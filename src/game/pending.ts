import { prevDateKey } from './clock';
import type { GameState, PendingDaily } from './state';
import { WAR_GAMES, warBest, type WarGame } from './war';

// Subidas a los rankings que pueden fallar (sin conexión, sin sesión todavía, app cerrada antes de
// que llegue la escritura). La partida recuerda qué récord ya se subió y qué retos diarios faltan,
// y el guardado automático los reintenta.

/** Rankings de minijuegos que dependen de un récord guardado en la partida. */
export type ArcadeBoard = 'stack' | 'merge' | 'thief' | 'traffic' | 'memory' | 'fire' | 'metro' | 'towers' | WarGame;
export const ARCADE_BOARDS: ArcadeBoard[] = ['stack', 'merge', 'thief', 'traffic', 'memory', 'fire', 'metro', 'towers', ...WAR_GAMES];

/** Las reglas de Firestore no aceptan más de 999 movimientos en un reto diario. */
export const DAILY_MOVES_MAX = 999;

/**
 * Tope de puntuación que aceptan las reglas de Firestore en cada ranking. Una marca mayor se sube recortada:
 * si se enviase tal cual, las reglas la rechazarían y quedaría marcada como subida sin estar en el ranking.
 */
export const BOARD_CAP: Record<ArcadeBoard | 'city' | 'stars', number> = {
  stack: 1000,
  merge: 4_000_000,
  thief: 3000,
  traffic: 5000,
  memory: 500,
  fire: 5000,
  metro: 5000,
  towers: 5000,
  flak: 5000,
  artillery: 5000,
  lanes: 5000,
  duel: 5000,
  squadron: 5000,
  sentry: 5000,
  night: 5000,
  sewer: 5000,
  neon: 5000,
  cannon: 5000,
  city: Infinity,
  stars: 1e9,
};

/** Puntuación tal como se sube al ranking: entero, no negativo y sin pasar del tope de las reglas. */
export function clampScore(board: ArcadeBoard | 'city' | 'stars', score: number): number {
  return Math.min(BOARD_CAP[board], Math.max(0, Math.floor(score)));
}

/** Como mucho se guardan unos pocos pendientes (de hoy y de ayer, uno por reto). */
const PENDING_MAX = 9;

export function isArcadeBoard(board: string): board is ArcadeBoard {
  return (ARCADE_BOARDS as string[]).includes(board);
}

/** Récord local (tal como se sube al ranking) de cada minijuego. */
export function localBest(s: GameState, board: ArcadeBoard): number {
  switch (board) {
    case 'stack':
      return s.stackBest;
    case 'merge':
      return s.mergeBest;
    case 'thief':
      return s.thiefBest;
    case 'traffic':
      return s.trafficBest;
    case 'memory':
      return s.memoryBest;
    case 'fire':
      return s.fireBest;
    case 'metro':
      return s.metroBest;
    case 'towers':
      return s.towersBest;
    default:
      return warBest(s, board);
  }
}

/** Primer ranking cuyo récord local todavía no se subió (o null si están todos al día). */
export function nextResend(s: GameState, skip: (b: ArcadeBoard) => boolean = () => false): { board: ArcadeBoard; score: number } | null {
  for (const board of ARCADE_BOARDS) {
    if (skip(board)) continue;
    const score = Math.floor(localBest(s, board));
    if (score > 0 && score > (s.submittedBest[board] ?? 0)) return { board, score };
  }
  return null;
}

/** Apunta que ese récord ya está en el ranking (nunca baja). */
export function markSubmitted(s: GameState, board: ArcadeBoard, score: number): GameState {
  const n = Math.floor(score);
  if (!(n > (s.submittedBest[board] ?? 0))) return s;
  return { ...s, submittedBest: { ...s.submittedBest, [board]: n } };
}

/** Movimientos tal como se suben: entero entre 1 y 999. */
export function clampDailyMoves(moves: number): number {
  return Math.min(DAILY_MOVES_MAX, Math.max(1, Math.round(moves) || 1));
}

/** Añade (o sustituye) el resultado pendiente de un reto y día. */
export function addPendingDaily(s: GameState, p: PendingDaily): GameState {
  const rest = s.pendingDaily.filter((x) => x.kind !== p.kind || x.date !== p.date);
  return { ...s, pendingDaily: [...rest, p].slice(-PENDING_MAX) };
}

export function removePendingDaily(s: GameState, kind: PendingDaily['kind'], date: string): GameState {
  if (!s.pendingDaily.some((x) => x.kind === kind && x.date === date)) return s;
  return { ...s, pendingDaily: s.pendingDaily.filter((x) => x.kind !== kind || x.date !== date) };
}

/** Pendientes que el ranking aún aceptaría: solo los de hoy y ayer (las reglas admiten ±36 h). */
export function livePendingDaily(list: PendingDaily[], today: string): PendingDaily[] {
  const yesterday = prevDateKey(today);
  return list.filter((p) => p.date >= yesterday && p.date <= today);
}
