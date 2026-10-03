import { mulberry32 } from '../rng';

// Cartas de una baraja infinita (cada carta sale con la misma probabilidad, sin agotarse).
// Cada mano tiene un id público (se guarda con la partida) y un secreto que solo vive en memoria:
// la carta n-ésima de una mano siempre es la misma mientras la pestaña siga abierta, así que
// recargar no cambia la siguiente carta; y como el secreto no se guarda, leer la partida en el
// disco no permite calcularla. Si el secreto se perdió (otra pestaña, recarga), se crea otro:
// la carta que venía nunca se vio, así que sortearla de nuevo no da ventaja.

/** 0..51: rango = c % 13 (0 = A … 12 = K), palo = c / 13. */
export type Card = number;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

/** Carta número `n` de la baraja de una semilla (función pura). */
export function cardAt(seed: number, n: number): Card {
  return Math.floor(mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0)() * 52);
}

/** Secreto de cada mano abierta, solo en memoria. */
const secrets = new Map<number, number>();

function randomSeed(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** Carta número `n` de la mano `id`. */
export function drawCard(id: number, n: number): Card {
  let secret = secrets.get(id);
  if (secret === undefined) {
    secret = randomSeed();
    secrets.set(id, secret);
  }
  return cardAt(secret, n);
}

/** Olvida el secreto de una mano terminada (para no acumularlos). */
export function forgetHand(id: number) {
  secrets.delete(id);
}

/** 1 (as) … 13 (rey). */
export function rankOf(c: Card): number {
  return (c % 13) + 1;
}

export function cardLabel(c: Card): { rank: string; suit: string; red: boolean } {
  const suit = Math.floor(c / 13) % 4;
  return { rank: RANKS[c % 13], suit: SUITS[suit], red: suit === 1 || suit === 2 };
}

/** Id público de una mano nueva, con su secreto ya sorteado. */
export function newHandId(rand: () => number): number {
  const id = Math.floor(rand() * 4294967296) >>> 0;
  secrets.set(id, randomSeed());
  return id;
}
