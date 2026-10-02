import { mulberry32 } from '../rng';

// Cartas de una baraja infinita (cada carta sale con la misma probabilidad, sin agotarse).
// Las manos guardan su semilla: la carta n-ésima siempre es la misma, así que recargar la
// partida a mitad de una mano no sirve para cambiar la siguiente carta.

/** 0..51: rango = c % 13 (0 = A … 12 = K), palo = c / 13. */
export type Card = number;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

/** Carta número `n` de la baraja de una semilla. */
export function cardAt(seed: number, n: number): Card {
  return Math.floor(mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0)() * 52);
}

/** 1 (as) … 13 (rey). */
export function rankOf(c: Card): number {
  return (c % 13) + 1;
}

export function cardLabel(c: Card): { rank: string; suit: string; red: boolean } {
  const suit = Math.floor(c / 13) % 4;
  return { rank: RANKS[c % 13], suit: SUITS[suit], red: suit === 1 || suit === 2 };
}

export function newSeed(rand: () => number): number {
  return Math.floor(rand() * 4294967296) >>> 0;
}
