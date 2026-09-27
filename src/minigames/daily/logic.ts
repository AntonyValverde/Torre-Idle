import { hashString, mulberry32 } from '../rng';

// "Apagón": enciende todas las ventanas del edificio. Al tocar una ventana
// cambian ella y sus 4 vecinas. Todos los jugadores reciben el mismo tablero cada día.

export const GRID = 5;

export function press(board: boolean[], i: number, size = GRID): boolean[] {
  const next = board.slice();
  const r = Math.floor(i / size);
  const c = i % size;
  const toggle = (rr: number, cc: number) => {
    if (rr >= 0 && rr < size && cc >= 0 && cc < size) next[rr * size + cc] = !next[rr * size + cc];
  };
  toggle(r, c);
  toggle(r - 1, c);
  toggle(r + 1, c);
  toggle(r, c - 1);
  toggle(r, c + 1);
  return next;
}

export function isSolved(board: boolean[]): boolean {
  return board.every(Boolean);
}

/**
 * Genera el tablero del día partiendo de todo encendido y aplicando `par` toques distintos,
 * así siempre tiene solución en `par` movimientos o menos.
 */
export function dailyPuzzle(date: string, size = GRID): { board: boolean[]; par: number } {
  const rand = mulberry32(hashString('apagon:' + date));
  let par = 6 + Math.floor(rand() * 5);
  const cells = Array.from({ length: size * size }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  let board: boolean[] = Array(size * size).fill(true);
  for (let k = 0; k < par; k++) board = press(board, cells[k], size);
  if (isSolved(board)) board = press(board, cells[par++], size);
  return { board, par };
}
