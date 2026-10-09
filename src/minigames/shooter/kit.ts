// Piezas comunes de los shooters del arcade (Escuadrilla, Torre vigía, Ronda nocturna, Alcantarillas,
// Arena de neón y Alcalde bala). Todo es lógica pura, sin DOM: cada juego la usa desde su logic.ts y
// así se puede probar con semillas fijas.

export type Rand = () => number;

export interface Vec {
  x: number;
  y: number;
}

export interface Circle extends Vec {
  r: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Vector unitario de (x, y); (0, 0) si es nulo. */
export function norm(x: number, y: number): Vec {
  const d = Math.hypot(x, y);
  return d > 1e-9 ? { x: x / d, y: y / d } : { x: 0, y: 0 };
}

/** Dos círculos se tocan. */
export function hit(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy <= r * r;
}

/** El más cercano a (x, y) dentro de `maxR`, o null. */
export function nearest<T extends Vec>(list: readonly T[], x: number, y: number, maxR = Infinity): T | null {
  let best: T | null = null;
  let bd = maxR * maxR;
  for (const e of list) {
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Entero en [lo, hi]. */
export function randInt(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export function pickOne<T>(rand: Rand, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

/** Elige un elemento según su peso. */
export function weighted<T>(rand: Rand, list: readonly T[], weight: (x: T) => number): T {
  const total = list.reduce((n, x) => n + Math.max(0, weight(x)), 0);
  let r = rand() * total;
  for (const x of list) {
    r -= Math.max(0, weight(x));
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Mejoras de partida: al subir de nivel o abrir un cofre se ofrecen unas cuantas para elegir una.
// ---------------------------------------------------------------------------------------------

export interface UpgradeDef<Id extends string = string> {
  id: Id;
  emoji: string;
  name: string;
  /** Nivel máximo (1 = se coge una sola vez). */
  max: number;
  /** Qué hace el siguiente nivel (`lv` empieza en 1). */
  desc: (lv: number) => string;
  /** Probabilidad relativa de salir (1 por defecto). */
  weight?: number;
  /** Arma nueva (se resalta en la elección). */
  weapon?: boolean;
}

export type Levels<Id extends string = string> = Partial<Record<Id, number>>;

export function levelOf<Id extends string>(levels: Levels<Id>, id: Id): number {
  return levels[id] ?? 0;
}

/** Hasta `n` mejoras distintas que aún no están al máximo, sorteadas por peso. */
export function rollUpgrades<Id extends string>(defs: readonly UpgradeDef<Id>[], levels: Levels<Id>, rand: Rand, n = 3): UpgradeDef<Id>[] {
  const pool = defs.filter((d) => levelOf(levels, d.id) < d.max);
  const out: UpgradeDef<Id>[] = [];
  while (out.length < n && pool.length) {
    const d = weighted(rand, pool, (x) => x.weight ?? 1);
    out.push(d);
    pool.splice(pool.indexOf(d), 1);
  }
  return out;
}

/** Sube un nivel (sin pasar del máximo) y devuelve el nivel nuevo. */
export function levelUp<Id extends string>(levels: Levels<Id>, def: UpgradeDef<Id>): number {
  const lv = Math.min(def.max, levelOf(levels, def.id) + 1);
  levels[def.id] = lv;
  return lv;
}

// ---------------------------------------------------------------------------------------------
// Temporizadores en ms (las partidas avanzan con `step(g, dtMs, …)`).
// ---------------------------------------------------------------------------------------------

/** Resta `dt` a un enfriamiento y dice cuántas veces se cumplió (para cadencias rápidas). */
export function ticks(cool: { t: number }, every: number, dt: number): number {
  cool.t -= dt;
  let n = 0;
  while (cool.t <= 0 && n < 20) {
    cool.t += every;
    n++;
  }
  if (cool.t <= 0) cool.t = every;
  return n;
}
