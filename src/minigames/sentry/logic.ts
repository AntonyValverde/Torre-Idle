// "Torre vigía" (defensa de torre idle): la torre de la ciudad está en el centro y dispara sola al
// enemigo más cercano que entre en su alcance. Los enemigos llegan por todos los lados en oleadas que
// avanzan con el reloj (una cada 20 s, los mates o no). Cada baja da monedas, que se gastan en mejoras
// en cualquier momento sin parar el juego. La vida y el daño enemigos crecen de forma exponencial, así
// que tarde o temprano la torre cae: la gracia está en elegir bien las mejoras para llegar más lejos.

import { fmt } from '../../game/format';
import { clamp, weighted, type Rand } from '../shooter/kit';

export const FIELD_W = 360;
export const FIELD_H = 400;
/** Centro de la torre. */
export const TX = FIELD_W / 2;
export const TY = FIELD_H / 2;
/** Radio de la torre para los choques. */
export const TOWER_R = 17;
/** Cada oleada dura esto (ms); los enemigos salen en los primeros SPAWN_MS. */
export const WAVE_MS = 20000;
export const SPAWN_MS = 16500;
export const BOSS_EVERY = 10;
/** Rayo: enfriamiento (ms), daño (veces el daño de la torre) y aturdimiento (ms). */
export const RAYO_MS = 25000;
export const RAYO_MULT = 10;
export const RAYO_STUN = 1200;
export const BULLET_SPEED = 430;
/** Distancia a la que se paran los enemigos a distancia (justo dentro del alcance inicial). */
export const RANGED_STOP = 114;
export const EBULLET_SPEED = 58;
/** Puntos por oleada superada. */
export const WAVE_PTS = 10;

export type EnemyKind = 'basic' | 'fast' | 'tank' | 'ranged' | 'boss';

interface KindStats {
  hp: number;
  /** Unidades/s. */
  speed: number;
  /** Daño al tocar la torre (o de cada bala, si dispara). */
  dmg: number;
  r: number;
  /** Monedas al caer (antes de multiplicadores). */
  cash: number;
  pts: number;
  /** Se queda pegado y golpea cada tantos ms; 0 = revienta al chocar. */
  hitEvery: number;
  /** Cuánto le afecta el retroceso. */
  knock: number;
}

export const STATS: Record<EnemyKind, KindStats> = {
  basic: { hp: 10, speed: 27, dmg: 6, r: 7, cash: 2, pts: 1, hitEvery: 0, knock: 1 },
  fast: { hp: 6, speed: 56, dmg: 4, r: 6, cash: 2, pts: 1, hitEvery: 0, knock: 1.2 },
  tank: { hp: 50, speed: 14, dmg: 9, r: 11.5, cash: 7, pts: 1, hitEvery: 1200, knock: 0.35 },
  ranged: { hp: 14, speed: 25, dmg: 5, r: 7.5, cash: 4, pts: 1, hitEvery: 0, knock: 0.8 },
  boss: { hp: 380, speed: 9, dmg: 22, r: 23, cash: 100, pts: 25, hitEvery: 2000, knock: 0.08 },
};

// ---------------------------------------------------------------------------------------------
// Mejoras: se compran durante la partida, sin pausa. Precio exponencial y valores que crecen.
// ---------------------------------------------------------------------------------------------

export type UpId = 'dmg' | 'rate' | 'range' | 'crit' | 'critx' | 'multi' | 'hp' | 'regen' | 'thorns' | 'knock' | 'cash' | 'interest' | 'bonus';
export type Tab = 'atk' | 'def' | 'eco';

export interface UpDef {
  id: UpId;
  tab: Tab;
  emoji: string;
  name: string;
  /** Nivel máximo (Infinity = sin tope). */
  max: number;
  /** Precio del nivel 0 y cuánto se multiplica por nivel. */
  base: number;
  growth: number;
  value: (lv: number) => number;
  /** Valor ya formateado para el panel. */
  show: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
/** Números cortos: 8 en vez de 8.0, 1.2K en vez de 1234. */
const num = (v: number) => (v < 10 ? String(Math.round(v * 10) / 10) : fmt(v));

export const UPGRADES: UpDef[] = [
  { id: 'dmg', tab: 'atk', emoji: '💥', name: 'Daño', max: Infinity, base: 8, growth: 1.3, value: (lv) => (5 + 2.5 * lv) * 1.07 ** lv, show: num },
  { id: 'rate', tab: 'atk', emoji: '🔁', name: 'Cadencia', max: 30, base: 10, growth: 1.4, value: (lv) => 1.3 * (1 + 0.1 * lv), show: (v) => `${v.toFixed(1)}/s` },
  { id: 'range', tab: 'atk', emoji: '🎯', name: 'Alcance', max: 14, base: 14, growth: 1.5, value: (lv) => 120 + 7 * lv, show: (v) => `${v} m` },
  { id: 'crit', tab: 'atk', emoji: '🍀', name: 'Crítico', max: 15, base: 18, growth: 1.45, value: (lv) => 0.05 + 0.03 * lv, show: pct },
  { id: 'critx', tab: 'atk', emoji: '💢', name: 'Daño crítico', max: 25, base: 20, growth: 1.38, value: (lv) => 1.5 + 0.2 * lv, show: (v) => `×${v.toFixed(1)}` },
  { id: 'multi', tab: 'atk', emoji: '🔱', name: 'Multidisparo', max: 4, base: 70, growth: 2.8, value: (lv) => 1 + lv, show: (v) => `×${v}` },
  { id: 'hp', tab: 'def', emoji: '❤️', name: 'Vida máx.', max: Infinity, base: 8, growth: 1.3, value: (lv) => (100 + 30 * lv) * 1.06 ** lv, show: num },
  { id: 'regen', tab: 'def', emoji: '💚', name: 'Regeneración', max: Infinity, base: 12, growth: 1.38, value: (lv) => 1.2 * lv * 1.07 ** lv, show: (v) => `${num(v)}/s` },
  { id: 'thorns', tab: 'def', emoji: '🌵', name: 'Espinas', max: 15, base: 20, growth: 1.42, value: (lv) => 0.04 * lv, show: pct },
  { id: 'knock', tab: 'def', emoji: '💨', name: 'Retroceso', max: 10, base: 18, growth: 1.5, value: (lv) => 4 * lv, show: (v) => `${v} m` },
  { id: 'cash', tab: 'eco', emoji: '🪙', name: 'Monedas/baja', max: 40, base: 12, growth: 1.4, value: (lv) => 1 + 0.15 * lv, show: (v) => `×${v.toFixed(2)}` },
  { id: 'interest', tab: 'eco', emoji: '🏦', name: 'Interés', max: 10, base: 25, growth: 1.6, value: (lv) => 0.02 * lv, show: pct },
  { id: 'bonus', tab: 'eco', emoji: '🎁', name: 'Prima oleada', max: Infinity, base: 20, growth: 1.42, value: (lv) => 6 * lv * 1.08 ** lv, show: (v) => `+${num(v)}` },
];

export const UP: Record<UpId, UpDef> = Object.fromEntries(UPGRADES.map((d) => [d.id, d])) as Record<UpId, UpDef>;

export type Levels = Record<UpId, number>;

export function emptyLevels(): Levels {
  return { dmg: 0, rate: 0, range: 0, crit: 0, critx: 0, multi: 0, hp: 0, regen: 0, thorns: 0, knock: 0, cash: 0, interest: 0, bonus: 0 };
}

export function stat(g: { lv: Levels }, id: UpId): number {
  return UP[id].value(g.lv[id]);
}

/** Precio del siguiente nivel, o null si ya está al máximo. */
export function upCost(g: { lv: Levels }, id: UpId): number | null {
  const d = UP[id];
  const lv = g.lv[id];
  return lv >= d.max ? null : Math.floor(d.base * d.growth ** lv);
}

/** Lo que más se puede cobrar de interés en una oleada (si no, guardar sería mejor que mejorar). */
export function interestCap(wave: number): number {
  return 20 + 12 * wave;
}

// ---------------------------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------------------------

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  r: number;
  hp: number;
  max: number;
  dmg: number;
  speed: number;
  /** Daño ya en camino (balas que vuelan hacia él): así no se malgastan disparos en muertos. */
  pend: number;
  /** Hasta su siguiente golpe (pegado a la torre) o disparo (a distancia), ms. */
  hitT: number;
  /** Pegado a la torre. */
  stuck: boolean;
  /** Retroceso pendiente (unidades). */
  kb: number;
  stun: number;
  flash: number;
  age: number;
}

export interface Bullet {
  x: number;
  y: number;
  /** Último punto conocido del blanco (si muere, la bala llega ahí y se apaga). */
  tx: number;
  ty: number;
  target: number;
  dmg: number;
  crit: boolean;
  done?: boolean;
}

export interface EBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  done?: boolean;
}

interface Spawn {
  at: number;
  kind: EnemyKind;
  /** Ángulo desde el centro (rad). */
  a: number;
}

export interface SentryGame {
  t: number;
  phase: 'play' | 'over';
  hp: number;
  lv: Levels;
  coins: number;
  /** Monedas ganadas en total (estadística). */
  earned: number;
  score: number;
  kills: number;
  bosses: number;
  wave: number;
  waveT: number;
  queue: Spawn[];
  enemies: Enemy[];
  bullets: Bullet[];
  ebullets: EBullet[];
  fireT: number;
  rayoT: number;
  /** Ángulo del cañón (rad). */
  aim: number;
  nextId: number;
}

export type KillHow = 'shot' | 'thorns' | 'rayo';

export interface KillEv {
  x: number;
  y: number;
  kind: EnemyKind;
  cash: number;
  how: KillHow;
}

export interface SentryEvents {
  kills: KillEv[];
  /** Impactos que no mataron (chispas; los críticos llevan su número). */
  hits: { x: number; y: number; dmg: number; crit: boolean }[];
  /** Balas disparadas en este paso (fogonazo). */
  fired: number;
  /** Daño recibido por la torre y de dónde vino. */
  hurt: number;
  impacts: { x: number; y: number; kind: EnemyKind }[];
  /** Enemigos a distancia que dispararon. */
  enemyShots: { x: number; y: number }[];
  waveStart: number;
  waveClear: { wave: number; interest: number; bonus: number } | null;
  bossIn: boolean;
  bossDown: boolean;
  lost: boolean;
}

function newEvents(): SentryEvents {
  return { kills: [], hits: [], fired: 0, hurt: 0, impacts: [], enemyShots: [], waveStart: 0, waveClear: null, bossIn: false, bossDown: false, lost: false };
}

export function maxHp(g: SentryGame): number {
  return stat(g, 'hp');
}

export function range(g: SentryGame): number {
  return stat(g, 'range');
}

/** Vida de los enemigos según la oleada: exponencial, así la torre acaba cayendo. */
export function hpScale(wave: number): number {
  return 1.15 ** (wave - 1) * 1.11 ** Math.max(0, wave - 8);
}

export function dmgScale(wave: number): number {
  return 1.1 ** (wave - 1) * 1.05 ** Math.max(0, wave - 8);
}

/** Monedas por baja según la oleada (antes de la mejora de monedas). */
export function cashScale(wave: number): number {
  return 1 + 0.2 * (wave - 1);
}

export function isBossWave(wave: number): boolean {
  return wave % BOSS_EVERY === 0;
}

export function boss(g: SentryGame): Enemy | undefined {
  return g.enemies.find((e) => e.kind === 'boss');
}

// ---------------------------------------------------------------------------------------------
// Oleadas
// ---------------------------------------------------------------------------------------------

/** Cuántos enemigos normales trae una oleada. */
export function waveCount(wave: number): number {
  const n = Math.min(48, 5 + Math.floor(wave * 1.5));
  return isBossWave(wave) ? Math.ceil(n * 0.6) : n;
}

const KINDS: EnemyKind[] = ['basic', 'fast', 'ranged', 'tank'];

function kindWeight(k: EnemyKind, wave: number): number {
  switch (k) {
    case 'basic':
      return 10;
    case 'fast':
      return wave >= 2 ? 3 + wave * 0.3 : 0;
    case 'ranged':
      return wave >= 3 ? 2 + wave * 0.15 : 0;
    case 'tank':
      return wave >= 4 ? 1.5 + wave * 0.15 : 0;
    default:
      return 0;
  }
}

/** Lo que sale en una oleada, ordenado por tiempo (ms desde que empieza). */
export function waveSpawns(wave: number, rand: Rand): Spawn[] {
  const out: Spawn[] = [];
  const n = waveCount(wave);
  for (let i = 0; i < n; i++) {
    const at = 600 + (i / n) * (SPAWN_MS - 600) + rand() * 300;
    out.push({ at, kind: weighted(rand, KINDS, (k) => kindWeight(k, wave)), a: rand() * Math.PI * 2 });
  }
  // Desde la oleada 5, una manada de rápidos por el mismo lado: el momento de usar el rayo
  if (wave >= 5) {
    const at = 3000 + rand() * 9000;
    const a = rand() * Math.PI * 2;
    const m = 4 + Math.floor(wave / 5);
    for (let i = 0; i < m; i++) out.push({ at: at + i * 140, kind: 'fast', a: a + (rand() - 0.5) * 0.5 });
  }
  if (isBossWave(wave)) out.push({ at: 1200, kind: 'boss', a: rand() * Math.PI * 2 });
  return out.sort((p, q) => p.at - q.at);
}

function startWave(g: SentryGame, wave: number, rand: Rand) {
  g.wave = wave;
  g.queue = waveSpawns(wave, rand);
}

export function newSentry(rand: Rand): SentryGame {
  const g: SentryGame = {
    t: 0,
    phase: 'play',
    hp: 0,
    lv: emptyLevels(),
    coins: 0,
    earned: 0,
    score: 0,
    kills: 0,
    bosses: 0,
    wave: 1,
    waveT: 0,
    queue: [],
    enemies: [],
    bullets: [],
    ebullets: [],
    fireT: 0,
    rayoT: 0,
    aim: -Math.PI / 2,
    nextId: 1,
  };
  g.hp = maxHp(g);
  startWave(g, 1, rand);
  return g;
}

/** Punto del borde del campo (un poco por fuera) en la dirección `a` desde la torre. */
export function edgePoint(a: number): { x: number; y: number } {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const hx = FIELD_W / 2 + 14;
  const hy = FIELD_H / 2 + 14;
  const k = Math.min(Math.abs(hx / (dx || 1e-9)), Math.abs(hy / (dy || 1e-9)));
  return { x: TX + dx * k, y: TY + dy * k };
}

function makeEnemy(g: SentryGame, sp: Spawn): Enemy {
  const st = STATS[sp.kind];
  const p = edgePoint(sp.a);
  const hp = st.hp * hpScale(g.wave);
  return {
    id: g.nextId++,
    kind: sp.kind,
    x: p.x,
    y: p.y,
    r: st.r,
    hp,
    max: hp,
    dmg: st.dmg * dmgScale(g.wave),
    speed: st.speed,
    pend: 0,
    hitT: sp.kind === 'ranged' ? 900 : 0,
    stuck: false,
    kb: 0,
    stun: 0,
    flash: 0,
    age: 0,
  };
}

/** Pone un enemigo concreto en el campo (pruebas). */
export function spawnAt(g: SentryGame, kind: EnemyKind, x: number, y: number): Enemy {
  const e = makeEnemy(g, { at: 0, kind, a: 0 });
  e.x = x;
  e.y = y;
  g.enemies.push(e);
  return e;
}

// ---------------------------------------------------------------------------------------------
// Acciones del jugador
// ---------------------------------------------------------------------------------------------

/** Compra el siguiente nivel de una mejora. La vida máxima nueva también se rellena. */
export function buy(g: SentryGame, id: UpId): boolean {
  const cost = upCost(g, id);
  if (cost === null || g.coins < cost || g.phase !== 'play') return false;
  g.coins -= cost;
  if (id === 'hp') {
    const before = maxHp(g);
    g.lv.hp++;
    g.hp += maxHp(g) - before;
  } else g.lv[id]++;
  return true;
}

export function rayoReady(g: SentryGame): boolean {
  return g.phase === 'play' && g.rayoT <= 0;
}

/** Rayo: golpea a todos los enemigos, los aturde y borra sus balas. */
export function rayo(g: SentryGame): SentryEvents {
  const ev = newEvents();
  if (!rayoReady(g)) return ev;
  g.rayoT = RAYO_MS;
  const dmg = stat(g, 'dmg') * RAYO_MULT;
  for (const e of g.enemies) {
    if (e.hp <= 0) continue;
    e.hp -= dmg;
    e.flash = 120;
    e.stun = RAYO_STUN;
    if (e.hp <= 0) kill(g, e, 'rayo', ev);
    else ev.hits.push({ x: e.x, y: e.y, dmg, crit: false });
  }
  g.enemies = g.enemies.filter((e) => e.hp > 0);
  g.ebullets = [];
  return ev;
}

// ---------------------------------------------------------------------------------------------
// Paso
// ---------------------------------------------------------------------------------------------

function kill(g: SentryGame, e: Enemy, how: KillHow, ev: SentryEvents) {
  e.hp = 0;
  const st = STATS[e.kind];
  const cash = st.cash * cashScale(g.wave) * stat(g, 'cash');
  g.coins += cash;
  g.earned += cash;
  g.kills++;
  g.score += st.pts;
  ev.kills.push({ x: e.x, y: e.y, kind: e.kind, cash, how });
  if (e.kind === 'boss') {
    g.bosses++;
    ev.bossDown = true;
  }
}

function hurt(g: SentryGame, dmg: number, ev: SentryEvents) {
  if (g.phase !== 'play') return;
  g.hp -= dmg;
  ev.hurt += dmg;
  if (g.hp <= 0) {
    g.hp = 0;
    g.phase = 'over';
    ev.lost = true;
  }
}

/** Golpe de un enemigo que toca la torre: primero le pinchan las espinas; si muere, no hace daño. */
function contact(g: SentryGame, e: Enemy, ev: SentryEvents) {
  const thorns = stat(g, 'thorns');
  if (thorns > 0) {
    e.hp -= thorns * e.max * (e.kind === 'boss' ? 0.1 : 1);
    e.flash = 80;
    if (e.hp <= 0) {
      kill(g, e, 'thorns', ev);
      return;
    }
  }
  hurt(g, e.dmg, ev);
  ev.impacts.push({ x: e.x, y: e.y, kind: e.kind });
  if (STATS[e.kind].hitEvery === 0) e.hp = 0;
  else e.hitT = STATS[e.kind].hitEvery;
}

/** Elige hasta `n` blancos: los más cercanos dentro del alcance que aún no tienen la muerte en camino. */
function pickTargets(g: SentryGame, n: number): Enemy[] {
  const r = range(g);
  const inRange: { e: Enemy; d: number }[] = [];
  for (const e of g.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - TX, e.y - TY) - e.r;
    if (d <= r) inRange.push({ e, d });
  }
  if (!inRange.length) return [];
  inRange.sort((a, b) => a.d - b.d);
  const alive = inRange.filter((x) => x.e.pend < x.e.hp);
  // Si a todos les llega ya la muerte, se dispara igual al más cercano (por si alguna bala falla)
  const pool = alive.length ? alive : inRange;
  return pool.slice(0, n).map((x) => x.e);
}

function fire(g: SentryGame, rand: Rand, ev: SentryEvents): boolean {
  const targets = pickTargets(g, stat(g, 'multi'));
  if (!targets.length) return false;
  const base = stat(g, 'dmg');
  const critP = stat(g, 'crit');
  const critX = stat(g, 'critx');
  g.aim = Math.atan2(targets[0].y - TY, targets[0].x - TX);
  for (const e of targets) {
    const crit = rand() < critP;
    const dmg = crit ? base * critX : base;
    const a = Math.atan2(e.y - TY, e.x - TX);
    e.pend += dmg;
    g.bullets.push({ x: TX + Math.cos(a) * 15, y: TY + Math.sin(a) * 15, tx: e.x, ty: e.y, target: e.id, dmg, crit });
  }
  ev.fired += targets.length;
  return true;
}

export function step(g: SentryGame, dt: number, rand: Rand): SentryEvents {
  const ev = newEvents();
  if (g.phase !== 'play') return ev;
  const s = dt / 1000;
  g.t += dt;
  g.rayoT = Math.max(0, g.rayoT - dt);

  // Reloj de oleadas: avanza solo, como en un idle
  g.waveT += dt;
  while (g.queue.length && g.queue[0].at <= g.waveT) {
    const sp = g.queue.shift()!;
    g.enemies.push(makeEnemy(g, sp));
    if (sp.kind === 'boss') ev.bossIn = true;
  }
  if (g.waveT >= WAVE_MS) {
    const cleared = g.wave;
    g.waveT -= WAVE_MS;
    g.score += WAVE_PTS;
    const interest = Math.min(g.coins * stat(g, 'interest'), interestCap(cleared));
    const bonus = stat(g, 'bonus');
    g.coins += interest + bonus;
    g.earned += interest + bonus;
    ev.waveClear = { wave: cleared, interest, bonus };
    // Lo que quedara por salir sale ya (no debería pasar: SPAWN_MS < WAVE_MS)
    for (const sp of g.queue) g.enemies.push(makeEnemy(g, sp));
    startWave(g, cleared + 1, rand);
    ev.waveStart = g.wave;
  }

  // Regeneración
  g.hp = Math.min(maxHp(g), g.hp + stat(g, 'regen') * s);

  // Torre: dispara sola
  g.fireT -= dt;
  if (g.fireT <= 0) {
    if (fire(g, rand, ev)) g.fireT += 1000 / stat(g, 'rate');
    else g.fireT = 0;
  }

  // Balas de la torre (persiguen a su blanco)
  const byId = new Map<number, Enemy>();
  for (const e of g.enemies) byId.set(e.id, e);
  const knock = stat(g, 'knock');
  for (const b of g.bullets) {
    const e = byId.get(b.target);
    const live = e && e.hp > 0;
    if (live) {
      b.tx = e.x;
      b.ty = e.y;
    }
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.hypot(dx, dy);
    const mv = BULLET_SPEED * s;
    const reach = live ? e.r + 2 : 2;
    if (d - reach <= mv) {
      b.done = true;
      if (!live) continue;
      e.pend = Math.max(0, e.pend - b.dmg);
      e.hp -= b.dmg;
      e.flash = 70;
      if (knock > 0) e.kb += knock * STATS[e.kind].knock;
      if (e.hp <= 0) kill(g, e, 'shot', ev);
      else if (ev.hits.length < 12) ev.hits.push({ x: e.x - (dx / d) * e.r, y: e.y - (dy / d) * e.r, dmg: b.dmg, crit: b.crit });
      else if (b.crit) ev.hits.push({ x: e.x, y: e.y, dmg: b.dmg, crit: true });
    } else {
      b.x += (dx / d) * mv;
      b.y += (dy / d) * mv;
    }
  }
  g.bullets = g.bullets.filter((b) => !b.done);

  // Enemigos
  for (const e of g.enemies) {
    if (e.hp <= 0) continue;
    e.age += dt;
    e.flash = Math.max(0, e.flash - dt);
    const dx = TX - e.x;
    const dy = TY - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    // Retroceso: se le empuja hacia fuera rápido (y se despega si estaba pegado)
    if (e.kb > 0) {
      const push = Math.min(e.kb, 260 * s);
      e.kb -= push;
      e.x -= ux * push;
      e.y -= uy * push;
      e.stuck = false;
      continue;
    }
    if (e.stun > 0) {
      e.stun -= dt;
      continue;
    }
    if (e.kind === 'ranged') {
      if (d > RANGED_STOP) {
        e.x += ux * Math.min(e.speed * s, d - RANGED_STOP);
        e.y += uy * Math.min(e.speed * s, d - RANGED_STOP);
      } else {
        e.hitT -= dt;
        if (e.hitT <= 0) {
          e.hitT = 2800;
          g.ebullets.push({ x: e.x + ux * e.r, y: e.y + uy * e.r, vx: ux * EBULLET_SPEED, vy: uy * EBULLET_SPEED, dmg: e.dmg });
          ev.enemyShots.push({ x: e.x, y: e.y });
        }
      }
      continue;
    }
    const touch = TOWER_R + e.r;
    if (!e.stuck) {
      const mv = e.speed * s;
      if (d - mv <= touch) {
        e.x = TX - ux * touch;
        e.y = TY - uy * touch;
        e.stuck = true;
        contact(g, e, ev);
      } else {
        e.x += ux * mv;
        e.y += uy * mv;
      }
    } else {
      e.hitT -= dt;
      if (e.hitT <= 0) contact(g, e, ev);
    }
  }

  // Balas enemigas: lentas, van a la torre
  for (const b of g.ebullets) {
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (Math.hypot(b.x - TX, b.y - TY) <= TOWER_R + 3) {
      b.done = true;
      hurt(g, b.dmg, ev);
      ev.impacts.push({ x: b.x, y: b.y, kind: 'ranged' });
    }
  }
  g.ebullets = g.ebullets.filter((b) => !b.done);
  g.enemies = g.enemies.filter((e) => e.hp > 0);
  return ev;
}

/** Fracción de la oleada que ya pasó (0..1). */
export function waveProgress(g: SentryGame): number {
  return clamp(g.waveT / WAVE_MS, 0, 1);
}
