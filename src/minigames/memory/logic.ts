// "Memoria de ventanas": las ventanas se encienden en secuencia y hay que repetirla.
// Cada ronda superada añade una ventana más a la misma secuencia.

export const COLS = 3;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
export const START_LEN = 3;

/** Añade una ventana a la secuencia (nunca la misma dos veces seguidas: no se distinguiría). */
export function extend(seq: number[], rand: () => number): number[] {
  const prev = seq[seq.length - 1];
  let i = Math.floor(rand() * (CELLS - (prev === undefined ? 0 : 1)));
  if (prev !== undefined && i >= prev) i++;
  return [...seq, i];
}

export function firstSequence(rand: () => number): number[] {
  let seq: number[] = [];
  while (seq.length < START_LEN) seq = extend(seq, rand);
  return seq;
}

/** Cuánto tiempo se enciende cada ventana al mostrar la secuencia (más rápido cada ronda). */
export function flashMs(round: number): number {
  return Math.max(240, 520 - round * 18);
}

/** Tickets que devuelve una partida según las rondas completadas. */
export function memoryTickets(rounds: number): number {
  return rounds >= 15 ? 4 : rounds >= 11 ? 3 : rounds >= 8 ? 2 : rounds >= 5 ? 1 : 0;
}
