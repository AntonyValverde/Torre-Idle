import { hashString, mulberry32 } from '../rng';

// "Plan verde": reparte casas y parques en un barrio de 6×6.
// - Cada fila y cada columna tiene tantas casas como parques (3 y 3).
// - Nunca hay tres iguales seguidos, ni en horizontal ni en vertical.
// Algunas casillas vienen fijas. Todos los jugadores reciben el mismo plano cada día y tiene una sola solución.

export const SIZE = 6;
export const HALF = SIZE / 2;
export const EMPTY = 0;
export const HOUSE = 1;
export const PARK = 2;
export type Cell = 0 | 1 | 2;

export interface ParksPuzzle {
  /** Casillas fijas (0 = libre para el jugador). */
  givens: Cell[];
  solution: Cell[];
  /** Toques mínimos: casa = 1 toque, parque = 2 (vacío → casa → parque). */
  par: number;
}

/** Siguiente valor al tocar una casilla: vacío → casa → parque → vacío. */
export function cycle(c: Cell): Cell {
  return ((c + 1) % 3) as Cell;
}

/** ¿Se puede poner `v` en `i` mirando solo las casillas ya decididas antes (en orden de lectura)? */
function fits(cells: Cell[], i: number, v: Cell, rowCount: number[][], colCount: number[][]): boolean {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  if (rowCount[r][v] >= HALF || colCount[c][v] >= HALF) return false;
  if (c >= 2 && cells[i - 1] === v && cells[i - 2] === v) return false;
  if (r >= 2 && cells[i - SIZE] === v && cells[i - 2 * SIZE] === v) return false;
  return true;
}

/**
 * Cuenta soluciones (hasta `limit`) respetando las casillas fijas. Rellena en orden de lectura,
 * así basta con mirar las dos casillas anteriores de la fila y de la columna.
 */
export function countSolutions(givens: Cell[], limit = 2, rand?: () => number): { count: number; first: Cell[] | null } {
  const cells: Cell[] = Array(SIZE * SIZE).fill(EMPTY);
  const rowCount = Array.from({ length: SIZE }, () => [0, 0, 0]);
  const colCount = Array.from({ length: SIZE }, () => [0, 0, 0]);
  let count = 0;
  let first: Cell[] | null = null;

  const go = (i: number): boolean => {
    if (i === cells.length) {
      count++;
      if (!first) first = cells.slice();
      return count >= limit;
    }
    const options: Cell[] = givens[i] ? [givens[i]] : rand && rand() < 0.5 ? [PARK, HOUSE] : [HOUSE, PARK];
    for (const v of options) {
      if (!fits(cells, i, v, rowCount, colCount)) continue;
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      cells[i] = v;
      rowCount[r][v]++;
      colCount[c][v]++;
      const stop = go(i + 1);
      rowCount[r][v]--;
      colCount[c][v]--;
      cells[i] = EMPTY;
      if (stop) return true;
    }
    return false;
  };
  go(0);
  return { count, first };
}

/** Casillas que rompen una regla: tres iguales seguidos, o más de la mitad de un tipo en su fila o columna. */
export function problems(cells: Cell[]): Set<number> {
  const bad = new Set<number>();
  const lines: number[][] = [];
  for (let k = 0; k < SIZE; k++) {
    lines.push(Array.from({ length: SIZE }, (_, j) => k * SIZE + j));
    lines.push(Array.from({ length: SIZE }, (_, j) => j * SIZE + k));
  }
  for (const line of lines) {
    for (const v of [HOUSE, PARK]) {
      const of = line.filter((i) => cells[i] === v);
      if (of.length > HALF) of.forEach((i) => bad.add(i));
    }
    for (let j = 0; j + 2 < line.length; j++) {
      const [a, b, c] = [line[j], line[j + 1], line[j + 2]];
      if (cells[a] && cells[a] === cells[b] && cells[b] === cells[c]) [a, b, c].forEach((i) => bad.add(i));
    }
  }
  return bad;
}

export function isSolved(cells: Cell[]): boolean {
  return cells.every((c) => c !== EMPTY) && problems(cells).size === 0;
}

/**
 * Plano del día: un barrio completo al azar y después se quitan casillas mientras siga
 * habiendo una única solución.
 */
export function dailyParks(date: string): ParksPuzzle {
  const rand = mulberry32(hashString('plan-verde:' + date));
  const solution = countSolutions(Array(SIZE * SIZE).fill(EMPTY), 1, rand).first!;
  const givens = solution.slice();
  const order = givens.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    const keep = givens[i];
    givens[i] = EMPTY;
    if (countSolutions(givens, 2).count !== 1) givens[i] = keep;
  }
  let par = 0;
  for (let i = 0; i < givens.length; i++) if (!givens[i]) par += solution[i];
  return { givens, solution, par };
}
