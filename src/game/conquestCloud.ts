import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ensureUser } from './cloud';
import {
  CAPITAL_SLOTS,
  CAPITAL_START,
  SKEW_MS,
  START_TROOPS,
  TROOP_MAX,
  WORLD_MAX,
  attackPower,
  banditGarrison,
  garrisonAt,
  standings,
  troopsAt,
  type Player,
  type Report,
  type Standing,
  type Tile,
} from './conquest';

// Conquista en Firestore (las reglas validan cada escritura; ver firestore.rules):
//   conquest/{lunes}/members/{uid}             en qué mundo juega cada alcalde
//   conquest/{lunes}/worlds/{w}                cuántos alcaldes tiene el mundo
//   conquest/{lunes}/worlds/{w}/players/{uid}  reserva de tropas
//   conquest/{lunes}/worlds/{w}/tiles/{q_r}    territorios con dueño
//   .../players/{uid}/reports/{id}             partes de batalla: quién te quitó qué (solo los lee su dueño)

function need() {
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ms = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Date.now();
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Mundo en el que juega el alcalde esta semana (null si aún no se unió). Siempre del servidor. */
export async function myWorld(week: string): Promise<string | null> {
  const d = need();
  const user = await ensureUser();
  if (!user) throw new Error('Sin sesión');
  const snap = await getDocFromServer(doc(d, 'conquest', week, 'members', user.uid));
  const w = snap.data()?.w;
  return typeof w === 'string' ? w : null;
}

/** Se une a la conquista de la semana: primer mundo con sitio, siguiente casilla de capital. Devuelve el mundo. */
export async function joinConquest(week: string, name: string): Promise<string> {
  const d = need();
  const user = await ensureUser();
  if (!user) throw new Error('Sin sesión');
  const uid = user.uid;
  try {
    return await runTransaction(d, async (tx) => {
      for (let i = 0; i < 100; i++) {
        const w = `w${i}`;
        const ref = doc(d, 'conquest', week, 'worlds', w);
        const snap = await tx.get(ref);
        const members = snap.exists() ? num(snap.data().members) : 0;
        if (members >= WORLD_MAX) continue;
        const base = ['conquest', week, 'worlds', w] as const;
        tx.set(doc(d, 'conquest', week, 'members', uid), { w });
        tx.set(ref, { members: members + 1 });
        tx.set(doc(d, ...base, 'players', uid), { name, slot: members, troops: START_TROOPS, t: serverTimestamp(), rDay: '', rToday: 0, last: '', sent: 0 });
        tx.set(doc(d, ...base, 'tiles', CAPITAL_SLOTS[members]), {
          owner: uid,
          name,
          g: CAPITAL_START,
          t: serverTimestamp(),
          ct: serverTimestamp(),
          capital: true,
          sent: 0,
          from: '',
          to: '',
        });
        return w;
      }
      throw new Error('No queda sitio en ningún mundo');
    });
  } catch (e) {
    // Ya unido (desde otro dispositivo): las reglas no dejan unirse dos veces, pero vale la de antes
    if ((e as { code?: string })?.code === 'permission-denied') {
      const w = await myWorld(week);
      if (w) return w;
    }
    throw e;
  }
}

function parseTile(id: string, x: DocumentData): Tile | null {
  if (typeof x.owner !== 'string') return null;
  return {
    id,
    owner: x.owner,
    name: str(x.name).slice(0, 20) || '???',
    g: Math.max(0, num(x.g)),
    t: ms(x.t),
    ct: ms(x.ct),
    capital: x.capital === true,
  };
}

function parsePlayer(uid: string, x: DocumentData): Player {
  return {
    uid,
    name: str(x.name).slice(0, 20) || '???',
    slot: Math.floor(num(x.slot)),
    troops: Math.max(0, num(x.troops)),
    t: ms(x.t),
    rDay: str(x.rDay),
    rToday: Math.floor(num(x.rToday)),
    aAt: x.aAt ? ms(x.aAt) : 0,
  };
}

export interface WorldData {
  tiles: Map<string, Tile>;
  players: Player[];
}

/** Escucha el mundo en vivo (territorios y alcaldes). Devuelve la función para dejar de escuchar. */
export function watchWorld(week: string, w: string, onData: (data: WorldData) => void, onError: (e: unknown) => void): () => void {
  const d = need();
  let tiles: Map<string, Tile> | null = null;
  let players: Player[] | null = null;
  const emit = () => tiles && players && onData({ tiles, players });
  // 'estimate': lo recién escrito por ti tiene la hora del servidor pendiente; se usa una estimación
  const opts = { serverTimestamps: 'estimate' } as const;
  const stopTiles = onSnapshot(
    collection(d, 'conquest', week, 'worlds', w, 'tiles'),
    (snap) => {
      const next = new Map<string, Tile>();
      for (const x of snap.docs) {
        const tile = parseTile(x.id, x.data(opts));
        if (tile) next.set(x.id, tile);
      }
      tiles = next;
      emit();
    },
    onError,
  );
  const stopPlayers = onSnapshot(
    collection(d, 'conquest', week, 'worlds', w, 'players'),
    (snap) => {
      players = snap.docs.map((x) => parsePlayer(x.id, x.data(opts)));
      emit();
    },
    onError,
  );
  return () => {
    stopTiles();
    stopPlayers();
  };
}

/**
 * Ataca `target` con `sent` soldados del territorio propio vecino `from`. Las cuentas usan el margen de
 * reloj (SKEW_MS) para que el servidor nunca vea más soldados en el origen ni menos en el objetivo.
 * `mult`: bono del asalto (1 = sin asalto); la fuerza `p` es lo que cuenta contra los defensores, pero
 * nunca sobreviven más soldados de los enviados.
 */
export async function attackFrom(
  week: string,
  w: string,
  uid: string,
  name: string,
  from: string,
  target: string,
  sent: number,
  world: WorldData,
  at: number,
  mult = 1,
) {
  const d = need();
  const src = world.tiles.get(from);
  if (!src || src.owner !== uid) throw new Error('Ese territorio ya no es tuyo');
  const left = garrisonAt(src, at - SKEW_MS) - sent;
  if (left < 0) throw new Error('No tiene tantos soldados');
  const p = attackPower(sent, mult);
  const tile = world.tiles.get(target);
  const g = Math.min(sent, tile ? p - Math.ceil(garrisonAt(tile, at + SKEW_MS)) : p - banditGarrison(target));
  if (g < 0 || (!tile && g === 0)) throw new Error('No son suficientes soldados');
  const base = ['conquest', week, 'worlds', w] as const;
  const b = writeBatch(d);
  // El origen baja (y dice a dónde mandó cuántos); el objetivo pasa a ser tuyo con lo que sobra
  b.update(doc(d, ...base, 'tiles', from), { name, g: left, t: serverTimestamp(), to: target, sent, from: '' });
  b.set(doc(d, ...base, 'tiles', target), { owner: uid, name, g, t: serverTimestamp(), ct: serverTimestamp(), capital: false, sent, p, from, to: '' });
  // Con bono de asalto: queda apuntado (las reglas solo dejan uno cada 10 min)
  if (p > sent) b.update(doc(d, ...base, 'players', uid), { aAt: serverTimestamp() });
  // Parte de batalla para el alcalde que pierde el territorio (lo verá al volver)
  if (tile) b.set(doc(collection(d, ...base, 'players', tile.owner, 'reports')), { by: uid, name, tile: target, at: serverTimestamp() });
  await b.commit();
}

/** Refuerza un territorio propio con `sent` tropas de la reserva (se conserva la hora de la conquista). */
export async function reinforce(week: string, w: string, me: Player, name: string, target: string, sent: number, world: WorldData, at: number) {
  const d = need();
  const tile = world.tiles.get(target);
  if (!tile || tile.owner !== me.uid) throw new Error('Ese territorio ya no es tuyo');
  const troops = troopsAt(me, at - SKEW_MS) - sent;
  if (troops < 0) throw new Error('No tienes tantas tropas en la reserva');
  const base = ['conquest', week, 'worlds', w] as const;
  const b = writeBatch(d);
  b.update(doc(d, ...base, 'players', me.uid), { troops, t: serverTimestamp(), last: target, sent });
  b.update(doc(d, ...base, 'tiles', target), { name, g: garrisonAt(tile, at - SKEW_MS) + sent, t: serverTimestamp(), sent, from: target, to: '' });
  await b.commit();
}

/** Partes de batalla recibidos después de `sinceMs` (hora del servidor). */
export async function fetchReports(week: string, w: string, sinceMs: number): Promise<Report[]> {
  const d = need();
  const user = await ensureUser();
  if (!user) return [];
  const q = query(
    collection(d, 'conquest', week, 'worlds', w, 'players', user.uid, 'reports'),
    where('at', '>', Timestamp.fromMillis(sinceMs)),
    orderBy('at'),
    limit(30),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((x) => {
      const v = x.data();
      const at = v.at?.toMillis?.();
      return typeof at === 'number' && typeof v.by === 'string' && typeof v.tile === 'string' ? { by: v.by, name: str(v.name).slice(0, 20) || '???', tile: v.tile, at } : null;
    })
    .filter((r): r is Report => !!r);
}

// ---------- Administración ----------

/** Mundos de una semana y cuántos alcaldes tiene cada uno. */
export async function fetchWorlds(week: string): Promise<{ w: string; members: number }[]> {
  const d = need();
  const snap = await getDocsFromServer(collection(d, 'conquest', week, 'worlds'));
  return snap.docs.map((x) => ({ w: x.id, members: Math.floor(num(x.data().members)) })).sort((a, b) => Number(a.w.slice(1)) - Number(b.w.slice(1)));
}

/** Un mundo leído una vez del servidor (territorios y alcaldes). */
export async function fetchWorldOnce(week: string, w: string): Promise<WorldData> {
  const d = need();
  const [tiles, players] = await Promise.all([
    getDocsFromServer(collection(d, 'conquest', week, 'worlds', w, 'tiles')),
    getDocsFromServer(collection(d, 'conquest', week, 'worlds', w, 'players')),
  ]);
  const map = new Map<string, Tile>();
  for (const x of tiles.docs) {
    const t = parseTile(x.id, x.data());
    if (t) map.set(x.id, t);
  }
  return { tiles: map, players: players.docs.map((x) => parsePlayer(x.id, x.data())) };
}

/** Moderación: devuelve un territorio a los bandidos (las reglas solo lo permiten al administrador). */
export async function removeTile(week: string, w: string, id: string): Promise<void> {
  await deleteDoc(doc(need(), 'conquest', week, 'worlds', w, 'tiles', id));
}

/** Clasificación final de una temporada terminada (del servidor: sin conexión no se cobra). */
export async function fetchFinalStandings(week: string, w: string): Promise<{ rows: Standing[]; size: number }> {
  const d = need();
  await ensureUser();
  const [tiles, players] = await Promise.all([
    getDocsFromServer(collection(d, 'conquest', week, 'worlds', w, 'tiles')),
    getDocsFromServer(collection(d, 'conquest', week, 'worlds', w, 'players')),
  ]);
  const ts = tiles.docs.map((x) => parseTile(x.id, x.data())).filter((t): t is Tile => !!t);
  const ps = players.docs.map((x) => parsePlayer(x.id, x.data()));
  return { rows: standings(ts, ps), size: ps.length };
}

/** Suma a la reserva los reclutas ganados hoy por jugar. */
export async function sendRecruits(week: string, w: string, me: Player, n: number, day: string, at: number) {
  const d = need();
  const rToday = (me.rDay === day ? me.rToday : 0) + n;
  const troops = Math.min(TROOP_MAX, troopsAt(me, at - SKEW_MS) + n);
  await writeBatch(d)
    .update(doc(d, 'conquest', week, 'worlds', w, 'players', me.uid), { troops, t: serverTimestamp(), rDay: day, rToday })
    .commit();
}
