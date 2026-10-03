import { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { ensureUser } from './cloud';
import {
  CAPITAL_SLOTS,
  CAPITAL_START,
  SKEW_MS,
  START_TROOPS,
  TROOP_MAX,
  WORLD_MAX,
  banditGarrison,
  garrisonAt,
  sourceFor,
  troopsAt,
  type Player,
  type Tile,
} from './conquest';

// Conquista en Firestore (las reglas validan cada escritura; ver firestore.rules):
//   conquest/{lunes}/members/{uid}             en qué mundo juega cada alcalde
//   conquest/{lunes}/worlds/{w}                cuántos alcaldes tiene el mundo
//   conquest/{lunes}/worlds/{w}/players/{uid}  reserva de tropas
//   conquest/{lunes}/worlds/{w}/tiles/{q_r}    territorios con dueño

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
    ctRaw: x.ct,
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
 * Envía `sent` tropas de la reserva al territorio `target` (conquista o refuerzo). Las cuentas usan
 * el margen de reloj (SKEW_MS) para que el servidor nunca vea menos tropas ni más guarnición.
 */
export async function sendTroops(week: string, w: string, me: Player, name: string, target: string, sent: number, world: WorldData, at: number) {
  const d = need();
  const from = sourceFor(target, world.tiles, me.uid);
  if (!from) throw new Error('Necesitas un territorio vecino');
  const troops = troopsAt(me, at - SKEW_MS) - sent;
  if (troops < 0) throw new Error('No tienes tantas tropas');
  const tile = world.tiles.get(target);
  let data: Record<string, unknown>;
  if (tile?.owner === me.uid) {
    // Refuerzo: se conserva la hora de la conquista (el escudo no se renueva)
    data = { capital: tile.capital, ct: tile.ctRaw, g: garrisonAt(tile, at - SKEW_MS) + sent };
  } else if (tile) {
    const g = sent - Math.ceil(garrisonAt(tile, at + SKEW_MS));
    if (g < 0) throw new Error('No son suficientes tropas');
    data = { capital: false, ct: serverTimestamp(), g };
  } else {
    const g = sent - banditGarrison(target);
    if (g <= 0) throw new Error('No son suficientes tropas');
    data = { capital: false, ct: serverTimestamp(), g };
  }
  const base = ['conquest', week, 'worlds', w] as const;
  const b = writeBatch(d);
  b.update(doc(d, ...base, 'players', me.uid), { troops, t: serverTimestamp(), last: target, sent });
  b.set(doc(d, ...base, 'tiles', target), { owner: me.uid, name, t: serverTimestamp(), sent, from, ...data });
  await b.commit();
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
