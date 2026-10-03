import { hashString } from '../minigames/rng';
import { cupStart, cupWeekKey } from './cup';
import type { GameState } from './state';

// Conquista: una temporada por semana (lunes a domingo, hora de Costa Rica, como la Copa) en mundos de
// hasta 16 alcaldes. El mapa es una cuadrícula hexagonal; cada alcalde tiene una capital que no se puede
// perder y se expande desde ella. Las tropas salen de una reserva que se recarga sola y crece con
// reclutas por jugar. Las reglas de Firestore repiten estas mismas cuentas para validar cada envío
// (ver firestore.rules): si cambias una cifra aquí, cámbiala también allí.

/** Radio del mapa: 61 territorios. */
export const RADIUS = 4;
export const WORLD_MAX = 16;
/** Reserva de tropas: 1 cada 3 min hasta 60 (unas 3 h fuera). Los reclutas pueden pasar del tope. */
export const TROOP_MS = 180_000;
export const TROOP_CAP = 60;
export const TROOP_MAX = 200;
export const START_TROOPS = 20;
/** Reclutas por actividad: como mucho tantos al día. */
export const RECRUITS_DAY = 30;
export const RECRUIT_MISSION = 5;
export const RECRUIT_DAILY = 5;
export const RECRUIT_INCIDENT = 3;
/** Guarnición de un territorio propio: crece 1 cada 10 min hasta 30 (la capital, hasta 50). */
export const GROW_MS = 600_000;
export const TILE_CAP = 30;
export const CAPITAL_CAP = 50;
export const CAPITAL_START = 20;
/** Tras una conquista, el territorio no se puede atacar durante 30 min. */
export const SHIELD_MS = 30 * 60_000;
/** La Torre central: guarnición de bandidos y valor en la clasificación. */
export const CENTER = '0_0';
export const CENTER_BANDITS = 40;
export const CENTER_VALUE = 3;
/**
 * Margen por si el reloj del móvil no coincide del todo con el del servidor: las tropas se cuentan
 * como si fuera un poco antes y las guarniciones enemigas, un poco después.
 */
export const SKEW_MS = 20_000;

/** Casillas de capital (en el anillo exterior), en el orden en que se reparten. */
export const CAPITAL_SLOTS = [
  '-4_4', '4_-4', '0_4', '0_-4', '4_0', '-4_0', '-2_4', '2_-4', '2_2', '-2_-2', '4_-2', '-4_2', '-3_4', '3_-4', '3_1', '-3_-1',
];
const CAPITAL_SET = new Set(CAPITAL_SLOTS);

// ---------- Hexágonos (coordenadas axiales q, r) ----------

export interface Hex {
  q: number;
  r: number;
}

export const tileId = (q: number, r: number) => `${q}_${r}`;

export function parseTile(id: string): Hex | null {
  if (!/^-?[0-4]_-?[0-4]$/.test(id)) return null;
  const [q, r] = id.split('_').map(Number);
  return hexDist2(q, r) <= 2 * RADIUS ? { q, r } : null;
}

/** El doble de la distancia al centro (así es siempre un entero, como en las reglas). */
export function hexDist2(q: number, r: number): number {
  return Math.abs(q) + Math.abs(r) + Math.abs(q + r);
}

export function distToCenter(id: string): number {
  const h = parseTile(id);
  return h ? hexDist2(h.q, h.r) / 2 : Infinity;
}

export function adjacent(a: string, b: string): boolean {
  const x = parseTile(a);
  const y = parseTile(b);
  return !!x && !!y && hexDist2(x.q - y.q, x.r - y.r) === 2;
}

const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function neighbors(id: string): string[] {
  const h = parseTile(id);
  if (!h) return [];
  return DIRS.map(([dq, dr]) => tileId(h.q + dq, h.r + dr)).filter((x) => parseTile(x));
}

/** Todos los territorios del mapa. */
export const ALL_TILES: string[] = (() => {
  const out: string[] = [];
  for (let q = -RADIUS; q <= RADIUS; q++) for (let r = -RADIUS; r <= RADIUS; r++) if (hexDist2(q, r) <= 2 * RADIUS) out.push(tileId(q, r));
  return out;
})();

export const isCapitalSlot = (id: string) => CAPITAL_SET.has(id);

/** Guarnición de bandidos de un territorio sin dueño: más fuerte cuanto más cerca del centro. */
export function banditGarrison(id: string): number {
  if (id === CENTER) return CENTER_BANDITS;
  const h = parseTile(id);
  // 4 + 3 por cada paso hacia el centro: 4 en el borde, 13 junto a la Torre central
  return h ? 16 - (3 * hexDist2(h.q, h.r)) / 2 : Infinity;
}

// ---------- Datos de la nube ----------

export interface Tile {
  id: string;
  owner: string;
  name: string;
  /** Guarnición en el momento `t`. */
  g: number;
  t: number;
  /** Momento de la conquista: el escudo dura SHIELD_MS desde aquí. */
  ct: number;
  /** La hora de la conquista tal como viene de la nube: al reforzar se reescribe idéntica (las reglas lo exigen). */
  ctRaw?: unknown;
  capital: boolean;
}

export interface Player {
  uid: string;
  name: string;
  slot: number;
  troops: number;
  t: number;
  rDay: string;
  rToday: number;
}

/** Guarnición actual de un territorio con dueño (crece hasta su tope; lo que pasa del tope se queda). */
export function garrisonAt(tile: Pick<Tile, 'g' | 't' | 'capital'>, ms: number): number {
  const cap = tile.capital ? CAPITAL_CAP : TILE_CAP;
  if (tile.g >= cap) return tile.g;
  return Math.min(cap, tile.g + Math.max(0, ms - tile.t) / GROW_MS);
}

/** Tropas en la reserva (se recargan hasta TROOP_CAP; por encima, de reclutas, no recargan). */
export function troopsAt(p: Pick<Player, 'troops' | 't'>, ms: number): number {
  if (p.troops >= TROOP_CAP) return p.troops;
  return Math.min(TROOP_CAP, p.troops + Math.max(0, ms - p.t) / TROOP_MS);
}

/** Milisegundos hasta la próxima tropa (0 si la reserva está llena). */
export function nextTroopMs(p: Pick<Player, 'troops' | 't'>, ms: number): number {
  const now = troopsAt(p, ms);
  if (now >= TROOP_CAP) return 0;
  return Math.ceil((1 - (now % 1)) * TROOP_MS);
}

export function shielded(tile: Pick<Tile, 'ct'>, ms: number): boolean {
  return ms < tile.ct + SHIELD_MS;
}

export type TargetInfo =
  | { kind: 'reserved' }
  | { kind: 'far' }
  | { kind: 'capital'; owner: string }
  | { kind: 'shield'; until: number }
  | { kind: 'attack'; need: number; bandits: boolean }
  | { kind: 'reinforce' };

/**
 * Qué se puede hacer con un territorio: conquistarlo (y cuántas tropas hacen falta), reforzarlo, o nada.
 * `tiles` son los territorios con dueño; `me` el alcalde que mira.
 */
export function targetInfo(id: string, tiles: Map<string, Tile>, me: string, ms: number): TargetInfo {
  const tile = tiles.get(id);
  if (tile?.owner === me) return { kind: 'reinforce' };
  const near = neighbors(id).some((n) => tiles.get(n)?.owner === me);
  if (!tile && isCapitalSlot(id)) return { kind: 'reserved' };
  if (tile?.capital) return { kind: 'capital', owner: tile.owner };
  if (!near) return { kind: 'far' };
  if (!tile) return { kind: 'attack', need: banditGarrison(id) + 1, bandits: true };
  if (shielded(tile, ms - SKEW_MS)) return { kind: 'shield', until: tile.ct + SHIELD_MS };
  // Se cuenta la guarnición como si ya hubiera pasado el margen: el servidor nunca verá más
  return { kind: 'attack', need: Math.floor(garrisonAt(tile, ms + SKEW_MS)) + 1, bandits: false };
}

/**
 * Territorio propio desde el que salen las tropas: el vecino de más guarnición, o el mismo territorio
 * si es un refuerzo (así una capital aislada también se puede reforzar).
 */
export function sourceFor(id: string, tiles: Map<string, Tile>, me: string): string | null {
  if (tiles.get(id)?.owner === me) return id;
  const own = neighbors(id)
    .map((n) => tiles.get(n))
    .filter((t): t is Tile => !!t && t.owner === me)
    .sort((a, b) => b.g - a.g);
  return own[0]?.id ?? null;
}

export interface Standing {
  uid: string;
  name: string;
  tiles: number;
  points: number;
  center: boolean;
}

/** Clasificación del mundo: un punto por territorio y CENTER_VALUE por la Torre central. */
export function standings(tiles: Iterable<Tile>, players: Player[]): Standing[] {
  const by = new Map<string, Standing>();
  for (const p of players) by.set(p.uid, { uid: p.uid, name: p.name, tiles: 0, points: 0, center: false });
  for (const t of tiles) {
    const row = by.get(t.owner) ?? { uid: t.owner, name: t.name, tiles: 0, points: 0, center: false };
    row.tiles++;
    row.points += t.id === CENTER ? CENTER_VALUE : 1;
    if (t.id === CENTER) row.center = true;
    by.set(t.owner, row);
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.tiles - a.tiles || (a.uid < b.uid ? -1 : 1));
}

/** Color de cada alcalde en el mapa (el tuyo siempre azul). */
export function ownerHue(uid: string, me: string | null): number {
  if (uid === me) return 205;
  // Se evitan los azules para no confundirlos con los tuyos
  const h = hashString('color:' + uid) % 300;
  return h < 170 ? h : h + 60;
}

// ---------- Temporada ----------

/** La temporada es la semana de la Copa (lunes a domingo, hora de Costa Rica). */
export function seasonOf(ms: number): { week: string; endsAt: number } {
  const week = cupWeekKey(ms);
  return { week, endsAt: cupStart(week) + 7 * 86_400_000 };
}

// ---------- Reclutas en la partida ----------

export interface ConquestState {
  /** Día al que corresponde `recruits`. */
  day: string | null;
  /** Reclutas ganados hoy por actividad (se suben a la reserva al abrir la Conquista). */
  recruits: number;
}

export function newConquest(): ConquestState {
  return { day: null, recruits: 0 };
}

export function conquestState(v: unknown): ConquestState {
  if (!v || typeof v !== 'object') return newConquest();
  const r = v as Partial<ConquestState>;
  const n = typeof r.recruits === 'number' && Number.isFinite(r.recruits) ? Math.floor(r.recruits) : 0;
  return { day: typeof r.day === 'string' ? r.day : null, recruits: Math.max(0, Math.min(RECRUITS_DAY, n)) };
}

/** Suma reclutas de hoy por jugar (con el tope diario). */
export function addRecruits(s: GameState, n: number, day: string): GameState {
  const c = s.conquest.day === day ? s.conquest : { day, recruits: 0 };
  const recruits = Math.min(RECRUITS_DAY, c.recruits + n);
  if (recruits === c.recruits && c === s.conquest) return s;
  return { ...s, conquest: { day, recruits } };
}

/** Reclutas ganados hoy que aún no están en la reserva de la nube. */
export function recruitsToSend(s: GameState, p: Pick<Player, 'rDay' | 'rToday'>, day: string): number {
  if (s.conquest.day !== day) return 0;
  const sent = p.rDay === day ? p.rToday : 0;
  return Math.max(0, s.conquest.recruits - sent);
}
