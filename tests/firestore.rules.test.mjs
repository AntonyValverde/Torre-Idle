// Pruebas de las reglas de Firestore contra el emulador local (no toca la base de datos real).
// Requiere Java. Ejecutar con: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-torre',
  firestore: { rules: readFileSync(process.env.RULES_PATH ?? 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const anon = env.unauthenticatedContext().firestore();
const ADMIN_EMAIL = 'antonyvalverde2003@gmail.com';
const admin = env.authenticatedContext('boss', { email: ADMIN_EMAIL, email_verified: true }).firestore();
// Mismo correo pero sin verificar (p. ej. alguien que lo escribió en un registro con contraseña)
const fakeAdmin = env.authenticatedContext('fake', { email: ADMIN_EMAIL, email_verified: false }).firestore();
const otherGoogle = env.authenticatedContext('carol', { email: 'carol@gmail.com', email_verified: true }).firestore();

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

console.log('otros');
await no('colección inventada', () => setDoc(doc(alice, 'admin/config'), { x: 1 }));

console.log(`\n${pass} ok, ${fail} FAIL`);
await env.cleanup();
process.exit(fail ? 1 : 0);
