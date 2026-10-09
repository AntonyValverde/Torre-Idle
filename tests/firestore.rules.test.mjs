// Pruebas de las reglas de Firestore contra el emulador local (no toca la base de datos real).
// Requiere Java. Ejecutar con: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
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
function check(name, cond) {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
}

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
await ok('guerra de torres', () => setDoc(doc(bob, 'leaderboards/towers/scores/bob'), { name: 'Bob', score: 42, updatedAt: serverTimestamp() }));
await no('guerra de torres imposible', () => setDoc(doc(alice, 'leaderboards/towers/scores/alice'), { name: 'Alice', score: 5001, updatedAt: serverTimestamp() }));
for (const board of ['flak', 'artillery', 'lanes', 'duel', 'squadron', 'sentry', 'night', 'sewer', 'neon', 'cannon']) {
  await ok(`juego de guerra ${board}`, () => setDoc(doc(bob, `leaderboards/${board}/scores/bob`), { name: 'Bob', score: 120, updatedAt: serverTimestamp() }));
  await no(`juego de guerra ${board} imposible`, () => setDoc(doc(alice, `leaderboards/${board}/scores/alice`), { name: 'Alice', score: 5001, updatedAt: serverTimestamp() }));
}
await no('ranking inventado', () => setDoc(doc(alice, 'leaderboards/war/scores/alice'), { name: 'Alice', score: 1, updatedAt: serverTimestamp() }));
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
await no('ciudad: cosmético mal formado', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', deco: 'Zeppelin,<b>' })));
await no('ciudad: demasiados cosméticos', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', deco: 'aaa,bbb,ccc,ddd,eee,fff,ggg,hhh,iii' })));
await no('ciudad: campo extra', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', admin: true })));
await no('ciudad: falta un campo', () => {
  const { stars, ...rest } = city({ name: 'Bob' });
  return setDoc(doc(bob, 'cities/bob'), rest);
});
await no('ciudad: era decimal', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', era: 1.5 })));
await no('ciudad: nombre con HTML', () => setDoc(doc(bob, 'cities/bob'), city({ name: '<b>x</b>' })));
await no('ciudad: un jugador no borra', () => deleteDoc(ca));
await no('ciudad: copas mal escritas', () => setDoc(doc(carolDb(), 'cities/carol'), city({ name: 'Carol', cups: 'muchas' })));
await ok('ciudad: con su vitrina, temporadas y cosméticos del pase', () => setDoc(doc(bob, 'cities/bob'), city({ name: 'Bob', cups: '2,0,1,1', deco: 'zeppelin,aurora' })));
await ok('ciudad: vitrina de una versión anterior (3 números)', () => setDoc(doc(carolDb(), 'cities/carol'), city({ name: 'Carol', cups: '1,0,0' })));
await no('ciudad: vitrina con 5 números', () => setDoc(doc(fakeAdmin, 'cities/fake'), city({ name: 'Fake', cups: '1,1,1,1,1' })));
const dave = env.authenticatedContext('dave').firestore();
await ok('ciudad: con regalos recibidos (❤️)', () => setDoc(doc(dave, 'cities/dave'), city({ name: 'Dave', gifts: 12 })));
const erin = env.authenticatedContext('erin').firestore();
await no('ciudad: regalos negativos', () => setDoc(doc(erin, 'cities/erin'), city({ name: 'Erin', gifts: -1 })));
await no('ciudad: regalos decimales', () => setDoc(doc(erin, 'cities/erin'), city({ name: 'Erin', gifts: 1.5 })));
await no('ciudad: regalos como texto', () => setDoc(doc(erin, 'cities/erin'), city({ name: 'Erin', gifts: 'mil' })));
await no('ciudad: conquistas negativas', () => setDoc(doc(erin, 'cities/erin'), city({ name: 'Erin', conq: -1 })));
await ok('ciudad: con conquistas ganadas (⚔️)', () => setDoc(doc(erin, 'cities/erin'), city({ name: 'Erin', conq: 2 })));
const gina = env.authenticatedContext('gina').firestore();
await no('ciudad: estilo de general mal formado', () => setDoc(doc(gina, 'cities/gina'), city({ name: 'Gina', army: 'caballería' })));
await no('ciudad: estilo de general con cuatro cifras', () => setDoc(doc(gina, 'cities/gina'), city({ name: 'Gina', army: '1000-0-0' })));
await no('ciudad: estilo de general como número', () => setDoc(doc(gina, 'cities/gina'), city({ name: 'Gina', army: 40 })));
await ok('ciudad: con estilo de general del Duelo', () => setDoc(doc(gina, 'cities/gina'), city({ name: 'Gina', army: '40-35-25' })));

console.log('gifts (regalos entre ciudades)');
// El regalo se renueva otro día (posterior); mañana sigue dentro del margen de ±36 h de las reglas
const tomorrow = key(new Date(Date.now() + 86400000));
const gift = (extra = {}) => ({ name: 'Bob', day: today, createdAt: serverTimestamp(), ...extra });
const gBob = doc(bob, 'gifts/alice/inbox/bob');
await ok('regalo: Bob deja un regalo en la ciudad de Alice', () => setDoc(gBob, gift()));
await no('regalo: otro el mismo día', () => setDoc(gBob, gift()));
await ok('regalo: renovarlo otro día', () => setDoc(gBob, gift({ day: tomorrow })));
await no('regalo: volver a un día anterior (alternar hoy/mañana)', () => setDoc(gBob, gift()));
await no('regalo: firmar como otro remitente', () => setDoc(doc(bob, 'gifts/alice/inbox/carol'), gift()));
await no('regalo: a uno mismo', () => setDoc(doc(alice, 'gifts/alice/inbox/alice'), gift({ name: 'Alice' })));
await no('regalo: a una ciudad que no existe', () => setDoc(doc(bob, 'gifts/fantasma/inbox/bob'), gift()));
await no('regalo: día futuro', () => setDoc(doc(bob, 'gifts/carol/inbox/bob'), gift({ day: future })));
await no('regalo: hora falsa del cliente', () => setDoc(doc(bob, 'gifts/carol/inbox/bob'), gift({ createdAt: Timestamp.fromMillis(Date.now()) })));
await no('regalo: campo extra (p. ej. tickets)', () => setDoc(doc(bob, 'gifts/carol/inbox/bob'), gift({ tickets: 99 })));
await no('regalo: nombre con HTML', () => setDoc(doc(bob, 'gifts/carol/inbox/bob'), gift({ name: '<b>x</b>' })));
await no('regalo: sin sesión', () => setDoc(doc(anon, 'gifts/carol/inbox/anon'), gift({ name: 'Anon' })));
await ok('regalo: Alice lee su buzón', () => getDocs(query(collection(alice, 'gifts/alice/inbox'), where('createdAt', '>', Timestamp.fromMillis(0)))));
await no('regalo: Bob no lee el buzón de Alice', () => getDocs(collection(bob, 'gifts/alice/inbox')));
await no('regalo: sin sesión no lee buzones', () => getDoc(doc(anon, 'gifts/alice/inbox/bob')));
await no('regalo: el remitente no lo borra', () => deleteDoc(gBob));
await ok('regalo: la destinataria lo borra', () => deleteDoc(doc(alice, 'gifts/alice/inbox/bob')));
await ok('regalo: el administrador lee buzones', () => getDocs(collection(admin, 'gifts/alice/inbox')));

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
// Lecturas incrementales (src/game/cupCloud.ts): solo las marcas subidas después de cierta hora
{
  const col = `cup/${cupWeek}/results`;
  const base = Date.now() - 120_000;
  const seeded = { 'inc-old': base, 'inc-new': base + 60_000, 'inc-now': null };
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [id, at] of Object.entries(seeded)) {
      await setDoc(doc(ctx.firestore(), col, id), { name: id, g1: 1, updatedAt: at === null ? serverTimestamp() : Timestamp.fromMillis(at) });
    }
  });
  const since = (ms) => getDocs(query(collection(anon, col), where('updatedAt', '>', Timestamp.fromMillis(ms)), limit(2000)));
  const ids = async (ms) => (await since(ms)).docs.map((d) => d.id).sort().join(',');
  await ok('copa: lectura pública de solo las marcas nuevas', () => since(base));
  check('copa: llegan solo las marcas posteriores', (await ids(base)) === 'inc-new,inc-now');
  check('copa: también las que puso la hora del servidor', (await ids(base + 60_000)) === 'inc-now');
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const id of Object.keys(seeded)) await deleteDoc(doc(ctx.firestore(), col, id));
  });
}

console.log('conquest (Conquista)');
{
  // Misma semana que la Copa. Capitales: alice en -4_4 (casilla 0) y bob en 4_-4 (casilla 1)
  const C = `conquest/${cupWeek}`;
  const W = `${C}/worlds/w0`;
  const SLOTS = ['-4_4', '4_-4', '0_4', '0_-4'];
  const join = (db, uid, name, slot, { week = cupWeek, w = 'w0', capital = SLOTS[slot], troops = 20, members = slot + 1, prev } = {}) => {
    const base = `conquest/${week}`;
    const b = writeBatch(db);
    b.set(doc(db, `${base}/members/${uid}`), { w });
    b.set(doc(db, `${base}/worlds/${w}`), prev === undefined ? { members } : { members, prev });
    b.set(doc(db, `${base}/worlds/${w}/players/${uid}`), { name, slot, troops, t: serverTimestamp(), rDay: '', rToday: 0, last: '', sent: 0 });
    b.set(doc(db, `${base}/worlds/${w}/tiles/${capital}`), { owner: uid, name, g: 20, t: serverTimestamp(), ct: serverTimestamp(), capital: true, sent: 0, from: '', to: '' });
    return b.commit();
  };
  // Ataque: el territorio de origen baja (y dice a dónde mandó) y el objetivo pasa al atacante, en el mismo lote
  // `p`: fuerza con bono de asalto; `assault`: apunta el bono en el alcalde (aAt + aTo) en el mismo lote
  const attack = (db, uid, name, target, from, sent, left, g, { skipFrom = false, p, assault = false, aTo = target } = {}) => {
    const b = writeBatch(db);
    if (!skipFrom) b.update(doc(db, `${W}/tiles/${from}`), { name, g: left, t: serverTimestamp(), to: target, sent, from: '' });
    b.set(doc(db, `${W}/tiles/${target}`), {
      owner: uid,
      name,
      g,
      t: serverTimestamp(),
      ct: serverTimestamp(),
      capital: false,
      sent,
      ...(p === undefined ? {} : { p }),
      from,
      to: '',
    });
    if (assault) b.update(doc(db, `${W}/players/${uid}`), { aAt: serverTimestamp(), aTo });
    return b.commit();
  };
  // Refuerzo desde la reserva: la reserva baja y el territorio propio sube, en el mismo lote
  const reinforce = (db, uid, name, target, sent, troops, g, { skipPlayer = false, extra = {} } = {}) => {
    const b = writeBatch(db);
    if (!skipPlayer) b.update(doc(db, `${W}/players/${uid}`), { troops, t: serverTimestamp(), last: target, sent });
    b.update(doc(db, `${W}/tiles/${target}`), { name, g, t: serverTimestamp(), sent, from: target, to: '', ...extra });
    return b.commit();
  };
  const seed = (path, data) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
  const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);
  const tileSeed = (owner, g, tAgo, ctAgo) => ({ owner, name: owner === 'alice' ? 'Alice' : 'Bob', g, t: ago(tAgo), ct: ago(ctAgo), capital: false, sent: 0, from: '', to: '' });

  await no('conquista: unirse con más tropas', () => join(alice, 'alice', 'Alice', 0, { troops: 99 }));
  await no('conquista: capital en otra casilla', () => join(alice, 'alice', 'Alice', 0, { capital: '4_-4' }));
  await no('conquista: unirse la semana que viene', () => join(alice, 'alice', 'Alice', 0, { week: nextCup }));
  await ok('conquista: unirse (primera capital)', () => join(alice, 'alice', 'Alice', 0));
  await no('conquista: unirse dos veces', () => join(alice, 'alice', 'Alice', 1, { members: 2 }));
  await no('conquista: ocupar una casilla ya dada', () => join(bob, 'bob', 'Bob', 0, { members: 1 }));
  await no('conquista: saltarse el contador', () => join(bob, 'bob', 'Bob', 2, { members: 3 }));
  await ok('conquista: el segundo alcalde, segunda capital', () => join(bob, 'bob', 'Bob', 1));

  // Mundos nuevos: solo cuando el anterior está lleno (16). w2 lleno, w3 con un alcalde, w4 no existe
  const frank = env.authenticatedContext('frank').firestore();
  const gina = env.authenticatedContext('gina').firestore();
  await seed(`${C}/worlds/w2`, { members: 16 });
  await no('conquista: abrir w9 sin anterior', () => join(gina, 'gina', 'Gina', 0, { w: 'w9' }));
  await no('conquista: abrir w5 con w4 inexistente', () => join(gina, 'gina', 'Gina', 0, { w: 'w5', prev: 'w4' }));
  await no('conquista: abrir w5 saltándose mundos (w2 lleno)', () => join(gina, 'gina', 'Gina', 0, { w: 'w5', prev: 'w2' }));
  await no('conquista: abrir w1 con w0 sin llenar', () => join(gina, 'gina', 'Gina', 0, { w: 'w1', prev: 'w0' }));
  await ok('conquista: abrir w3 con w2 lleno', () => join(frank, 'frank', 'Frank', 0, { w: 'w3', prev: 'w2' }));
  await no('conquista: abrir w4 con w3 sin llenar', () => join(gina, 'gina', 'Gina', 0, { w: 'w4', prev: 'w3' }));
  await no('conquista: w0 con anterior', () => join(gina, 'gina', 'Gina', 0, { week: cupWeek, w: 'w0', prev: 'w2' }));
  await ok('conquista: unirse a un mundo abierto (w3)', () => join(gina, 'gina', 'Gina', 1, { w: 'w3' }));
  await ok('conquista: lectura pública del mundo', () => getDocs(collection(anon, `${W}/tiles`)));

  // Bandidos: -4_3 tiene 4 (borde) y -3_3 tiene 7. Se ataca desde la capital (20 soldados)
  await no('conquista: no basta con igualar a los bandidos', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 4, 16, 0));
  await no('conquista: guarnición inflada', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 5, 15, 5));
  await no('conquista: una casilla de capital libre no se toma', () => attack(alice, 'alice', 'Alice', '-3_4', '-4_4', 10, 10, 6));
  await no('conquista: un territorio que no es vecino', () => attack(alice, 'alice', 'Alice', '0_0', '-4_4', 19, 1, 0));
  await no('conquista: más soldados de los que tiene el origen', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 21, 0, 17));
  await no('conquista: sin restar los soldados del origen', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 5, 20, 1));
  await no('conquista: territorio sin pasar por el origen', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 5, 15, 1, { skipFrom: true }));
  await no('conquista: atacar desde un territorio ajeno', () => attack(alice, 'alice', 'Alice', '3_-3', '4_-4', 8, 12, 1));
  await ok('conquista: tomar un territorio de bandidos', () => attack(alice, 'alice', 'Alice', '-4_3', '-4_4', 5, 15, 1));
  await ok('conquista: y otro más hacia el centro', () => attack(alice, 'alice', 'Alice', '-3_3', '-4_4', 8, 7, 1));

  // La reserva solo refuerza lo propio, y se conserva la hora de la conquista (el escudo no se renueva)
  await no('conquista: refuerzo inflado', () => reinforce(alice, 'alice', 'Alice', '-3_3', 3, 17, 10));
  await no('conquista: refuerzo sin gastar la reserva', () => reinforce(alice, 'alice', 'Alice', '-3_3', 3, 20, 4));
  await no('conquista: reforzar sin pasar por la reserva', () => reinforce(alice, 'alice', 'Alice', '-3_3', 3, 17, 4, { skipPlayer: true }));
  await no('conquista: reforzar renovando el escudo', () => reinforce(alice, 'alice', 'Alice', '-3_3', 3, 17, 4, { extra: { ct: serverTimestamp() } }));
  await no('conquista: reforzar lo ajeno', () => reinforce(alice, 'alice', 'Alice', '4_-4', 3, 17, 23));
  await ok('conquista: reforzar desde la reserva', () => reinforce(alice, 'alice', 'Alice', '-3_3', 3, 17, 4));

  // La reserva se recarga: 1 tropa cada 3 min
  await seed(`${W}/players/alice`, { name: 'Alice', slot: 0, troops: 0, t: ago(30 * 60000), rDay: '', rToday: 0, last: '', sent: 0 });
  await no('conquista: más de lo recargado', () => reinforce(alice, 'alice', 'Alice', '-3_3', 11, 0, 15));
  await ok('conquista: gastar lo recargado (10 en 30 min)', () => reinforce(alice, 'alice', 'Alice', '-3_3', 10, 0, 14));
  // La recarga cuenta fracciones (4,5 min = 1,5 tropas): el móvil guarda lo que sobra
  await seed(`${W}/players/alice`, { name: 'Alice', slot: 0, troops: 0, t: ago(270000), rDay: '', rToday: 0, last: '', sent: 0 });
  await no('conquista: más de la fracción recargada', () => reinforce(alice, 'alice', 'Alice', '-3_3', 1, 0.6, 15));
  await ok('conquista: la recarga cuenta fracciones', () => reinforce(alice, 'alice', 'Alice', '-3_3', 1, 0.4, 15));

  // Los soldados de un territorio crecen solos: 1 cada 4 min (de 0 a 15 en una hora)
  await seed(`${W}/tiles/-3_3`, tileSeed('alice', 0, 3600000, 3600000));
  await no('conquista: más soldados de los que crecieron', () => attack(alice, 'alice', 'Alice', '-2_3', '-3_3', 16, 0, 9));
  await ok('conquista: atacar con los soldados que crecieron', () => attack(alice, 'alice', 'Alice', '-2_3', '-3_3', 15, 0, 8));

  // Otro alcalde: bob tiene -3_2 con 30 soldados, vecino de -4_3 (de alice)
  await seed(`${W}/tiles/-3_2`, tileSeed('bob', 30, 0, 3600000));
  await no('conquista: atacar bajo escudo', () => attack(bob, 'bob', 'Bob', '-4_3', '-3_2', 10, 20, 1));
  // Sin escudo: los soldados de alice crecieron de 1 a 16 en una hora
  await seed(`${W}/tiles/-4_3`, tileSeed('alice', 1, 3600000, 3600000));
  await no('conquista: no basta con igualar los que crecieron', () => attack(bob, 'bob', 'Bob', '-4_3', '-3_2', 16, 14, 0));
  await no('conquista: conquistar con guarnición inflada', () => attack(bob, 'bob', 'Bob', '-4_3', '-3_2', 18, 12, 5));
  await ok('conquista: conquistar el territorio de otro alcalde', () => attack(bob, 'bob', 'Bob', '-4_3', '-3_2', 18, 12, 1));
  await no('conquista: una capital no se conquista', () => attack(bob, 'bob', 'Bob', '-4_4', '-4_3', 1, 0, 0));
  await no('conquista: atacar diciendo que sale del propio objetivo', () => attack(bob, 'bob', 'Bob', '-2_2', '-2_2', 5, 0, 1));
  await no('conquista: escribir territorios a nombre de otro', () => attack(bob, 'alice', 'Alice', '-2_2', '-3_3', 5, 5, 0));

  // Asalto: la fuerza `p` llega a x1,5 de los enviados si el alcalde apunta el bono (uno cada 10 min).
  // -2_2 tiene 10 bandidos; alice ataca desde -3_3 con 20 soldados
  await seed(`${W}/tiles/-3_3`, tileSeed('alice', 20, 0, 3600000));
  await no('asalto: fuerza de más sin apuntar el bono', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 2, { p: 12 }));
  await no('asalto: bono de más de x1,5', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 3, { p: 13, assault: true }));
  await no('asalto: menos fuerza que soldados', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 12, 8, 2, { p: 11, assault: true }));
  await no('asalto: sobreviven más de los enviados', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 8, { p: 12, assault: true }));
  await no('asalto: guarnición inflada con el bono', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 3, { p: 12, assault: true }));
  await no('asalto: bono apuntado a otro territorio', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 2, { p: 12, assault: true, aTo: '0_0' }));
  await no('asalto: bono sin objetivo (solo aAt)', () => {
    const b = writeBatch(alice);
    b.update(doc(alice, `${W}/tiles/-3_3`), { name: 'Alice', g: 12, t: serverTimestamp(), to: '-2_2', sent: 8, from: '' });
    b.set(doc(alice, `${W}/tiles/-2_2`), { owner: 'alice', name: 'Alice', g: 2, t: serverTimestamp(), ct: serverTimestamp(), capital: false, sent: 8, p: 12, from: '-3_3', to: '' });
    b.update(doc(alice, `${W}/players/alice`), { aAt: serverTimestamp() });
    return b.commit();
  });
  await ok('asalto: tomar bandidos con bono x1,5', () => attack(alice, 'alice', 'Alice', '-2_2', '-3_3', 8, 12, 2, { p: 12, assault: true }));
  // 2_1 tiene 7 bandidos; alice ataca desde 1_1
  await seed(`${W}/tiles/1_1`, tileSeed('alice', 20, 0, 3600000));
  await no('asalto: otro bono antes de 10 min', () => attack(alice, 'alice', 'Alice', '2_1', '1_1', 6, 14, 2, { p: 9, assault: true }));
  await no('asalto: apuntar otro bono suelto antes de 10 min', () =>
    updateDoc(doc(alice, `${W}/players/alice`), { aAt: serverTimestamp() }),
  );
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `${W}/players/alice`), { aAt: ago(11 * 60000) }));
  await no('asalto: mover la hora del bono al pasado', () =>
    updateDoc(doc(alice, `${W}/players/alice`), { troops: 0, t: serverTimestamp(), last: '1_1', sent: 1, aAt: ago(3600000) }),
  );
  await ok('asalto: pasados 10 min, otro bono', () => attack(alice, 'alice', 'Alice', '2_1', '1_1', 6, 14, 2, { p: 9, assault: true }));
  // Contra otro alcalde: alice tiene -1_3 con 10; bob ataca desde 0_2 con 20
  await seed(`${W}/tiles/-1_3`, tileSeed('alice', 10, 0, 3600000));
  await seed(`${W}/tiles/0_2`, tileSeed('bob', 20, 0, 3600000));
  await no('asalto: sin bono, 8 no bastan contra 10', () => attack(bob, 'bob', 'Bob', '-1_3', '0_2', 8, 12, 0));
  await no('asalto: con fuerza de más pero sin apuntar el bono', () => attack(bob, 'bob', 'Bob', '-1_3', '0_2', 8, 12, 1, { p: 12 }));
  await ok('asalto: conquistar a otro alcalde con bono', () => attack(bob, 'bob', 'Bob', '-1_3', '0_2', 8, 12, 1, { p: 12, assault: true }));

  // Partes de batalla: van en el mismo lote que la conquista y solo los lee quien perdió el territorio
  await seed(`${W}/tiles/-2_1`, tileSeed('alice', 1, 3600000, 3600000));
  await seed(`${W}/tiles/-3_2`, tileSeed('bob', 30, 0, 3600000));
  // El id del parte es el territorio conquistado: así hay exactamente uno por conquista
  const report = (db, to, rid = '-2_1') => doc(db, `${W}/players/${to}/reports/${rid}`);
  const captureWithReport = (to, extra = {}, { rid, second } = {}) => {
    const b = writeBatch(bob);
    // Los soldados de alice crecieron a algo más de 16 en esa hora: con 18 queda 1
    b.update(doc(bob, `${W}/tiles/-3_2`), { name: 'Bob', g: 12, t: serverTimestamp(), to: '-2_1', sent: 18, from: '' });
    b.set(doc(bob, `${W}/tiles/-2_1`), { owner: 'bob', name: 'Bob', g: 1, t: serverTimestamp(), ct: serverTimestamp(), capital: false, sent: 18, from: '-3_2', to: '' });
    b.set(report(bob, to, rid), { by: 'bob', name: 'Bob', tile: '-2_1', at: serverTimestamp(), ...extra });
    if (second) b.set(report(bob, to, second), { by: 'bob', name: 'Bob', tile: '-2_1', at: serverTimestamp() });
    return b.commit();
  };
  await no('conquista: parte a quien no era el dueño', () => captureWithReport('carol'));
  await no('conquista: parte firmado por otro', () => captureWithReport('alice', { by: 'alice' }));
  await no('conquista: parte con otro id que el territorio', () => captureWithReport('alice', {}, { rid: 'x1' }));
  await no('conquista: dos partes por la misma conquista', () => captureWithReport('alice', {}, { second: 'x2' }));
  await ok('conquista: conquistar con parte de batalla', () => captureWithReport('alice'));
  await no('conquista: parte sin conquista', () => setDoc(report(bob, 'alice', '-3_3'), { by: 'bob', name: 'Bob', tile: '-3_3', at: serverTimestamp() }));
  await ok('conquista: el que perdió lee sus partes', () => getDocs(collection(alice, `${W}/players/alice/reports`)));
  await no('conquista: nadie más los lee', () => getDocs(collection(bob, `${W}/players/alice/reports`)));

  // Reclutas: hasta 30 al día (45 con la ley Militar), sumados a la reserva
  const rec = (troops, rDay, rToday) => updateDoc(doc(alice, `${W}/players/alice`), { troops, t: serverTimestamp(), rDay, rToday });
  await no('conquista: reclutas de otro día', () => rec(5, future, 5));
  // El móvil pone su día local: mañana queda fuera (las zonas horarias solo llegan a UTC+14), hoy vale
  await no('conquista: reclutas de mañana', () => rec(5, key(new Date(Date.now() + 2 * 86400000)), 5));
  await no('conquista: más de 45 reclutas', () => rec(46, today, 46));
  await no('conquista: tropas de más con los reclutas', () => rec(9, today, 5));
  await ok('conquista: sumar reclutas', () => rec(5, today, 5));
  await no('conquista: cobrar los mismos reclutas otra vez', () => rec(10, today, 5));
  await ok('conquista: más reclutas el mismo día', () => rec(8, today, 8));
  // La capital también se refuerza desde la reserva
  const gCap = (await getDoc(doc(alice, `${W}/tiles/-4_4`))).data().g;
  await ok('conquista: reforzar la capital desde la reserva', () => reinforce(alice, 'alice', 'Alice', '-4_4', 2, 6, gCap + 2));
  await no('conquista: cambiar la casilla de capital', () => updateDoc(doc(alice, `${W}/players/alice`), { slot: 5 }));
  await ok('conquista: cambiar el nombre', () => updateDoc(doc(alice, `${W}/players/alice`), { name: 'Alicia' }));
  await no('conquista: un alcalde no borra territorios', () => deleteDoc(doc(alice, `${W}/tiles/-3_3`)));
  await ok('conquista: el admin borra un territorio', () => deleteDoc(doc(admin, `${W}/tiles/-3_3`)));
}

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

console.log('eliminar cuenta');
const tomb = () => ({ deleted: true, deletedAt: serverTimestamp() });
await no('un jugador no elimina la cuenta de otro', () => setDoc(doc(bob, 'users/alice'), tomb()));
await no('marca con campos extra', () => setDoc(doc(admin, 'users/alice'), { ...tomb(), state: {} }));
await no('marca con hora del cliente', () => setDoc(doc(admin, 'users/alice'), { deleted: true, deletedAt: Timestamp.now() }));
await no('marca a medias (merge con la partida)', () => setDoc(doc(admin, 'users/alice'), tomb(), { merge: true }));
// El panel no deja al admin eliminarse a sí mismo; desde Perfil puede, como cualquier jugador
await ok('el admin elimina su propia cuenta (desde Perfil)', () => setDoc(doc(admin, 'users/boss'), tomb()));
await ok('el admin elimina la cuenta', () => setDoc(doc(admin, 'users/alice'), tomb()));
await ok('repetirlo no falla', () => setDoc(doc(admin, 'users/alice'), tomb()));
await ok('el admin elimina una cuenta que nunca guardó', () => setDoc(doc(admin, 'users/ghost'), tomb()));
await ok('el dueño aún lee la marca (así su juego se entera)', () => getDoc(ua));
await no('el dueño no guarda encima de la marca', () => setDoc(ua, { ping: serverTimestamp() }, { merge: true }));
await no('ni sustituyendo el documento entero', () =>
  setDoc(ua, { state: { coins: 1 }, name: 'Alice', totalEarned: 999, savedAt: serverTimestamp() }),
);
await no('ni borrándola', () => deleteDoc(ua));
await no('un jugador sin la marca no borra su suggestionMeta', () => deleteDoc(doc(bob, 'suggestionMeta/bob')));
await ok('el admin borra su suggestionMeta', () => deleteDoc(doc(admin, 'suggestionMeta/alice')));
await ok('el admin borra en lote (también documentos que no existen)', () => {
  const b = writeBatch(admin);
  b.delete(doc(admin, 'daily/2026-09-27/scores/alice'));
  b.delete(doc(admin, 'roads/2026-09-27/scores/alice'));
  b.delete(doc(admin, 'league/2026-09-28/scores/alice'));
  b.delete(doc(admin, 'leaderboards/metro/scores/alice'));
  return b.commit();
});

console.log('el jugador elimina su cuenta');
{
  const hugo = env.authenticatedContext('hugo').firestore();
  const H = `conquest/${cupWeek}/worlds/w9`;
  const seed = {
    'users/hugo': { state: { coins: 1 }, name: 'Hugo', totalEarned: 50 },
    'leaderboards/stack/scores/hugo': { name: 'Hugo', score: 10 },
    'leaderboards/stack/scores/bob': { name: 'Bob', score: 10 },
    [`daily/${today}/scores/hugo`]: { name: 'Hugo', moves: 5, timeMs: 9000, score: 50009000 },
    [`roads/${today}/scores/hugo`]: { name: 'Hugo', moves: 5, timeMs: 9000, score: 50009000 },
    [`parks/${today}/scores/hugo`]: { name: 'Hugo', moves: 5, timeMs: 9000, score: 50009000 },
    [`league/${thisMonday}/scores/hugo`]: { name: 'Hugo', score: 40 },
    'cities/hugo': { name: 'Hugo' },
    [`cup/${cupWeek}/entries/hugo`]: { name: 'Hugo' },
    [`cup/${cupWeek}/results/hugo`]: { name: 'Hugo', g1: 10 },
    'suggestionMeta/hugo': { lastAt: Timestamp.now() },
    'suggestions/hugo-1': { uid: 'hugo', name: 'Hugo', kind: 'idea', text: 'Más trenes', status: 'nuevo' },
    'suggestions/bob-1': { uid: 'bob', name: 'Bob', kind: 'idea', text: 'Más barcos', status: 'nuevo' },
    'gifts/hugo/inbox/bob': { name: 'Bob', day: today },
    [`conquest/${cupWeek}/members/hugo`]: { w: 'w9' },
    [`${H}/players/hugo`]: { name: 'Hugo', slot: 3 },
    [`${H}/players/hugo/reports/1_1`]: { by: 'bob', name: 'Bob', tile: '1_1' },
    [`${H}/tiles/1_1`]: { owner: 'hugo', name: 'Hugo' },
    [`${H}/tiles/1_2`]: { owner: 'bob', name: 'Bob' },
  };
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of Object.entries(seed)) await setDoc(doc(ctx.firestore(), path), data);
  });
  const mineSugg = () => getDocs(query(collection(hugo, 'suggestions'), where('uid', '==', 'hugo')));
  await no('sin la marca no borra su récord', () => deleteDoc(doc(hugo, 'leaderboards/stack/scores/hugo')));
  await no('sin la marca no borra su resultado diario (lo repetiría)', () => deleteDoc(doc(hugo, `daily/${today}/scores/hugo`)));
  await no('sin la marca no borra su suggestionMeta', () => deleteDoc(doc(hugo, 'suggestionMeta/hugo')));
  await no('sin la marca no borra sus territorios', () => deleteDoc(doc(hugo, `${H}/tiles/1_1`)));
  await ok('lee sus sugerencias', mineSugg);
  await no('no lee las de otros', () => getDocs(query(collection(hugo, 'suggestions'), where('uid', '==', 'alice'))));
  await no('marca propia con campos extra', () => setDoc(doc(hugo, 'users/hugo'), { ...tomb(), state: {} }));
  await no('marca propia a medias (merge)', () => setDoc(doc(hugo, 'users/hugo'), tomb(), { merge: true }));
  await ok('se pone la marca a sí mismo', () => setDoc(doc(hugo, 'users/hugo'), tomb()));
  await ok('repetir la marca no falla', () => setDoc(doc(hugo, 'users/hugo'), tomb()));
  await no('ya no guarda partida', () => setDoc(doc(hugo, 'users/hugo'), { ping: serverTimestamp() }, { merge: true }));
  await ok('borra en lotes de 10 (también documentos que no existen)', () => {
    const b = writeBatch(hugo);
    for (const path of [
      'leaderboards/stack/scores/hugo',
      'leaderboards/merge/scores/hugo',
      `daily/${today}/scores/hugo`,
      `roads/${today}/scores/hugo`,
      `parks/${today}/scores/hugo`,
      'daily/2026-09-27/scores/hugo',
      `league/${thisMonday}/scores/hugo`,
      'league/2026-09-28/scores/hugo',
      'cities/hugo',
      `cup/${cupWeek}/results/hugo`,
    ])
      b.delete(doc(hugo, path));
    return b.commit();
  });
  await ok('borra su suggestionMeta, su buzón y sus sugerencias', async () => {
    const b = writeBatch(hugo);
    b.delete(doc(hugo, 'suggestionMeta/hugo'));
    b.delete(doc(hugo, 'gifts/hugo/inbox/bob'));
    for (const s of (await mineSugg()).docs) b.delete(s.ref);
    return b.commit();
  });
  await no('no borra territorios de otro', () => deleteDoc(doc(hugo, `${H}/tiles/1_2`)));
  await no('no borra récords de otro', () => deleteDoc(doc(hugo, 'leaderboards/stack/scores/bob')));
  await no('no borra sugerencias de otro', () => deleteDoc(doc(hugo, 'suggestions/bob-1')));
  await ok('borra sus partes y territorios (vuelven a los bandidos)', () => {
    const b = writeBatch(hugo);
    b.delete(doc(hugo, `${H}/players/hugo/reports/1_1`));
    b.delete(doc(hugo, `${H}/tiles/1_1`));
    return b.commit();
  });
  await ok('borra su reserva y su plaza en la Conquista', () => {
    const b = writeBatch(hugo);
    b.delete(doc(hugo, `${H}/players/hugo`));
    b.delete(doc(hugo, `conquest/${cupWeek}/members/hugo`));
    return b.commit();
  });
  if (cupPhaseNow === 'signup') await ok('se borra de la Copa antes de los grupos', () => deleteDoc(doc(hugo, `cup/${cupWeek}/entries/hugo`)));
  else await no('ya no se borra de la Copa tras los grupos', () => deleteDoc(doc(hugo, `cup/${cupWeek}/entries/hugo`)));
  await no('otro jugador no borra lo de quien se marcó', () => deleteDoc(doc(bob, 'cities/hugo')));
  await no('ni con la marca puede borrar la partida', () => deleteDoc(doc(hugo, 'users/hugo')));
}

console.log('otros');
await no('colección inventada', () => setDoc(doc(alice, 'admin/config'), { x: 1 }));

console.log(`\n${pass} ok, ${fail} FAIL`);
await env.cleanup();
process.exit(fail ? 1 : 0);
