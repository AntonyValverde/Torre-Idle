import { cardAt, rankOf, type Card } from './cards';

// Más alto o más bajo: sale una carta y hay que adivinar si la siguiente será más alta o más baja
// (si es igual, se pierde). Cada acierto multiplica el premio según lo difícil que era, con un 3%
// para la casa en cada paso. Se puede cobrar después de cualquier acierto.

export const HILO_EDGE = 0.97;
export const HILO_MAX = 50;

export type HiLoGuess = 'hi' | 'lo';

export interface HiLoRun {
  bet: number;
  seed: number;
  n: number;
  cards: Card[];
  mult: number;
  /** null mientras se juega; 'lose' al fallar; 'cash' al cobrar. */
  result: 'lose' | 'cash' | null;
  paid: number;
}

/** Probabilidad de acertar desde un rango (as = 1 … rey = 13). */
export function winChance(rank: number, g: HiLoGuess): number {
  return g === 'hi' ? (13 - rank) / 13 : (rank - 1) / 13;
}

/** Multiplicador de un acierto (0 si es imposible acertar). */
export function stepMult(rank: number, g: HiLoGuess): number {
  const p = winChance(rank, g);
  return p > 0 ? Math.floor((HILO_EDGE / p) * 100) / 100 : 0;
}

export function hiloStart(bet: number, seed: number): HiLoRun {
  return { bet, seed, n: 1, cards: [cardAt(seed, 0)], mult: 1, result: null, paid: 0 };
}

export function current(run: HiLoRun): Card {
  return run.cards[run.cards.length - 1];
}

export function hiloGuess(run: HiLoRun, g: HiLoGuess): HiLoRun {
  if (run.result) return run;
  const rank = rankOf(current(run));
  const step = stepMult(rank, g);
  if (step <= 0) return run;
  const next = cardAt(run.seed, run.n);
  const r = rankOf(next);
  const ok = g === 'hi' ? r > rank : r < rank;
  const cards = [...run.cards, next];
  if (!ok) return { ...run, n: run.n + 1, cards, result: 'lose', paid: 0 };
  const mult = Math.min(HILO_MAX, Math.floor(run.mult * step * 100) / 100);
  const won = { ...run, n: run.n + 1, cards, mult };
  // En el tope se cobra solo
  return mult >= HILO_MAX ? hiloCash(won) : won;
}

/** Hace falta al menos un acierto para cobrar. */
export function canCash(run: HiLoRun): boolean {
  return !run.result && run.cards.length > 1;
}

export function hiloCash(run: HiLoRun): HiLoRun {
  if (run.result || run.cards.length < 2) return run;
  return { ...run, result: 'cash', paid: Math.floor(run.bet * run.mult) };
}
