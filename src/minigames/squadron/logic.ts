// "Escuadrilla" (matamarcianos vertical): tu avión defiende el cielo de la ciudad. Dispara solo; tú lo
// mueves arrastrando. Los enemigos llegan por oleadas y sueltan monedas; las estrellas mejoran el arma.
// Cada dos oleadas aterrizas en el hangar y gastas las monedas en mejoras, y cada cuatro llega un
// dirigible jefe. Se acaba cuando te quedas sin vidas.

import { clamp, hit, nearest, norm, pickOne, type Rand } from '../shooter/kit';

export const FIELD_W = 360;
export const FIELD_H = 600;
/** Hueco del avión para las balas (más pequeño que el dibujo: así es justo esquivar). */
export const PLAYER_R = 5;
/** Hueco del avión al chocar con un enemigo. */
export const PLAYER_BODY = 11;
export const PLAYER_MIN_Y = 90;
export const PLAYER_MAX_Y = FIELD_H - 26;
/** Invulnerable tras un golpe (ms). */
export const INV_MS = 1600;
export const START_HP = 3;
/** Nivel máximo del arma (estrellas). */
export const POWER_MAX = 5;
export const HANGAR_EVERY = 2;
export const BOSS_EVERY = 4;
/** Pausa tras despejar una oleada: las monedas vuelan hacia ti (ms). */
export const BETWEEN_MS = 1500;
/** Velocidad con teclado (unidades/s). */
export const KEY_SPEED = 260;
export const SHOT_SPEED = 560;
/** Radio base del imán de monedas. */
export const MAGNET_R = 36;

export type EnemyKind = 'scout' | 'diver' | 'fighter' | 'bomber' | 'boss';
type Move = 'hover' | 'cross' | 'down' | 'dive' | 'boss';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  move: Move;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  max: number;
  /** Edad (ms). */
  age: number;
  /** Altura donde se queda (hover) o eje de la onda (cross). */
  ty: number;
  phase: number;
  /** Hasta el próximo disparo (ms). */
  fire: number;
  /** Destello al recibir un impacto (ms). */
  flash: number;
  /** Jefe: patrón actual, aviso antes de disparar y ráfagas pendientes. */
  pattern: number;
  warn: number;
  burst: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  kind: 'gun' | 'wing' | 'missile';
  /** Misil: enemigo al que persigue. */
  target: number;
}

export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export type PickupKind = 'coin' | 'star' | 'heart';

export interface Pickup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: PickupKind;
  value: number;
  /** Atraída por el imán. */
  pulled: boolean;
  /** Ya recogida (se quita al final del paso). */
  got?: boolean;
}

export type ShopId = 'dmg' | 'rate' | 'missile' | 'wing' | 'armor' | 'magnet' | 'repair';

interface Spawn {
  at: number;
  kind: EnemyKind;
  move: Move;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ty: number;
  phase: number;
}

export interface SquadronGame {
  t: number;
  phase: 'play' | 'hangar' | 'over';
  x: number;
  y: number;
  hp: number;
  inv: number;
  power: number;
  lv: Record<ShopId, number>;
  coins: number;
  score: number;
  kills: number;
  wave: number;
  bosses: number;
  /** Tiempo desde que empezó la oleada y lo que falta por salir. */
  waveT: number;
  queue: Spawn[];
  /** >0: pausa entre oleadas. */
  between: number;
  enemies: Enemy[];
  shots: Shot[];
  eshots: EnemyShot[];
  pickups: Pickup[];
  gunT: number;
  missileT: number;
  wingT: number;
  nextId: number;
}

export interface Pop {
  x: number;
  y: number;
  kind: EnemyKind;
  pts: number;
}

export interface SquadronEvents {
  kills: Pop[];
  /** Impactos propios que no mataron (chispas). */
  sparks: { x: number; y: number }[];
  shots: number;
  hurt: boolean;
  /** Recogidas: monedas sumadas, estrella o corazón. */
  coins: number;
  star: boolean;
  heart: boolean;
  waveStart: number;
  waveClear: boolean;
  bossIn: boolean;
  bossWarn: boolean;
  bossDown: boolean;
  hangar: boolean;
  lost: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------

const STATS: Record<EnemyKind, { hp: number; r: number; pts: number; coins: number }> = {
  scout: { hp: 1, r: 10, pts: 1, coins: 1 },
  diver: { hp: 2, r: 10, pts: 2, coins: 1 },
  fighter: { hp: 4, r: 13, pts: 3, coins: 2 },
  bomber: { hp: 12, r: 20, pts: 8, coins: 5 },
  boss: { hp: 170, r: 44, pts: 40, coins: 30 },
};

export interface ShopDef {
  id: ShopId;
  emoji: string;
  name: string;
  max: number;
  costs: number[];
  desc: (lv: number) => string;
}

export const SHOP: ShopDef[] = [
  { id: 'dmg', emoji: '💥', name: 'Munición pesada', max: 5, costs: [30, 60, 100, 150, 220], desc: () => '+25 % de daño en todos tus disparos' },
  { id: 'rate', emoji: '⚡', name: 'Cadencia', max: 5, costs: [25, 50, 90, 140, 200], desc: () => 'Disparas un 12 % más rápido' },
  { id: 'missile', emoji: '🚀', name: 'Misiles', max: 3, costs: [60, 120, 200], desc: (lv) => (lv === 1 ? 'Misiles que buscan al enemigo más cercano' : 'Un misil más en cada salva') },
  { id: 'wing', emoji: '🛩️', name: 'Escoltas', max: 2, costs: [80, 170], desc: (lv) => (lv === 1 ? 'Dos avionetas vuelan contigo y disparan' : 'Tus escoltas disparan el doble') },
  { id: 'armor', emoji: '🛡️', name: 'Blindaje', max: 2, costs: [70, 150], desc: () => '+1 vida máxima (y la recuperas)' },
  { id: 'magnet', emoji: '🧲', name: 'Imán', max: 2, costs: [30, 60], desc: () => 'Atraes las monedas desde más lejos' },
  { id: 'repair', emoji: '🔧', name: 'Reparar', max: 0, costs: [45], desc: () => 'Recupera 1 vida' },
];

export function maxHp(g: SquadronGame): number {
  return START_HP + g.lv.armor;
}

export function dmgMult(g: SquadronGame): number {
  return 1 + 0.25 * g.lv.dmg;
}

export function gunMs(g: SquadronGame): number {
  return 165 * 0.88 ** g.lv.rate;
}

export function magnetR(g: SquadronGame): number {
  return MAGNET_R + 28 * g.lv.magnet;
}

/** Vida de los enemigos según la oleada: sube poco al principio y, desde la décima, cada vez más deprisa. */
export function hpScale(wave: number): number {
  return (1 + 0.16 * (wave - 1)) * 1.07 ** Math.max(0, wave - 10);
}

/** Desde la décima oleada los enemigos disparan más y más seguido. */
function pressure(wave: number): number {
  return Math.max(0, wave - 10);
}

export function isBossWave(wave: number): boolean {
  return wave % BOSS_EVERY === 0;
}

/** Precio del siguiente nivel, o null si ya no se puede comprar. */
export function shopCost(g: SquadronGame, id: ShopId): number | null {
  const d = SHOP.find((x) => x.id === id)!;
  if (id === 'repair') return g.hp < maxHp(g) ? d.costs[0] : null;
  return g.lv[id] < d.max ? d.costs[g.lv[id]] : null;
}

export function buy(g: SquadronGame, id: ShopId): boolean {
  const cost = shopCost(g, id);
  if (cost === null || g.coins < cost || g.phase !== 'hangar') return false;
  g.coins -= cost;
  if (id === 'repair') g.hp = Math.min(maxHp(g), g.hp + 1);
  else {
    g.lv[id]++;
    if (id === 'armor') g.hp = Math.min(maxHp(g), g.hp + 1);
  }
  return true;
}

/** Sale del hangar y empieza la siguiente oleada. */
export function leaveHangar(g: SquadronGame, rand: Rand): number {
  if (g.phase !== 'hangar') return g.wave;
  g.phase = 'play';
  startWave(g, g.wave + 1, rand);
  return g.wave;
}

// ---------------------------------------------------------------------------------------------
// Oleadas
// ---------------------------------------------------------------------------------------------

type Group = 'row' | 'snake' | 'vee' | 'guards' | 'bombers' | 'divers';

function groupFor(wave: number, rand: Rand): Group {
  const pool: Group[] = ['row', 'snake'];
  if (wave >= 2) pool.push('vee', 'guards');
  if (wave >= 3) pool.push('divers', 'bombers');
  if (wave >= 6) pool.push('bombers', 'divers', 'guards');
  return pickOne(rand, pool);
}

function spawnsFor(group: Group, at: number, rand: Rand): Spawn[] {
  const out: Spawn[] = [];
  const s = (dt: number, kind: EnemyKind, move: Move, x: number, y: number, vx: number, vy: number, ty: number, phase = 0) =>
    out.push({ at: at + dt, kind, move, x, y, vx, vy, ty, phase });
  switch (group) {
    case 'row': {
      const ty = 80 + rand() * 90;
      for (let i = 0; i < 5; i++) s(i * 120, 'scout', 'hover', 60 + i * 60, -20, 0, 0, ty + (i % 2) * 18, i);
      break;
    }
    case 'snake': {
      const left = rand() < 0.5;
      const ty = 110 + rand() * 120;
      for (let i = 0; i < 6; i++) s(i * 260, 'scout', 'cross', left ? -20 : FIELD_W + 20, ty, left ? 95 : -95, 0, ty, i * 0.6);
      break;
    }
    case 'vee': {
      const cx = 90 + rand() * 180;
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        s(Math.abs(k) * 180, 'fighter', 'down', cx + k * 34, -24 - Math.abs(k) * 24, 0, 42, 0);
      }
      break;
    }
    case 'guards': {
      for (let i = 0; i < 3; i++) s(i * 250, 'fighter', 'hover', 70 + i * 110, -24, 0, 0, 120 + (i === 1 ? -30 : 0), i);
      break;
    }
    case 'bombers': {
      const two = rand() < 0.5;
      s(0, 'bomber', 'hover', two ? 110 : 180, -30, 0, 0, 130, 0);
      if (two) s(400, 'bomber', 'hover', 250, -30, 0, 0, 150, 1.5);
      break;
    }
    case 'divers': {
      for (let i = 0; i < 4; i++) s(i * 340, 'diver', 'dive', 40 + rand() * (FIELD_W - 80), -20, 0, 0, 60);
      break;
    }
  }
  return out;
}

/** Lo que sale en una oleada (ordenado por tiempo). */
export function waveSpawns(wave: number, rand: Rand): Spawn[] {
  if (isBossWave(wave)) {
    const out: Spawn[] = [{ at: 900, kind: 'boss', move: 'boss', x: FIELD_W / 2, y: -60, vx: 0, vy: 0, ty: 120, phase: 0 }];
    return out;
  }
  const groups = Math.min(7, 2 + Math.floor(wave / 2));
  const gap = Math.max(1700, 3100 - wave * 110);
  const out: Spawn[] = [];
  for (let i = 0; i < groups; i++) out.push(...spawnsFor(groupFor(wave, rand), 600 + i * gap, rand));
  return out.sort((a, b) => a.at - b.at);
}

function startWave(g: SquadronGame, wave: number, rand: Rand) {
  g.wave = wave;
  g.waveT = 0;
  g.queue = waveSpawns(wave, rand);
}

export function newSquadron(rand: Rand): SquadronGame {
  const g: SquadronGame = {
    t: 0,
    phase: 'play',
    x: FIELD_W / 2,
    y: FIELD_H - 90,
    hp: START_HP,
    inv: 0,
    power: 1,
    lv: { dmg: 0, rate: 0, missile: 0, wing: 0, armor: 0, magnet: 0, repair: 0 },
    coins: 0,
    score: 0,
    kills: 0,
    wave: 1,
    bosses: 0,
    waveT: 0,
    queue: [],
    between: 0,
    enemies: [],
    shots: [],
    eshots: [],
    pickups: [],
    gunT: 0,
    missileT: 600,
    wingT: 0,
    nextId: 1,
  };
  startWave(g, 1, rand);
  return g;
}

function makeEnemy(g: SquadronGame, sp: Spawn): Enemy {
  const st = STATS[sp.kind];
  const hp = Math.round(st.hp * hpScale(g.wave) * (sp.kind === 'boss' ? 1.2 : 1) * 10) / 10;
  return {
    id: g.nextId++,
    kind: sp.kind,
    move: sp.move,
    x: sp.x,
    y: sp.y,
    vx: sp.vx,
    vy: sp.vy,
    r: st.r,
    hp,
    max: hp,
    age: 0,
    ty: sp.ty,
    phase: sp.phase,
    fire: 900 + sp.phase * 300,
    flash: 0,
    pattern: 0,
    warn: 0,
    burst: 0,
  };
}

export function boss(g: SquadronGame): Enemy | undefined {
  return g.enemies.find((e) => e.kind === 'boss');
}

// ---------------------------------------------------------------------------------------------
// Paso
// ---------------------------------------------------------------------------------------------

function aimAt(g: SquadronGame, x: number, y: number, speed: number, spread = 0): EnemyShot {
  const d = norm(g.x - x, g.y - y);
  const a = Math.atan2(d.y, d.x) + spread;
  return { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4 };
}

function bulletSpeed(wave: number): number {
  return Math.min(265, 145 + wave * 5);
}

function enemyFire(g: SquadronGame, e: Enemy, rand: Rand, ev: SquadronEvents) {
  const sp = bulletSpeed(g.wave);
  if (e.kind === 'boss') {
    // Avisa (brillo) antes de cada patrón y luego dispara
    if (e.warn > 0) return;
    const lvl = g.bosses;
    switch (e.pattern % 4) {
      case 0: {
        const n = 7 + Math.min(6, lvl * 2);
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + ((i - (n - 1) / 2) / n) * 1.9;
          g.eshots.push({ x: e.x, y: e.y + 24, vx: Math.cos(a) * sp * 0.85, vy: Math.sin(a) * sp * 0.85, r: 4.5 });
        }
        break;
      }
      case 1:
        for (const s of [-0.16, 0, 0.16]) g.eshots.push(aimAt(g, e.x, e.y + 24, sp, s));
        break;
      case 2: {
        const n = 14 + Math.min(8, lvl * 3);
        const off = rand() * Math.PI;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          g.eshots.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp * 0.7, vy: Math.sin(a) * sp * 0.7, r: 4.5 });
        }
        break;
      }
      case 3:
        for (const dx of [-60, 60]) {
          g.enemies.push(makeEnemy(g, { at: 0, kind: 'scout', move: 'dive', x: e.x + dx, y: e.y + 10, vx: 0, vy: 0, ty: e.y + 40, phase: 0 }));
        }
        break;
    }
    // Las ráfagas apuntadas se repiten
    if (e.pattern % 4 === 1 && e.burst < 2) {
      e.burst++;
      e.fire = 170;
      return;
    }
    e.burst = 0;
    e.pattern++;
    e.fire = Math.max(1300, 2500 - lvl * 250);
    e.warn = 520;
    if (e.pattern % 4 !== 1) ev.bossWarn = true;
    return;
  }
  const p = pressure(g.wave);
  const faster = Math.max(0.5, 1 - 0.035 * p);
  if (e.kind === 'fighter') {
    const spread = p >= 8 ? [-0.14, 0, 0.14] : p >= 1 ? [-0.08, 0.08] : [0];
    for (const a of spread) g.eshots.push(aimAt(g, e.x, e.y + 8, sp, a));
    e.fire = Math.max(800, 2300 - g.wave * 70) * (0.8 + rand() * 0.4) * faster;
  } else if (e.kind === 'bomber') {
    const fan = g.wave >= 16 ? [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6] : g.wave >= 8 ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.3, 0, 0.3];
    for (const a of fan) g.eshots.push({ x: e.x, y: e.y + 16, vx: Math.sin(a) * sp * 0.8, vy: Math.cos(a) * sp * 0.8, r: 5 });
    e.fire = Math.max(1200, 2600 - g.wave * 60) * faster;
  } else if (e.kind === 'scout' && g.wave >= 5) {
    g.eshots.push(p >= 4 ? aimAt(g, e.x, e.y + 8, sp * 0.9) : { x: e.x, y: e.y + 8, vx: 0, vy: sp * 0.9, r: 3.5 });
    e.fire = (2600 + rand() * 2600) * faster;
  } else e.fire = 1e9;
}

function moveEnemy(g: SquadronGame, e: Enemy, dt: number) {
  const s = dt / 1000;
  switch (e.move) {
    case 'hover': {
      // Baja hasta su altura, se mece y a los 9 s se marcha hacia abajo
      if (e.age < 9000) {
        e.y += (e.ty - e.y) * Math.min(1, 2.2 * s);
        e.x += Math.cos(e.age / 700 + e.phase) * 22 * s;
      } else {
        e.vy = Math.min(e.vy + 140 * s, 160);
        e.y += e.vy * s;
      }
      break;
    }
    case 'cross':
      e.x += e.vx * s;
      e.y = e.ty + Math.sin(e.age / 420 + e.phase) * 46;
      break;
    case 'down':
      e.y += e.vy * s;
      break;
    case 'dive': {
      // Se asoma, apunta a donde estás y se lanza
      if (e.age < 650) e.y += (e.ty - e.y) * Math.min(1, 3 * s);
      else {
        if (e.vx === 0 && e.vy === 0) {
          const d = norm(g.x - e.x, g.y - e.y);
          e.vx = d.x * 230;
          e.vy = Math.max(0.35, d.y) * 230;
        }
        e.x += e.vx * s;
        e.y += e.vy * s;
      }
      break;
    }
    case 'boss':
      if (e.y < e.ty) e.y = Math.min(e.ty, e.y + 60 * s);
      else e.x = FIELD_W / 2 + Math.sin(e.age / 2300) * 108;
      break;
  }
}

function offField(e: Enemy): boolean {
  return e.y > FIELD_H + 40 || (e.move === 'cross' && (e.x < -40 || e.x > FIELD_W + 40) && e.age > 1500);
}

function drop(g: SquadronGame, e: Enemy, rand: Rand) {
  const st = STATS[e.kind];
  const coins = e.kind === 'boss' ? st.coins + 10 * g.bosses : st.coins;
  const n = Math.min(coins, e.kind === 'boss' ? 12 : 4);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const v = 30 + rand() * (e.kind === 'boss' ? 110 : 50);
    // El valor se reparte entre las monedas que se ven
    const value = Math.floor(coins / n) + (i < coins % n ? 1 : 0);
    g.pickups.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, kind: 'coin', value, pulled: false });
  }
  const starChance = e.kind === 'boss' ? 1 : e.kind === 'bomber' ? 0.3 : 0.025;
  if (rand() < starChance) g.pickups.push({ x: e.x, y: e.y, vx: 0, vy: -30, kind: 'star', value: 1, pulled: false });
  const heartChance = e.kind === 'boss' ? 1 : e.kind === 'bomber' ? 0.1 : 0;
  if (rand() < heartChance) g.pickups.push({ x: e.x + 14, y: e.y, vx: 20, vy: -30, kind: 'heart', value: 1, pulled: false });
}

function kill(g: SquadronGame, e: Enemy, rand: Rand, ev: SquadronEvents) {
  const pts = e.kind === 'boss' ? STATS.boss.pts + 20 * g.bosses : STATS[e.kind].pts;
  g.score += pts;
  g.kills++;
  ev.kills.push({ x: e.x, y: e.y, kind: e.kind, pts });
  drop(g, e, rand);
  if (e.kind === 'boss') {
    g.bosses++;
    ev.bossDown = true;
    // Al caer el jefe se van sus escoltas
    for (const o of g.enemies) if (o !== e && o.kind === 'scout' && o.move === 'dive') o.hp = 0;
    g.eshots = [];
  }
}

function hurt(g: SquadronGame, ev: SquadronEvents) {
  if (g.inv > 0) return;
  g.hp--;
  g.inv = INV_MS;
  ev.hurt = true;
  // Respiro: desaparecen las balas enemigas
  g.eshots = [];
  if (g.hp <= 0) {
    g.phase = 'over';
    ev.lost = true;
  }
}

function fireGuns(g: SquadronGame, ev: SquadronEvents) {
  const dmg = dmgMult(g);
  const mk = (dx: number, a: number) => g.shots.push({ x: g.x + dx, y: g.y - 14, vx: Math.sin(a) * SHOT_SPEED, vy: -Math.cos(a) * SHOT_SPEED, dmg, kind: 'gun', target: 0 });
  switch (g.power) {
    case 1:
      mk(0, 0);
      break;
    case 2:
      mk(-6, 0);
      mk(6, 0);
      break;
    case 3:
      mk(0, 0);
      mk(-4, -0.17);
      mk(4, 0.17);
      break;
    case 4:
      mk(-6, 0);
      mk(6, 0);
      mk(-6, -0.2);
      mk(6, 0.2);
      break;
    default:
      mk(-6, 0);
      mk(6, 0);
      mk(-6, -0.2);
      mk(6, 0.2);
      mk(-8, -0.42);
      mk(8, 0.42);
  }
  ev.shots++;
}

/**
 * Avanza la partida `dt` ms. `move` es cuánto quiere moverse el avión en este paso (unidades del
 * juego: el arrastre del dedo ya convertido, más el teclado).
 */
export function step(g: SquadronGame, dt: number, move: { x: number; y: number }, rand: Rand): SquadronEvents {
  const ev: SquadronEvents = {
    kills: [],
    sparks: [],
    shots: 0,
    hurt: false,
    coins: 0,
    star: false,
    heart: false,
    waveStart: 0,
    waveClear: false,
    bossIn: false,
    bossWarn: false,
    bossDown: false,
    hangar: false,
    lost: false,
  };
  if (g.phase !== 'play') return ev;
  const s = dt / 1000;
  g.t += dt;
  g.inv = Math.max(0, g.inv - dt);

  // Avión
  g.x = clamp(g.x + move.x, 14, FIELD_W - 14);
  g.y = clamp(g.y + move.y, PLAYER_MIN_Y, PLAYER_MAX_Y);

  // Entre oleadas no se dispara: las monedas vuelan hacia ti
  if (g.between > 0) {
    g.between -= dt;
    if (g.between <= 0) {
      g.between = 0;
      if (g.wave % HANGAR_EVERY === 0) {
        g.phase = 'hangar';
        ev.hangar = true;
      } else {
        startWave(g, g.wave + 1, rand);
        ev.waveStart = g.wave;
      }
    }
  } else {
    // Oleada: salen los enemigos que tocan
    g.waveT += dt;
    while (g.queue.length && g.queue[0].at <= g.waveT) {
      const sp = g.queue.shift()!;
      g.enemies.push(makeEnemy(g, sp));
      if (sp.kind === 'boss') ev.bossIn = true;
    }

    // Disparos propios
    g.gunT -= dt;
    if (g.gunT <= 0) {
      g.gunT += gunMs(g);
      fireGuns(g, ev);
    }
    if (g.lv.wing > 0) {
      g.wingT -= dt;
      if (g.wingT <= 0) {
        g.wingT += g.lv.wing >= 2 ? 240 : 420;
        for (const dx of [-26, 26]) g.shots.push({ x: g.x + dx, y: g.y + 2, vx: 0, vy: -SHOT_SPEED, dmg: 0.6 * dmgMult(g), kind: 'wing', target: 0 });
      }
    }
    if (g.lv.missile > 0 && g.enemies.length) {
      g.missileT -= dt;
      if (g.missileT <= 0) {
        g.missileT += 1150;
        for (let i = 0; i < g.lv.missile; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const t = nearest(g.enemies, g.x, g.y - 120);
          g.shots.push({ x: g.x + side * 12, y: g.y, vx: side * 120, vy: -60, dmg: 3 * dmgMult(g), kind: 'missile', target: t?.id ?? 0 });
        }
      }
    }
  }

  // Proyectiles propios
  for (const sh of g.shots) {
    if (sh.kind === 'missile') {
      const t = g.enemies.find((e) => e.id === sh.target) ?? nearest(g.enemies, sh.x, sh.y);
      if (t) {
        sh.target = t.id;
        const d = norm(t.x - sh.x, t.y - sh.y);
        sh.vx += d.x * 1100 * s;
        sh.vy += d.y * 1100 * s;
      } else sh.vy -= 600 * s;
      const v = Math.hypot(sh.vx, sh.vy);
      const max = 330;
      if (v > max) {
        sh.vx *= max / v;
        sh.vy *= max / v;
      }
    }
    sh.x += sh.vx * s;
    sh.y += sh.vy * s;
  }

  // Enemigos
  for (const e of g.enemies) {
    e.age += dt;
    e.flash = Math.max(0, e.flash - dt);
    moveEnemy(g, e, dt);
    if (e.kind === 'boss' && e.warn > 0) e.warn = Math.max(0, e.warn - dt);
    e.fire -= dt;
    const inView = e.y > 10 && e.y < FIELD_H * 0.72;
    if (e.fire <= 0 && inView && e.age > 600 && g.between === 0) enemyFire(g, e, rand, ev);
    else if (e.fire <= 0 && !inView) e.fire = 300;
  }

  // Impactos propios
  for (const sh of g.shots) {
    if (sh.dmg <= 0) continue;
    for (const e of g.enemies) {
      if (e.hp <= 0) continue;
      if (hit({ x: sh.x, y: sh.y, r: sh.kind === 'missile' ? 5 : 3 }, e)) {
        e.hp -= sh.dmg;
        e.flash = 70;
        sh.dmg = 0;
        if (e.hp <= 0) kill(g, e, rand, ev);
        else if (ev.sparks.length < 8) ev.sparks.push({ x: sh.x, y: sh.y });
        break;
      }
    }
  }
  g.shots = g.shots.filter((sh) => sh.dmg > 0 && sh.y > -30 && sh.y < FIELD_H + 30 && sh.x > -30 && sh.x < FIELD_W + 30);
  g.enemies = g.enemies.filter((e) => e.hp > 0 && !offField(e));

  // Balas enemigas
  const me = { x: g.x, y: g.y, r: PLAYER_R };
  for (const b of g.eshots) {
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (g.phase === 'play' && hit(me, b)) {
      b.r = -1;
      hurt(g, ev);
    }
  }
  g.eshots = g.eshots.filter((b) => b.r > 0 && b.y > -20 && b.y < FIELD_H + 20 && b.x > -20 && b.x < FIELD_W + 20);

  // Choques con enemigos
  if (g.phase === 'play' && g.inv <= 0) {
    for (const e of g.enemies) {
      if (hit({ x: g.x, y: g.y, r: PLAYER_BODY }, { x: e.x, y: e.y, r: e.r * 0.8 })) {
        hurt(g, ev);
        if (e.kind !== 'boss') {
          e.hp -= 6 * dmgMult(g);
          if (e.hp <= 0) kill(g, e, rand, ev);
        }
        break;
      }
    }
    g.enemies = g.enemies.filter((e) => e.hp > 0);
  }

  // Monedas y premios
  const magnet = magnetR(g);
  for (const p of g.pickups) {
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (g.between > 0 || (p.kind === 'coin' && d < magnet) || (p.kind !== 'coin' && d < 26)) p.pulled = true;
    if (p.pulled) {
      const n = norm(g.x - p.x, g.y - p.y);
      const v = 420;
      p.vx = n.x * v;
      p.vy = n.y * v;
    } else {
      p.vx *= Math.max(0, 1 - 2 * s);
      p.vy = Math.min(p.vy + 90 * s, p.kind === 'coin' ? 75 : 60);
    }
    p.x += p.vx * s;
    p.y += p.vy * s;
    if (d < 16) {
      p.got = true;
      if (p.kind === 'coin') {
        g.coins += p.value;
        ev.coins += p.value;
      } else if (p.kind === 'star') {
        if (g.power < POWER_MAX) g.power++;
        else g.score += 5;
        ev.star = true;
      } else {
        g.hp = Math.min(maxHp(g), g.hp + 1);
        ev.heart = true;
      }
    }
  }
  g.pickups = g.pickups.filter((p) => !p.got && p.y < FIELD_H + 20);

  // Fin de oleada
  if (g.phase === 'play' && g.between === 0 && g.queue.length === 0 && g.enemies.length === 0) {
    g.score += g.wave;
    g.between = BETWEEN_MS;
    g.eshots = [];
    ev.waveClear = true;
  }
  return ev;
}
