import type { GameState } from './state';

// Juegos de guerra del arcade: Defensa antiaérea, Artillería, Defensa de calles y Duelo de generales.
// Comparten la forma de premiar (monedas por punto según la producción y gemas por tramos), así que
// sus cifras viven en esta tabla en vez de en una función por juego.

export type WarGame = 'flak' | 'artillery' | 'lanes' | 'duel';
export const WAR_GAMES: WarGame[] = ['flak', 'artillery', 'lanes', 'duel'];

export function isWarGame(id: string): id is WarGame {
  return (WAR_GAMES as string[]).includes(id);
}

export type WarBestKey = 'flakBest' | 'artilleryBest' | 'lanesBest' | 'duelBest';

export interface WarInfo {
  emoji: string;
  name: string;
  /** Unidad de la puntuación (para rankings y periódico). */
  unit: string;
  best: WarBestKey;
  /** Monedas por punto: como mínimo `min`, o tantos segundos de producción. */
  coinMin: number;
  coinPps: number;
  /** Tramos de gemas: [puntos, gemas], de mayor a menor. */
  gems: [number, number][];
}

export const WAR_INFO: Record<WarGame, WarInfo> = {
  flak: { emoji: '🛡️', name: 'Defensa antiaérea', unit: 'pts', best: 'flakBest', coinMin: 12, coinPps: 3, gems: [[350, 6], [200, 4], [90, 2], [35, 1]] },
  artillery: { emoji: '🎯', name: 'Artillería', unit: 'pts', best: 'artilleryBest', coinMin: 25, coinPps: 7, gems: [[150, 6], [90, 4], [45, 2], [20, 1]] },
  lanes: { emoji: '🚧', name: 'Defensa de calles', unit: 'pts', best: 'lanesBest', coinMin: 15, coinPps: 4, gems: [[220, 6], [140, 4], [70, 2], [30, 1]] },
  duel: { emoji: '🎖️', name: 'Duelo de generales', unit: 'pts', best: 'duelBest', coinMin: 30, coinPps: 9, gems: [[120, 6], [70, 4], [35, 2], [15, 1]] },
};

/** Gemas que da una puntuación. */
export function warGems(game: WarGame, score: number): number {
  return WAR_INFO[game].gems.find(([at]) => score >= at)?.[1] ?? 0;
}

/** Puntos que hacen falta para las primeras gemas (para el aviso del resultado). */
export function warFirstGems(game: WarGame): number {
  const g = WAR_INFO[game].gems;
  return g[g.length - 1][0];
}

/** Monedas antes de multiplicadores: por punto, el mínimo o unos segundos de producción. */
export function warCoins(game: WarGame, score: number, pps: number): number {
  const info = WAR_INFO[game];
  return score * Math.max(info.coinMin, pps * info.coinPps);
}

export function warBest(s: GameState, game: WarGame): number {
  return s[WAR_INFO[game].best];
}
