// "Bomberos": salen incendios en las ventanas de un edificio y crecen (nivel 1 a 3).
// Un fuego al máximo se propaga a una ventana vecina. Cada toque gasta agua y baja un nivel.
// Se pierde cuando arden LOSE_AT ventanas a la vez. Cuanto más dura la partida, más rápido va.

export const COLS = 4;
export const ROWS = 5;
export const CELLS = COLS * ROWS;
export const MAX_LEVEL = 3;
export const WATER_MAX = 8;
/** Un chorro de agua se recarga cada tantos ms. */
export const WATER_REFILL_MS = 320;
/** Ventanas ardiendo a la vez con las que se pierde el edificio. */
export const LOSE_AT = 8;
/** Puntos por bajar un nivel y extra por apagar del todo. */
export const HIT_POINTS = 1;
export const PUT_OUT_BONUS = 2;

export interface FireGame {
  /** Tiempo jugado (ms). */
  t: number;
  /** Nivel de fuego de cada ventana (0 = sin fuego). */
  level: number[];
  /** ms que faltan para que cada fuego crezca (o se propague si ya está al máximo). */
  timer: number[];
  water: number;
  refill: number;
  nextSpawn: number;
  score: number;
  /** Fuegos apagados del todo. */
  putOut: number;
  over: boolean;
}

export function growMs(t: number): number {
  return Math.max(700, 2000 / (1 + t / 90_000));
}

export function spawnMs(t: number): number {
  return Math.max(300, 1500 / (1 + t / 60_000));
}

export function newFire(): FireGame {
  return {
    t: 0,
    level: Array(CELLS).fill(0),
    timer: Array(CELLS).fill(0),
    water: WATER_MAX,
    refill: 0,
    nextSpawn: 600,
    score: 0,
    putOut: 0,
    over: false,
  };
}

export function burning(g: FireGame): number {
  return g.level.filter((l) => l > 0).length;
}

export function neighbors(i: number): number[] {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const out: number[] = [];
  if (r > 0) out.push(i - COLS);
  if (r < ROWS - 1) out.push(i + COLS);
  if (c > 0) out.push(i - 1);
  if (c < COLS - 1) out.push(i + 1);
  return out;
}

function ignite(g: FireGame, i: number) {
  g.level[i] = 1;
  g.timer[i] = growMs(g.t);
}

export interface FireEvents {
  spawned: number;
  spread: number;
  lost: boolean;
}

/** Avanza la partida `dt` ms. */
export function step(g: FireGame, dt: number, rand: () => number): FireEvents {
  const ev: FireEvents = { spawned: 0, spread: 0, lost: false };
  if (g.over) return ev;
  g.t += dt;

  // Agua: se recarga sola
  if (g.water < WATER_MAX) {
    g.refill += dt;
    while (g.refill >= WATER_REFILL_MS && g.water < WATER_MAX) {
      g.refill -= WATER_REFILL_MS;
      g.water++;
    }
  } else {
    g.refill = 0;
  }

  // Los fuegos crecen; los que están al máximo se propagan
  for (let i = 0; i < CELLS; i++) {
    if (!g.level[i]) continue;
    g.timer[i] -= dt;
    if (g.timer[i] > 0) continue;
    g.timer[i] += growMs(g.t);
    if (g.level[i] < MAX_LEVEL) {
      g.level[i]++;
    } else {
      const free = neighbors(i).filter((j) => !g.level[j]);
      if (free.length) {
        ignite(g, free[Math.floor(rand() * free.length)]);
        ev.spread++;
      }
    }
  }

  // Fuegos nuevos
  g.nextSpawn -= dt;
  if (g.nextSpawn <= 0) {
    g.nextSpawn += spawnMs(g.t) * (0.7 + rand() * 0.6);
    const free = g.level.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0);
    if (free.length) {
      ignite(g, free[Math.floor(rand() * free.length)]);
      ev.spawned++;
    }
  }

  if (burning(g) >= LOSE_AT) {
    g.over = true;
    ev.lost = true;
  }
  return ev;
}

export type SprayResult = { kind: 'empty' } | { kind: 'miss' } | { kind: 'hit'; points: number; out: boolean };

/** Lanza agua a una ventana. */
export function spray(g: FireGame, i: number): SprayResult {
  if (g.over || i < 0 || i >= CELLS) return { kind: 'miss' };
  if (g.water < 1) return { kind: 'empty' };
  g.water--;
  if (!g.level[i]) return { kind: 'miss' };
  g.level[i]--;
  // El agua enfría: el fuego tarda en volver a crecer
  g.timer[i] = growMs(g.t);
  const out = g.level[i] === 0;
  const points = HIT_POINTS + (out ? PUT_OUT_BONUS : 0);
  g.score += points;
  if (out) g.putOut++;
  return { kind: 'hit', points, out };
}
