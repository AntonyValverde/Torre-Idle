// "Defensa de calles": tres calles bajan hasta el ayuntamiento. Por arriba llegan oleadas de soldados
// enemigos y tú construyes defensas en las casillas de cada calle con el dinero que vas ganando:
// torretas (disparan calle arriba), barricadas (los frenan) y cañones (daño en zona). Un enemigo que se
// topa con una defensa se para a romperla. Cada uno que llega al ayuntamiento quita una vida.

export const LANES = 3;
export const ROWS = 5;
export const LANE_W = 30;
export const FIELD_W = LANES * LANE_W;
export const FIELD_H = 150;
export const ROW_H = 22;
/** Centro vertical de la primera fila de casillas. */
export const ROW0_Y = 24;
/** Donde empieza el ayuntamiento: quien llega aquí, entra. */
export const HALL_Y = 134;
export const LIVES = 5;
export const START_MONEY = 160;
/** Dinero que entra solo, por segundo. */
export const INCOME = 2.5;
export const WAVE_PAUSE_MS = 3000;
/** Medio alto de una casilla (lo que ocupa una defensa). */
export const SLOT_HALF = 9;

export type DefenseKind = 'archer' | 'wall' | 'cannon';
export type EnemyKind = 'soldier' | 'runner' | 'brute' | 'ram';

export const DEFENSES: Record<DefenseKind, { emoji: string; name: string; cost: number; hp: number; every: number; dmg: number; range: number }> = {
  archer: { emoji: '🏹', name: 'Torreta', cost: 50, hp: 6, every: 900, dmg: 1, range: 85 },
  wall: { emoji: '🚧', name: 'Barricada', cost: 30, hp: 16, every: 0, dmg: 0, range: 0 },
  cannon: { emoji: '💣', name: 'Cañón', cost: 90, hp: 6, every: 2200, dmg: 3, range: 95 },
};
export const DEFENSE_KINDS: DefenseKind[] = ['archer', 'wall', 'cannon'];
/** Radio (vertical) del daño en zona del cañón y daño a los de alrededor. */
export const SPLASH = 11;
export const SPLASH_DMG = 2;

export const ENEMIES: Record<EnemyKind, { emoji: string; hp: number; speed: number; hit: number; pts: number; money: number }> = {
  soldier: { emoji: '💂', hp: 4, speed: 9, hit: 1, pts: 1, money: 6 },
  runner: { emoji: '🏃', hp: 2, speed: 15, hit: 1, pts: 1, money: 5 },
  brute: { emoji: '🛡️', hp: 12, speed: 6, hit: 2, pts: 3, money: 12 },
  ram: { emoji: '🐏', hp: 40, speed: 4.5, hit: 4, pts: 10, money: 30 },
};
/** Un enemigo parado golpea la defensa cada tantos ms. */
export const HIT_MS = 700;

export interface Defense {
  kind: DefenseKind;
  lane: number;
  row: number;
  hp: number;
  cool: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  lane: number;
  y: number;
  hp: number;
  /** ms hasta su próximo golpe (cuando está parado ante una defensa). */
  cool: number;
  hurt: number;
}

/** Disparo que se dibuja un momento (el daño es instantáneo). */
export interface Tracer {
  lane: number;
  y0: number;
  y1: number;
  kind: DefenseKind;
  age: number;
}

export interface LanesGame {
  t: number;
  wave: number;
  toSpawn: number;
  nextSpawn: number;
  pause: number;
  money: number;
  lives: number;
  /** Casillas: defenses[lane][row]. */
  defenses: (Defense | null)[][];
  enemies: Enemy[];
  tracers: Tracer[];
  nextId: number;
  score: number;
  kills: number;
  over: boolean;
}

export interface LanesEvents {
  kills: number;
  points: number;
  leaked: number;
  broken: number;
  waveCleared: boolean;
  waveStart: boolean;
  lost: boolean;
}

export const rowY = (row: number) => ROW0_Y + row * ROW_H;
export const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

export function waveSize(wave: number): number {
  return 3 + 3 * wave;
}

export function spawnMs(wave: number): number {
  return Math.max(550, 1900 - 90 * wave);
}

/** Vida de los enemigos: crece un poco cada oleada. */
export function hpScale(wave: number): number {
  return 1 + 0.22 * (wave - 1);
}

export function newLanes(): LanesGame {
  return {
    t: 0,
    wave: 1,
    toSpawn: waveSize(1),
    nextSpawn: 2500,
    pause: 0,
    money: START_MONEY,
    lives: LIVES,
    defenses: Array.from({ length: LANES }, () => Array<Defense | null>(ROWS).fill(null)),
    enemies: [],
    tracers: [],
    nextId: 1,
    score: 0,
    kills: 0,
    over: false,
  };
}

export function pickEnemy(wave: number, rand: () => number): EnemyKind {
  const r = rand();
  if (wave >= 4 && r < 0.18) return 'brute';
  if (wave >= 2 && r < 0.45) return 'runner';
  return 'soldier';
}

export function build(g: LanesGame, kind: DefenseKind, lane: number, row: number): 'ok' | 'money' | 'taken' {
  if (g.over || lane < 0 || lane >= LANES || row < 0 || row >= ROWS) return 'taken';
  if (g.defenses[lane][row]) return 'taken';
  const d = DEFENSES[kind];
  if (g.money < d.cost) return 'money';
  g.money -= d.cost;
  g.defenses[lane][row] = { kind, lane, row, hp: d.hp, cool: 0 };
  return 'ok';
}

/** Primera defensa por debajo del enemigo en su calle (la que lo frena). */
export function blocker(g: LanesGame, e: Enemy): Defense | null {
  for (let row = 0; row < ROWS; row++) {
    const d = g.defenses[e.lane][row];
    if (d && rowY(row) + SLOT_HALF > e.y) return d;
  }
  return null;
}

function damage(g: LanesGame, e: Enemy, n: number, ev: LanesEvents) {
  if (e.hp <= 0) return;
  e.hp -= n;
  e.hurt = 200;
  if (e.hp > 0) return;
  const k = ENEMIES[e.kind];
  g.score += k.pts;
  g.money += k.money;
  g.kills++;
  ev.kills++;
  ev.points += k.pts;
}

export function step(g: LanesGame, dt: number, rand: () => number): LanesEvents {
  const ev: LanesEvents = { kills: 0, points: 0, leaked: 0, broken: 0, waveCleared: false, waveStart: false, lost: false };
  if (g.over) return ev;
  g.t += dt;
  g.money += (INCOME * dt) / 1000;

  // Oleadas (cada quinta trae un ariete)
  if (g.pause > 0) {
    g.pause -= dt;
    if (g.pause <= 0) {
      g.pause = 0;
      g.wave++;
      g.toSpawn = waveSize(g.wave);
      g.nextSpawn = 400;
      ev.waveStart = true;
    }
  } else if (g.toSpawn > 0) {
    g.nextSpawn -= dt;
    if (g.nextSpawn <= 0) {
      const kind: EnemyKind = g.wave % 5 === 0 && g.toSpawn === 1 ? 'ram' : pickEnemy(g.wave, rand);
      const hp = Math.round(ENEMIES[kind].hp * hpScale(g.wave));
      g.enemies.push({ id: g.nextId++, kind, lane: Math.floor(rand() * LANES), y: -6, hp, cool: HIT_MS / 2, hurt: 0 });
      g.toSpawn--;
      g.nextSpawn += spawnMs(g.wave) * (0.7 + rand() * 0.6);
    }
  }

  // Enemigos: bajan o golpean la defensa que tienen delante
  for (const e of g.enemies) {
    e.hurt = Math.max(0, e.hurt - dt);
    const k = ENEMIES[e.kind];
    const d = blocker(g, e);
    const stopAt = d ? rowY(d.row) - SLOT_HALF - 3 : Infinity;
    const ny = e.y + (k.speed * dt) / 1000;
    if (ny < stopAt) {
      e.y = ny;
      continue;
    }
    e.y = Math.max(e.y, stopAt);
    e.cool -= dt;
    if (e.cool <= 0 && d) {
      e.cool += HIT_MS;
      d.hp -= k.hit;
      if (d.hp <= 0) {
        g.defenses[d.lane][d.row] = null;
        ev.broken++;
      }
    }
  }

  // Defensas: disparan al enemigo más cercano calle arriba
  for (const lane of g.defenses) {
    for (const d of lane) {
      if (!d || d.kind === 'wall') continue;
      const info = DEFENSES[d.kind];
      d.cool -= dt;
      if (d.cool > 0) continue;
      const y = rowY(d.row);
      const target = g.enemies
        .filter((e) => e.lane === d.lane && e.hp > 0 && e.y < y && y - e.y <= info.range && e.y > -4)
        .sort((a, b) => b.y - a.y)[0];
      if (!target) {
        d.cool = 0;
        continue;
      }
      d.cool = info.every;
      g.tracers.push({ lane: d.lane, y0: y, y1: target.y, kind: d.kind, age: 0 });
      damage(g, target, info.dmg, ev);
      if (d.kind === 'cannon') {
        for (const e of g.enemies) if (e !== target && e.lane === d.lane && Math.abs(e.y - target.y) <= SPLASH) damage(g, e, SPLASH_DMG, ev);
      }
    }
  }

  g.enemies = g.enemies.filter((e) => {
    if (e.hp <= 0) return false;
    if (e.y >= HALL_Y) {
      g.lives--;
      ev.leaked++;
      return false;
    }
    return true;
  });
  for (const tr of g.tracers) tr.age += dt;
  g.tracers = g.tracers.filter((tr) => tr.age < 160);

  if (g.lives <= 0) {
    g.lives = 0;
    g.over = true;
    ev.lost = true;
    return ev;
  }

  if (g.pause === 0 && g.toSpawn === 0 && g.enemies.length === 0) {
    g.score += g.wave;
    ev.points += g.wave;
    g.money += 20 + 5 * g.wave;
    ev.waveCleared = true;
    g.pause = WAVE_PAUSE_MS;
  }
  return ev;
}
