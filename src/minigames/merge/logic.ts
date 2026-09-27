export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Tile {
  id: number;
  v: number;
  r: number;
  c: number;
  isNew?: boolean;
  merged?: boolean;
}

export const SIZE = 4;

let idSeq = 1;
export function nextTileId() {
  return idSeq++;
}

/** Celdas de una fila/columna ordenadas desde el borde hacia el que se desliza. */
function lineCells(line: number, dir: Dir, size: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let k = 0; k < size; k++) {
    const idx = dir === 'left' || dir === 'up' ? k : size - 1 - k;
    cells.push(dir === 'left' || dir === 'right' ? [line, idx] : [idx, line]);
  }
  return cells;
}

export function move(tiles: Tile[], dir: Dir, size = SIZE): { tiles: Tile[]; moved: boolean; gained: number } {
  const at = new Map(tiles.map((t) => [t.r * size + t.c, t]));
  const out: Tile[] = [];
  let gained = 0;
  let moved = false;

  for (let line = 0; line < size; line++) {
    const cells = lineCells(line, dir, size);
    const lineTiles = cells.map(([r, c]) => at.get(r * size + c)).filter((t): t is Tile => !!t);
    let pos = 0;
    for (let i = 0; i < lineTiles.length; i++) {
      const t = lineTiles[i];
      const next = lineTiles[i + 1];
      const [r, c] = cells[pos++];
      if (next && next.v === t.v) {
        const v = t.v * 2;
        gained += v;
        moved = true;
        out.push({ id: t.id, v, r, c, merged: true });
        i++;
      } else {
        if (t.r !== r || t.c !== c) moved = true;
        out.push({ id: t.id, v: t.v, r, c });
      }
    }
  }
  return { tiles: out, moved, gained };
}

export function spawn(tiles: Tile[], rand: () => number = Math.random, size = SIZE): Tile[] {
  const used = new Set(tiles.map((t) => t.r * size + t.c));
  const empty: number[] = [];
  for (let i = 0; i < size * size; i++) if (!used.has(i)) empty.push(i);
  if (empty.length === 0) return tiles;
  const cell = empty[Math.floor(rand() * empty.length)];
  return [
    ...tiles,
    { id: nextTileId(), v: rand() < 0.9 ? 2 : 4, r: Math.floor(cell / size), c: cell % size, isNew: true },
  ];
}

export function canMove(tiles: Tile[], size = SIZE): boolean {
  if (tiles.length < size * size) return true;
  const at = new Map(tiles.map((t) => [t.r * size + t.c, t.v]));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = at.get(r * size + c);
      if (c + 1 < size && at.get(r * size + c + 1) === v) return true;
      if (r + 1 < size && at.get((r + 1) * size + c) === v) return true;
    }
  }
  return false;
}

export function newBoard(rand: () => number = Math.random): Tile[] {
  return spawn(spawn([], rand), rand);
}

export const MATERIALS: Record<number, { emoji: string; name: string }> = {
  2: { emoji: '🪵', name: 'Madera' },
  4: { emoji: '🧱', name: 'Ladrillo' },
  8: { emoji: '🪨', name: 'Piedra' },
  16: { emoji: '🔩', name: 'Acero' },
  32: { emoji: '🪟', name: 'Vidrio' },
  64: { emoji: '⚙️', name: 'Motor' },
  128: { emoji: '🏗️', name: 'Grúa' },
  256: { emoji: '🗽', name: 'Estatua' },
  512: { emoji: '🏛️', name: 'Monumento' },
  1024: { emoji: '🌆', name: 'Maravilla' },
  2048: { emoji: '👑', name: 'Leyenda' },
  4096: { emoji: '🌠', name: 'Coloso' },
};
