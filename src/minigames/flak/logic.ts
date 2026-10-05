// "Defensa antiaérea": caen proyectiles sobre los edificios de la ciudad. Cada toque dispara un obús
// desde la batería que explota donde tocaste; lo que quede dentro de la explosión cae y estalla a su
// vez (reacción en cadena, que puntúa más). Llegan por oleadas cada vez más rápidas y, desde la tercera,
// algunos se parten en tres a media altura. Se pierde cuando no queda ningún edificio en pie.

export const FIELD_W = 100;
export const FIELD_H = 150;
export const GROUND = 138;
export const BATTERY = { x: 50, y: GROUND - 4 };
/** Centros de los edificios (la batería queda en medio). */
export const BUILDING_X = [9, 22, 35, 65, 78, 91];
export const BUILDING_W = 11;

export const AMMO_MAX = 8;
export const AMMO_REFILL_MS = 450;
/** Velocidad del obús propio (unidades/s). */
export const SHOT_SPEED = 170;
/** Explosión propia: crece, se mantiene y se apaga. */
export const BLAST_R = 12;
export const CHAIN_R = 7;
export const GROW_MS = 250;
export const HOLD_MS = 150;
export const FADE_MS = 250;
export const BLAST_MS = GROW_MS + HOLD_MS + FADE_MS;
/** Pausa entre oleadas. */
export const WAVE_PAUSE_MS = 2000;
/** Puntos por edificio en pie al acabar una oleada. */
export const SURVIVOR_BONUS = 3;
/** Cada tantas oleadas superadas se reconstruye un edificio. */
export const REBUILD_EVERY = 3;
/** No se puede disparar tan pegado al suelo. */
export const MIN_AIM_Y = GROUND - 8;

export type EnemyKind = 'shell' | 'fast' | 'split';

export interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: EnemyKind;
  /** Edificio al que apunta. */
  target: number;
  /** Altura a la que se parte (solo los 'split'). */
  splitY: number;
  /** De dónde salió (para la estela). */
  x0: number;
  y0: number;
}

export interface Shot {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface Blast {
  x: number;
  y: number;
  /** Radio máximo. */
  r: number;
  age: number;
  /** 0 = la de tu obús; 1, 2… = reacción en cadena. -1 = impacto enemigo (no derriba nada). */
  depth: number;
}

export interface Building {
  x: number;
  h: number;
  alive: boolean;
}

export interface FlakGame {
  t: number;
  wave: number;
  /** Enemigos de esta oleada que faltan por salir. */
  toSpawn: number;
  nextSpawn: number;
  /** ms de pausa antes de la siguiente oleada (0 = en oleada). */
  pause: number;
  enemies: Enemy[];
  shots: Shot[];
  blasts: Blast[];
  buildings: Building[];
  ammo: number;
  refill: number;
  score: number;
  kills: number;
  /** Mejor cadena de la partida (enemigos de un solo disparo). */
  bestChain: number;
  over: boolean;
}

export interface FlakEvents {
  kills: number;
  /** Puntos ganados en este paso. */
  points: number;
  /** Dónde cayó cada derribo y cuánto valió. */
  pops: { x: number; y: number; pts: number }[];
  hits: number;
  split: boolean;
  waveCleared: boolean;
  rebuilt: boolean;
  waveStart: boolean;
  lost: boolean;
}

export function waveSize(wave: number): number {
  return 5 + 2 * wave;
}

export function spawnMs(wave: number): number {
  return Math.max(420, 1700 - 110 * wave);
}

/** Velocidad de caída base de una oleada (unidades/s). */
export function fallSpeed(wave: number): number {
  return 13 + 2.2 * wave;
}

export function newFlak(rand: () => number): FlakGame {
  return {
    t: 0,
    wave: 1,
    toSpawn: waveSize(1),
    nextSpawn: 700,
    pause: 0,
    enemies: [],
    shots: [],
    blasts: [],
    buildings: BUILDING_X.map((x) => ({ x, h: 18 + Math.round(rand() * 26), alive: true })),
    ammo: AMMO_MAX,
    refill: 0,
    score: 0,
    kills: 0,
    bestChain: 0,
    over: false,
  };
}

export function standing(g: FlakGame): number {
  return g.buildings.filter((b) => b.alive).length;
}

/** Radio actual de una explosión según su edad. */
export function blastRadius(b: Blast): number {
  if (b.age < GROW_MS) return (b.r * b.age) / GROW_MS;
  if (b.age < GROW_MS + HOLD_MS) return b.r;
  return Math.max(0, b.r * (1 - (b.age - GROW_MS - HOLD_MS) / FADE_MS));
}

function pickTarget(g: FlakGame, rand: () => number): number {
  const alive = g.buildings.map((b, i) => (b.alive ? i : -1)).filter((i) => i >= 0);
  const pool = alive.length ? alive : g.buildings.map((_, i) => i);
  return pool[Math.floor(rand() * pool.length)];
}

function aim(e: Enemy, g: FlakGame, speed: number) {
  const b = g.buildings[e.target];
  const tx = b.x;
  const ty = GROUND - b.h;
  const d = Math.hypot(tx - e.x, ty - e.y) || 1;
  e.vx = ((tx - e.x) / d) * speed;
  e.vy = ((ty - e.y) / d) * speed;
}

export function spawnEnemy(g: FlakGame, rand: () => number): Enemy {
  const r = rand();
  const kind: EnemyKind = g.wave >= 3 && r < 0.2 ? 'split' : g.wave >= 2 && r < 0.4 ? 'fast' : 'shell';
  const x = 6 + rand() * (FIELD_W - 12);
  const e: Enemy = { x, y: -4, vx: 0, vy: 0, kind, target: pickTarget(g, rand), splitY: 40 + rand() * 25, x0: x, y0: -4 };
  aim(e, g, fallSpeed(g.wave) * (kind === 'fast' ? 1.6 : 1));
  return e;
}

/** Dispara un obús hacia (x, y). */
export function fire(g: FlakGame, x: number, y: number): 'ok' | 'empty' | 'low' {
  if (g.over) return 'empty';
  if (y > MIN_AIM_Y) return 'low';
  if (g.ammo < 1) return 'empty';
  g.ammo--;
  g.shots.push({ x: BATTERY.x, y: BATTERY.y, tx: Math.max(0, Math.min(FIELD_W, x)), ty: Math.max(0, y) });
  return 'ok';
}

export function step(g: FlakGame, dt: number, rand: () => number): FlakEvents {
  const ev: FlakEvents = { kills: 0, points: 0, pops: [], hits: 0, split: false, waveCleared: false, rebuilt: false, waveStart: false, lost: false };
  if (g.over) return ev;
  g.t += dt;

  // Munición
  if (g.ammo < AMMO_MAX) {
    g.refill += dt;
    while (g.refill >= AMMO_REFILL_MS && g.ammo < AMMO_MAX) {
      g.refill -= AMMO_REFILL_MS;
      g.ammo++;
    }
  } else g.refill = 0;

  // Oleadas
  if (g.pause > 0) {
    g.pause -= dt;
    if (g.pause <= 0) {
      g.pause = 0;
      g.wave++;
      g.toSpawn = waveSize(g.wave);
      g.nextSpawn = 500;
      ev.waveStart = true;
    }
  } else if (g.toSpawn > 0) {
    g.nextSpawn -= dt;
    if (g.nextSpawn <= 0) {
      g.enemies.push(spawnEnemy(g, rand));
      g.toSpawn--;
      g.nextSpawn += spawnMs(g.wave) * (0.7 + rand() * 0.6);
    }
  }

  // Obuses propios: al llegar, explotan
  g.shots = g.shots.filter((s) => {
    const d = Math.hypot(s.tx - s.x, s.ty - s.y);
    const move = (SHOT_SPEED * dt) / 1000;
    if (d <= move) {
      g.blasts.push({ x: s.tx, y: s.ty, r: BLAST_R, age: 0, depth: 0 });
      return false;
    }
    s.x += ((s.tx - s.x) / d) * move;
    s.y += ((s.ty - s.y) / d) * move;
    return true;
  });

  // Enemigos: avanzan, se parten o llegan a su objetivo
  const born: Enemy[] = [];
  g.enemies = g.enemies.filter((e) => {
    e.x += (e.vx * dt) / 1000;
    e.y += (e.vy * dt) / 1000;
    if (e.kind === 'split' && e.y >= e.splitY) {
      ev.split = true;
      for (let k = 0; k < 3; k++) {
        const c: Enemy = { x: e.x, y: e.y, vx: 0, vy: 0, kind: 'shell', target: pickTarget(g, rand), splitY: 0, x0: e.x, y0: e.y };
        aim(c, g, fallSpeed(g.wave) * 1.1);
        born.push(c);
      }
      return false;
    }
    const b = g.buildings[e.target];
    if (e.y >= GROUND - b.h) {
      if (b.alive && Math.abs(e.x - b.x) <= BUILDING_W) {
        b.alive = false;
        ev.hits++;
      }
      g.blasts.push({ x: e.x, y: e.y, r: 9, age: 0, depth: -1 });
      return false;
    }
    return true;
  });
  g.enemies.push(...born);

  // Explosiones: derriban lo que tocan, y cada derribo es otra explosión (en cadena)
  const chained: Blast[] = [];
  for (const bl of g.blasts) {
    bl.age += dt;
    if (bl.depth < 0) continue;
    const r = blastRadius(bl);
    if (r < 1) continue;
    g.enemies = g.enemies.filter((e) => {
      if (Math.hypot(e.x - bl.x, e.y - bl.y) > r + 1.2) return true;
      const pts = 1 + bl.depth + (e.kind === 'split' ? 2 : e.kind === 'fast' ? 1 : 0);
      ev.kills++;
      ev.points += pts;
      ev.pops.push({ x: e.x, y: e.y, pts });
      g.kills++;
      g.score += pts;
      chained.push({ x: e.x, y: e.y, r: CHAIN_R, age: 0, depth: bl.depth + 1 });
      return false;
    });
  }
  g.blasts = g.blasts.filter((b) => b.age < BLAST_MS);
  g.blasts.push(...chained);
  const depth = chained.reduce((m, b) => Math.max(m, b.depth), 0);
  g.bestChain = Math.max(g.bestChain, depth);

  if (standing(g) === 0) {
    g.over = true;
    ev.lost = true;
    return ev;
  }

  // Fin de oleada: no queda nada por salir ni en el aire
  if (g.pause === 0 && g.toSpawn === 0 && g.enemies.length === 0) {
    const bonus = SURVIVOR_BONUS * standing(g);
    g.score += bonus;
    ev.points += bonus;
    ev.waveCleared = true;
    if (g.wave % REBUILD_EVERY === 0) {
      const down = g.buildings.find((b) => !b.alive);
      if (down) {
        down.alive = true;
        ev.rebuilt = true;
      }
    }
    g.pause = WAVE_PAUSE_MS;
  }
  return ev;
}

/** Lo que cae del cielo según la era de la ciudad (solo cambia el aspecto). */
export interface FlakTheme {
  name: string;
  color: string;
  trail: string;
}

export function flakTheme(era: number): FlakTheme {
  if (era <= 1) return { name: 'piedras de catapulta', color: '#a07a4e', trail: 'rgba(200,170,120,0.35)' };
  if (era === 2) return { name: 'balas de cañón', color: '#2b2d36', trail: 'rgba(210,210,220,0.35)' };
  if (era === 3) return { name: 'bombas', color: '#3a4a2a', trail: 'rgba(255,190,120,0.35)' };
  if (era === 4) return { name: 'misiles', color: '#d8dce6', trail: 'rgba(255,120,80,0.45)' };
  return { name: 'drones', color: '#7a5cff', trail: 'rgba(140,200,255,0.45)' };
}
