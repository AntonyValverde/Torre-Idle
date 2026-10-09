// "Arena de neón" (twin-stick a lo Geometry Wars): una nave en una arena cerrada. Un pulgar mueve y el
// otro apunta y dispara. Los enemigos son figuras geométricas que aparecen en grupos por los bordes
// (con un aviso antes de poder hacer daño), cada una con su manera de moverse. Al morir sueltan
// fragmentos verdes que suben el multiplicador (que se pierde al morir) y a veces un potenciador.
// Cada pocos puntos eliges una mejora permanente y cada 90 s llega un Núcleo jefe.

import { clamp, hit, levelOf, levelUp, norm, pickOne, rollUpgrades, weighted, type Levels, type Rand, type UpgradeDef, type Vec } from '../shooter/kit';

export const ARENA_W = 360;
export const ARENA_H = 560;
/** Hueco de la nave (más pequeño que el dibujo: así los roces se perdonan). */
export const PLAYER_R = 6;
export const PLAYER_SPEED = 175;
export const START_LIVES = 3;
export const START_BOMBS = 2;
export const MAX_BOMBS = 6;
/** Aviso de aparición: se ve la silueta, pero ni hace daño ni se le puede dar (ms). */
export const SPAWN_MS = 600;
export const BOSS_SPAWN_MS = 1500;
/** Tras morir: la nave no está (ms) y luego es invulnerable un rato. */
export const RESPAWN_MS = 650;
export const INV_MS = 2200;
/** Al morir se limpian los enemigos de alrededor. */
export const CLEAR_R = 140;
export const POWER_MS = 15000;
export const BOSS_EVERY = 90000;
export const MULT_MAX = 10;
export const GEOM_LIFE = 7000;
export const ORB_LIFE = 9000;
/** Duración de la onda de la bomba y radio final (llega a todas las esquinas). */
export const BLAST_MS = 480;
export const BLAST_R = 680;
/** Los puntos de cada derribo (base × multiplicador) se escalan para que el marcador quede en la escala del arcade. */
export const PTS_K = 0.35;
/** Tope de seguridad del marcador (el ranking no admite más). */
export const SCORE_CAP = 4999;

export type EnemyKind = 'wanderer' | 'chaser' | 'splitter' | 'mini' | 'dodger' | 'snake' | 'boss';
export type PowerKind = 'spread' | 'bounce' | 'pierce' | 'turbo';
export type UpId = 'rate' | 'guns' | 'speed' | 'rear' | 'bomb' | 'life' | 'magnet' | 'move' | 'long';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  max: number;
  /** Edad desde que acabó el aviso (ms). */
  age: number;
  /** >0: aún se está materializando (ms). */
  spawn: number;
  /** Destello blanco al recibir un impacto (ms). */
  flash: number;
  /** Rumbo (rad) y rumbo deseado de los que deambulan o serpentean. */
  a: number;
  ta: number;
  /** Temporizador: cambio de rumbo, enfriamiento de la esquiva, siguiente ataque del jefe. */
  t: number;
  /** Esquivador: ms que le quedan de esquiva. */
  dodge: number;
  /** Mini: centro alrededor del que gira. */
  cx: number;
  cy: number;
  /** Serpiente: segmentos de la cola (invulnerables y peligrosos). */
  segs: Vec[];
  /** Jefe: ataque siguiente y aviso antes de lanzarlo (ms). */
  phase: number;
  warn: number;
  /** Bomba que ya le hizo daño (el jefe solo recibe una vez por bomba). */
  blast: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Enemigos que aún puede atravesar (Perforante) y rebotes que le quedan (Rebote). */
  pierce: number;
  bounce: number;
  /** Último enemigo tocado (para no dañarlo dos veces seguidas al atravesarlo). */
  last: number;
  dead: boolean;
}

export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dead: boolean;
}

/** Fragmento verde: sube el multiplicador. */
export interface Geom {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  got: boolean;
}

export interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: PowerKind;
  life: number;
  got: boolean;
}

export interface Blast {
  id: number;
  x: number;
  y: number;
  age: number;
  r: number;
}

export interface NeonInput {
  /** Dirección y fuerza (0..1) del movimiento. */
  mx: number;
  my: number;
  /** Dirección de disparo (unitaria) o null si no se dispara. */
  aim: Vec | null;
  /** Se pidió una bomba en este paso. */
  bomb: boolean;
}

export interface NeonGame {
  t: number;
  phase: 'play' | 'over';
  x: number;
  y: number;
  /** Hacia dónde mira la nave (rad). */
  ang: number;
  lives: number;
  bombs: number;
  inv: number;
  respawn: number;
  /** Puntos con decimales (el marcador muestra la parte entera). */
  pts: number;
  score: number;
  mult: number;
  bestMult: number;
  /** Fragmentos reunidos hacia el siguiente multiplicador. */
  bank: number;
  kills: number;
  deaths: number;
  bosses: number;
  bossAt: number;
  pow: Record<PowerKind, number>;
  lv: Levels<UpId>;
  /** Mejoras ya ofrecidas y elección pendiente. */
  picks: number;
  offer: UpgradeDef<UpId>[] | null;
  enemies: Enemy[];
  shots: Shot[];
  eshots: EnemyShot[];
  geoms: Geom[];
  orbs: Orb[];
  blast: Blast | null;
  nextSpawn: number;
  /** Sin apariciones nuevas un rato (tras bomba o muerte). */
  calm: number;
  gunT: number;
  nextId: number;
}

export interface Pop {
  x: number;
  y: number;
  kind: EnemyKind;
  /** Lo que subió el marcador con este derribo (entero: los decimales se acumulan). */
  pts: number;
  mult: number;
  bomb: boolean;
}

export interface NeonEvents {
  kills: Pop[];
  /** Impactos que no mataron. */
  sparks: Vec[];
  /** Balas paradas por la cola de una serpiente. */
  absorbed: Vec[];
  /** Balas que se apagan contra el borde. */
  walls: Vec[];
  shots: number;
  /** Avisos de aparición nuevos. */
  spawned: number;
  geoms: number;
  multUp: boolean;
  power: PowerKind | null;
  powerOut: PowerKind | null;
  died: Vec | null;
  cleared: { x: number; y: number; kind: EnemyKind }[];
  lost: boolean;
  bomb: Vec | null;
  bossIn: Vec | null;
  bossWarn: boolean;
  bossShot: boolean;
  bossDown: Vec | null;
  pick: boolean;
  dodges: number;
}

// ---------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------

export const STATS: Record<EnemyKind, { hp: number; r: number; pts: number; geoms: number; speed: number }> = {
  wanderer: { hp: 1, r: 10, pts: 1, geoms: 1, speed: 44 },
  chaser: { hp: 1, r: 10, pts: 1, geoms: 1, speed: 80 },
  splitter: { hp: 3, r: 11, pts: 2, geoms: 1, speed: 54 },
  mini: { hp: 1, r: 6, pts: 1, geoms: 1, speed: 58 },
  dodger: { hp: 2, r: 10, pts: 2, geoms: 2, speed: 68 },
  snake: { hp: 5, r: 9, pts: 4, geoms: 3, speed: 90 },
  boss: { hp: 90, r: 28, pts: 25, geoms: 14, speed: 70 },
};

export const SNAKE_SEGS = 9;
export const SNAKE_GAP = 8;

export const POWERS: Record<PowerKind, { emoji: string; name: string; color: string }> = {
  spread: { emoji: '🔱', name: 'Ráfaga', color: '#ffd23d' },
  bounce: { emoji: '🪃', name: 'Rebote', color: '#3dffb5' },
  pierce: { emoji: '🗡️', name: 'Perforante', color: '#ff5ad1' },
  turbo: { emoji: '⚡', name: 'Turbo', color: '#5ad7ff' },
};
export const POWER_KINDS: PowerKind[] = ['spread', 'bounce', 'pierce', 'turbo'];

export const UPGRADES: UpgradeDef<UpId>[] = [
  { id: 'rate', emoji: '⚡', name: 'Cadencia', max: 4, desc: () => 'Disparas un 16 % más rápido' },
  { id: 'guns', emoji: '🔫', name: 'Cañón extra', max: 2, weapon: true, desc: (lv) => (lv === 1 ? 'Dos chorros de balas en paralelo' : 'Tres chorros de balas en paralelo') },
  { id: 'speed', emoji: '💨', name: 'Balas veloces', max: 3, desc: () => 'Tus balas van un 18 % más rápido' },
  { id: 'rear', emoji: '↩️', name: 'Disparo trasero', max: 1, weapon: true, desc: () => 'También disparas hacia atrás' },
  { id: 'bomb', emoji: '💣', name: 'Bomba extra', max: 3, desc: () => '+1 bomba ahora mismo' },
  { id: 'life', emoji: '❤️', name: 'Vida extra', max: 2, weight: 0.8, desc: () => '+1 vida ahora mismo' },
  { id: 'magnet', emoji: '🧲', name: 'Imán', max: 3, desc: () => 'Atraes los fragmentos desde más lejos' },
  { id: 'move', emoji: '🏃', name: 'Motores', max: 3, desc: () => 'Te mueves un 10 % más rápido' },
  { id: 'long', emoji: '⏳', name: 'Potenciadores largos', max: 2, desc: () => 'Los potenciadores duran 5 s más' },
];

/** Puntos a los que se ofrece la mejora número `k` (1, 2, 3…): 30, 90, 180, 300, 450… */
export function pickAt(k: number): number {
  return (30 * k * (k + 1)) / 2;
}

/** Fragmentos que hacen falta para pasar del multiplicador `m` al siguiente. */
export function multNeed(m: number): number {
  return 4 + 4 * m * m;
}

export function fireMs(g: NeonGame): number {
  return 125 * 0.86 ** levelOf(g.lv, 'rate') * (g.pow.turbo > 0 ? 0.55 : 1);
}

export function bulletSpeed(g: NeonGame): number {
  return 470 * (1 + 0.18 * levelOf(g.lv, 'speed'));
}

export function moveSpeed(g: NeonGame): number {
  return PLAYER_SPEED * (1 + 0.1 * levelOf(g.lv, 'move'));
}

export function magnetR(g: NeonGame): number {
  return 30 + 22 * levelOf(g.lv, 'magnet');
}

export function powerMs(g: NeonGame): number {
  return POWER_MS + 5000 * levelOf(g.lv, 'long');
}

/** Pasados los 5 min la arena se desborda: cada minuto más es bastante más duro. */
const OVERLOAD = 300000;

/** Velocidad de los enemigos: empieza suave, +60 % a los 4 min y luego +50 % por minuto desde el desborde. */
export function speedScale(t: number): number {
  return 0.85 + 0.6 * Math.min(1, t / 240000) + 0.5 * Math.max(0, (t - OVERLOAD) / 60000);
}

/**
 * Escala de los puntos. Al principio cada derribo vale 0,9 y baja hasta 0,35 a los 2,5 min (quien empieza
 * también suma; luego el multiplicador compensa). En el desborde salen tantos que cada uno vale menos
 * (así el récord no se dispara).
 */
export function ptsK(t: number): number {
  return (PTS_K * (1 + 1.6 * Math.max(0, 1 - t / 150000))) / (1 + (1.5 * Math.max(0, t - OVERLOAD)) / 60000);
}

/** Vida de los enemigos: a partir de los 2 min aguantan más (si no, las mejoras lo arrasan todo). */
export function hpScale(t: number): number {
  return 1 + Math.max(0, t - 120000) / 120000 + Math.max(0, t - OVERLOAD) / 60000;
}

/** Cada cuánto llega un grupo nuevo (ms). */
export function spawnGap(t: number): number {
  return Math.max(900, 3000 - 1500 * Math.min(1, t / 240000) - 200 * Math.max(0, (t - OVERLOAD) / 60000));
}

/** Máximo de enemigos a la vez. */
export function enemyCap(t: number): number {
  return Math.min(75, 16 + Math.floor(t / 5000));
}

export function newNeon(): NeonGame {
  return {
    t: 0,
    phase: 'play',
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    ang: -Math.PI / 2,
    lives: START_LIVES,
    bombs: START_BOMBS,
    inv: 0,
    respawn: 0,
    pts: 0,
    score: 0,
    mult: 1,
    bestMult: 1,
    bank: 0,
    kills: 0,
    deaths: 0,
    bosses: 0,
    bossAt: BOSS_EVERY,
    pow: { spread: 0, bounce: 0, pierce: 0, turbo: 0 },
    lv: {},
    picks: 0,
    offer: null,
    enemies: [],
    shots: [],
    eshots: [],
    geoms: [],
    orbs: [],
    blast: null,
    nextSpawn: 1200,
    calm: 0,
    gunT: 0,
    nextId: 1,
  };
}

export function boss(g: NeonGame): Enemy | undefined {
  return g.enemies.find((e) => e.kind === 'boss');
}

export function summary(g: NeonGame): { score: number; detail: string } {
  const sec = Math.floor(g.t / 1000);
  const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const extra = g.bosses ? ` · ${g.bosses} ${g.bosses === 1 ? 'núcleo' : 'núcleos'}` : '';
  return { score: g.score, detail: `${time} · ${g.kills} derribos · ×${g.bestMult} máx${extra}` };
}

// ---------------------------------------------------------------------------------------------
// Apariciones
// ---------------------------------------------------------------------------------------------

export function makeEnemy(g: NeonGame, kind: EnemyKind, x: number, y: number, rand: Rand, spawn = SPAWN_MS): Enemy {
  const st = STATS[kind];
  const hp = kind === 'boss' ? Math.round(st.hp * (1 + 0.7 * g.bosses)) : Math.max(1, Math.round(st.hp * hpScale(g.t)));
  const a = rand() * Math.PI * 2;
  const e: Enemy = {
    id: g.nextId++,
    kind,
    x: clamp(x, st.r, ARENA_W - st.r),
    y: clamp(y, st.r, ARENA_H - st.r),
    vx: 0,
    vy: 0,
    r: st.r,
    hp,
    max: hp,
    age: 0,
    spawn,
    flash: 0,
    a,
    ta: a,
    t: kind === 'boss' ? 1800 : 600 + rand() * 1200,
    dodge: 0,
    cx: x,
    cy: y,
    segs: [],
    phase: 0,
    warn: 0,
    blast: 0,
  };
  if (kind === 'snake') for (let i = 0; i < SNAKE_SEGS; i++) e.segs.push({ x: e.x, y: e.y });
  return e;
}

type Pattern = 'drift' | 'corners' | 'line' | 'split' | 'dodge' | 'snake' | 'ring' | 'swarm';

const PATTERNS: { id: Pattern; from: number; w: number }[] = [
  { id: 'drift', from: 0, w: 3 },
  { id: 'corners', from: 18000, w: 3 },
  { id: 'line', from: 25000, w: 2 },
  { id: 'split', from: 38000, w: 2 },
  { id: 'dodge', from: 55000, w: 2 },
  { id: 'snake', from: 70000, w: 1.6 },
  { id: 'ring', from: 105000, w: 1.2 },
  { id: 'swarm', from: 140000, w: 1.2 },
];

const M = 18;

/** Punto del borde `side` (0 arriba, 1 derecha, 2 abajo, 3 izquierda) a una fracción `f` de su largo. */
function edgePoint(side: number, f: number): Vec {
  switch (side) {
    case 0:
      return { x: M + f * (ARENA_W - 2 * M), y: M };
    case 1:
      return { x: ARENA_W - M, y: M + f * (ARENA_H - 2 * M) };
    case 2:
      return { x: M + f * (ARENA_W - 2 * M), y: ARENA_H - M };
    default:
      return { x: M, y: M + f * (ARENA_H - 2 * M) };
  }
}

/** Uno de los dos bordes más lejanos a la nave. */
function farSide(g: NeonGame, rand: Rand): number {
  const d = [g.y, ARENA_W - g.x, ARENA_H - g.y, g.x];
  const order = [0, 1, 2, 3].sort((a, b) => d[b] - d[a]);
  return rand() < 0.7 ? order[0] : order[1];
}

function far(g: NeonGame, x: number, y: number, min: number): boolean {
  return Math.hypot(x - g.x, y - g.y) >= min;
}

/** Lanza un grupo según el patrón; devuelve cuántos avisos salieron. */
export function spawnPattern(g: NeonGame, id: Pattern, rand: Rand): number {
  const k = g.t / 60000;
  let n = 0;
  const add = (kind: EnemyKind, x: number, y: number) => {
    if (!far(g, x, y, 95)) return;
    g.enemies.push(makeEnemy(g, kind, x, y, rand));
    n++;
  };
  switch (id) {
    case 'drift': {
      const side = farSide(g, rand);
      const count = Math.min(7, 2 + Math.floor(k * 1.5));
      for (let i = 0; i < count; i++) {
        const p = edgePoint(rand() < 0.75 ? side : (side + 1 + Math.floor(rand() * 3)) % 4, rand());
        add('wanderer', p.x, p.y);
      }
      break;
    }
    case 'corners': {
      const per = Math.min(2, 1 + Math.floor(k / 2.5));
      for (const [cx, cy] of [
        [M + 4, M + 4],
        [ARENA_W - M - 4, M + 4],
        [M + 4, ARENA_H - M - 4],
        [ARENA_W - M - 4, ARENA_H - M - 4],
      ]) {
        if (!far(g, cx, cy, 130)) continue;
        for (let i = 0; i < per; i++) add('chaser', cx + (cx < ARENA_W / 2 ? 1 : -1) * i * 18, cy + (cy < ARENA_H / 2 ? 1 : -1) * i * 12);
      }
      break;
    }
    case 'line': {
      const side = farSide(g, rand);
      const count = Math.min(8, 4 + Math.floor(k));
      const kind: EnemyKind = g.t < 60000 || rand() < 0.5 ? 'wanderer' : 'chaser';
      for (let i = 0; i < count; i++) {
        const p = edgePoint(side, (i + 0.5) / count);
        add(kind, p.x, p.y);
      }
      break;
    }
    case 'split': {
      const count = Math.min(4, 2 + Math.floor(k / 1.5));
      for (let i = 0; i < count; i++) {
        const p = edgePoint(farSide(g, rand), 0.1 + rand() * 0.8);
        add('splitter', p.x, p.y);
      }
      break;
    }
    case 'dodge': {
      const corners = [
        [M + 20, M + 20],
        [ARENA_W - M - 20, M + 20],
        [M + 20, ARENA_H - M - 20],
        [ARENA_W - M - 20, ARENA_H - M - 20],
      ].sort((a, b) => Math.hypot(b[0] - g.x, b[1] - g.y) - Math.hypot(a[0] - g.x, a[1] - g.y));
      const [cx, cy] = corners[rand() < 0.6 ? 0 : 1];
      const count = Math.min(5, 2 + Math.floor(k));
      for (let i = 0; i < count; i++) add('dodger', cx + (rand() - 0.5) * 50, cy + (rand() - 0.5) * 50);
      break;
    }
    case 'snake': {
      const count = k > 2.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const p = edgePoint(farSide(g, rand), 0.15 + rand() * 0.7);
        add('snake', p.x, p.y);
      }
      break;
    }
    case 'ring': {
      // Un anillo de perseguidores alrededor de la nave: el aviso deja medio segundo para escapar
      const count = Math.min(12, 8 + Math.floor(k - 1.5));
      const off = rand() * Math.PI;
      for (let i = 0; i < count; i++) {
        const a = off + (i / count) * Math.PI * 2;
        const x = g.x + Math.cos(a) * 150;
        const y = g.y + Math.sin(a) * 150;
        if (x < M || x > ARENA_W - M || y < M || y > ARENA_H - M) continue;
        add('chaser', x, y);
      }
      break;
    }
    case 'swarm': {
      const count = Math.min(16, 8 + Math.floor(k * 2));
      for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 8; tries++) {
          x = M + rand() * (ARENA_W - 2 * M);
          y = M + rand() * (ARENA_H - 2 * M);
          if (far(g, x, y, 160)) break;
        }
        const kind = weighted(rand, ['wanderer', 'chaser', 'dodger', 'splitter'] as EnemyKind[], (q) => (q === 'chaser' ? 3 : q === 'wanderer' ? 2 : 1));
        add(kind, x, y);
      }
      break;
    }
  }
  return n;
}

function director(g: NeonGame, dt: number, rand: Rand, ev: NeonEvents) {
  // Jefe cada 90 s (el siguiente cuenta desde que cae el anterior)
  if (g.t >= g.bossAt && !boss(g)) {
    const x = g.x < ARENA_W / 2 ? ARENA_W * 0.7 : ARENA_W * 0.3;
    const y = g.y < ARENA_H / 2 ? ARENA_H * 0.72 : ARENA_H * 0.28;
    const b = makeEnemy(g, 'boss', x, y, rand, BOSS_SPAWN_MS);
    g.enemies.push(b);
    g.bossAt = Infinity;
    ev.bossIn = { x: b.x, y: b.y };
    ev.spawned++;
  }
  if (g.calm > 0) {
    g.calm -= dt;
    return;
  }
  g.nextSpawn -= dt;
  if (g.nextSpawn > 0) return;
  const withBoss = !!boss(g);
  if (g.enemies.length >= enemyCap(g.t) * (withBoss ? 0.5 : 1)) {
    g.nextSpawn = 400;
    return;
  }
  const pool = PATTERNS.filter((p) => g.t >= p.from);
  const p = weighted(rand, pool, (q) => q.w * (withBoss && (q.id === 'ring' || q.id === 'swarm') ? 0 : 1));
  ev.spawned += spawnPattern(g, p.id, rand);
  g.nextSpawn = spawnGap(g.t) * (0.85 + rand() * 0.3) * (withBoss ? 2.2 : 1);
}

// ---------------------------------------------------------------------------------------------
// Puntos, muertes y premios
// ---------------------------------------------------------------------------------------------

function addPts(g: NeonGame, p: number) {
  g.pts += p;
  // Redondeo al más cercano: el primer derribo ya suma 1
  g.score = Math.min(SCORE_CAP, Math.round(g.pts));
}

function dropGeoms(g: NeonGame, x: number, y: number, n: number, rand: Rand) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const v = 25 + rand() * (n > 4 ? 110 : 45);
    g.geoms.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: GEOM_LIFE + rand() * 600, got: false });
  }
}

function dropOrb(g: NeonGame, x: number, y: number, rand: Rand) {
  // Mejor uno que no tengas ya activo
  const kind = weighted(rand, POWER_KINDS, (k) => (g.pow[k] > 0 ? 0.3 : 1));
  const a = rand() * Math.PI * 2;
  g.orbs.push({ x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, kind, life: ORB_LIFE, got: false });
}

function kill(g: NeonGame, e: Enemy, rand: Rand, ev: NeonEvents, born: Enemy[], byBomb: boolean) {
  if (e.hp <= -100) return;
  e.hp = -100;
  const st = STATS[e.kind];
  const base = e.kind === 'boss' ? st.pts + 10 * g.bosses : st.pts;
  const mult = byBomb ? 1 : g.mult;
  const before = g.score;
  addPts(g, base * mult * ptsK(g.t));
  // Lo que sube el marcador entero (los decimales se acumulan para el siguiente)
  const pts = g.score - before;
  g.kills++;
  ev.kills.push({ x: e.x, y: e.y, kind: e.kind, pts, mult, bomb: byBomb });
  if (e.kind === 'boss') {
    g.bosses++;
    g.bombs = Math.min(MAX_BOMBS, g.bombs + 1);
    g.bossAt = g.t + BOSS_EVERY;
    for (const b of g.eshots) b.dead = true;
    dropGeoms(g, e.x, e.y, st.geoms, rand);
    dropOrb(g, e.x, e.y, rand);
    ev.bossDown = { x: e.x, y: e.y };
    return;
  }
  if (byBomb) return;
  dropGeoms(g, e.x, e.y, st.geoms, rand);
  const orbChance = e.kind === 'snake' ? 0.3 : e.kind === 'mini' ? 0.01 : 0.035;
  if (g.orbs.length < 2 && rand() < orbChance) dropOrb(g, e.x, e.y, rand);
  if (e.kind === 'splitter') {
    // Se parte en tres cuadraditos que giran a su alrededor
    for (let i = 0; i < 3; i++) {
      const m = makeEnemy(g, 'mini', e.x, e.y, rand, 0);
      m.a = (i / 3) * Math.PI * 2;
      m.cx = e.x;
      m.cy = e.y;
      m.flash = 120;
      born.push(m);
    }
  }
}

function die(g: NeonGame, ev: NeonEvents) {
  g.lives--;
  g.deaths++;
  ev.died = { x: g.x, y: g.y };
  g.mult = 1;
  g.bank = 0;
  g.respawn = RESPAWN_MS;
  g.inv = RESPAWN_MS + INV_MS;
  g.calm = Math.max(g.calm, 1500);
  for (const k of POWER_KINDS) g.pow[k] = 0;
  for (const b of g.eshots) b.dead = true;
  // Se limpian los de alrededor (sin puntos) para no volver a morir al aparecer
  for (const e of g.enemies) {
    if (e.kind === 'boss') continue;
    if (e.spawn > 0 || Math.hypot(e.x - g.x, e.y - g.y) < CLEAR_R) {
      e.hp = -100;
      ev.cleared.push({ x: e.x, y: e.y, kind: e.kind });
    }
  }
  if (g.lives <= 0) {
    g.lives = 0;
    g.phase = 'over';
    ev.lost = true;
  }
}

/** Aplica la mejora elegida y prepara la siguiente si ya tocaba otra. */
export function choose(g: NeonGame, id: UpId, rand: Rand): boolean {
  const d = g.offer?.find((u) => u.id === id);
  if (!d) return false;
  levelUp(g.lv, d);
  if (id === 'bomb') g.bombs = Math.min(MAX_BOMBS, g.bombs + 1);
  if (id === 'life') g.lives++;
  g.offer = null;
  // Un respiro para volver a poner los pulgares
  g.inv = Math.max(g.inv, 900);
  checkPick(g, rand);
  return true;
}

function checkPick(g: NeonGame, rand: Rand): boolean {
  if (g.offer || g.phase !== 'play' || g.score < pickAt(g.picks + 1)) return false;
  g.picks++;
  const o = rollUpgrades(UPGRADES, g.lv, rand, 3);
  g.offer = o.length ? o : null;
  return !!g.offer;
}

// ---------------------------------------------------------------------------------------------
// Movimiento de los enemigos
// ---------------------------------------------------------------------------------------------

function turnTo(a: number, target: number, max: number): number {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + clamp(d, -max, max);
}

/** Dirige suavemente la velocidad hacia (tx, ty) a `speed`. */
function steer(e: Enemy, tx: number, ty: number, speed: number, k: number, s: number) {
  const d = norm(tx - e.x, ty - e.y);
  const f = Math.min(1, k * s);
  e.vx += (d.x * speed - e.vx) * f;
  e.vy += (d.y * speed - e.vy) * f;
}

function moveEnemy(g: NeonGame, e: Enemy, dt: number, rand: Rand, ev: NeonEvents) {
  const s = dt / 1000;
  const sp = STATS[e.kind].speed * speedScale(g.t);
  switch (e.kind) {
    case 'wanderer': {
      // Deriva sin rumbo fijo y rebota en los bordes
      e.t -= dt;
      if (e.t <= 0) {
        e.ta = e.a + (rand() - 0.5) * 2.4;
        e.t = 900 + rand() * 1500;
      }
      e.a = turnTo(e.a, e.ta, 1.6 * s);
      e.vx = Math.cos(e.a) * sp;
      e.vy = Math.sin(e.a) * sp;
      break;
    }
    case 'chaser':
      steer(e, g.x, g.y, sp, 2.6, s);
      break;
    case 'splitter':
      steer(e, g.x + Math.cos(e.age / 500) * 40, g.y + Math.sin(e.age / 500) * 40, sp, 1.6, s);
      break;
    case 'mini': {
      // Gira alrededor de un centro que persigue a la nave
      const d = norm(g.x - e.cx, g.y - e.cy);
      e.cx += d.x * sp * s;
      e.cy += d.y * sp * s;
      e.a += 5.5 * s;
      const rad = Math.min(14, 4 + e.age / 30);
      const nx = e.cx + Math.cos(e.a) * rad;
      const ny = e.cy + Math.sin(e.a) * rad;
      e.vx = (nx - e.x) / Math.max(s, 1e-6);
      e.vy = (ny - e.y) / Math.max(s, 1e-6);
      e.x = nx;
      e.y = ny;
      return;
    }
    case 'dodger': {
      e.t -= dt;
      if (e.dodge > 0) e.dodge -= dt;
      else {
        steer(e, g.x, g.y, sp, 2.2, s);
        if (e.t <= 0) {
          // Mira si viene una bala hacia él y se aparta de su línea
          for (const b of g.shots) {
            if (b.dead) continue;
            const dx = e.x - b.x;
            const dy = e.y - b.y;
            if (dx * dx + dy * dy > 90 * 90) continue;
            const bv = Math.hypot(b.vx, b.vy) || 1;
            if ((dx * b.vx + dy * b.vy) / bv <= 0) continue;
            const perp = (dx * b.vy - dy * b.vx) / bv;
            if (Math.abs(perp) > e.r + 9) continue;
            let side = perp === 0 ? (rand() < 0.5 ? 1 : -1) : Math.sign(perp);
            // Si la esquiva lo saca de la arena, se va al otro lado
            const px = (b.vy / bv) * side;
            const py = (-b.vx / bv) * side;
            if (e.x + px * 40 < e.r || e.x + px * 40 > ARENA_W - e.r || e.y + py * 40 < e.r || e.y + py * 40 > ARENA_H - e.r) side = -side;
            const v = 290 * Math.min(1.3, speedScale(g.t));
            e.vx = (b.vy / bv) * side * v;
            e.vy = (-b.vx / bv) * side * v;
            e.dodge = 170;
            e.t = Math.max(280, 520 - g.t / 1000);
            ev.dodges++;
            break;
          }
        }
      }
      break;
    }
    case 'snake': {
      // Serpentea hacia la nave; la cola sigue a la cabeza como una cuerda
      const target = Math.atan2(g.y - e.y, g.x - e.x) + Math.sin(e.age / 380) * 0.9;
      e.a = turnTo(e.a, target, 2.3 * s);
      // Cerca del borde gira hacia dentro
      if (e.x < 30 || e.x > ARENA_W - 30 || e.y < 30 || e.y > ARENA_H - 30) e.a = turnTo(e.a, Math.atan2(ARENA_H / 2 - e.y, ARENA_W / 2 - e.x), 4 * s);
      e.vx = Math.cos(e.a) * sp;
      e.vy = Math.sin(e.a) * sp;
      break;
    }
    case 'boss': {
      // Recorre la arena en una curva de Lissajous: predecible pero sin parar
      const tx = ARENA_W / 2 + Math.sin(e.age / 2600) * 112;
      const ty = ARENA_H / 2 + Math.sin(e.age / 1700 + 1) * 175;
      steer(e, tx, ty, sp * (1 + 0.15 * g.bosses), 1.2, s);
      e.a += 0.9 * s;
      bossAttack(g, e, dt, rand, ev);
      break;
    }
  }
  e.x += e.vx * s;
  e.y += e.vy * s;
  // Bordes: rebota (deambulantes) o se queda pegado
  if (e.x < e.r || e.x > ARENA_W - e.r) {
    e.x = clamp(e.x, e.r, ARENA_W - e.r);
    if (e.kind === 'wanderer') {
      e.a = Math.PI - e.a;
      e.ta = e.a;
    } else e.vx *= -0.3;
  }
  if (e.y < e.r || e.y > ARENA_H - e.r) {
    e.y = clamp(e.y, e.r, ARENA_H - e.r);
    if (e.kind === 'wanderer') {
      e.a = -e.a;
      e.ta = e.a;
    } else e.vy *= -0.3;
  }
  if (e.kind === 'snake') {
    let px = e.x;
    let py = e.y;
    for (const sg of e.segs) {
      const dx = px - sg.x;
      const dy = py - sg.y;
      const d = Math.hypot(dx, dy);
      if (d > SNAKE_GAP) {
        sg.x += (dx / d) * (d - SNAKE_GAP);
        sg.y += (dy / d) * (d - SNAKE_GAP);
      }
      px = sg.x;
      py = sg.y;
    }
  }
}

function bossAttack(g: NeonGame, e: Enemy, dt: number, rand: Rand, ev: NeonEvents) {
  const lvl = g.bosses;
  if (e.warn > 0) {
    e.warn -= dt;
    if (e.warn > 0) return;
    e.warn = 0;
    const sp = 82 * Math.min(1.5, speedScale(g.t));
    switch (e.phase % 4) {
      case 0:
      case 2: {
        const n = 12 + Math.min(8, lvl * 2);
        const off = rand() * Math.PI;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          g.eshots.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 4.5, dead: false });
        }
        break;
      }
      case 1: {
        // Suelta perseguidores por sus costados
        for (let i = 0; i < 4; i++) {
          const a = e.a + (i / 4) * Math.PI * 2;
          const x = e.x + Math.cos(a) * 46;
          const y = e.y + Math.sin(a) * 46;
          if (far(g, x, y, 70)) {
            g.enemies.push(makeEnemy(g, 'chaser', x, y, rand));
            ev.spawned++;
          }
        }
        break;
      }
      case 3: {
        const base = Math.atan2(g.y - e.y, g.x - e.x);
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.2;
          g.eshots.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp * 1.45, vy: Math.sin(a) * sp * 1.45, r: 4.5, dead: false });
        }
        break;
      }
    }
    if (e.phase % 4 !== 1) ev.bossShot = true;
    e.phase++;
    e.t = Math.max(1500, 2700 - 300 * lvl);
    return;
  }
  e.t -= dt;
  if (e.t <= 0) {
    e.warn = 700;
    ev.bossWarn = true;
  }
}

/** Separa a los que se amontonan (si no, los perseguidores acaban siendo una sola bola). */
function separate(list: Enemy[]) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.spawn > 0 || a.kind === 'boss' || a.kind === 'mini' || a.hp <= 0) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.spawn > 0 || b.kind === 'boss' || b.kind === 'mini' || b.hp <= 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const r = (a.r + b.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / 2 / d;
      a.x -= dx * push;
      a.y -= dy * push;
      b.x += dx * push;
      b.y += dy * push;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------------------------

const OFFSETS = [[0], [-4, 4], [-7, 0, 7]];

function fire(g: NeonGame, ax: number, ay: number) {
  const base = Math.atan2(ay, ax);
  const sp = bulletSpeed(g);
  const angles = g.pow.spread > 0 ? [-0.2, 0, 0.2] : [0];
  const offs = OFFSETS[Math.min(2, levelOf(g.lv, 'guns'))];
  const pierce = g.pow.pierce > 0 ? 3 : 0;
  const bounce = g.pow.bounce > 0 ? 2 : 0;
  const c = Math.cos(base);
  const sn = Math.sin(base);
  const mk = (a: number, o: number) => {
    g.shots.push({
      x: g.x + c * 9 - sn * o,
      y: g.y + sn * 9 + c * o,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      pierce,
      bounce,
      last: 0,
      dead: false,
    });
  };
  for (const a of angles) for (const o of offs) mk(base + a, o);
  if (levelOf(g.lv, 'rear') > 0) mk(base + Math.PI, 0);
}

// ---------------------------------------------------------------------------------------------
// Paso
// ---------------------------------------------------------------------------------------------

export function newEvents(): NeonEvents {
  return {
    kills: [],
    sparks: [],
    absorbed: [],
    walls: [],
    shots: 0,
    spawned: 0,
    geoms: 0,
    multUp: false,
    power: null,
    powerOut: null,
    died: null,
    cleared: [],
    lost: false,
    bomb: null,
    bossIn: null,
    bossWarn: false,
    bossShot: false,
    bossDown: null,
    pick: false,
    dodges: 0,
  };
}

/** Lanza una bomba si quedan; devuelve si salió. */
export function dropBomb(g: NeonGame, ev: NeonEvents): boolean {
  if (g.bombs <= 0 || g.blast || g.respawn > 0 || g.phase !== 'play') return false;
  g.bombs--;
  g.blast = { id: g.nextId++, x: g.x, y: g.y, age: 0, r: 0 };
  g.inv = Math.max(g.inv, BLAST_MS + 300);
  g.calm = Math.max(g.calm, 1600);
  for (const b of g.eshots) b.dead = true;
  ev.bomb = { x: g.x, y: g.y };
  return true;
}

/** Avanza la partida `dt` ms. */
export function step(g: NeonGame, dt: number, inp: NeonInput, rand: Rand): NeonEvents {
  const ev = newEvents();
  if (g.phase !== 'play' || g.offer) return ev;
  const s = dt / 1000;
  g.t += dt;
  g.inv = Math.max(0, g.inv - dt);
  g.respawn = Math.max(0, g.respawn - dt);
  for (const k of POWER_KINDS) {
    if (g.pow[k] > 0) {
      g.pow[k] -= dt;
      if (g.pow[k] <= 0) {
        g.pow[k] = 0;
        ev.powerOut = k;
      }
    }
  }

  // Nave
  const alive = g.respawn <= 0;
  if (alive) {
    const m = Math.min(1, Math.hypot(inp.mx, inp.my));
    const d = norm(inp.mx, inp.my);
    const v = moveSpeed(g) * m * s;
    g.x = clamp(g.x + d.x * v, PLAYER_R + 2, ARENA_W - PLAYER_R - 2);
    g.y = clamp(g.y + d.y * v, PLAYER_R + 2, ARENA_H - PLAYER_R - 2);
    if (inp.aim) g.ang = Math.atan2(inp.aim.y, inp.aim.x);
    else if (m > 0.2) g.ang = turnTo(g.ang, Math.atan2(d.y, d.x), 12 * s);
  }
  if (inp.bomb) dropBomb(g, ev);

  g.gunT = Math.max(0, g.gunT - dt);
  if (alive && inp.aim && g.gunT <= 0) {
    fire(g, inp.aim.x, inp.aim.y);
    g.gunT = fireMs(g);
    ev.shots++;
  }

  director(g, dt, rand, ev);

  // Balas propias
  for (const b of g.shots) {
    b.x += b.vx * s;
    b.y += b.vy * s;
    let out = false;
    if (b.x < 0 || b.x > ARENA_W) {
      out = true;
      if (b.bounce > 0) {
        b.vx = -b.vx;
        b.x = clamp(b.x, 0, ARENA_W);
      }
    }
    if (b.y < 0 || b.y > ARENA_H) {
      out = true;
      if (b.bounce > 0) {
        b.vy = -b.vy;
        b.y = clamp(b.y, 0, ARENA_H);
      }
    }
    if (out) {
      if (b.bounce > 0) {
        b.bounce--;
        b.last = 0;
      } else {
        b.dead = true;
        if (ev.walls.length < 6) ev.walls.push({ x: clamp(b.x, 0, ARENA_W), y: clamp(b.y, 0, ARENA_H) });
      }
    }
  }

  // Enemigos
  const born: Enemy[] = [];
  for (const e of g.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.spawn > 0) {
      e.spawn -= dt;
      continue;
    }
    e.age += dt;
    moveEnemy(g, e, dt, rand, ev);
  }
  separate(g.enemies);

  // Impactos propios
  for (const b of g.shots) {
    if (b.dead) continue;
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.spawn > 0 || e.id === b.last) continue;
      const dx = b.x - e.x;
      const dy = b.y - e.y;
      const rr = e.r + 3;
      if (dx * dx + dy * dy <= rr * rr) {
        e.hp -= 1;
        e.flash = 80;
        b.last = e.id;
        if (b.pierce > 0) b.pierce--;
        else b.dead = true;
        if (e.hp <= 0) kill(g, e, rand, ev, born, false);
        else if (ev.sparks.length < 10) ev.sparks.push({ x: b.x, y: b.y });
        if (b.dead) break;
        continue;
      }
      // La cola de la serpiente para las balas (salvo las perforantes)
      if (e.kind === 'snake' && b.pierce <= 0) {
        for (const sg of e.segs) {
          const sx = b.x - sg.x;
          const sy = b.y - sg.y;
          if (sx * sx + sy * sy <= 7 * 7) {
            b.dead = true;
            if (ev.absorbed.length < 6) ev.absorbed.push({ x: b.x, y: b.y });
            break;
          }
        }
        if (b.dead) break;
      }
    }
  }

  // Onda de la bomba
  if (g.blast) {
    const bl = g.blast;
    bl.age += dt;
    bl.r = (bl.age / BLAST_MS) * BLAST_R;
    for (const e of g.enemies) {
      if (e.hp <= 0 || Math.hypot(e.x - bl.x, e.y - bl.y) > bl.r + e.r) continue;
      if (e.kind === 'boss') {
        if (e.spawn <= 0 && e.blast !== bl.id) {
          e.blast = bl.id;
          e.hp -= Math.ceil(e.max * 0.2);
          e.flash = 200;
          if (e.hp <= 0) kill(g, e, rand, ev, born, false);
        }
      } else if (e.spawn > 0) {
        e.hp = -100;
        ev.cleared.push({ x: e.x, y: e.y, kind: e.kind });
      } else kill(g, e, rand, ev, born, true);
    }
    if (bl.age >= BLAST_MS) g.blast = null;
  }
  if (born.length) g.enemies.push(...born);

  // Balas enemigas
  const me = { x: g.x, y: g.y, r: PLAYER_R };
  for (const b of g.eshots) {
    if (b.dead) continue;
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (b.x < -4 || b.x > ARENA_W + 4 || b.y < -4 || b.y > ARENA_H + 4) b.dead = true;
    else if (alive && g.inv <= 0 && g.phase === 'play' && hit(me, b)) {
      b.dead = true;
      die(g, ev);
    }
  }

  // Choques con enemigos
  if (alive && g.inv <= 0 && g.phase === 'play') {
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.spawn > 0) continue;
      let touched = hit(me, { x: e.x, y: e.y, r: e.r * 0.85 });
      if (!touched && e.kind === 'snake') for (const sg of e.segs) if (hit(me, { x: sg.x, y: sg.y, r: 4.5 })) touched = true;
      if (touched) {
        die(g, ev);
        break;
      }
    }
  }

  // Fragmentos: el imán los atrae y suben el multiplicador
  const mag = magnetR(g);
  for (const p of g.geoms) {
    p.life -= dt;
    const dx = g.x - p.x;
    const dy = g.y - p.y;
    const d = Math.hypot(dx, dy);
    if (alive && d < mag) {
      const v = 380;
      p.vx = (dx / (d || 1)) * v;
      p.vy = (dy / (d || 1)) * v;
    } else {
      const k = Math.max(0, 1 - 2.2 * s);
      p.vx *= k;
      p.vy *= k;
    }
    p.x = clamp(p.x + p.vx * s, 3, ARENA_W - 3);
    p.y = clamp(p.y + p.vy * s, 3, ARENA_H - 3);
    if (alive && d < PLAYER_R + 9) {
      p.got = true;
      ev.geoms++;
      if (g.mult < MULT_MAX) {
        g.bank++;
        if (g.bank >= multNeed(g.mult)) {
          g.bank = 0;
          g.mult++;
          g.bestMult = Math.max(g.bestMult, g.mult);
          ev.multUp = true;
        }
      }
    }
  }
  g.geoms = g.geoms.filter((p) => !p.got && p.life > 0);

  // Potenciadores
  for (const o of g.orbs) {
    o.life -= dt;
    o.x += o.vx * s;
    o.y += o.vy * s;
    if (o.x < 12 || o.x > ARENA_W - 12) o.vx = -o.vx;
    if (o.y < 12 || o.y > ARENA_H - 12) o.vy = -o.vy;
    o.x = clamp(o.x, 12, ARENA_W - 12);
    o.y = clamp(o.y, 12, ARENA_H - 12);
    if (alive && Math.hypot(g.x - o.x, g.y - o.y) < PLAYER_R + 13) {
      o.got = true;
      g.pow[o.kind] = powerMs(g);
      ev.power = o.kind;
    }
  }
  g.orbs = g.orbs.filter((o) => !o.got && o.life > 0);

  g.shots = g.shots.filter((b) => !b.dead);
  g.eshots = g.eshots.filter((b) => !b.dead);
  g.enemies = g.enemies.filter((e) => e.hp > 0);

  if (checkPick(g, rand)) ev.pick = true;
  return ev;
}

/** Atajo para pruebas: elige una mejora al azar de las ofrecidas. */
export function chooseAny(g: NeonGame, rand: Rand): boolean {
  if (!g.offer) return false;
  return choose(g, pickOne(rand, g.offer).id, rand);
}
