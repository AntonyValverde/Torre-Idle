import { hashString, mulberry32 } from '../rng';

// "Conecta las calles": cada casilla es un tramo de calle que se gira 90° al tocarlo.
// Hay que unir todas las casas con el ayuntamiento. Todos los jugadores reciben el mismo plano cada día.
//
// Cada tramo se guarda como una máscara de salidas: N = 1, E = 2, S = 4, W = 8.

export const SIZE = 6;
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

const DIRS = [
  { bit: N, dr: -1, dc: 0, opp: S },
  { bit: E, dr: 0, dc: 1, opp: W },
  { bit: S, dr: 1, dc: 0, opp: N },
  { bit: W, dr: 0, dc: -1, opp: E },
];

export interface RoadsPuzzle {
  /** Máscaras de salida tal como empieza el plano (desordenado). */
  tiles: number[];
  /** Casilla del ayuntamiento. */
  hall: number;
  /** Casillas con casa (los tramos sin salida). */
  houses: number[];
  /** Una solución (el árbol original antes de desordenarlo). */
  solution: number[];
  /** Giros necesarios para llegar a esa solución. */
  par: number;
}

/** Gira un tramo 90° en el sentido de las agujas del reloj. */
export function rotate(mask: number): number {
  return ((mask << 1) | (mask >> 3)) & 15;
}

export function exits(mask: number): number {
  let n = 0;
  for (const d of DIRS) if (mask & d.bit) n++;
  return n;
}

/** Casillas unidas al ayuntamiento: dos tramos vecinos conectan si ambos apuntan el uno al otro. */
export function connected(tiles: number[], hall: number, size = SIZE): Set<number> {
  const seen = new Set([hall]);
  const queue = [hall];
  while (queue.length) {
    const i = queue.shift()!;
    const r = Math.floor(i / size);
    const c = i % size;
    for (const d of DIRS) {
      if (!(tiles[i] & d.bit)) continue;
      const rr = r + d.dr;
      const cc = c + d.dc;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const j = rr * size + cc;
      if (!seen.has(j) && tiles[j] & d.opp) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen;
}

export function isSolved(tiles: number[], hall: number, houses: number[], size = SIZE): boolean {
  const reach = connected(tiles, hall, size);
  return houses.every((h) => reach.has(h));
}

/** Giros mínimos para pasar de `from` a `to` (o -1 si no es el mismo tramo). */
export function turnsBetween(from: number, to: number): number {
  let m = from;
  for (let k = 0; k < 4; k++) {
    if (m === to) return k;
    m = rotate(m);
  }
  return -1;
}

/**
 * Genera el plano del día: un árbol aleatorio (Prim) que pasa por todas las casillas, con el
 * ayuntamiento como raíz y una casa en cada calle sin salida. Después gira cada tramo al azar.
 * Como parte de una solución real, siempre se puede resolver.
 */
export function dailyRoads(date: string, size = SIZE): RoadsPuzzle {
  const rand = mulberry32(hashString('calles:' + date));
  const cells = size * size;
  const solution: number[] = Array(cells).fill(0);
  const hall = Math.floor(rand() * cells);
  const inTree = new Set([hall]);
  const frontier: [number, number][] = [];
  const addEdges = (i: number) => {
    const r = Math.floor(i / size);
    const c = i % size;
    DIRS.forEach((d, k) => {
      const rr = r + d.dr;
      const cc = c + d.dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size) frontier.push([i, k]);
    });
  };
  addEdges(hall);
  while (inTree.size < cells) {
    const [i, k] = frontier.splice(Math.floor(rand() * frontier.length), 1)[0];
    const d = DIRS[k];
    const j = i + d.dr * size + d.dc;
    if (inTree.has(j)) continue;
    solution[i] |= d.bit;
    solution[j] |= d.opp;
    inTree.add(j);
    addEdges(j);
  }

  const houses: number[] = [];
  for (let i = 0; i < cells; i++) if (i !== hall && exits(solution[i]) === 1) houses.push(i);

  const tiles = solution.map((m) => {
    let x = m;
    for (let k = Math.floor(rand() * 4); k > 0; k--) x = rotate(x);
    return x;
  });
  // Si por casualidad sale ya resuelto, se gira una calle sin salida
  if (isSolved(tiles, hall, houses, size)) tiles[houses[0]] = rotate(tiles[houses[0]]);

  let par = 0;
  for (let i = 0; i < cells; i++) par += turnsBetween(tiles[i], solution[i]);
  return { tiles, hall, houses, solution, par };
}
