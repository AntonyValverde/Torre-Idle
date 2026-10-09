// "Ronda nocturna" (survivors): el alcalde hace la ronda por la plaza de noche y le rodean hordas de
// bichos. Tú solo te mueves; las armas disparan solas. Los bichos sueltan gemas de experiencia y al subir
// de nivel eliges una mejora (armas nuevas o mejores, o pasivas). A los 4:00 llega El Coco y si aguantas
// hasta las 5:00 amanece y ganas. Se acaba antes si te quedas sin vida.

import { levelOf, levelUp, norm, pickOne, rollUpgrades, type Levels, type Rand, type UpgradeDef, type Vec } from '../shooter/kit';

/** Lo que se ve de la plaza en unidades del juego (la cámara sigue al alcalde). */
export const FIELD_W = 330;
export const FIELD_H = 560;
/** Duración de la noche y llegada del jefe (ms). */
export const RUN_MS = 300_000;
export const BOSS_AT = 240_000;
export const PLAYER_R = 7;
export const BASE_SPEED = 92;
export const BASE_HP = 100;
/** Tras un golpe, un respiro corto antes del siguiente (ms). */
export const HURT_CD = 450;
/** Tope de bichos vivos (los eventos pueden pasarlo un poco). */
export const MAX_ENEMIES = 180;
export const HARD_MAX = 230;
export const MAX_GEMS = 260;
export const MAX_ITEMS = 10;
export const BASE_MAGNET = 30;
export const DAWN_BONUS = 150;
export const MAX_LEVEL = 5;

export type EnemyKind = 'rat' | 'bat' | 'ghost' | 'gargoyle' | 'coco';
export type WeaponId = 'farol' | 'escoba' | 'campana' | 'petardos' | 'agua' | 'silbato';
export type PassiveId = 'botas' | 'iman' | 'corazon' | 'reloj' | 'brazo';
/** Premios de consolación cuando ya lo tienes todo al máximo. */
export type ExtraId = 'pollo' | 'bolsa';
export type UpId = WeaponId | PassiveId | ExtraId;

export const WEAPON_IDS: WeaponId[] = ['farol', 'escoba', 'campana', 'petardos', 'agua', 'silbato'];
export const PASSIVE_IDS: PassiveId[] = ['botas', 'iman', 'corazon', 'reloj', 'brazo'];

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** Empujón (se frena solo). */
  kx: number;
  ky: number;
  r: number;
  hp: number;
  max: number;
  speed: number;
  dmg: number;
  age: number;
  phase: number;
  /** Destello blanco al recibir un golpe (ms). */
  flash: number;
  /** La escoba no le pega otra vez hasta que pase esto (ms). */
  broomCd: number;
  dead: boolean;
  /** Mira a la izquierda (para el dibujo). */
  left: boolean;
  /** El Coco: 0 anda, 1 apunta (aviso), 2 embiste; tiempo en el modo, dirección fijada y vueltas. */
  mode: number;
  modeT: number;
  ax: number;
  ay: number;
  cycles: number;
}

export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: number;
  life: number;
  hits: number[];
}

/** Petardo o frasco de agua bendita en el aire: va de (sx, sy) a (x, y) en `dur` ms. */
export interface Throw {
  kind: 'petardo' | 'agua';
  sx: number;
  sy: number;
  x: number;
  y: number;
  t: number;
  dur: number;
  r: number;
  dmg: number;
}

export interface Puddle {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  tick: number;
  dmg: number;
}

export interface Gem {
  x: number;
  y: number;
  v: number;
  pulled: boolean;
  /** Velocidad al volar hacia ti (empieza negativa: primero se aparta un poco). */
  sp: number;
  got: boolean;
}

export type ItemKind = 'food' | 'magnet';

export interface Item {
  x: number;
  y: number;
  kind: ItemKind;
  age: number;
  got: boolean;
}

// ---------------------------------------------------------------------------------------------
// Rejilla para choques: cada paso se reparten los bichos en celdas alrededor del alcalde y cada arma
// solo mira las celdas que toca (en vez de comparar con los 200 bichos).
// ---------------------------------------------------------------------------------------------

const CELL = 32;
const GN = 64;
/** Radio del bicho más grande (para no dejárselo fuera de una consulta). */
const MAX_R = 28;

export class Grid {
  head = new Int32Array(GN * GN);
  next = new Int32Array(1024);
  out = new Int32Array(1024);
  ox = 0;
  oy = 0;

  build(list: Enemy[], cx: number, cy: number) {
    this.ox = cx - (GN * CELL) / 2;
    this.oy = cy - (GN * CELL) / 2;
    this.head.fill(-1);
    const n = Math.min(list.length, this.next.length);
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.dead) continue;
      const gx = Math.floor((e.x - this.ox) / CELL);
      const gy = Math.floor((e.y - this.oy) / CELL);
      if (gx < 0 || gy < 0 || gx >= GN || gy >= GN) continue;
      const c = gy * GN + gx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  /** Índices de los bichos que pueden estar a menos de `reach` de (x, y). Quedan en `out`. */
  query(x: number, y: number, reach: number): number {
    const x0 = Math.max(0, Math.floor((x - reach - this.ox) / CELL));
    const y0 = Math.max(0, Math.floor((y - reach - this.oy) / CELL));
    const x1 = Math.min(GN - 1, Math.floor((x + reach - this.ox) / CELL));
    const y1 = Math.min(GN - 1, Math.floor((y + reach - this.oy) / CELL));
    let n = 0;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        let i = this.head[gy * GN + gx];
        while (i >= 0 && n < this.out.length) {
          this.out[n++] = i;
          i = this.next[i];
        }
      }
    }
    return n;
  }
}

export interface NightGame {
  t: number;
  phase: 'play' | 'over';
  won: boolean;
  x: number;
  y: number;
  /** Última dirección de marcha (para el silbato sin bichos cerca) y hacia dónde mira. */
  faceX: number;
  faceY: number;
  left: boolean;
  moving: boolean;
  hp: number;
  hurtCd: number;
  lv: number;
  xp: number;
  /** Niveles ganados que aún no se han elegido. */
  pending: number;
  levels: Levels<UpId>;
  kills: number;
  killPts: number;
  bonus: number;
  score: number;
  enemies: Enemy[];
  bolts: Bolt[];
  throws: Throw[];
  puddles: Puddle[];
  gems: Gem[];
  items: Item[];
  cd: Record<WeaponId, number>;
  /** Ángulo de las escobas. */
  orbit: number;
  spawnAcc: number;
  nextEvent: number;
  bossSpawned: boolean;
  bossDown: boolean;
  nextId: number;
  steps: number;
  gemMerge: number;
  /** Media pantalla visible (la vista lo actualiza): los bichos nacen justo fuera. */
  halfW: number;
  halfH: number;
  grid: Grid;
}

export interface Pop {
  x: number;
  y: number;
  kind: EnemyKind;
  pts: number;
}

export interface NightEvents {
  kills: Pop[];
  /** Golpes con su daño (para los números, ya recortados). */
  hits: { x: number; y: number; dmg: number }[];
  bolts: number;
  pulses: { x: number; y: number; r: number }[];
  whistles: { x: number; y: number; a: number; range: number; spread: number }[];
  booms: { x: number; y: number; r: number }[];
  splashes: { x: number; y: number; r: number }[];
  hurt: number;
  /** Experiencia recogida en este paso. */
  xp: number;
  food: boolean;
  magnet: boolean;
  levelUp: boolean;
  /** Aviso de un evento de la noche (enjambre, cerco, gárgola…). */
  announce: { text: string; tone: 'good' | 'bad' | 'boss' } | null;
  eliteIn: boolean;
  bossIn: boolean;
  bossWarn: boolean;
  bossCharge: boolean;
  bossSummon: boolean;
  bossDown: boolean;
  /** Al amanecer los bichos se deshacen (posiciones para el humo). */
  burn: { x: number; y: number; kind: EnemyKind }[];
  dawn: boolean;
  lost: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------

interface EnemyStats {
  hp: number;
  speed: number;
  r: number;
  dmg: number;
  xp: number;
  pts: number;
  /** Cuánto ignora los empujones (1 = nada). */
  firm: number;
}

export const ENEMY: Record<EnemyKind, EnemyStats> = {
  rat: { hp: 9, speed: 46, r: 7, dmg: 7, xp: 1, pts: 1, firm: 0 },
  bat: { hp: 6, speed: 62, r: 6, dmg: 5, xp: 1, pts: 1, firm: 0 },
  ghost: { hp: 16, speed: 36, r: 9, dmg: 9, xp: 2, pts: 1, firm: 0.3 },
  gargoyle: { hp: 260, speed: 35, r: 14, dmg: 15, xp: 15, pts: 10, firm: 0.85 },
  coco: { hp: 4200, speed: 44, r: 26, dmg: 24, xp: 60, pts: 60, firm: 1 },
};

/** Vida de los bichos según el minuto de la noche. */
export function hpMul(t: number): number {
  return 1 + (t / 60_000) * 0.32;
}

/** Los bichos corren algo más según avanza la noche. */
export function speedMul(t: number): number {
  return 1 + (t / 60_000) * 0.08;
}

/** Bichos por segundo. */
export function spawnRate(t: number): number {
  return 1 + (t / 1000) * 0.025;
}

/** Experiencia para pasar del nivel `lv` al siguiente. */
export function xpNeed(lv: number): number {
  return 4 + 3 * (lv - 1);
}

interface WeaponStats {
  cd: number[];
  dmg: number[];
  n: number[];
  r: number[];
}

export const WEAPON: Record<WeaponId, WeaponStats> = {
  // n = rayos, r = cuántos atraviesa
  farol: { cd: [720, 650, 600, 540, 470], dmg: [12, 16, 16, 20, 24], n: [1, 1, 2, 2, 3], r: [0, 0, 1, 1, 2] },
  // n = escobas, r = radio de giro
  escoba: { cd: [0, 0, 0, 0, 0], dmg: [7, 8, 10, 11, 14], n: [1, 2, 2, 3, 4], r: [34, 36, 40, 42, 46] },
  // r = radio de la onda
  campana: { cd: [2800, 2600, 2400, 2200, 2000], dmg: [10, 13, 16, 20, 25], n: [1, 1, 1, 1, 1], r: [52, 58, 64, 70, 78] },
  // n = petardos, r = radio de la explosión
  petardos: { cd: [2000, 1900, 1800, 1650, 1500], dmg: [18, 18, 24, 24, 30], n: [1, 2, 2, 3, 4], r: [28, 30, 32, 34, 36] },
  // n = frascos, r = radio del charco, dmg por toque (cada 300 ms)
  agua: { cd: [3800, 3600, 3400, 3200, 3000], dmg: [4, 5, 6, 7, 8], n: [1, 1, 2, 2, 3], r: [24, 27, 30, 33, 36] },
  // r = alcance del cono
  silbato: { cd: [2200, 2000, 1800, 1600, 1400], dmg: [6, 8, 10, 12, 14], n: [1, 1, 1, 1, 1], r: [70, 78, 86, 94, 104] },
};

const PUDDLE_LIFE = [2500, 2800, 3100, 3400, 3800];
const WHISTLE_SPREAD = [0.5, 0.55, 0.6, 0.66, 0.75];

export function wl(g: NightGame, id: UpId): number {
  return levelOf(g.levels, id);
}

/** Valor de un arma a un nivel. */
function ws(id: WeaponId, key: keyof WeaponStats, lv: number): number {
  return WEAPON[id][key][Math.max(0, Math.min(MAX_LEVEL, lv) - 1)];
}

export const UPGRADES: UpgradeDef<UpId>[] = [
  {
    id: 'farol',
    emoji: '🏮',
    name: 'Farol',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Lanza rayos de luz al bicho más cercano' : lv === 3 ? 'Dos rayos y atraviesan a uno' : lv === 5 ? 'Tres rayos que atraviesan a dos' : 'Más daño y más rápido'),
  },
  {
    id: 'escoba',
    emoji: '🧹',
    name: 'Escoba giratoria',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Una escoba gira a tu alrededor y barre bichos' : lv === 2 || lv === 4 || lv === 5 ? '+1 escoba y más daño' : 'Más daño y gira más abierta'),
  },
  {
    id: 'campana',
    emoji: '🔔',
    name: 'Campana',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Un campanazo daña y aparta a todos los de cerca' : 'Onda más grande, más fuerte y más seguida'),
  },
  {
    id: 'petardos',
    emoji: '🧨',
    name: 'Petardos',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Lanzas petardos que estallan entre los bichos' : lv === 2 || lv === 4 || lv === 5 ? '+1 petardo en cada tanda' : 'Explosiones más grandes y fuertes'),
  },
  {
    id: 'agua',
    emoji: '💧',
    name: 'Agua bendita',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Deja charcos que queman a los bichos que pisan' : lv === 3 || lv === 5 ? '+1 frasco, charcos más grandes' : 'Charcos más grandes y duraderos'),
  },
  {
    id: 'silbato',
    emoji: '📯',
    name: 'Silbato',
    max: 5,
    weapon: true,
    desc: (lv) => (lv === 1 ? 'Un pitido en abanico que empuja lejos a los bichos' : 'Más alcance, más ancho y más seguido'),
  },
  { id: 'botas', emoji: '👢', name: 'Botas', max: 5, weight: 0.8, desc: () => 'Corres un 10 % más rápido' },
  { id: 'iman', emoji: '🧲', name: 'Imán', max: 5, weight: 0.8, desc: () => 'Atraes las gemas desde más lejos' },
  { id: 'corazon', emoji: '❤️', name: 'Corazón', max: 5, weight: 0.8, desc: () => '+20 de vida máxima y te curas 20' },
  { id: 'reloj', emoji: '⏱️', name: 'Reloj', max: 5, weight: 0.8, desc: () => 'Tus armas recargan un 8 % antes' },
  { id: 'brazo', emoji: '💪', name: 'Brazo fuerte', max: 5, weight: 0.8, desc: () => '+15 % de daño en todas tus armas' },
];

export const EXTRAS: UpgradeDef<UpId>[] = [
  { id: 'pollo', emoji: '🍗', name: 'Muslo de pollo', max: 9999, desc: () => 'Te curas 40 de vida' },
  { id: 'bolsa', emoji: '💰', name: 'Bolsa de monedas', max: 9999, desc: () => '+10 puntos' },
];

export const UP_BY_ID = Object.fromEntries([...UPGRADES, ...EXTRAS].map((d) => [d.id, d])) as Record<UpId, UpgradeDef<UpId>>;

export function maxHp(g: NightGame): number {
  return BASE_HP + 20 * wl(g, 'corazon');
}

export function speed(g: NightGame): number {
  return BASE_SPEED * (1 + 0.1 * wl(g, 'botas'));
}

export function magnetR(g: NightGame): number {
  return BASE_MAGNET * (1 + 0.38 * wl(g, 'iman'));
}

export function cdMul(g: NightGame): number {
  return 1 - 0.08 * wl(g, 'reloj');
}

export function dmgMul(g: NightGame): number {
  return 1 + 0.15 * wl(g, 'brazo');
}

export function ownedWeapons(g: NightGame): WeaponId[] {
  return WEAPON_IDS.filter((id) => wl(g, id) > 0);
}

/** Tres mejoras para elegir. Al principio siempre sale al menos un arma nueva. */
export function rollChoices(g: NightGame, rand: Rand): UpgradeDef<UpId>[] {
  const ch = rollUpgrades(UPGRADES, g.levels, rand, 3);
  if (ownedWeapons(g).length < 3 && !ch.some((d) => d.weapon && wl(g, d.id) === 0)) {
    const fresh = UPGRADES.filter((d) => d.weapon && wl(g, d.id) === 0);
    if (fresh.length) ch[Math.min(ch.length, 2)] = pickOne(rand, fresh);
  }
  for (const x of EXTRAS) if (ch.length < 3) ch.push(x);
  return ch;
}

/** Aplica la mejora elegida y gasta uno de los niveles pendientes. */
export function applyUpgrade(g: NightGame, id: UpId) {
  if (id === 'pollo') g.hp = Math.min(maxHp(g), g.hp + 40);
  else if (id === 'bolsa') g.bonus += 10;
  else {
    levelUp(g.levels, UP_BY_ID[id]);
    if (id === 'corazon') g.hp = Math.min(maxHp(g), g.hp + 20);
    // Un arma nueva dispara enseguida
    if ((WEAPON_IDS as string[]).includes(id) && wl(g, id) === 1) g.cd[id as WeaponId] = 200;
  }
  g.pending = Math.max(0, g.pending - 1);
  updateScore(g);
}

// ---------------------------------------------------------------------------------------------
// La noche: eventos con hora fija
// ---------------------------------------------------------------------------------------------

type NightEventKind = 'swarm' | 'ring' | 'elite' | 'boss' | 'note';

interface NightEvent {
  at: number;
  kind: NightEventKind;
  n: number;
  enemy?: EnemyKind;
  text: string;
  tone: 'good' | 'bad' | 'boss';
}

export const TIMELINE: NightEvent[] = [
  { at: 40_000, kind: 'swarm', n: 14, enemy: 'bat', text: '🦇 ¡Enjambre de murciélagos!', tone: 'bad' },
  { at: 60_000, kind: 'elite', n: 1, enemy: 'gargoyle', text: '🗿 ¡Una gárgola se despierta!', tone: 'boss' },
  { at: 95_000, kind: 'ring', n: 22, enemy: 'rat', text: '🐀 ¡Te rodean las ratas!', tone: 'bad' },
  { at: 120_000, kind: 'elite', n: 2, enemy: 'gargoyle', text: '🗿 ¡Dos gárgolas!', tone: 'boss' },
  { at: 150_000, kind: 'ring', n: 16, enemy: 'ghost', text: '👻 ¡Fantasmas por todas partes!', tone: 'bad' },
  { at: 180_000, kind: 'elite', n: 3, enemy: 'gargoyle', text: '🗿 ¡Tres gárgolas!', tone: 'boss' },
  { at: 205_000, kind: 'swarm', n: 24, enemy: 'bat', text: '🦇 ¡Una nube de murciélagos!', tone: 'bad' },
  { at: BOSS_AT, kind: 'boss', n: 1, enemy: 'coco', text: '👹 ¡Llega El Coco!', tone: 'boss' },
  { at: 270_000, kind: 'ring', n: 30, enemy: 'rat', text: '🐀 ¡Última horda!', tone: 'bad' },
  { at: 285_000, kind: 'note', n: 0, text: '🌄 ¡Ya casi amanece!', tone: 'good' },
];

// ---------------------------------------------------------------------------------------------
// Partida
// ---------------------------------------------------------------------------------------------

export function newNight(): NightGame {
  return {
    t: 0,
    phase: 'play',
    won: false,
    x: 0,
    y: 40,
    faceX: 1,
    faceY: 0,
    left: false,
    moving: false,
    hp: BASE_HP,
    hurtCd: 0,
    lv: 1,
    xp: 0,
    pending: 0,
    levels: { farol: 1 },
    kills: 0,
    killPts: 0,
    bonus: 0,
    score: 0,
    enemies: [],
    bolts: [],
    throws: [],
    puddles: [],
    gems: [],
    items: [],
    cd: { farol: 500, escoba: 0, campana: 0, petardos: 0, agua: 0, silbato: 0 },
    orbit: 0,
    spawnAcc: 0,
    nextEvent: 0,
    bossSpawned: false,
    bossDown: false,
    nextId: 1,
    steps: 0,
    gemMerge: 0,
    halfW: FIELD_W / 2,
    halfH: FIELD_H / 2,
    grid: new Grid(),
  };
}

export function updateScore(g: NightGame) {
  g.score = g.killPts + Math.floor(g.t / 2000) + g.bonus;
}

export function boss(g: NightGame): Enemy | undefined {
  return g.enemies.find((e) => e.kind === 'coco' && !e.dead);
}

export function makeEnemy(g: NightGame, kind: EnemyKind, x: number, y: number, rand: Rand): Enemy {
  const st = ENEMY[kind];
  const hp = Math.round(st.hp * (kind === 'coco' ? 1 : hpMul(g.t)) * 10) / 10;
  const e: Enemy = {
    id: g.nextId++,
    kind,
    x,
    y,
    kx: 0,
    ky: 0,
    r: st.r,
    hp,
    max: hp,
    speed: st.speed * (kind === 'coco' ? 1 : speedMul(g.t)) * (0.9 + rand() * 0.2),
    dmg: st.dmg,
    age: 0,
    phase: rand() * Math.PI * 2,
    flash: 0,
    broomCd: 0,
    dead: false,
    left: x > g.x,
    mode: 0,
    modeT: 0,
    ax: 0,
    ay: 0,
    cycles: 0,
  };
  g.enemies.push(e);
  return e;
}

/** Un punto justo fuera de la pantalla. */
function edgePoint(g: NightGame, rand: Rand, margin = 30): Vec {
  const hw = g.halfW + margin;
  const hh = g.halfH + margin;
  const p = rand() * 2 * (hw + hh);
  const side = rand() < 0.5 ? -1 : 1;
  if (p < 2 * hw) return { x: g.x - hw + p, y: g.y + side * hh };
  return { x: g.x + side * hw, y: g.y - hh + (p - 2 * hw) };
}

function pickKind(t: number, rand: Rand): EnemyKind {
  const sec = t / 1000;
  const wb = sec < 20 ? 0 : Math.min(0.9, (sec - 20) / 50);
  const wg = sec < 75 ? 0 : Math.min(0.7, (sec - 75) / 60);
  const r = rand() * (1 + wb + wg);
  return r < 1 ? 'rat' : r < 1 + wb ? 'bat' : 'ghost';
}

function runTimeline(g: NightGame, rand: Rand, ev: NightEvents) {
  while (g.nextEvent < TIMELINE.length && TIMELINE[g.nextEvent].at <= g.t) {
    const e = TIMELINE[g.nextEvent++];
    ev.announce = { text: e.text, tone: e.tone };
    const room = HARD_MAX - g.enemies.length;
    switch (e.kind) {
      case 'swarm': {
        // Todos llegan por el mismo lado, en piña
        const a = rand() * Math.PI * 2;
        const R = Math.max(g.halfW, g.halfH) + 40;
        const cx = g.x + Math.cos(a) * R;
        const cy = g.y + Math.sin(a) * R;
        for (let i = 0; i < Math.min(e.n, room); i++) makeEnemy(g, e.enemy!, cx + (rand() - 0.5) * 90, cy + (rand() - 0.5) * 90, rand);
        break;
      }
      case 'ring': {
        const R = Math.max(g.halfW, g.halfH) + 20;
        const n = Math.min(e.n, room);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          makeEnemy(g, e.enemy!, g.x + Math.cos(a) * R, g.y + Math.sin(a) * R, rand);
        }
        break;
      }
      case 'elite':
        for (let i = 0; i < e.n; i++) {
          const p = edgePoint(g, rand, 40);
          makeEnemy(g, 'gargoyle', p.x, p.y, rand);
        }
        ev.eliteIn = true;
        break;
      case 'boss': {
        const p = edgePoint(g, rand, 50);
        const b = makeEnemy(g, 'coco', p.x, p.y, rand);
        b.speed = ENEMY.coco.speed;
        g.bossSpawned = true;
        ev.bossIn = true;
        break;
      }
      case 'note':
        break;
    }
  }
}

function spawnTick(g: NightGame, dt: number, rand: Rand) {
  const rate = spawnRate(g.t) * (boss(g) ? 0.6 : 1);
  g.spawnAcc = Math.min(4, g.spawnAcc + (rate * dt) / 1000);
  while (g.spawnAcc >= 1) {
    g.spawnAcc -= 1;
    if (g.enemies.length >= MAX_ENEMIES) continue;
    const p = edgePoint(g, rand);
    makeEnemy(g, pickKind(g.t, rand), p.x, p.y, rand);
  }
}

function emptyEvents(): NightEvents {
  return {
    kills: [],
    hits: [],
    bolts: 0,
    pulses: [],
    whistles: [],
    booms: [],
    splashes: [],
    hurt: 0,
    xp: 0,
    food: false,
    magnet: false,
    levelUp: false,
    announce: null,
    eliteIn: false,
    bossIn: false,
    bossWarn: false,
    bossCharge: false,
    bossSummon: false,
    bossDown: false,
    burn: [],
    dawn: false,
    lost: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Daño, muertes y botín
// ---------------------------------------------------------------------------------------------

function addGem(g: NightGame, x: number, y: number, v: number) {
  if (g.gems.length >= MAX_GEMS) {
    // Demasiadas en el suelo: el valor se suma a una que ya está (se ve más gorda)
    g.gemMerge = (g.gemMerge + 1) % g.gems.length;
    g.gems[g.gemMerge].v += v;
    return;
  }
  g.gems.push({ x, y, v, pulled: false, sp: 0, got: false });
}

function addItem(g: NightGame, x: number, y: number, kind: ItemKind) {
  // Si hay demasiados, se pierde el más antiguo (seguramente quedó lejos)
  if (g.items.length >= MAX_ITEMS) g.items.shift();
  g.items.push({ x, y, kind, age: 0, got: false });
}

function kill(g: NightGame, e: Enemy, rand: Rand, ev: NightEvents) {
  e.dead = true;
  const st = ENEMY[e.kind];
  g.kills++;
  g.killPts += st.pts;
  ev.kills.push({ x: e.x, y: e.y, kind: e.kind, pts: st.pts });
  if (e.kind === 'coco') {
    // Lluvia de gemas y premios
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addGem(g, e.x + Math.cos(a) * 22, e.y + Math.sin(a) * 22, 8);
    }
    addItem(g, e.x - 14, e.y, 'magnet');
    addItem(g, e.x + 14, e.y, 'food');
    g.bossDown = true;
    ev.bossDown = true;
    return;
  }
  addGem(g, e.x, e.y, st.xp);
  if (e.kind === 'gargoyle') {
    if (rand() < 0.6) addItem(g, e.x + 10, e.y, 'food');
    else addItem(g, e.x + 10, e.y, 'magnet');
  } else {
    const r = rand();
    if (r < 0.004) addItem(g, e.x, e.y, 'food');
    else if (r < 0.0065) addItem(g, e.x, e.y, 'magnet');
  }
}

/** Golpea a un bicho desde (fx, fy): daño, destello y empujón hacia fuera. */
function strike(g: NightGame, e: Enemy, dmg: number, fx: number, fy: number, kb: number, rand: Rand, ev: NightEvents) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 90;
  const firm = ENEMY[e.kind].firm;
  if (kb > 0 && firm < 1) {
    const n = norm(e.x - fx, e.y - fy);
    e.kx += n.x * kb * (1 - firm);
    e.ky += n.y * kb * (1 - firm);
  }
  if (ev.hits.length < 10) ev.hits.push({ x: e.x, y: e.y - e.r, dmg });
  if (e.hp <= 0) kill(g, e, rand, ev);
}

// ---------------------------------------------------------------------------------------------
// Bichos
// ---------------------------------------------------------------------------------------------

function moveEnemies(g: NightGame, dt: number, rand: Rand, ev: NightEvents) {
  const s = dt / 1000;
  const far = Math.max(g.halfW, g.halfH) * 2.2 + 80;
  const damp = Math.max(0, 1 - 9 * s);
  for (const e of g.enemies) {
    if (e.dead) continue;
    e.age += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.broomCd > 0) e.broomCd -= dt;
    let dx = g.x - e.x;
    let dy = g.y - e.y;
    let d = Math.hypot(dx, dy);
    // Se quedó muy atrás: reaparece por delante (así la horda no se pierde)
    if (d > far && !(e.kind === 'coco' && e.mode === 2)) {
      const p = edgePoint(g, rand);
      e.x = p.x;
      e.y = p.y;
      dx = g.x - e.x;
      dy = g.y - e.y;
      d = Math.hypot(dx, dy);
    }
    const nx = d > 0.01 ? dx / d : 0;
    const ny = d > 0.01 ? dy / d : 0;
    let vx = nx * e.speed;
    let vy = ny * e.speed;
    if (e.kind === 'bat') {
      // Revolotea: zigzag de lado a lado con acelerones
      const w = Math.sin(e.age / 170 + e.phase) * 1.1;
      const burst = 1 + 0.5 * Math.max(0, Math.sin(e.age / 400 + e.phase * 2));
      vx = (nx - ny * w) * e.speed * burst;
      vy = (ny + nx * w) * e.speed * burst;
    } else if (e.kind === 'ghost') {
      const w = Math.sin(e.age / 600 + e.phase) * 0.6;
      vx = (nx - ny * w) * e.speed;
      vy = (ny + nx * w) * e.speed;
    } else if (e.kind === 'coco') {
      ({ vx, vy } = cocoMove(g, e, dt, nx, ny, rand, ev));
    }
    e.x += (vx + e.kx) * s;
    e.y += (vy + e.ky) * s;
    e.kx *= damp;
    e.ky *= damp;
    if (Math.abs(vx) > 4) e.left = vx < 0;
    // No se meten dentro del alcalde: se quedan pegados alrededor
    const min = PLAYER_R + e.r * 0.7;
    const ex = e.x - g.x;
    const ey = e.y - g.y;
    const d2 = ex * ex + ey * ey;
    if (d2 < min * min && d2 > 0.0001 && e.kind !== 'ghost') {
      const k = min / Math.sqrt(d2);
      e.x = g.x + ex * k;
      e.y = g.y + ey * k;
    }
  }
}

/** El Coco: anda hacia ti, se para y avisa con una línea, y embiste. Cada dos embestidas llama murciélagos. */
function cocoMove(g: NightGame, e: Enemy, dt: number, nx: number, ny: number, rand: Rand, ev: NightEvents): { vx: number; vy: number } {
  e.modeT += dt;
  if (e.mode === 0) {
    if (e.modeT > 3800 && e.age > 2500) {
      e.mode = 1;
      e.modeT = 0;
      e.ax = nx;
      e.ay = ny;
      ev.bossWarn = true;
    }
    return { vx: nx * e.speed, vy: ny * e.speed };
  }
  if (e.mode === 1) {
    // Sigue apuntando hasta 300 ms antes de lanzarse (así se puede esquivar)
    if (e.modeT < 650) {
      e.ax = nx;
      e.ay = ny;
    }
    if (e.modeT > 950) {
      e.mode = 2;
      e.modeT = 0;
      ev.bossCharge = true;
    }
    return { vx: 0, vy: 0 };
  }
  if (e.modeT > 650) {
    e.mode = 0;
    e.modeT = 0;
    e.cycles++;
    if (e.cycles % 2 === 0) {
      ev.bossSummon = true;
      const room = Math.min(8, HARD_MAX - g.enemies.length);
      for (let i = 0; i < room; i++) {
        const a = (i / 8) * Math.PI * 2;
        makeEnemy(g, 'bat', e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40, rand);
      }
    }
  }
  return { vx: e.ax * 300, vy: e.ay * 300 };
}

/** Empujón suave entre bichos para que no se apelotonen en un solo punto (media horda en cada paso). */
function separate(g: NightGame) {
  const list = g.enemies;
  const grid = g.grid;
  const half = g.steps & 1;
  for (let i = half; i < list.length; i += 2) {
    const e = list[i];
    if (e.dead || e.kind === 'ghost' || e.kind === 'coco') continue;
    const n = grid.query(e.x, e.y, e.r + 16);
    let px = 0;
    let py = 0;
    for (let k = 0; k < n; k++) {
      const j = grid.out[k];
      if (j === i) continue;
      const o = list[j];
      if (o.kind === 'ghost' || o.dead) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const min = (e.r + o.r) * 0.85;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 < 0.01) {
        px += ((i * 7) % 3) - 1;
        py += ((i * 13) % 3) - 1;
        continue;
      }
      const d = Math.sqrt(d2);
      // Los grandes empujan más de lo que les empujan
      const w = o.r / (e.r + o.r);
      px += (dx / d) * (min - d) * w;
      py += (dy / d) * (min - d) * w;
    }
    e.x += px * 0.9;
    e.y += py * 0.9;
  }
}

// ---------------------------------------------------------------------------------------------
// Armas
// ---------------------------------------------------------------------------------------------

/** Los `k` bichos más cercanos dentro de `maxR` (sin repetir). */
function nearestK(g: NightGame, k: number, maxR: number): Enemy[] {
  const out: Enemy[] = [];
  const ds: number[] = [];
  const max2 = maxR * maxR;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const dx = e.x - g.x;
    const dy = e.y - g.y;
    const d = dx * dx + dy * dy;
    if (d > max2) continue;
    if (out.length < k || d < ds[ds.length - 1]) {
      let i = out.length < k ? out.length : out.length - 1;
      if (out.length < k) {
        out.push(e);
        ds.push(d);
      }
      while (i > 0 && ds[i - 1] > d) {
        out[i] = out[i - 1];
        ds[i] = ds[i - 1];
        i--;
      }
      out[i] = e;
      ds[i] = d;
    }
  }
  return out;
}

/** Un bicho al azar que se vea en pantalla (para petardos y agua). */
function randomVisible(g: NightGame, rand: Rand, reach: number): Enemy | null {
  const n = g.enemies.length;
  if (!n) return null;
  for (let i = 0; i < 8; i++) {
    const e = g.enemies[Math.floor(rand() * n)];
    if (!e.dead && Math.abs(e.x - g.x) < Math.min(reach, g.halfW - 10) && Math.abs(e.y - g.y) < Math.min(reach, g.halfH - 10)) return e;
  }
  return null;
}

function fireWeapons(g: NightGame, dt: number, rand: Rand, ev: NightEvents) {
  const mul = dmgMul(g);
  const cdm = cdMul(g);
  const grid = g.grid;

  // Farol: rayos a los más cercanos
  const lvF = wl(g, 'farol');
  if (lvF > 0) {
    g.cd.farol -= dt;
    if (g.cd.farol <= 0) {
      const n = ws('farol', 'n', lvF);
      const targets = nearestK(g, n, 260);
      if (targets.length) {
        g.cd.farol = ws('farol', 'cd', lvF) * cdm;
        for (let i = 0; i < n; i++) {
          const t = targets[i % targets.length];
          // Si hay menos bichos que rayos, los que sobran salen un poco abiertos
          const a = Math.atan2(t.y - g.y, t.x - g.x) + (i >= targets.length ? (i % 2 ? 0.25 : -0.25) : 0);
          g.bolts.push({ x: g.x, y: g.y - 6, vx: Math.cos(a) * 290, vy: Math.sin(a) * 290, dmg: ws('farol', 'dmg', lvF) * mul, pierce: ws('farol', 'r', lvF), life: 1100, hits: [] });
        }
        ev.bolts++;
      } else g.cd.farol = 0;
    }
  }

  // Escoba: gira siempre; cada bicho recibe como mucho un golpe cada 450 ms
  const lvE = wl(g, 'escoba');
  if (lvE > 0) {
    const n = ws('escoba', 'n', lvE);
    const R = ws('escoba', 'r', lvE);
    g.orbit += (dt / 1000) * (3.2 + 0.25 * lvE);
    const dmg = ws('escoba', 'dmg', lvE) * mul;
    for (let b = 0; b < n; b++) {
      const a = g.orbit + (b / n) * Math.PI * 2;
      const bx = g.x + Math.cos(a) * R;
      const by = g.y + Math.sin(a) * R;
      const m = grid.query(bx, by, 10 + MAX_R);
      for (let k = 0; k < m; k++) {
        const e = g.enemies[grid.out[k]];
        if (e.dead || e.broomCd > 0) continue;
        const rr = e.r + 10;
        if ((e.x - bx) ** 2 + (e.y - by) ** 2 > rr * rr) continue;
        e.broomCd = 450;
        strike(g, e, dmg, g.x, g.y, 130, rand, ev);
      }
    }
  }

  // Campana: onda alrededor
  const lvC = wl(g, 'campana');
  if (lvC > 0) {
    g.cd.campana -= dt;
    if (g.cd.campana <= 0) {
      g.cd.campana = ws('campana', 'cd', lvC) * cdm;
      const R = ws('campana', 'r', lvC);
      const dmg = ws('campana', 'dmg', lvC) * mul;
      ev.pulses.push({ x: g.x, y: g.y, r: R });
      const m = grid.query(g.x, g.y, R + MAX_R);
      for (let k = 0; k < m; k++) {
        const e = g.enemies[grid.out[k]];
        const rr = R + e.r;
        if (!e.dead && (e.x - g.x) ** 2 + (e.y - g.y) ** 2 <= rr * rr) strike(g, e, dmg, g.x, g.y, 170, rand, ev);
      }
    }
  }

  // Petardos: caen junto a bichos que se ven
  const lvP = wl(g, 'petardos');
  if (lvP > 0) {
    g.cd.petardos -= dt;
    if (g.cd.petardos <= 0) {
      const tgt = randomVisible(g, rand, 220);
      if (tgt) {
        g.cd.petardos = ws('petardos', 'cd', lvP) * cdm;
        const n = ws('petardos', 'n', lvP);
        for (let i = 0; i < n; i++) {
          const t = i === 0 ? tgt : (randomVisible(g, rand, 220) ?? tgt);
          const jx = (rand() - 0.5) * 18;
          const jy = (rand() - 0.5) * 18;
          g.throws.push({ kind: 'petardo', sx: g.x, sy: g.y - 8, x: t.x + jx, y: t.y + jy, t: -i * 90, dur: 520, r: ws('petardos', 'r', lvP), dmg: ws('petardos', 'dmg', lvP) * mul });
        }
      } else g.cd.petardos = 200;
    }
  }

  // Agua bendita: frascos que dejan charcos
  const lvA = wl(g, 'agua');
  if (lvA > 0) {
    g.cd.agua -= dt;
    if (g.cd.agua <= 0) {
      g.cd.agua = ws('agua', 'cd', lvA) * cdm;
      const n = ws('agua', 'n', lvA);
      for (let i = 0; i < n; i++) {
        const t = randomVisible(g, rand, 150);
        const a = rand() * Math.PI * 2;
        const x = t ? t.x : g.x + g.faceX * 50 + Math.cos(a) * 20;
        const y = t ? t.y : g.y + g.faceY * 50 + Math.sin(a) * 20;
        g.throws.push({ kind: 'agua', sx: g.x, sy: g.y - 8, x, y, t: -i * 120, dur: 420, r: ws('agua', 'r', lvA), dmg: ws('agua', 'dmg', lvA) * mul });
      }
    }
  }

  // Silbato: abanico hacia el bicho más cercano (o hacia donde vas)
  const lvS = wl(g, 'silbato');
  if (lvS > 0) {
    g.cd.silbato -= dt;
    if (g.cd.silbato <= 0) {
      const range = ws('silbato', 'r', lvS);
      const near = nearestK(g, 1, range * 1.4)[0];
      if (near || g.moving) {
        g.cd.silbato = ws('silbato', 'cd', lvS) * cdm;
        const dir = near ? norm(near.x - g.x, near.y - g.y) : { x: g.faceX, y: g.faceY };
        const spread = WHISTLE_SPREAD[lvS - 1];
        const cos = Math.cos(spread);
        const dmg = ws('silbato', 'dmg', lvS) * mul;
        ev.whistles.push({ x: g.x, y: g.y, a: Math.atan2(dir.y, dir.x), range, spread });
        const m = grid.query(g.x, g.y, range + MAX_R);
        for (let k = 0; k < m; k++) {
          const e = g.enemies[grid.out[k]];
          if (e.dead) continue;
          const dx = e.x - g.x;
          const dy = e.y - g.y;
          const d = Math.hypot(dx, dy);
          if (d > range + e.r) continue;
          if (d > e.r && (dx * dir.x + dy * dir.y) / d < cos) continue;
          strike(g, e, dmg, g.x, g.y, 300, rand, ev);
        }
      } else g.cd.silbato = 150;
    }
  }
}

function moveShots(g: NightGame, dt: number, rand: Rand, ev: NightEvents) {
  const s = dt / 1000;
  const grid = g.grid;
  for (const b of g.bolts) {
    b.life -= dt;
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (b.life <= 0) continue;
    const m = grid.query(b.x, b.y, 4 + MAX_R);
    for (let k = 0; k < m; k++) {
      const e = g.enemies[grid.out[k]];
      if (e.dead || b.hits.includes(e.id)) continue;
      const rr = e.r + 4;
      if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > rr * rr) continue;
      b.hits.push(e.id);
      strike(g, e, b.dmg, b.x - b.vx * 0.05, b.y - b.vy * 0.05, 60, rand, ev);
      if (b.pierce-- <= 0) {
        b.life = 0;
        break;
      }
    }
  }
  compact(g.bolts, (b) => b.life > 0);

  for (const th of g.throws) {
    th.t += dt;
    if (th.t < th.dur) continue;
    if (th.kind === 'petardo') {
      ev.booms.push({ x: th.x, y: th.y, r: th.r });
      const m = grid.query(th.x, th.y, th.r + MAX_R);
      for (let k = 0; k < m; k++) {
        const e = g.enemies[grid.out[k]];
        const rr = th.r + e.r;
        if (!e.dead && (e.x - th.x) ** 2 + (e.y - th.y) ** 2 <= rr * rr) strike(g, e, th.dmg, th.x, th.y, 140, rand, ev);
      }
    } else {
      const lv = Math.max(1, wl(g, 'agua'));
      const life = PUDDLE_LIFE[lv - 1];
      ev.splashes.push({ x: th.x, y: th.y, r: th.r });
      g.puddles.push({ x: th.x, y: th.y, r: th.r, life, max: life, tick: 0, dmg: th.dmg });
    }
  }
  compact(g.throws, (th) => th.t < th.dur);

  for (const p of g.puddles) {
    p.life -= dt;
    p.tick -= dt;
    if (p.tick > 0) continue;
    p.tick = 300;
    const m = grid.query(p.x, p.y, p.r + MAX_R);
    for (let k = 0; k < m; k++) {
      const e = g.enemies[grid.out[k]];
      const rr = p.r + e.r * 0.6;
      if (!e.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) strike(g, e, p.dmg, p.x, p.y, 0, rand, ev);
    }
  }
  compact(g.puddles, (p) => p.life > 0);
}

/** Quita en el sitio (sin crear otro array) los que no cumplen `keep`. */
function compact<T>(list: T[], keep: (x: T) => boolean) {
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (keep(x)) list[j++] = x;
  }
  list.length = j;
}

// ---------------------------------------------------------------------------------------------
// Recoger
// ---------------------------------------------------------------------------------------------

function gainXp(g: NightGame, v: number, ev: NightEvents) {
  g.xp += v;
  ev.xp += v;
  while (g.xp >= xpNeed(g.lv)) {
    g.xp -= xpNeed(g.lv);
    g.lv++;
    g.pending++;
    ev.levelUp = true;
  }
}

function pickups(g: NightGame, dt: number, ev: NightEvents) {
  const s = dt / 1000;
  const mr = magnetR(g);
  const mr2 = mr * mr;
  const grab = PLAYER_R + 6;
  for (const gem of g.gems) {
    const dx = g.x - gem.x;
    const dy = g.y - gem.y;
    const d2 = dx * dx + dy * dy;
    if (!gem.pulled && d2 < mr2) {
      gem.pulled = true;
      gem.sp = -70;
    }
    if (!gem.pulled) continue;
    const d = Math.sqrt(d2);
    if (d < grab) {
      gem.got = true;
      gainXp(g, gem.v, ev);
      continue;
    }
    gem.sp = Math.min(420, gem.sp + 900 * s);
    const step = Math.min(d, gem.sp * s);
    gem.x += (dx / d) * step;
    gem.y += (dy / d) * step;
  }
  compact(g.gems, (x) => !x.got);

  for (const it of g.items) {
    it.age += dt;
    const dx = g.x - it.x;
    const dy = g.y - it.y;
    if (dx * dx + dy * dy > (grab + 6) ** 2) continue;
    it.got = true;
    if (it.kind === 'food') {
      g.hp = Math.min(maxHp(g), g.hp + 30);
      ev.food = true;
    } else {
      for (const gem of g.gems) if (!gem.pulled) {
        gem.pulled = true;
        gem.sp = -40;
      }
      ev.magnet = true;
    }
  }
  compact(g.items, (x) => !x.got);
}

// ---------------------------------------------------------------------------------------------
// Paso
// ---------------------------------------------------------------------------------------------

/** Avanza la partida `dt` ms. `mv` es la dirección del joystick o teclado (fuerza 0..1). */
export function step(g: NightGame, dt: number, mv: Vec, rand: Rand): NightEvents {
  const ev = emptyEvents();
  if (g.phase !== 'play') return ev;
  const s = dt / 1000;
  g.t += dt;
  g.steps++;
  if (g.hurtCd > 0) g.hurtCd -= dt;

  // Alcalde
  const m = Math.hypot(mv.x, mv.y);
  if (m > 0.05) {
    const k = m > 1 ? 1 / m : 1;
    const sp = speed(g) * s;
    g.x += mv.x * k * sp;
    g.y += mv.y * k * sp;
    g.faceX = mv.x / m;
    g.faceY = mv.y / m;
    if (Math.abs(mv.x) > 0.1) g.left = mv.x < 0;
    g.moving = true;
  } else g.moving = false;

  runTimeline(g, rand, ev);
  spawnTick(g, dt, rand);
  moveEnemies(g, dt, rand, ev);
  g.grid.build(g.enemies, g.x, g.y);
  separate(g);
  fireWeapons(g, dt, rand, ev);
  moveShots(g, dt, rand, ev);

  // Mordiscos: el bicho que te toca quita su daño (con un respiro corto entre golpes)
  if (g.hurtCd <= 0) {
    const n = g.grid.query(g.x, g.y, PLAYER_R + MAX_R);
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const e = g.enemies[g.grid.out[k]];
      if (e.dead) continue;
      const rr = PLAYER_R + e.r * 0.85;
      if ((e.x - g.x) ** 2 + (e.y - g.y) ** 2 > rr * rr) continue;
      // El Coco embistiendo duele más
      const dmg = e.kind === 'coco' && e.mode === 2 ? e.dmg * 1.5 : e.dmg;
      if (dmg > worst) worst = dmg;
    }
    if (worst > 0) {
      g.hp -= worst;
      g.hurtCd = HURT_CD;
      ev.hurt = worst;
    }
  }
  compact(g.enemies, (e) => !e.dead);

  pickups(g, dt, ev);

  if (g.hp <= 0) {
    g.hp = 0;
    g.phase = 'over';
    ev.lost = true;
  } else if (g.t >= RUN_MS) {
    // Amanece: los bichos se deshacen con la luz
    g.t = RUN_MS;
    g.won = true;
    g.bonus += DAWN_BONUS;
    g.phase = 'over';
    ev.dawn = true;
    for (const e of g.enemies) if (ev.burn.length < 80) ev.burn.push({ x: e.x, y: e.y, kind: e.kind });
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.throws.length = 0;
  }
  updateScore(g);
  return ev;
}
