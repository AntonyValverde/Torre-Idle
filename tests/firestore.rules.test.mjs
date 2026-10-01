// Pruebas de las reglas de Firestore contra el emulador local (no toca la base de datos real).
// Requiere Java. Ejecutar con: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

// CUP_SHIFT_DAYS=n mueve la semana de la Copa n días hacia atrás (en las reglas y en las pruebas):
// así se puede probar el sábado y el domingo cualquier día. Solo cambia la copia en memoria de las reglas.
const CUP_SHIFT_MS = Math.round(Number(process.env.CUP_SHIFT_DAYS ?? 0) * 86400000);
let rulesText = readFileSync(process.env.RULES_PATH ?? 'firestore.rules', 'utf8');
if (CUP_SHIFT_MS) {
  const marker = 'toMillis() + 21600000)';
  if (!rulesText.includes(marker)) throw new Error('No se encontró el inicio de semana de la Copa en las reglas');
  rulesText = rulesText.replace(marker, `toMillis() + 21600000 - ${CUP_SHIFT_MS})`);
}

const env = await initializeTestEnvironment({
  projectId: 'demo-torre',
  firestore: { rules: rulesText, host: '127.0.0.1', port: 8080 },
});

const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const anon = env.unauthenticatedContext().firestore();
const ADMIN_EMAIL = 'antonyvalverde2003@gmail.com';
const admin = env.authenticatedContext('boss', { email: ADMIN_EMAIL, email_verified: true }).firestore();
// Mismo correo pero sin verificar (p. ej. alguien que lo escribió en un registro con contraseña)
const fakeAdmin = env.authenticatedContext('fake', { email: ADMIN_EMAIL, email_verified: false }).firestore();
const otherGoogle = env.authenticatedContext('carol', { email: 'carol@gmail.com', email_verified: true }).firestore();
const carolDb = () => otherGoogle;

let pass = 0;
let fail = 0;
async function t(name, fn, shouldPass) {
  try {
    await (shouldPass ? assertSucceeds(fn()) : assertFails(fn()));
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name} -> ${e.message?.split('\n')[0]}`);
  }
}
const ok = (n, f) => t(n, f, true);
const no = (n, f) => t(n, f, false);

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = key(new Date());
const future = key(new Date(Date.now() + 5 * 86400000));

console.log('users/{uid}');
const ua = doc(alice, 'users/alice');
await ok('crear con ping del servidor', () => setDoc(ua, { ping: serverTimestamp() }, { merge: true }));
await ok('guardar partida', () => setDoc(ua, { state: { coins: 5 }, name: 'Alice', totalEarned: 100, savedAt: serverTimestamp() }, { merge: true }));
await ok('ping de nuevo (conserva totalEarned)', () => setDoc(ua, { ping: serverTimestamp() }, { merge: true }));
await ok('subir progreso', () => setDoc(ua, { state: { coins: 9 }, totalEarned: 200, savedAt: serverTimestamp() }, { merge: true }));
await no('BAJAR progreso (dispositivo viejo)', () => setDoc(ua, { state: { coins: 1 }, totalEarned: 150, savedAt: serverTimestamp() }, { merge: true }));
await no('marca de tiempo falsa del cliente', () => setDoc(ua, { ping: Timestamp.fromMillis(Date.now() + 86400000) }, { merge: true }));
await no('campo extra', () => setDoc(ua, { admin: true }, { merge: true }));
await no('state que no es un mapa', () => setDoc(ua, { state: 'hack' }, { merge: true }));
await no('otro usuario lee', () => getDoc(doc(bob, 'users/alice')));
await no('otro usuario escribe', () => setDoc(doc(bob, 'users/alice'), { ping: serverTimestamp() }, { merge: true }));
await no('sin sesión lee', () => getDoc(doc(anon, 'users/alice')));
await ok('el dueño lee', () => getDoc(ua));

console.log('leaderboards');
const la = doc(alice, 'leaderboards/stack/scores/alice');
await ok('crear récord', () => setDoc(la, { name: 'Alice', score: 10, updatedAt: serverTimestamp() }));
await ok('lectura pública', () => getDoc(doc(anon, 'leaderboards/stack/scores/alice')));
await no('puntuación menor', () => setDoc(la, { name: 'Alice', score: 5, updatedAt: serverTimestamp() }));
await no('récord antes de 5 s', () => setDoc(la, { name: 'Alice', score: 20, updatedAt: serverTimestamp() }));
await ok('renombrar', () => updateDoc(la, { name: 'José Ñú_2' }));
await no('nombre con carácter invisible', () => updateDoc(la, { name: 'Ali​ce' }));
await no('nombre con HTML', () => updateDoc(la, { name: '<b>x</b>' }));
await no('nombre con espacio al final', () => updateDoc(la, { name: 'Alice ' }));
await no('nombre demasiado largo', () => updateDoc(la, { name: 'a'.repeat(21) }));
await no('renombrar + cambiar puntuación', () => updateDoc(la, { name: 'Alice', score: 999 }));
await no('escribir el récord de otro', () => setDoc(doc(bob, 'leaderboards/stack/scores/alice'), { name: 'Bob', score: 1, updatedAt: serverTimestamp() }));
await no('puntuación imposible', () => setDoc(doc(bob, 'leaderboards/stack/scores/bob'), { name: 'Bob', score: 1001, updatedAt: serverTimestamp() }));
await no('puntuación decimal', () => setDoc(doc(bob, 'leaderboards/thief/scores/bob'), { name: 'Bob', score: 10.5, updatedAt: serverTimestamp() }));
await no('ranking inventado', () => setDoc(doc(bob, 'leaderboards/hack/scores/bob'), { name: 'Bob', score: 1, updatedAt: serverTimestamp() }));
await no('updatedAt falso', () => setDoc(doc(bob, 'leaderboards/merge/scores/bob'), { name: 'Bob', score: 1, updatedAt: Timestamp.now() }));
await ok('ciudad con número grande', () => setDoc(doc(bob, 'leaderboards/city/scores/bob'), { name: 'Bob', score: 1.5e40, updatedAt: serverTimestamp() }));
await ok('semáforo', () => setDoc(doc(bob, 'leaderboards/traffic/scores/bob'), { name: 'Bob', score: 42, updatedAt: serverTimestamp() }));
await no('semáforo imposible', () => setDoc(doc(alice, 'leaderboards/traffic/scores/alice'), { name: 'Alice', score: 5001, updatedAt: serverTimestamp() }));
await ok('memoria', () => setDoc(doc(bob, 'leaderboards/memory/scores/bob'), { name: 'Bob', score: 12, updatedAt: serverTimestamp() }));
await no('memoria imposible', () => setDoc(doc(alice, 'leaderboards/memory/scores/alice'), { name: 'Alice', score: 501, updatedAt: serverTimestamp() }));
await ok('bomberos', () => setDoc(doc(bob, 'leaderboards/fire/scores/bob'), { name: 'Bob', score: 140, updatedAt: serverTimestamp() }));
await no('bomberos imposible', () => setDoc(doc(alice, 'leaderboards/fire/scores/alice'), { name: 'Alice', score: 5001, updatedAt: serverTimestamp() }));
await ok('metro', () => setDoc(doc(bob, 'leaderboards/metro/scores/bob'), { name: 'Bob', score: 75, updatedAt: serverTimestamp() }));
await no('metro decimal', () => setDoc(doc(alice, 'leaderboards/metro/scores/alice'), { name: 'Alice', score: 7.5, updatedAt: serverTimestamp() }));
await new Promise((r) => setTimeout(r, 5500));
await ok('récord mayor tras 5 s', () => setDoc(la, { name: 'Alice', score: 20, updatedAt: serverTimestamp() }));

console.log('daily (Apagón)');
const da = doc(alice, `daily/${today}/scores/alice`);
const entry = (moves, timeMs) => ({ name: 'Alice', moves, timeMs, score: moves * 10000000 + timeMs, createdAt: serverTimestamp() });
await no('día futuro', () => setDoc(doc(alice, `daily/${future}/scores/alice`), entry(8, 5000)));
await no('demasiado rápido para un humano', () => setDoc(da, entry(8, 1500)));
await no('score que no cuadra', () => setDoc(da, { ...entry(8, 5000), score: 1 }));
await ok('resultado de hoy', () => setDoc(da, entry(8, 5000)));
await no('reescribir resultado', () => setDoc(da, entry(6, 4000)));
await no('cambiar movimientos', () => updateDoc(da, { moves: 1 }));
await ok('renombrar en el diario', () => updateDoc(da, { name: 'Alicia' }));

console.log('roads (Conecta las calles)');
const ra = doc(alice, `roads/${today}/scores/alice`);
await no('calles: día futuro', () => setDoc(doc(alice, `roads/${future}/scores/alice`), entry(20, 9000)));
await no('calles: demasiado rápido', () => setDoc(ra, entry(20, 2000)));
await no('calles: resultado de otro', () => setDoc(doc(bob, `roads/${today}/scores/alice`), entry(20, 9000)));
await ok('calles: resultado de hoy', () => setDoc(ra, entry(20, 9000)));
await no('calles: reescribir resultado', () => setDoc(ra, entry(10, 9000)));
await ok('calles: lectura pública', () => getDoc(doc(anon, `roads/${today}/scores/alice`)));
await ok('calles: renombrar', () => updateDoc(ra, { name: 'Alicia' }));

console.log('parks (Plan verde)');
const pa = doc(alice, `parks/${today}/scores/alice`);
await no('plan verde: día futuro', () => setDoc(doc(alice, `parks/${future}/scores/alice`), entry(30, 12000)));
await no('plan verde: demasiado rápido', () => setDoc(pa, entry(30, 3000)));
await ok('plan verde: resultado de hoy', () => setDoc(pa, entry(30, 12000)));
await no('plan verde: reescribir resultado', () => setDoc(pa, entry(25, 12000)));
await ok('plan verde: lectura pública', () => getDoc(doc(anon, `parks/${today}/scores/alice`)));
await no('plan verde: un jugador no borra', () => deleteDoc(pa));

console.log('cities (ciudades públicas)');
const ca = doc(alice, 'cities/alice');
const city = (extra = {}) => ({ name: 'Alice', era: 2, layout: '4,4,3,2,1,0,0,0,0,0,0,0,0,0,0,0', buildings: 120, earned: 1.5e9, stars: 3, updatedAt: serverTimestamp(), ...extra });
await ok('ciudad: publicar la mía', () => setDoc(ca, city()));
await ok('ciudad: cualquiera la visita', () => getDoc(doc(anon, 'cities/alice')));
await no('ciudad: actualizar antes de 30 s', () => setDoc(ca, city({ buildings: 130 })));
await no('ciudad: publicar la de otro', () => setDoc(doc(bob, 'cities/alice'), city({ name: 'Bob' })));
await no('ciudad: plano mal formado', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', layout: '<img src=x>' })));
await no('ciudad: tamaño de edificio imposible', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', layout: '9,9,9' })));
await no('ciudad: campo extra', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', admin: true })));
await no('ciudad: falta un campo', () => {
  const { stars, ...rest } = city({ name: 'Bob' });
  return setDoc(doc(bob, 'cities/bob'), rest);
});
await no('ciudad: era decimal', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', era: 1.5 })));
await no('ciudad: nombre con HTML', () => setDoc(doc(bob, 'cities/bob'), city({ name: '<b>x</b>' })));
await no('ciudad: un jugador no borra', () => deleteDoc(ca));
await no('ciudad: copas mal escritas', () => setDoc(doc(carolDb(), 'cities/carol'), city({ name: 'Carol', cups: 'muchas' })));
await ok('ciudad: con su vitrina y temporadas', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', cups: '2,0,1,1' })));
await ok('ciudad: vitrina de una versión anterior (3 números)', () => setDoc(doc(carolDb(), 'cities/carol'), city({ name: 'Carol', cups: '1,0,0' })));
await no('ciudad: vitrina con 5 números', () => setDoc(doc(fakeAdmin, 'cities/fake'), city({ name: 'Fake', cups: '1,1,1,1,1' })));

console.log('league');
const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const thisMonday = key(mondayOf(new Date()));
const lastMonday = key(new Date(mondayOf(new Date()).getTime() - 7 * 86400000));
const notMonday = key(new Date(mondayOf(new Date()).getTime() + 2 * 86400000));
const lg = (score) => ({ name: 'Alice', score, updatedAt: serverTimestamp() });
const lgA = doc(alice, `league/${thisMonday}/scores/alice`);
await ok('liga: puntos de esta semana', () => setDoc(lgA, lg(30)));
await ok('liga: lectura pública', () => getDoc(doc(anon, `league/${thisMonday}/scores/alice`)));
await no('liga: bajar puntos', () => setDoc(lgA, lg(20)));
await no('liga: subir antes de 5 s', () => setDoc(lgA, lg(40)));
await no('liga: semana pasada', () => setDoc(doc(alice, `league/${lastMonday}/scores/alice`), lg(30)));
await no('liga: fecha que no es lunes', () => setDoc(doc(alice, `league/${notMonday}/scores/alice`), lg(30)));
await no('liga: más del máximo', () => setDoc(doc(bob, `league/${thisMonday}/scores/bob`), { ...lg(1001), name: 'Bob' }));
await no('liga: puntos de otro', () => setDoc(doc(bob, `league/${thisMonday}/scores/alice`), lg(50)));
await ok('liga: renombrar', () => updateDoc(lgA, { name: 'Alicia' }));
await no('liga: un jugador no borra', () => deleteDoc(lgA));

console.log('cup (Copa de Alcaldes)');
// Misma cuenta que src/game/cup.ts: semanas de lunes a domingo en hora de Costa Rica (UTC-6)
const CR = -6 * 3600000;
// Con CUP_SHIFT_DAYS las reglas ven la semana desplazada: aquí se hace la misma cuenta
const cupNow = Date.now() + CUP_SHIFT_MS;
const cupWeekOf = (ms) => {
  const d = new Date(ms + CR);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
};
const cupWeek = cupWeekOf(cupNow);
const [cy, cm, cd] = cupWeek.split('-').map(Number);
const cupDay = Math.floor((cupNow - (Date.UTC(cy, cm - 1, cd) - CR)) / 86400000);
const cupPhaseNow = cupDay < 5 ? 'signup' : cupDay < 6 ? 'groups' : 'final';
const nextCup = cupWeekOf(cupNow + 7 * 86400000);
console.log(`  (semana ${cupWeek}, fase de hoy: ${cupPhaseNow})`);
const cupEntry = (extra = {}) => ({ name: 'Alice', tier: 9, gold: 0, silver: 0, bronze: 0, createdAt: serverTimestamp(), ...extra });
const ceA = doc(alice, `cup/${cupWeek}/entries/alice`);
const crA = doc(alice, `cup/${cupWeek}/results/alice`);
await no('copa: inscribirse en la semana que viene', () => setDoc(doc(alice, `cup/${nextCup}/entries/alice`), cupEntry()));
await no('copa: semana que no es lunes', () => setDoc(doc(alice, `cup/${notMonday}/entries/alice`), cupEntry()));
await no('copa: inscribir a otro', () => setDoc(doc(bob, `cup/${cupWeek}/entries/alice`), cupEntry()));
await no('copa: marcas sin estar inscrito', () => setDoc(doc(bob, `cup/${cupWeek}/results/bob`), { name: 'Bob', g1: 10, updatedAt: serverTimestamp() }));
if (cupPhaseNow === 'signup') {
  await no('copa: nivel imposible', () => setDoc(doc(bob, `cup/${cupWeek}/entries/bob`), { ...cupEntry({ tier: 999 }), name: 'Bob' }));
  await no('copa: campo extra', () => setDoc(doc(bob, `cup/${cupWeek}/entries/bob`), { ...cupEntry({ hack: 1 }), name: 'Bob' }));
  await ok('copa: inscribirse', () => setDoc(ceA, cupEntry()));
  await ok('copa: lectura pública de inscritos', () => getDocs(collection(anon, `cup/${cupWeek}/entries`)));
  await no('copa: cambiar el nivel tras inscribirse', () => updateDoc(ceA, { tier: 1 }));
  await ok('copa: cambiar el nombre', () => updateDoc(ceA, { name: 'Alicia' }));
  await no('copa: marcas de grupo antes del sábado', () => setDoc(crA, { name: 'Alice', g1: 10, updatedAt: serverTimestamp() }));
  await no('copa: marca de la final antes del domingo', () => setDoc(crA, { name: 'Alice', f: 10, updatedAt: serverTimestamp() }));
  await no('copa: un jugador no se borra', () => deleteDoc(ceA));
  await ok('copa: el admin descalifica antes de los grupos', () => deleteDoc(doc(admin, `cup/${cupWeek}/entries/alice`)));
} else {
  await no('copa: inscribirse fuera de plazo', () => setDoc(ceA, cupEntry()));
  // Con la inscripción cerrada, se crea a mano (sin reglas) para probar las marcas
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `cup/${cupWeek}/entries/alice`), cupEntry({ createdAt: Timestamp.now() })));
  const slot = cupPhaseNow === 'groups' ? 'g1' : 'f';
  const other = cupPhaseNow === 'groups' ? 'f' : 'g1';
  await ok(`copa: subir marca del día (${slot})`, () => setDoc(crA, { name: 'Alice', [slot]: 30, updatedAt: serverTimestamp() }, { merge: true }));
  await no('copa: subir otra vez antes de 5 s', () => setDoc(crA, { name: 'Alice', [slot]: 40, updatedAt: serverTimestamp() }, { merge: true }));
  await new Promise((r) => setTimeout(r, 5500));
  await no('copa: bajar la marca', () => setDoc(crA, { name: 'Alice', [slot]: 20, updatedAt: serverTimestamp() }, { merge: true }));
  await no(`copa: marca de otro día (${other})`, () => setDoc(crA, { name: 'Alice', [other]: 20, updatedAt: serverTimestamp() }, { merge: true }));
  await no('copa: marca imposible', () => setDoc(crA, { name: 'Alice', [slot]: 5001, updatedAt: serverTimestamp() }, { merge: true }));
  await ok('copa: mejorar la marca', () => setDoc(crA, { name: 'Alice', [slot]: 45, updatedAt: serverTimestamp() }, { merge: true }));
  await no('copa: el admin ya no borra inscripciones', () => deleteDoc(doc(admin, `cup/${cupWeek}/entries/alice`)));
}
await ok('copa: lectura pública de resultados', () => getDocs(collection(anon, `cup/${cupWeek}/results`)));
await ok('copa: el admin borra marcas', () => deleteDoc(doc(admin, `cup/${cupWeek}/results/alice`)));

console.log('suggestions');
const suggestion = (db, uid, extra = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, 'suggestions', `${uid}-${Math.random().toString(36).slice(2)}`), {
    uid,
    name: 'Alice',
    kind: 'idea',
    text: 'Un minijuego de trenes',
    era: 2,
    ua: 'Mozilla/5.0',
    status: 'nuevo',
    createdAt: serverTimestamp(),
    ...extra,
  });
  b.set(doc(db, 'suggestionMeta', uid), { lastAt: serverTimestamp() });
  return b.commit();
};
await ok('enviar sugerencia', () => suggestion(alice, 'alice'));
await no('otra antes de un minuto', () => suggestion(alice, 'alice'));
await no('sugerencia sin marcar suggestionMeta', () =>
  setDoc(doc(bob, 'suggestions/x1'), { uid: 'bob', name: 'Bob', kind: 'idea', text: 'Hola mundo', status: 'nuevo', createdAt: serverTimestamp() }),
);
await no('sugerencia a nombre de otro', () => suggestion(bob, 'alice'));
await no('texto demasiado corto', () => suggestion(bob, 'bob', { text: 'hey' }));
await no('texto demasiado largo', () => suggestion(bob, 'bob', { text: 'x'.repeat(1001) }));
await no('tipo inventado', () => suggestion(bob, 'bob', { kind: 'spam' }));
await no('estado distinto de nuevo', () => suggestion(bob, 'bob', { status: 'hecho' }));
await no('sin sesión', () => suggestion(anon, 'nadie'));
await ok('otro jugador envía la suya', () => suggestion(bob, 'bob'));
await no('un jugador no puede leer las sugerencias', () => getDocs(collection(alice, 'suggestions')));
await no('otra cuenta de Google tampoco', () => getDocs(collection(otherGoogle, 'suggestions')));
await no('correo del admin sin verificar no es admin', () => getDocs(collection(fakeAdmin, 'suggestions')));
await ok('el admin lee las sugerencias', () => getDocs(collection(admin, 'suggestions')));
let anyId = '';
await env.withSecurityRulesDisabled(async (ctx) => {
  anyId = (await getDocs(collection(ctx.firestore(), 'suggestions'))).docs[0].id;
});
await ok('el admin marca como leída', () => updateDoc(doc(admin, 'suggestions', anyId), { status: 'leido' }));
await no('el admin no puede reescribir el texto', () => updateDoc(doc(admin, 'suggestions', anyId), { text: 'otra cosa' }));
await no('estado inventado', () => updateDoc(doc(admin, 'suggestions', anyId), { status: 'borrado' }));
await no('un jugador no cambia el estado', () => updateDoc(doc(alice, 'suggestions', anyId), { status: 'hecho' }));
await no('un jugador no borra sugerencias', () => deleteDoc(doc(alice, 'suggestions', anyId)));
await ok('el admin borra una sugerencia', () => deleteDoc(doc(admin, 'suggestions', anyId)));

console.log('admin');
await ok('el admin lee admin/access', () => getDoc(doc(admin, 'admin/access')));
await no('un jugador no lee admin/access', () => getDoc(doc(alice, 'admin/access')));
await no('el admin no escribe en admin/', () => setDoc(doc(admin, 'admin/access'), { x: 1 }));
await ok('el admin lee la partida de un jugador', () => getDoc(doc(admin, 'users/alice')));
await no('el admin no modifica partidas', () => setDoc(doc(admin, 'users/alice'), { ping: serverTimestamp() }, { merge: true }));
await no('un jugador no borra su récord', () => deleteDoc(doc(alice, 'leaderboards/stack/scores/alice')));
await ok('el admin quita a alguien del ranking', () => deleteDoc(doc(admin, 'leaderboards/stack/scores/alice')));
await ok('el admin quita un resultado diario', () => deleteDoc(doc(admin, `roads/${today}/scores/alice`)));
await ok('el admin quita a alguien de la liga', () => deleteDoc(doc(admin, `league/${thisMonday}/scores/alice`)));
await ok('el admin quita un resultado del plan verde', () => deleteDoc(doc(admin, `parks/${today}/scores/alice`)));
await ok('el admin borra una ciudad pública', () => deleteDoc(doc(admin, 'cities/alice')));

console.log('otros');
await no('colección inventada', () => setDoc(doc(alice, 'admin/config'), { x: 1 }));

console.log(`\n${pass} ok, ${fail} FAIL`);
await env.cleanup();
process.exit(fail ? 1 : 0);
