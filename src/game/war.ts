import type { GameState } from './state';

// Juegos de guerra del arcade (Defensa antiaérea, Artillería, Defensa de calles y Duelo de generales) y
// shooters (Escuadrilla, Torre vigía, Ronda nocturna, Alcantarillas, Arena de neón y Alcalde bala).
// Comparten la forma de premiar (monedas por punto según la producción y gemas por tramos), así que
// sus cifras viven en esta tabla en vez de en una función por juego.

export type ShooterGame = 'squadron' | 'sentry' | 'night' | 'sewer' | 'neon' | 'cannon';
export const SHOOTER_GAMES: ShooterGame[] = ['squadron', 'sentry', 'night', 'sewer', 'neon', 'cannon'];

export type WarGame = 'flak' | 'artillery' | 'lanes' | 'duel' | ShooterGame;
export const WAR_GAMES: WarGame[] = ['flak', 'artillery', 'lanes', 'duel', ...SHOOTER_GAMES];

export function isWarGame(id: string): id is WarGame {
  return (WAR_GAMES as string[]).includes(id);
}

export type WarBestKey = `${WarGame}Best`;

export interface WarInfo {
  emoji: string;
  name: string;
  /** Unidad de la puntuación (para rankings y periódico). */
  unit: string;
  best: WarBestKey;
  /**
   * Monedas por punto: como mínimo `min`, o tantos segundos de producción. Los shooters puntúan más, así
   * que pagan menos por punto: una gran partida vale lo mismo que en los demás juegos (~20 min de producción).
   */
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
  squadron: { emoji: '✈️', name: 'Escuadrilla', unit: 'pts', best: 'squadronBest', coinMin: 6, coinPps: 1.7, gems: [[700, 6], [400, 4], [180, 2], [60, 1]] },
  sentry: { emoji: '🗼', name: 'Torre vigía', unit: 'pts', best: 'sentryBest', coinMin: 5, coinPps: 1.3, gems: [[900, 6], [500, 4], [220, 2], [70, 1]] },
  night: { emoji: '🌙', name: 'Ronda nocturna', unit: 'pts', best: 'nightBest', coinMin: 4, coinPps: 1, gems: [[1200, 6], [700, 4], [300, 2], [80, 1]] },
  sewer: { emoji: '🐀', name: 'Alcantarillas', unit: 'pts', best: 'sewerBest', coinMin: 6, coinPps: 1.7, gems: [[700, 6], [400, 4], [180, 2], [60, 1]] },
  neon: { emoji: '💠', name: 'Arena de neón', unit: 'pts', best: 'neonBest', coinMin: 3, coinPps: 0.8, gems: [[1500, 6], [800, 4], [350, 2], [80, 1]] },
  cannon: { emoji: '🎪', name: 'Alcalde bala', unit: 'm', best: 'cannonBest', coinMin: 4, coinPps: 1, gems: [[1200, 6], [800, 4], [400, 2], [150, 1]] },
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
