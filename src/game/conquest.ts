import { hashString } from '../minigames/rng';
import { advisorMult } from './advisors';
import { cupStart, cupWeekKey } from './cup';
import { currentLaw, lawMult } from './laws';
import type { GameState } from './state';

// Conquista: una temporada por semana (lunes a domingo, hora de Costa Rica, como la Copa) en mundos de
// hasta 16 alcaldes. El mapa es una cuadrícula hexagonal; cada alcalde tiene una capital que no se puede
// perder y se expande desde ella. Como en la Guerra de torres, cada territorio genera soldados y se ataca
// desde uno propio a un vecino con sus soldados. La reserva (se recarga sola y suma reclutas por jugar)
// sirve para reforzar tus territorios. Las reglas de Firestore repiten estas mismas cuentas para validar
// cada envío (ver firestore.rules): si cambias una cifra aquí, cámbiala también allí.

/** Radio del mapa: 61 territorios. */
export const RADIUS = 4;
export const WORLD_MAX = 16;
/** Reserva para reforzar: 1 cada 3 min hasta 60 (unas 3 h fuera). Los reclutas pueden pasar del tope. */
export const TROOP_MS = 180_000;
export const TROOP_CAP = 60;
export const TROOP_MAX = 200;
export const START_TROOPS = 20;
/** Reclutas por actividad: como mucho tantos al día (45 con la ley Militar; las reglas aceptan 45). */
export const RECRUITS_DAY = 30;
export const RECRUITS_MAX = 45;
export const RECRUIT_MISSION = 5;
export const RECRUIT_DAILY = 5;
export const RECRUIT_INCIDENT = 3;
/** Soldados de un territorio propio: crecen 1 cada 4 min hasta 30; la capital, 1 cada 2 min hasta 60. */
export const GROW_MS = 240_000;
export const CAPITAL_GROW_MS = 120_000;
export const TILE_CAP = 30;
export const CAPITAL_CAP = 60;
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
/**
 * Asalto: antes de atacar se puede jugar una batalla corta de la Guerra de torres que multiplica la
 * fuerza de los soldados enviados, como mucho x1,5. Las reglas no pueden ver el minijuego, así que solo
 * ponen el tope y dejan usar un ataque con bono cada 10 min por alcalde.
 */
export const ASSAULT_MAX = 1.5;
export const ASSAULT_COOLDOWN_MS = 10 * 60_000;

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
  /** Último ataque con bono de asalto (0 si nunca). */
  aAt: number;
}

/** Fuerza de un ataque: los soldados por el bono del asalto (con tope), redondeada hacia abajo. */
export function attackPower(sent: number, mult = 1): number {
  const m = Math.min(ASSAULT_MAX, Math.max(1, mult));
  return Math.floor(sent * m + 1e-9);
}

/** Soldados que hay que enviar para llegar a una fuerza `need` con un bono dado. */
export function soldiersFor(need: number, mult = 1): number {
  let n = Math.max(1, Math.ceil(need / Math.min(ASSAULT_MAX, Math.max(1, mult))));
  while (n > 1 && attackPower(n - 1, mult) >= need) n--;
  while (attackPower(n, mult) < need) n++;
  return n;
}

/** Milisegundos hasta poder usar otro bono de asalto (0 si ya se puede). Cuenta el margen de reloj. */
export function assaultWaitMs(p: Pick<Player, 'aAt'>, ms: number): number {
  if (!p.aAt) return 0;
  return Math.max(0, p.aAt + ASSAULT_COOLDOWN_MS + SKEW_MS - ms);
}

/** Soldados de un territorio con dueño (crecen hasta su tope; lo que pasa del tope por refuerzos se queda). */
export function garrisonAt(tile: Pick<Tile, 'g' | 't' | 'capital'>, ms: number): number {
  const cap = tile.capital ? CAPITAL_CAP : TILE_CAP;
  if (tile.g >= cap) return tile.g;
  return Math.min(cap, tile.g + Math.max(0, ms - tile.t) / (tile.capital ? CAPITAL_GROW_MS : GROW_MS));
}

/** Milisegundos hasta que un territorio propio tenga `n` soldados (0 si ya los tiene; Infinity si no llega). */
export function msUntilGarrison(tile: Pick<Tile, 'g' | 't' | 'capital'>, n: number, ms: number): number {
  const now = garrisonAt(tile, ms);
  if (now >= n) return 0;
  if (n > (tile.capital ? CAPITAL_CAP : TILE_CAP)) return Infinity;
  return Math.ceil((n - now) * (tile.capital ? CAPITAL_GROW_MS : GROW_MS));
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
  /** `from`: territorio propio vecino desde el que se ataca. */
  | { kind: 'attack'; need: number; bandits: boolean; from: string }
  | { kind: 'own' };

/**
 * Qué se puede hacer con un territorio: atacarlo desde un territorio tuyo vecino (y cuántos soldados
 * hacen falta), reforzarlo desde la reserva si es tuyo, o nada. `prefer`: territorio propio elegido
 * antes como origen (si es vecino, se ataca desde él).
 */
export function targetInfo(id: string, tiles: Map<string, Tile>, me: string, ms: number, prefer: string | null = null): TargetInfo {
  const tile = tiles.get(id);
  if (tile?.owner === me) return { kind: 'own' };
  if (!tile && isCapitalSlot(id)) return { kind: 'reserved' };
  if (tile?.capital) return { kind: 'capital', owner: tile.owner };
  const from = sourceFor(id, tiles, me, ms, prefer);
  if (!from) return { kind: 'far' };
  if (!tile) return { kind: 'attack', need: banditGarrison(id) + 1, bandits: true, from };
  if (shielded(tile, ms - SKEW_MS)) return { kind: 'shield', until: tile.ct + SHIELD_MS };
  // Se cuentan sus soldados como si ya hubiera pasado el margen: el servidor nunca verá más
  return { kind: 'attack', need: Math.floor(garrisonAt(tile, ms + SKEW_MS)) + 1, bandits: false, from };
}

/** Territorio propio vecino desde el que atacar: el elegido si es vecino, si no el que más soldados tiene. */
export function sourceFor(id: string, tiles: Map<string, Tile>, me: string, ms: number, prefer: string | null = null): string | null {
  const own = neighbors(id)
    .map((n) => tiles.get(n))
    .filter((t): t is Tile => !!t && t.owner === me);
  if (prefer && own.some((t) => t.id === prefer)) return prefer;
  own.sort((a, b) => garrisonAt(b, ms) - garrisonAt(a, ms));
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

/**
 * Tonos de los rivales según su casilla de capital: bien distintos entre sí, sin azules (el tuyo) y con
 * el dorado (la Torre central) y los verdes (el terreno) al final, que se confunden.
 */
export const SLOT_HUES = [0, 285, 28, 320, 265, 345, 12, 300, 250, 335, 55, 40, 100, 140, 160, 70];

/** Color de cada alcalde en el mapa (el tuyo siempre azul). Con su casilla, uno de la paleta. */
export function ownerHue(uid: string, me: string | null, slot?: number): number {
  if (uid === me) return 205;
  if (slot !== undefined && slot >= 0) return SLOT_HUES[slot % SLOT_HUES.length];
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

// ---------- Estado en la partida ----------

/** Parte de batalla: otro alcalde te quitó un territorio. */
export interface Report {
  by: string;
  name: string;
  tile: string;
  /** Hora del servidor (ms). */
  at: number;
}

/** Resultado de una temporada terminada. */
export interface SeasonRecord {
  week: string;
  rank: number;
  size: number;
  points: number;
  gems: number;
}

export interface ConquestState {
  /** Día al que corresponde `recruits`. */
  day: string | null;
  /** Reclutas ganados hoy por actividad (se suben a la reserva al abrir la Conquista). */
  recruits: number;
  /** Semana y mundo en que juega el alcalde (para los partes y el premio). */
  week: string | null;
  w: string | null;
  /** Hora (del servidor) del último parte de batalla ya visto. */
  seenAt: number;
  /** Últimos partes de batalla. */
  reports: Report[];
  /** Territorios perdidos en total (para el periódico). */
  lost: number;
  /** Última semana cuyo premio ya se cobró. */
  claimed: string | null;
  /** Temporadas ganadas (bandera en la ciudad) y podios. */
  wins: number;
  podiums: number;
  history: SeasonRecord[];
  /** Partes de batalla que llegaron y aún no se han visto en la pestaña. */
  unread: number;
  /** Última foto de la reserva en la nube: para avisar (reserva llena, reclutas) sin leerla. */
  reserve: Reserve | null;
  /** Clara ya presentó la Conquista. */
  intro: boolean;
  /** Territorios conquistados en total (logro y periódico). */
  captured: number;
}

export type Reserve = Pick<Player, 'troops' | 't' | 'rDay' | 'rToday'>;

const REPORTS_MAX = 8;
export const HISTORY_MAX = 8;

export function newConquest(): ConquestState {
  return {
    day: null,
    recruits: 0,
    week: null,
    w: null,
    seenAt: 0,
    reports: [],
    lost: 0,
    claimed: null,
    wins: 0,
    podiums: 0,
    history: [],
    unread: 0,
    reserve: null,
    intro: false,
    captured: 0,
  };
}

function reserveOf(v: unknown): Reserve | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<Reserve>;
  if (!Number.isFinite(r.troops) || !Number.isFinite(r.t)) return null;
  return { troops: Math.max(0, r.troops as number), t: r.t as number, rDay: typeof r.rDay === 'string' ? r.rDay : '', rToday: count(r.rToday) };
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const text = (v: unknown) => (typeof v === 'string' ? v : null);

export function conquestState(v: unknown): ConquestState {
  if (!v || typeof v !== 'object') return newConquest();
  const r = v as Partial<ConquestState>;
  return {
    day: text(r.day),
    recruits: Math.min(RECRUITS_MAX, count(r.recruits)),
    week: text(r.week),
    w: text(r.w),
    seenAt: count(r.seenAt),
    reports: Array.isArray(r.reports)
      ? r.reports
          .filter((x) => x && typeof x.by === 'string' && typeof x.name === 'string' && typeof x.tile === 'string' && Number.isFinite(x.at))
          .slice(0, REPORTS_MAX)
          .map((x) => ({ by: x.by, name: x.name.slice(0, 20), tile: x.tile, at: x.at }))
      : [],
    lost: count(r.lost),
    claimed: text(r.claimed),
    wins: count(r.wins),
    podiums: count(r.podiums),
    history: Array.isArray(r.history)
      ? r.history
          .filter((x) => x && typeof x.week === 'string')
          .slice(-HISTORY_MAX)
          .map((x) => ({ week: x.week, rank: count(x.rank), size: count(x.size), points: count(x.points), gems: count(x.gems) }))
      : [],
    unread: count(r.unread),
    reserve: reserveOf(r.reserve),
    intro: r.intro === true,
    captured: count(r.captured),
  };
}

/** Apunta un territorio conquistado. */
export function withCapture(s: GameState): GameState {
  return { ...s, conquest: { ...s.conquest, captured: s.conquest.captured + 1 } };
}

/** Guarda la foto de la reserva (solo si cambió). */
export function withReserve(s: GameState, p: Reserve): GameState {
  const r = s.conquest.reserve;
  if (r && r.troops === p.troops && r.t === p.t && r.rDay === p.rDay && r.rToday === p.rToday) return s;
  return { ...s, conquest: { ...s.conquest, reserve: { troops: p.troops, t: p.t, rDay: p.rDay, rToday: p.rToday } } };
}

/**
 * Aviso para la tarjeta del Mapa del mundo (null si no hay nada): partes sin leer, reclutas por sumar,
 * reserva llena, o temporada nueva para quien ya jugó alguna.
 */
export function conquestAlert(s: GameState, ms: number, today: string): string | null {
  const c = s.conquest;
  const week = seasonOf(ms).week;
  if (c.week !== week) return c.week || c.history.length ? '⚔️ ¡Nueva temporada!' : null;
  if (c.unread > 0) return `📜 ${c.unread} ${c.unread === 1 ? 'parte' : 'partes'} de batalla`;
  if (!c.reserve) return null;
  const n = recruitsToSend(s, c.reserve, today);
  if (n > 0) return `🎖️ +${n} reclutas`;
  if (troopsAt(c.reserve, ms) >= TROOP_CAP) return '⚔️ ¡Reserva llena!';
  return null;
}

/** Apunta en qué semana y mundo juega el alcalde. */
export function withWorld(s: GameState, week: string, w: string): GameState {
  if (s.conquest.week === week && s.conquest.w === w) return s;
  return { ...s, conquest: { ...s.conquest, week, w } };
}

/** Guarda los partes de batalla nuevos. Devuelve también los recién llegados. */
export function applyReports(s: GameState, list: Report[]): { s: GameState; fresh: Report[] } {
  const c = s.conquest;
  const fresh = list.filter((r) => r.at > c.seenAt).sort((a, b) => b.at - a.at);
  if (!fresh.length) return { s, fresh };
  return {
    s: {
      ...s,
      conquest: { ...c, seenAt: fresh[0].at, lost: c.lost + fresh.length, unread: c.unread + fresh.length, reports: [...fresh, ...c.reports].slice(0, REPORTS_MAX) },
    },
    fresh,
  };
}

/**
 * Premio al cerrar la temporada: participación (5 + 1 por punto, hasta 20) y extra por el podio. El podio
 * pide rivales: ganar solo cuenta si hubo al menos 2 alcaldes, el 2º con 3 y el 3º con 4.
 */
export function seasonPrize(rank: number, size: number, points: number): { gems: number; tickets: number; win: boolean; podium: boolean } {
  const base = 5 + Math.min(15, Math.max(0, points));
  const win = rank === 1 && size >= 2;
  const second = rank === 2 && size >= 3;
  const third = rank === 3 && size >= 4;
  const extra = win ? 45 : second ? 25 : third ? 10 : 0;
  return { gems: base + extra, tickets: win ? 3 : second ? 2 : third ? 1 : 0, win, podium: win || second || third };
}

/** Cobra el premio de una temporada terminada (una sola vez por semana). */
export function applySeason(s: GameState, week: string, rank: number, size: number, points: number): { s: GameState; prize: ReturnType<typeof seasonPrize> } | null {
  const c = s.conquest;
  if (c.claimed === week) return null;
  const prize = seasonPrize(rank, size, points);
  const conquest: ConquestState = {
    ...c,
    claimed: week,
    wins: c.wins + (prize.win ? 1 : 0),
    podiums: c.podiums + (prize.podium ? 1 : 0),
    history: [...c.history, { week, rank, size, points, gems: prize.gems }].slice(-HISTORY_MAX),
  };
  return { s: { ...s, gems: s.gems + prize.gems, tickets: s.tickets + prize.tickets, conquest }, prize };
}

/** Tope diario de reclutas: 30, o el de la ley de la era (la Militar lo sube a 45). */
export function recruitCap(s: GameState): number {
  return Math.min(RECRUITS_MAX, currentLaw(s)?.fx.recruitCap ?? RECRUITS_DAY);
}

/** Multiplicador de reclutas: ley Militar y la Generala en el consejo. */
export function recruitMult(s: GameState): number {
  return lawMult(s, 'recruits') * advisorMult(s, 'recruits');
}

/** Suma reclutas de hoy por jugar (con el multiplicador y el tope diario). */
export function addRecruits(s: GameState, n: number, day: string): GameState {
  const before = s.conquest.day === day ? s.conquest.recruits : 0;
  const recruits = Math.max(before, Math.min(recruitCap(s), before + Math.round(n * recruitMult(s))));
  if (recruits === s.conquest.recruits && s.conquest.day === day) return s;
  return { ...s, conquest: { ...s.conquest, day, recruits } };
}

/** Reclutas ganados hoy que aún no están en la reserva de la nube. */
export function recruitsToSend(s: GameState, p: Pick<Player, 'rDay' | 'rToday'>, day: string): number {
  if (s.conquest.day !== day) return 0;
  const sent = p.rDay === day ? p.rToday : 0;
  return Math.max(0, s.conquest.recruits - sent);
}
