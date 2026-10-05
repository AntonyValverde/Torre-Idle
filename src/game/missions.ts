import { hashString, mulberry32 } from '../minigames/rng';
import { dateKey, isNewDay, weekKey } from './clock';
import { randomCard } from './cup';
import { addPassXp, passSeason, rolloverPass, type PassReward } from './pass';
import type { GameState } from './state';
import { tutorialProgress } from './tutorial';
import { rollPaper } from './paper';

// Misiones diarias y semanales, y la liga semanal que se alimenta de ellas.
// Las misiones del día (y de la semana) son las mismas para todos: salen de la fecha.

/** Lo que hace el jugador y puede contar para una misión. */
export type MissionEvent =
  | 'tap'
  | 'build'
  | 'upgrade'
  | 'arcade'
  | 'balloon'
  | 'decree'
  | 'wheel'
  | 'daily'
  | 'roads'
  | 'parks'
  | 'fire'
  | 'metro'
  | 'puzzle'
  | 'achievement'
  | 'traffic'
  | 'stack'
  | 'thief'
  | 'memory'
  | 'merge'
  | 'flak'
  | 'artillery'
  | 'lanes'
  | 'duel';

export interface MissionDef {
  id: string;
  event: MissionEvent;
  /** sum: se acumula; max: basta con llegar una vez (récord de una partida). */
  kind: 'sum' | 'max';
  target: number;
  emoji: string;
  text: string;
  /**
   * Fecha (o lunes de la semana) desde la que puede salir. Las misiones nuevas llevan fecha para no
   * cambiar las ya repartidas: el sorteo de cada día depende de cuántas haya en cada grupo.
   */
  since?: string;
}

/** Desde cuándo salen las misiones de los juegos de guerra (día y semana). */
export const WAR_MISSIONS_DAY = '2026-10-07';
export const WAR_MISSIONS_WEEK = '2026-10-12';

export interface MissionSlot {
  id: string;
  /** Progreso (no pasa del objetivo). */
  p: number;
  /** Recompensa reclamada. */
  c: boolean;
}

export interface MissionsState {
  day: string | null;
  daily: MissionSlot[];
  /** Cofre por completar las tres diarias. */
  chest: boolean;
  week: string | null;
  weekly: MissionSlot[];
}

export interface LeagueState {
  /** Semana actual (su lunes). */
  week: string | null;
  points: number;
  /** Semana anterior pendiente de premio (se reclama al empezar la nueva). */
  prev: { week: string; points: number } | null;
  /** Mejor división cobrada (índice en DIVISIONS), para el logro. */
  best: number;
}

// Tres grupos: así cada día hay una misión de ciudad, una de minijuego y una libre
const DAILY: MissionDef[][] = [
  [
    { id: 'd-tap', event: 'tap', kind: 'sum', target: 300, emoji: '👆', text: 'Toca la ciudad 300 veces' },
    { id: 'd-build', event: 'build', kind: 'sum', target: 15, emoji: '🏗️', text: 'Construye 15 edificios' },
    { id: 'd-upgrade', event: 'upgrade', kind: 'sum', target: 2, emoji: '⬆️', text: 'Compra 2 mejoras' },
    { id: 'd-balloon', event: 'balloon', kind: 'sum', target: 2, emoji: '🎈', text: 'Atrapa 2 globos dorados' },
    { id: 'd-decree', event: 'decree', kind: 'sum', target: 2, emoji: '📜', text: 'Firma 2 decretos del consejo' },
  ],
  [
    { id: 'd-traffic', event: 'traffic', kind: 'max', target: 20, emoji: '🚦', text: 'Haz cruzar 20 coches en Semáforo' },
    { id: 'd-stack', event: 'stack', kind: 'max', target: 12, emoji: '🏗️', text: 'Apila 12 pisos en Stack Tower' },
    { id: 'd-thief', event: 'thief', kind: 'max', target: 25, emoji: '🦹', text: 'Consigue 25 puntos en Atrapa al ladrón' },
    { id: 'd-memory', event: 'memory', kind: 'max', target: 5, emoji: '🧠', text: 'Supera 5 rondas en Memoria' },
    { id: 'd-merge', event: 'merge', kind: 'max', target: 128, emoji: '🧱', text: 'Consigue la ficha 128 en Fusión' },
    { id: 'd-fire', event: 'fire', kind: 'max', target: 40, emoji: '🚒', text: 'Consigue 40 puntos en Bomberos' },
    { id: 'd-metro', event: 'metro', kind: 'max', target: 15, emoji: '🚇', text: 'Lleva a 15 viajeros en Metro' },
    { id: 'd-flak', event: 'flak', kind: 'max', target: 50, emoji: '🛡️', text: 'Consigue 50 puntos en Defensa antiaérea', since: WAR_MISSIONS_DAY },
    { id: 'd-artillery', event: 'artillery', kind: 'max', target: 25, emoji: '🎯', text: 'Consigue 25 puntos en Artillería', since: WAR_MISSIONS_DAY },
    { id: 'd-lanes', event: 'lanes', kind: 'max', target: 40, emoji: '🚧', text: 'Consigue 40 puntos en Defensa de calles', since: WAR_MISSIONS_DAY },
    { id: 'd-duel', event: 'duel', kind: 'max', target: 12, emoji: '🎖️', text: 'Consigue 12 puntos en Duelo de generales', since: WAR_MISSIONS_DAY },
  ],
  [
    { id: 'd-daily', event: 'daily', kind: 'sum', target: 1, emoji: '🌃', text: 'Completa el Apagón diario' },
    { id: 'd-roads', event: 'roads', kind: 'sum', target: 1, emoji: '🛣️', text: 'Completa Conecta las calles' },
    { id: 'd-parks', event: 'parks', kind: 'sum', target: 1, emoji: '🌳', text: 'Completa el Plan verde' },
    { id: 'd-wheel', event: 'wheel', kind: 'sum', target: 1, emoji: '🎡', text: 'Gira la rueda de la fortuna' },
    { id: 'd-arcade', event: 'arcade', kind: 'sum', target: 2, emoji: '🎮', text: 'Juega 2 partidas de arcade' },
  ],
];

const WEEKLY: MissionDef[][] = [
  [
    { id: 'w-build', event: 'build', kind: 'sum', target: 120, emoji: '🏗️', text: 'Construye 120 edificios' },
    { id: 'w-tap', event: 'tap', kind: 'sum', target: 3000, emoji: '👆', text: 'Toca la ciudad 3000 veces' },
    { id: 'w-balloon', event: 'balloon', kind: 'sum', target: 10, emoji: '🎈', text: 'Atrapa 10 globos dorados' },
    { id: 'w-decree', event: 'decree', kind: 'sum', target: 10, emoji: '📜', text: 'Firma 10 decretos del consejo' },
  ],
  [
    { id: 'w-arcade', event: 'arcade', kind: 'sum', target: 12, emoji: '🎮', text: 'Juega 12 partidas de arcade' },
    { id: 'w-traffic', event: 'traffic', kind: 'max', target: 50, emoji: '🚦', text: 'Haz cruzar 50 coches en Semáforo' },
    { id: 'w-stack', event: 'stack', kind: 'max', target: 25, emoji: '🏗️', text: 'Apila 25 pisos en Stack Tower' },
    { id: 'w-memory', event: 'memory', kind: 'max', target: 9, emoji: '🧠', text: 'Supera 9 rondas en Memoria' },
    { id: 'w-fire', event: 'fire', kind: 'max', target: 120, emoji: '🚒', text: 'Consigue 120 puntos en Bomberos' },
    { id: 'w-metro', event: 'metro', kind: 'max', target: 50, emoji: '🚇', text: 'Lleva a 50 viajeros en Metro' },
    { id: 'w-flak', event: 'flak', kind: 'max', target: 180, emoji: '🛡️', text: 'Consigue 180 puntos en Defensa antiaérea', since: WAR_MISSIONS_WEEK },
    { id: 'w-artillery', event: 'artillery', kind: 'max', target: 80, emoji: '🎯', text: 'Consigue 80 puntos en Artillería', since: WAR_MISSIONS_WEEK },
    { id: 'w-lanes', event: 'lanes', kind: 'max', target: 130, emoji: '🚧', text: 'Consigue 130 puntos en Defensa de calles', since: WAR_MISSIONS_WEEK },
    { id: 'w-duel', event: 'duel', kind: 'max', target: 45, emoji: '🎖️', text: 'Consigue 45 puntos en Duelo de generales', since: WAR_MISSIONS_WEEK },
  ],
  [
    { id: 'w-puzzle', event: 'puzzle', kind: 'sum', target: 6, emoji: '🧩', text: 'Completa 6 retos diarios (Apagón, Calles o Plan verde)' },
    { id: 'w-achievement', event: 'achievement', kind: 'sum', target: 4, emoji: '🏅', text: 'Reclama 4 logros' },
    { id: 'w-wheel', event: 'wheel', kind: 'sum', target: 5, emoji: '🎡', text: 'Gira la rueda 5 veces' },
  ],
];

export const MISSION_BY_ID = new Map([...DAILY.flat(), ...WEEKLY.flat()].map((m) => [m.id, m]));

// Recompensas (los puntos de liga son iguales para todos: no dependen del progreso de la ciudad)
export const DAILY_REWARD = { gems: 1, tickets: 1, points: 10 };
export const CHEST_REWARD = { gems: 4, boost: 2, boostSeconds: 900, points: 20 };
export const WEEKLY_REWARD = { gems: 8, points: 40 };
export const PUZZLE_POINTS = 15;
/** Tope de puntos por semana (las reglas de Firestore lo exigen). */
export const LEAGUE_MAX = 1000;

function pick(groups: MissionDef[][], seed: string, key: string): MissionSlot[] {
  const rand = mulberry32(hashString(seed));
  return groups.map((all) => {
    const g = all.filter((m) => !m.since || m.since <= key);
    return { id: g[Math.floor(rand() * g.length)].id, p: 0, c: false };
  });
}

export function dailyMissions(date: string): MissionSlot[] {
  return pick(DAILY, 'misiones:' + date, date);
}

export function weeklyMissions(week: string): MissionSlot[] {
  return pick(WEEKLY, 'semana:' + week, week);
}

export function newMissions(): MissionsState {
  return { day: null, daily: [], chest: false, week: null, weekly: [] };
}

export function newLeague(): LeagueState {
  return { week: null, points: 0, prev: null, best: -1 };
}

/**
 * Cambia de día o de semana si toca. Solo avanza: volver a una fecha anterior
 * (cambiando el reloj o la zona horaria) no reinicia nada.
 */
export function syncPeriods(s: GameState, t: number): GameState {
  const today = dateKey(t);
  const week = weekKey(t);
  let m = s.missions;
  let next = s;
  if (isNewDay(m.day, today)) m = { ...m, day: today, daily: dailyMissions(today), chest: false };
  if (isNewDay(m.week, week)) m = { ...m, week, weekly: weeklyMissions(week) };
  const l = s.league;
  if (isNewDay(l.week, week)) {
    // La semana que termina queda pendiente de premio si sumó algo
    const ended = l.week && l.points > 0 ? { week: l.week, points: l.points } : null;
    // Solo cabe un premio pendiente: si aún quedaba otro sin cobrar, se cobra solo en vez de perderse
    if (ended && l.prev) next = payLeague(next, l.prev.points);
    next = { ...next, league: { ...next.league, week, points: 0, prev: ended ?? l.prev } };
  }
  // Pase de temporada: al cambiar de temporada, los niveles ganados y no cobrados se pagan solos
  const rolled = rolloverPass(next.pass, passSeason(t));
  if (rolled.pass !== next.pass) {
    next = { ...next, pass: rolled.pass };
    for (const r of rolled.owed) next = applyPassReward(next, r);
  }
  // El periódico hace su foto diaria de la ciudad
  return rollPaper(m === s.missions && next === s ? s : { ...next, missions: m }, today);
}

/**
 * Da un premio del pase: gemas, tickets, fichas del casino, una carta de la Copa (al azar), un sobre de
 * consejero o el cosmético de la temporada (con sus gemas). El cosmético no se repite si ya se tenía.
 */
export function applyPassReward(s: GameState, r: PassReward): GameState {
  switch (r.kind) {
    case 'gems':
      return { ...s, gems: s.gems + r.n };
    case 'tickets':
      return { ...s, tickets: s.tickets + r.n };
    case 'chips':
      return { ...s, casino: { ...s.casino, chips: s.casino.chips + r.n } };
    case 'card': {
      const card = randomCard(Math.random);
      return { ...s, cup: { ...s.cup, cards: { ...s.cup.cards, [card]: s.cup.cards[card] + r.n } } };
    }
    case 'pack':
      return { ...s, advisors: { ...s.advisors, packs: s.advisors.packs + r.n } };
    case 'deco': {
      const decos = r.deco && !s.pass.decos.includes(r.deco) ? [...s.pass.decos, r.deco] : s.pass.decos;
      return { ...s, gems: s.gems + (r.gems ?? 0), pass: decos === s.pass.decos ? s.pass : { ...s.pass, decos } };
    }
  }
}

/** Cobra el premio de una semana de liga: gemas, tickets y la mejor división (para el logro). */
export function payLeague(s: GameState, points: number): GameState {
  const d = divisionOf(points);
  return {
    ...s,
    gems: s.gems + d.gems,
    tickets: s.tickets + d.tickets,
    league: { ...s.league, best: Math.max(s.league.best, DIVISIONS.indexOf(d)) },
  };
}

function advance(slots: MissionSlot[], ev: MissionEvent, n: number): MissionSlot[] {
  let changed = false;
  const out = slots.map((x) => {
    const def = MISSION_BY_ID.get(x.id);
    if (!def || def.event !== ev || x.p >= def.target) return x;
    const p = Math.min(def.target, def.kind === 'sum' ? x.p + n : Math.max(x.p, n));
    if (p === x.p) return x;
    changed = true;
    return { ...x, p };
  });
  return changed ? out : slots;
}

/** Suma progreso a las misiones activas que cuenten ese evento (y al paso del tutorial). */
export function bump(s: GameState, ev: MissionEvent, n = 1): GameState {
  if (!(n > 0)) return s;
  const daily = advance(s.missions.daily, ev, n);
  const weekly = advance(s.missions.weekly, ev, n);
  const next = daily === s.missions.daily && weekly === s.missions.weekly ? s : { ...s, missions: { ...s.missions, daily, weekly } };
  return tutorialProgress(next, ev, n);
}

export function isDone(slot: MissionSlot): boolean {
  const def = MISSION_BY_ID.get(slot.id);
  return !!def && slot.p >= def.target;
}

export function claimableMissions(s: GameState): number {
  const m = s.missions;
  let n = [...m.daily, ...m.weekly].filter((x) => isDone(x) && !x.c).length;
  if (chestReady(s)) n++;
  return n;
}

export function chestReady(s: GameState): boolean {
  const d = s.missions.daily;
  return !s.missions.chest && d.length > 0 && d.every((x) => x.c);
}

/** Suma puntos de liga (con su tope semanal); los mismos puntos avanzan el pase de temporada. */
export function addPoints(s: GameState, points: number): GameState {
  return { ...s, league: { ...s.league, points: Math.min(LEAGUE_MAX, s.league.points + points) }, pass: addPassXp(s.pass, points) };
}

// ---------- Divisiones de la liga ----------

export interface Division {
  id: string;
  name: string;
  emoji: string;
  min: number;
  gems: number;
  tickets: number;
}

export const DIVISIONS: Division[] = [
  { id: 'bronce', name: 'Bronce', emoji: '🥉', min: 0, gems: 3, tickets: 0 },
  { id: 'plata', name: 'Plata', emoji: '🥈', min: 150, gems: 8, tickets: 1 },
  { id: 'oro', name: 'Oro', emoji: '🥇', min: 300, gems: 15, tickets: 2 },
  { id: 'diamante', name: 'Diamante', emoji: '💎', min: 450, gems: 25, tickets: 3 },
];

export function divisionOf(points: number): Division {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (points >= x.min) d = x;
  return d;
}

export function nextDivision(points: number): Division | null {
  return DIVISIONS.find((x) => x.min > points) ?? null;
}
