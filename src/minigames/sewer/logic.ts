// "Alcantarillas" (roguelite de salas, como Archero): bajas a las alcantarillas de la ciudad y vas
// limpiando salas. Te mueves con el joystick y, cuando te quedas quieto, disparas solo al enemigo más
// cercano. Al limpiar una sala se abre la puerta de arriba y eliges un hallazgo; cada 5 salas hay un
// jefe. Los enemigos sueltan chatarra (🔩), que se guarda aunque pierdas y se gasta en el taller.

import { clamp, levelOf, levelUp, norm, pickOne, rollUpgrades, weighted, type Levels, type Rand, type UpgradeDef, type Vec } from '../shooter/kit';
import type { SewerLevels } from './meta';

export const FIELD_W = 360;
export const FIELD_H = 622;
/** La sala es una rejilla de 18 × 30 casillas: las cajas encajan en ella y los enemigos la usan para rodearlas. */
export const CELL = 18;
export const COLS = 18;
export const ROWS = 30;
export const RX0 = 18;
export const RY0 = 64;
export const RX1 = RX0 + COLS * CELL;
export const RY1 = RY0 + ROWS * CELL;
/** Puerta de arriba (salida) y hueco de abajo (entrada). */
export const DOOR_X0 = FIELD_W / 2 - 28;
export const DOOR_X1 = FIELD_W / 2 + 28;
export const PLAYER_R = 8;
/** Hueco para recibir golpes (algo menor que el dibujo: así es justo esquivar). */
export const HURT_R = 6;
export const BASE_HP = 3;
export const BASE_SPEED = 125;
export const BASE_DMG = 10;
export const FIRE_MS = 400;
export const SHOT_SPEED = 330;
export const SHOT_R = 3.5;
export const INV_MS = 1100;
export const REVIVE_INV_MS = 2600;
export const BOSS_EVERY = 5;
/** Desde que cae el último enemigo hasta elegir hallazgo (la chatarra vuela hacia ti). */
export const CLEAR_MS = 900;
export const TRANS_MS = 760;
export const EMERGE_MS = 700;
/** Quieto tanto tiempo antes de disparar (evita disparos con el temblor del dedo). */
export const STILL_MS = 70;
export const MAGNET_R = 34;
export const ORBIT_R = 30;
export const SWEEP_R = 82;
export const MAX_SCORE = 4999;

export type EnemyKind = 'rat' | 'bat' | 'slug' | 'croc' | 'shroom' | 'king' | 'gator';
export type HallazgoId = 'double' | 'fan' | 'bounce' | 'pierce' | 'fire' | 'ice' | 'rate' | 'dmg' | 'hpmax' | 'heal' | 'orbit' | 'speed';
type AiState = 'move' | 'warn' | 'dash' | 'stun' | 'cast';
type Cast = '' | 'summon' | 'sweep' | 'spit';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomMap {
  n: number;
  boss: EnemyKind | null;
  crates: Rect[];
  /** Canales de agua: frenan a quien camina por ellos. */
  water: Rect[];
  puddles: { x: number; y: number; rx: number; ry: number }[];
  /** Rejillas del suelo (decoración y por donde salen las ratas del rey). */
  grates: Vec[];
  /** Casillas ocupadas por cajas. */
  blocked: Uint8Array;
  seed: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  r: number;
  hp: number;
  max: number;
  /** Velocidad de este paso (para orientar el dibujo) y empujón al recibir un impacto. */
  vx: number;
  vy: number;
  kx: number;
  ky: number;
  face: number;
  age: number;
  /** >0: aún está saliendo del agua (ni se mueve, ni hace daño, ni se le puede dar). */
  emerge: number;
  flash: number;
  burn: number;
  burnDps: number;
  burnTick: number;
  slow: number;
  slowK: number;
  state: AiState;
  st: number;
  stMax: number;
  /** Dirección fijada para la embestida. */
  dx: number;
  dy: number;
  cool: number;
  /** Murciélago: rumbo actual y cuándo cambia. */
  wx: number;
  wy: number;
  wt: number;
  pattern: number;
  cast: Cast;
  orbT: number;
  trail: number;
  dead: boolean;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: number;
  bounce: number;
  hitIds: number[];
  life: number;
  gone: boolean;
}

export interface Spore {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  gone: boolean;
}

export interface Pickup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'scrap' | 'heart';
  value: number;
  pulled: boolean;
  got: boolean;
}

export interface Slime {
  x: number;
  y: number;
  r: number;
  life: number;
}

export interface SewerGame {
  t: number;
  phase: 'play' | 'choice' | 'over';
  meta: SewerLevels;
  x: number;
  y: number;
  /** Empujón al recibir un golpe. */
  kx: number;
  ky: number;
  /** Última dirección de movimiento (para el dibujo). */
  mx: number;
  my: number;
  moving: boolean;
  hp: number;
  inv: number;
  reviveLeft: boolean;
  revived: boolean;
  lv: Levels<HallazgoId>;
  /** Sala limpia (la chatarra vuela hacia ti); `open`: además ya elegiste hallazgo y puedes salir. */
  done: boolean;
  /** Hallazgo con el que empezaste gracias a la mochila. */
  packed: HallazgoId | null;
  score: number;
  kills: number;
  bosses: number;
  room: number;
  cleared: number;
  scrap: number;
  map: RoomMap;
  enemies: Enemy[];
  /** Enemigos que salen cuando quedan pocos (salas grandes). */
  reserve: EnemyKind[];
  shots: Shot[];
  spores: Spore[];
  pickups: Pickup[];
  slime: Slime[];
  open: boolean;
  openT: number;
  clearT: number;
  /** >0: cruzando la puerta hacia la sala siguiente. */
  trans: number;
  transHalf: boolean;
  gunT: number;
  stillT: number;
  /** Enemigo al que apuntas (0: ninguno) y si ahora mismo estás disparando. */
  target: number;
  firing: boolean;
  aimX: number;
  aimY: number;
  offer: UpgradeDef<HallazgoId>[];
  orbA: number;
  flow: Int16Array;
  flowQ: Int16Array;
  flowCell: number;
  flowT: number;
  nextId: number;
}

export interface KillPop {
  x: number;
  y: number;
  kind: EnemyKind;
  pts: number;
}

export interface SewerEvents {
  kills: KillPop[];
  /** Impactos propios que no mataron. */
  hits: { x: number; y: number; burn: boolean; ice: boolean }[];
  /** Balas que chocan con paredes o cajas (propias y esporas). */
  puffs: { x: number; y: number; mine: boolean }[];
  emerged: { x: number; y: number; kind: EnemyKind }[];
  shots: number;
  spores: number;
  hurt: boolean;
  revive: boolean;
  scrap: number;
  heal: number;
  roomClear: boolean;
  choice: boolean;
  door: boolean;
  roomStart: number;
  bossIn: EnemyKind | null;
  /** Aviso de embestida, barrido o invocación. */
  warn: boolean;
  /** Una embestida chocó contra la pared. */
  slams: { x: number; y: number; big: boolean }[];
  sweep: { x: number; y: number } | null;
  summon: { x: number; y: number }[];
  bossDown: boolean;
  lost: boolean;
}

function newEvents(): SewerEvents {
  return {
    kills: [],
    hits: [],
    puffs: [],
    emerged: [],
    shots: 0,
    spores: 0,
    hurt: false,
    revive: false,
    scrap: 0,
    heal: 0,
    roomClear: false,
    choice: false,
    door: false,
    roomStart: 0,
    bossIn: null,
    warn: false,
    slams: [],
    sweep: null,
    summon: [],
    bossDown: false,
    lost: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------

export const STATS: Record<EnemyKind, { hp: number; r: number; speed: number; scrap: number; cost: number; name: string }> = {
  rat: { hp: 20, r: 8, speed: 74, scrap: 1, cost: 1, name: 'Rata' },
  bat: { hp: 14, r: 8, speed: 90, scrap: 1, cost: 1, name: 'Murciélago' },
  slug: { hp: 46, r: 11, speed: 24, scrap: 2, cost: 2, name: 'Babosa' },
  croc: { hp: 58, r: 12, speed: 34, scrap: 3, cost: 3, name: 'Cocodrilo' },
  shroom: { hp: 34, r: 10, speed: 0, scrap: 2, cost: 2, name: 'Seta tóxica' },
  king: { hp: 620, r: 20, speed: 46, scrap: 20, cost: 0, name: 'Rey Rata' },
  gator: { hp: 940, r: 23, speed: 40, scrap: 25, cost: 0, name: 'Cocodrilo gigante' },
};

export const HALLAZGOS: UpgradeDef<HallazgoId>[] = [
  { id: 'double', emoji: '🔫', name: 'Disparo doble', max: 2, weapon: true, desc: (lv) => (lv === 1 ? 'Disparas dos balas a la vez' : 'Disparas tres balas a la vez') },
  { id: 'fan', emoji: '🔱', name: 'Abanico', max: 2, weapon: true, desc: (lv) => (lv === 1 ? '+2 balas en diagonal' : '+2 balas más, aún más abiertas') },
  { id: 'bounce', emoji: '🔁', name: 'Rebote en paredes', max: 2, desc: (lv) => (lv === 1 ? 'Las balas rebotan una vez en paredes y cajas' : 'Las balas rebotan dos veces') },
  { id: 'pierce', emoji: '🗡️', name: 'Perforante', max: 2, desc: (lv) => (lv === 1 ? 'Cada bala atraviesa a un enemigo' : 'Cada bala atraviesa a dos enemigos') },
  { id: 'fire', emoji: '🔥', name: 'Fuego', max: 2, desc: (lv) => (lv === 1 ? 'Quemas: daño extra durante 2 s' : 'Quemas el doble de fuerte') },
  { id: 'ice', emoji: '❄️', name: 'Hielo', max: 2, desc: (lv) => (lv === 1 ? 'Los enemigos que tocas van a medio gas' : 'Los congelas aún más y durante más rato') },
  { id: 'rate', emoji: '⚡', name: 'Cadencia+', max: 4, desc: () => 'Disparas un 20 % más rápido' },
  { id: 'dmg', emoji: '💥', name: 'Daño+', max: 5, desc: () => '+25 % de daño en cada bala' },
  { id: 'hpmax', emoji: '💖', name: 'Vida máx + cura', max: 3, desc: () => '+1 corazón máximo y te curas 1' },
  // Se puede coger siempre que te falte vida: su nivel no se guarda
  { id: 'heal', emoji: '🩹', name: 'Curación', max: 1, weight: 1.4, desc: () => 'Recuperas 2 corazones' },
  { id: 'orbit', emoji: '🔵', name: 'Escudo orbital', max: 3, desc: (lv) => (lv === 1 ? 'Una bola gira a tu alrededor: daña y para balas' : 'Una bola más girando a tu alrededor') },
  { id: 'speed', emoji: '💨', name: 'Velocidad', max: 3, desc: () => 'Te mueves un 12 % más rápido' },
];

export const isBossRoom = (n: number) => n % BOSS_EVERY === 0;

/** Qué jefe sale en una sala de jefe: se alternan, empezando por el Rey Rata. */
export function bossFor(n: number): EnemyKind | null {
  if (!isBossRoom(n)) return null;
  return (n / BOSS_EVERY) % 2 === 1 ? 'king' : 'gator';
}

export function maxHp(g: SewerGame): number {
  return BASE_HP + g.meta.hp + levelOf(g.lv, 'hpmax');
}

export function dmgOf(g: SewerGame): number {
  return BASE_DMG * (1 + 0.1 * g.meta.dmg) * (1 + 0.25 * levelOf(g.lv, 'dmg'));
}

export function speedOf(g: SewerGame): number {
  return BASE_SPEED * (1 + 0.06 * g.meta.speed) * (1 + 0.12 * levelOf(g.lv, 'speed'));
}

export function fireMs(g: SewerGame): number {
  return FIRE_MS / 1.2 ** levelOf(g.lv, 'rate');
}

export function choicesN(g: SewerGame): number {
  return g.meta.luck > 0 ? 4 : 3;
}

/** Vida de los enemigos según la profundidad (crece algo más que lineal: al final siempre caes). */
export function hpScale(n: number): number {
  return 1 + 0.15 * (n - 1) + 0.02 * (n - 1) ** 2;
}

export function spdScale(n: number): number {
  return Math.min(1.7, 1 + 0.025 * (n - 1));
}

/** Puntos: 10 por sala limpia, 1 por baja y 50 por jefe. */
export function scoreOf(g: SewerGame): number {
  return Math.min(MAX_SCORE, 10 * g.cleared + g.kills + 50 * g.bosses);
}

// ---------------------------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------------------------

/** Saca un círculo de una caja. Devuelve si la tocaba. */
function pushOut(o: { x: number; y: number }, r: number, b: Rect): boolean {
  const cx = clamp(o.x, b.x, b.x + b.w);
  const cy = clamp(o.y, b.y, b.y + b.h);
  const dx = o.x - cx;
  const dy = o.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    o.x = cx + (dx / d) * r;
    o.y = cy + (dy / d) * r;
    return true;
  }
  // El centro quedó dentro: sale por el lado más cercano
  const l = o.x - b.x;
  const rr = b.x + b.w - o.x;
  const t = o.y - b.y;
  const bt = b.y + b.h - o.y;
  const m = Math.min(l, rr, t, bt);
  if (m === l) o.x = b.x - r;
  else if (m === rr) o.x = b.x + b.w + r;
  else if (m === t) o.y = b.y - r;
  else o.y = b.y + b.h + r;
  return true;
}

function inRect(x: number, y: number, b: Rect): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** El segmento cruza la caja (ampliada `pad`). */
function segHits(x1: number, y1: number, x2: number, y2: number, b: Rect, pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x1 - (b.x - pad)) && clip(dx, b.x + b.w + pad - x1) && clip(-dy, y1 - (b.y - pad)) && clip(dy, b.y + b.h + pad - y1);
}

/** No hay cajas entre los dos puntos. */
export function clearLine(g: SewerGame, x1: number, y1: number, x2: number, y2: number, pad = 0): boolean {
  for (const b of g.map.crates) if (segHits(x1, y1, x2, y2, b, pad)) return false;
  return true;
}

function cellOf(x: number, y: number): number {
  const c = clamp(Math.floor((x - RX0) / CELL), 0, COLS - 1);
  const r = clamp(Math.floor((y - RY0) / CELL), 0, ROWS - 1);
  return r * COLS + c;
}

function inWater(g: SewerGame, x: number, y: number): boolean {
  for (const w of g.map.water) if (inRect(x, y, w)) return true;
  return false;
}

/**
 * Mueve un cuerpo redondo chocando con las cajas (si `solid`) y las paredes. Devuelve si chocó con algo
 * (las embestidas se paran al chocar).
 */
function moveBody(g: SewerGame, o: { x: number; y: number }, dx: number, dy: number, r: number, solid: boolean): boolean {
  let bump = false;
  o.x += dx;
  o.y += dy;
  if (solid) for (const b of g.map.crates) if (pushOut(o, r, b)) bump = true;
  if (o.x < RX0 + r) {
    o.x = RX0 + r;
    bump = true;
  } else if (o.x > RX1 - r) {
    o.x = RX1 - r;
    bump = true;
  }
  if (o.y < RY0 + r) {
    o.y = RY0 + r;
    bump = true;
  } else if (o.y > RY1 - r) {
    o.y = RY1 - r;
    bump = true;
  }
  return bump;
}

// Mapa de distancias hasta ti (búsqueda en anchura por la rejilla): los enemigos de a pie lo siguen
// para rodear las cajas en vez de quedarse atascados detrás.
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function buildFlow(g: SewerGame) {
  const d = g.flow;
  const q = g.flowQ;
  const blocked = g.map.blocked;
  d.fill(-1);
  const start = cellOf(g.x, g.y);
  let head = 0;
  let tail = 0;
  d[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const c = i % COLS;
    const r = (i - c) / COLS;
    for (const [ox, oy] of DIRS) {
      const nc = c + ox;
      const nr = r + oy;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (blocked[ni] || d[ni] >= 0) continue;
      // En diagonal solo si no se roza ninguna esquina
      if (ox && oy && (blocked[r * COLS + nc] || blocked[nr * COLS + c])) continue;
      d[ni] = d[i] + 1;
      q[tail++] = ni;
    }
  }
  g.flowCell = start;
}

/** Hacia dónde ir para llegar hasta ti: en línea recta si se ve, o por el camino más corto. */
function steer(g: SewerGame, e: Enemy): Vec {
  if (clearLine(g, e.x, e.y, g.x, g.y, e.r * 0.8)) return norm(g.x - e.x, g.y - e.y);
  const i = cellOf(e.x, e.y);
  const c = i % COLS;
  const r = (i - c) / COLS;
  const d = g.flow;
  let best = d[i] >= 0 ? d[i] : 32000;
  let bi = -1;
  for (const [ox, oy] of DIRS) {
    const nc = c + ox;
    const nr = r + oy;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
    const ni = nr * COLS + nc;
    if (d[ni] < 0 || d[ni] >= best) continue;
    if (ox && oy && (g.map.blocked[r * COLS + nc] || g.map.blocked[nr * COLS + c])) continue;
    best = d[ni];
    bi = ni;
  }
  if (bi < 0) return norm(g.x - e.x, g.y - e.y);
  const bc = bi % COLS;
  return norm(RX0 + (bc + 0.5) * CELL - e.x, RY0 + ((bi - bc) / COLS + 0.5) * CELL - e.y);
}

// ---------------------------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------------------------

type Cells = [number, number, number, number][];

/** Distribuciones de cajas en casillas [col, fila, ancho, alto]. Arriba (puerta) y abajo (entrada) quedan libres. */
const TEMPLATES: Cells[] = [
  // Cuatro pilares
  [
    [3, 7, 2, 2],
    [13, 7, 2, 2],
    [3, 17, 2, 2],
    [13, 17, 2, 2],
  ],
  // Muro partido
  [
    [0, 12, 5, 1],
    [13, 12, 5, 1],
    [8, 19, 2, 2],
  ],
  // Escalera en diagonal
  [
    [3, 5, 2, 2],
    [7, 10, 2, 2],
    [11, 15, 2, 2],
    [14, 20, 2, 1],
  ],
  // Almacén con cajas sueltas
  [
    [2, 6, 2, 1],
    [14, 6, 2, 1],
    [6, 13, 1, 2],
    [11, 13, 1, 2],
    [8, 20, 2, 1],
  ],
  // Pasillo central
  [
    [4, 6, 1, 5],
    [13, 6, 1, 5],
    [4, 16, 1, 5],
    [13, 16, 1, 5],
  ],
  // Cruz
  [
    [6, 13, 6, 1],
    [8, 9, 2, 3],
    [8, 15, 2, 2],
  ],
  // Rincones
  [
    [0, 4, 2, 2],
    [16, 4, 2, 2],
    [0, 20, 2, 2],
    [16, 20, 2, 2],
    [8, 12, 2, 2],
  ],
];

/** Sala de jefe: cuatro pilares contra los que estrellar sus embestidas. */
const BOSS_CELLS: Cells = [
  [3, 7, 2, 2],
  [13, 7, 2, 2],
  [3, 19, 2, 2],
  [13, 19, 2, 2],
];

export function genRoom(n: number, rand: Rand): RoomMap {
  const boss = bossFor(n);
  // La primera sala siempre es la sencilla; después, cualquiera de las otras
  const cells = boss ? BOSS_CELLS : n === 1 ? TEMPLATES[0] : pickOne(rand, TEMPLATES.slice(1));
  const mirror = rand() < 0.5;
  const blocked = new Uint8Array(COLS * ROWS);
  const crates: Rect[] = cells.map(([c0, r, w, h]) => {
    const c = mirror ? COLS - c0 - w : c0;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked[y * COLS + x] = 1;
    return { x: RX0 + c * CELL, y: RY0 + r * CELL, w: w * CELL, h: h * CELL };
  });
  // Un canal de agua cruzando la sala (frena), si cabe sin pisar cajas
  const water: Rect[] = [];
  if (!boss && n >= 2 && rand() < 0.45) {
    for (const row of [22, 9, 15]) {
      let free = true;
      for (let x = 0; x < COLS && free; x++) if (blocked[row * COLS + x] || blocked[(row + 1) * COLS + x]) free = false;
      if (free) {
        water.push({ x: RX0, y: RY0 + row * CELL, w: COLS * CELL, h: CELL * 2 });
        break;
      }
    }
  }
  const puddles: RoomMap['puddles'] = [];
  for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) {
    puddles.push({ x: RX0 + 20 + rand() * (COLS * CELL - 40), y: RY0 + 30 + rand() * (ROWS * CELL - 60), rx: 10 + rand() * 16, ry: 5 + rand() * 7 });
  }
  const grates: Vec[] = [
    { x: RX0 + CELL * 1.5, y: RY0 + CELL * 2.5 },
    { x: RX1 - CELL * 1.5, y: RY0 + CELL * 2.5 },
    { x: RX0 + CELL * 1.5, y: RY0 + CELL * 14.5 },
    { x: RX1 - CELL * 1.5, y: RY0 + CELL * 14.5 },
  ];
  return { n, boss, crates, water, puddles, grates, blocked, seed: Math.floor(rand() * 1e9) };
}

function makeEnemy(g: SewerGame, kind: EnemyKind, x: number, y: number): Enemy {
  const st = STATS[kind];
  const boss = kind === 'king' || kind === 'gator';
  const hp = boss ? Math.round(st.hp * 1.45 ** g.bosses) : Math.round(st.hp * hpScale(g.room));
  return {
    id: g.nextId++,
    kind,
    x,
    y,
    r: st.r,
    hp,
    max: hp,
    vx: 0,
    vy: 0,
    kx: 0,
    ky: 0,
    face: x < g.x ? 1 : -1,
    age: 0,
    emerge: EMERGE_MS,
    flash: 0,
    burn: 0,
    burnDps: 0,
    burnTick: 0,
    slow: 0,
    slowK: 1,
    state: 'move',
    st: boss ? 1200 : 0,
    stMax: 1,
    dx: 0,
    dy: 0,
    cool: kind === 'croc' ? 1400 : kind === 'shroom' ? 1100 : 0,
    wx: 0,
    wy: 1,
    wt: 0,
    pattern: 0,
    cast: '',
    orbT: 0,
    trail: 0,
    dead: false,
  };
}

/** Busca un sitio libre para un enemigo, lejos de ti. */
function placeFor(g: SewerGame, kind: EnemyKind, rand: Rand, minFromPlayer: number, topRows: number): Vec {
  const fly = kind === 'bat';
  for (let tries = 0; tries < 60; tries++) {
    const c = Math.floor(rand() * COLS);
    const r = 1 + Math.floor(rand() * topRows);
    if (!fly && g.map.blocked[r * COLS + c]) continue;
    const x = RX0 + (c + 0.5) * CELL;
    const y = RY0 + (r + 0.5) * CELL;
    if (kind === 'shroom' && inWater(g, x, y)) continue;
    if (Math.hypot(x - g.x, y - g.y) < minFromPlayer) continue;
    if (g.enemies.some((e) => Math.hypot(e.x - x, e.y - y) < 30)) continue;
    return { x, y };
  }
  return { x: FIELD_W / 2, y: RY0 + 60 };
}

function spawn(g: SewerGame, kind: EnemyKind, rand: Rand, delay: number, minFromPlayer: number) {
  const p = placeFor(g, kind, rand, minFromPlayer, kind === 'shroom' ? 16 : 19);
  const e = makeEnemy(g, kind, p.x, p.y);
  e.emerge = EMERGE_MS + delay;
  g.enemies.push(e);
}

/** Qué enemigos salen en una sala normal. */
export function roomEnemies(n: number, rand: Rand): EnemyKind[] {
  let budget = Math.min(22, 3 + Math.floor(n - 1));
  const pool: { k: EnemyKind; w: number }[] = [{ k: 'rat', w: 3 }];
  if (n >= 2) pool.push({ k: 'bat', w: 2 });
  if (n >= 3) pool.push({ k: 'slug', w: 1.4 }, { k: 'shroom', w: 1.2 });
  if (n >= 4) pool.push({ k: 'croc', w: 0.8 + n * 0.04 });
  const out: EnemyKind[] = [];
  let shrooms = 0;
  const maxShrooms = 1 + Math.floor(n / 6);
  while (budget > 0) {
    const ok = pool.filter((p) => STATS[p.k].cost <= budget && (p.k !== 'shroom' || shrooms < maxShrooms));
    if (!ok.length) break;
    const k = weighted(rand, ok, (p) => p.w).k;
    if (k === 'shroom') shrooms++;
    out.push(k);
    budget -= STATS[k].cost;
  }
  return out;
}

export function enterRoom(g: SewerGame, n: number, rand: Rand, ev: SewerEvents = newEvents()) {
  g.room = n;
  g.map = genRoom(n, rand);
  g.enemies = [];
  g.reserve = [];
  g.shots = [];
  g.spores = [];
  g.pickups = [];
  g.slime = [];
  g.done = false;
  g.open = false;
  g.openT = 0;
  g.clearT = 0;
  g.target = 0;
  g.firing = false;
  g.x = FIELD_W / 2;
  g.y = RY1 + 12;
  g.kx = 0;
  g.ky = 0;
  g.flowT = 0;
  ev.roomStart = n;
  const boss = g.map.boss;
  if (boss) {
    const e = makeEnemy(g, boss, FIELD_W / 2, RY0 + 150);
    e.emerge = 1400;
    g.enemies.push(e);
    ev.bossIn = boss;
    return;
  }
  const list = roomEnemies(n, rand);
  // Las salas grandes salen en dos tandas: la segunda cuando quedan pocos
  const first = list.slice(0, 8);
  g.reserve = list.slice(8);
  first.forEach((k, i) => spawn(g, k, rand, i * 90, 230));
}

export function newSewer(rand: Rand, meta: SewerLevels): SewerGame {
  const g: SewerGame = {
    t: 0,
    phase: 'play',
    meta: { ...meta },
    x: FIELD_W / 2,
    y: RY1 - 26,
    kx: 0,
    ky: 0,
    mx: 0,
    my: -1,
    moving: false,
    hp: 0,
    inv: 0,
    reviveLeft: meta.revive > 0,
    revived: false,
    lv: {},
    done: false,
    packed: null,
    score: 0,
    kills: 0,
    bosses: 0,
    room: 1,
    cleared: 0,
    scrap: 0,
    map: genRoom(1, rand),
    enemies: [],
    reserve: [],
    shots: [],
    spores: [],
    pickups: [],
    slime: [],
    open: false,
    openT: 0,
    clearT: 0,
    trans: 0,
    transHalf: false,
    gunT: 0,
    stillT: 0,
    target: 0,
    firing: false,
    aimX: 0,
    aimY: 0,
    offer: [],
    orbA: 0,
    flow: new Int16Array(COLS * ROWS),
    flowQ: new Int16Array(COLS * ROWS),
    flowCell: -1,
    flowT: 0,
    nextId: 1,
  };
  if (meta.pack > 0) {
    const d = pickOne(
      rand,
      HALLAZGOS.filter((h) => h.id !== 'heal' && h.id !== 'hpmax'),
    );
    levelUp(g.lv, d);
    g.packed = d.id;
  }
  g.hp = maxHp(g);
  enterRoom(g, 1, rand, newEvents());
  g.y = RY1 - 26;
  return g;
}

/** Para pruebas y para el jefe: un enemigo que ya está fuera (sin animación de salida). */
export function addEnemy(g: SewerGame, kind: EnemyKind, x: number, y: number): Enemy {
  const e = makeEnemy(g, kind, x, y);
  e.emerge = 0;
  g.enemies.push(e);
  return e;
}

export function boss(g: SewerGame): Enemy | undefined {
  return g.enemies.find((e) => (e.kind === 'king' || e.kind === 'gator') && !e.dead);
}

export function pickHallazgo(g: SewerGame, id: HallazgoId): boolean {
  if (g.phase !== 'choice') return false;
  const d = HALLAZGOS.find((h) => h.id === id);
  if (!d) return false;
  if (id === 'heal') g.hp = Math.min(maxHp(g), g.hp + 2);
  else {
    levelUp(g.lv, d);
    if (id === 'hpmax') g.hp = Math.min(maxHp(g), g.hp + 1);
  }
  g.offer = [];
  g.phase = 'play';
  g.open = true;
  g.openT = 0;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Paso
// ---------------------------------------------------------------------------------------------

function hurtPlayer(g: SewerGame, ev: SewerEvents, fromX: number, fromY: number) {
  if (g.inv > 0 || g.phase !== 'play' || g.trans > 0) return;
  g.hp--;
  g.inv = INV_MS;
  ev.hurt = true;
  const d = norm(g.x - fromX, g.y - fromY);
  g.kx = (d.x || 0) * 260;
  g.ky = (d.y || 1) * 260;
  if (g.hp > 0) return;
  if (g.reviveLeft) {
    // Segunda oportunidad: media vida, onda que aparta a todos y borra las esporas
    g.reviveLeft = false;
    g.revived = true;
    g.hp = Math.ceil(maxHp(g) / 2);
    g.inv = REVIVE_INV_MS;
    g.spores = [];
    for (const e of g.enemies) {
      if (e.kind === 'king' || e.kind === 'gator') continue;
      const k = norm(e.x - g.x, e.y - g.y);
      e.kx = k.x * 420;
      e.ky = k.y * 420;
    }
    ev.revive = true;
    return;
  }
  g.phase = 'over';
  g.shots = [];
  g.firing = false;
  ev.lost = true;
}

function drop(g: SewerGame, e: Enemy, rand: Rand) {
  const big = e.kind === 'king' || e.kind === 'gator';
  const total = big ? STATS[e.kind].scrap + 5 * (g.bosses - 1) : STATS[e.kind].scrap;
  const n = Math.min(total, big ? 10 : 3);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const v = 40 + rand() * (big ? 120 : 60);
    const value = Math.floor(total / n) + (i < total % n ? 1 : 0);
    g.pickups.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, kind: 'scrap', value, pulled: false, got: false });
  }
  if (big) g.pickups.push({ x: e.x, y: e.y, vx: 0, vy: 40, kind: 'heart', value: 1, pulled: false, got: false });
}

function kill(g: SewerGame, e: Enemy, rand: Rand, ev: SewerEvents) {
  if (e.dead) return;
  e.dead = true;
  const big = e.kind === 'king' || e.kind === 'gator';
  if (big) {
    g.bosses++;
    ev.bossDown = true;
  } else g.kills++;
  ev.kills.push({ x: e.x, y: e.y, kind: e.kind, pts: big ? 50 : 1 });
  drop(g, e, rand);
  if (big) {
    // Al caer el jefe huyen sus ratas y se deshacen las esporas
    g.spores = [];
    for (const o of g.enemies) if (o !== e && !o.dead) kill(g, o, rand, ev);
  }
}

function damage(g: SewerGame, e: Enemy, dmg: number, rand: Rand, ev: SewerEvents) {
  e.hp -= dmg;
  e.flash = 80;
  if (e.hp <= 0) kill(g, e, rand, ev);
}

function fire(g: SewerGame, tx: number, ty: number, ev: SewerEvents) {
  const d = norm(tx - g.x, ty - g.y);
  const base = Math.atan2(d.y, d.x);
  const dmg = dmgOf(g);
  const pierce = levelOf(g.lv, 'pierce');
  const bounce = levelOf(g.lv, 'bounce');
  const mk = (a: number, off: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.shots.push({
      x: g.x + c * 9 - s * off,
      y: g.y + s * 9 + c * off,
      vx: c * SHOT_SPEED,
      vy: s * SHOT_SPEED,
      dmg,
      pierce,
      bounce,
      hitIds: [],
      life: 1700,
      gone: false,
    });
  };
  const par = 1 + levelOf(g.lv, 'double');
  for (let i = 0; i < par; i++) mk(base, (i - (par - 1) / 2) * 6);
  const fan = levelOf(g.lv, 'fan');
  if (fan >= 1) {
    mk(base - 0.42, 0);
    mk(base + 0.42, 0);
  }
  if (fan >= 2) {
    mk(base - 0.84, 0);
    mk(base + 0.84, 0);
  }
  ev.shots++;
}

function spores(g: SewerGame, x: number, y: number, n: number, spread: number, aim: number, speed: number, ev: SewerEvents) {
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * spread;
    g.spores.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4.5, gone: false });
  }
  ev.spores++;
}

function ring(g: SewerGame, x: number, y: number, n: number, speed: number, off: number, ev: SewerEvents) {
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    g.spores.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 5, gone: false });
  }
  ev.spores++;
}

/** Empieza el aviso de embestida (la dirección te sigue un rato y luego se fija). */
function startCharge(g: SewerGame, e: Enemy, ms: number, ev: SewerEvents) {
  aimAtPlayer(g, e);
  e.state = 'warn';
  e.st = ms;
  e.stMax = ms;
  ev.warn = true;
}

function startCast(e: Enemy, cast: Cast, ms: number, ev: SewerEvents) {
  e.state = 'cast';
  e.cast = cast;
  e.st = ms;
  e.stMax = ms;
  ev.warn = true;
}

function aimAtPlayer(g: SewerGame, e: Enemy) {
  const d = norm(g.x - e.x, g.y - e.y);
  e.dx = d.x;
  e.dy = d.y;
}

function stepEnemy(g: SewerGame, e: Enemy, dt: number, rand: Rand, ev: SewerEvents) {
  const s = dt / 1000;
  const st = STATS[e.kind];
  const slowF = e.slow > 0 ? e.slowK : 1;
  const ground = e.kind !== 'bat';
  const wet = ground && inWater(g, e.x, e.y) ? 0.65 : 1;
  const spd = st.speed * spdScale(g.room) * slowF * wet;
  let mx = 0;
  let my = 0;
  const lvl = g.bosses;

  switch (e.kind) {
    case 'rat': {
      // Corretea a tirones
      const d = steer(g, e);
      const k = 0.7 + 0.6 * Math.abs(Math.sin(e.age / 170 + e.id));
      mx = d.x * spd * k;
      my = d.y * spd * k;
      break;
    }
    case 'bat': {
      e.wt -= dt;
      if (e.wt <= 0) {
        // Rumbo nuevo: algo hacia ti y algo al azar
        const to = norm(g.x - e.x, g.y - e.y);
        const a = rand() * Math.PI * 2;
        const w = norm(to.x * 0.75 + Math.cos(a) * 0.9, to.y * 0.75 + Math.sin(a) * 0.9);
        e.wx = w.x;
        e.wy = w.y;
        e.wt = 350 + rand() * 450;
      }
      mx = e.wx * spd + Math.cos(e.age / 90) * 30;
      my = e.wy * spd + Math.sin(e.age / 120) * 30;
      break;
    }
    case 'slug': {
      const d = steer(g, e);
      mx = d.x * spd;
      my = d.y * spd;
      e.trail -= dt;
      if (e.trail <= 0) {
        e.trail = 260;
        if (g.slime.length < 60) g.slime.push({ x: e.x, y: e.y + 3, r: 11, life: 4200 });
      }
      break;
    }
    case 'shroom': {
      e.cool -= dt * slowF;
      if (e.state === 'move' && e.cool <= 0) {
        e.state = 'warn';
        e.st = 480;
        e.stMax = 480;
      } else if (e.state === 'warn') {
        e.st -= dt;
        if (e.st <= 0) {
          const n = g.room < 7 ? 3 : g.room < 14 ? 5 : 7;
          const sp = Math.min(130, 78 + g.room * 2.5);
          spores(g, e.x, e.y - 4, n, 0.3, Math.atan2(g.y - e.y, g.x - e.x), sp, ev);
          e.state = 'move';
          e.cool = Math.max(1500, 2800 - g.room * 60);
        }
      }
      break;
    }
    case 'croc': {
      if (e.state === 'move') {
        const d = steer(g, e);
        mx = d.x * spd;
        my = d.y * spd;
        e.cool -= dt;
        const dist = Math.hypot(g.x - e.x, g.y - e.y);
        if (e.cool <= 0 && dist < 200 && clearLine(g, e.x, e.y, g.x, g.y, 4)) startCharge(g, e, 760, ev);
      } else if (e.state === 'warn') {
        if (e.st > 300) aimAtPlayer(g, e);
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'dash';
          e.st = 650;
        }
      } else if (e.state === 'dash') {
        mx = e.dx * 290 * spdScale(g.room) * slowF;
        my = e.dy * 290 * spdScale(g.room) * slowF;
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'stun';
          e.st = 420;
        }
      } else if (e.state === 'stun') {
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'move';
          e.cool = Math.max(1100, 2000 - g.room * 30);
        }
      }
      break;
    }
    case 'king':
    case 'gator': {
      const king = e.kind === 'king';
      if (e.state === 'move') {
        const d = steer(g, e);
        mx = d.x * spd;
        my = d.y * spd;
        e.st -= dt;
        if (e.st <= 0) {
          const seq = king ? (lvl >= 1 ? ['charge', 'summon', 'spit', 'charge', 'spit'] : ['charge', 'summon', 'charge', 'charge']) : ['charge', 'sweep', 'charge', 'charge', 'sweep'];
          const next = seq[e.pattern % seq.length];
          e.pattern++;
          if (next === 'charge') startCharge(g, e, king ? 820 : 760, ev);
          else startCast(e, next as Cast, next === 'summon' ? 800 : next === 'sweep' ? 880 : 620, ev);
        }
      } else if (e.state === 'warn') {
        if (e.st > 320) aimAtPlayer(g, e);
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'dash';
          e.st = 1300;
        }
      } else if (e.state === 'dash') {
        const v = (king ? 320 : 360) * (1 + 0.06 * lvl) * slowF;
        mx = e.dx * v;
        my = e.dy * v;
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'stun';
          e.st = 500;
        }
      } else if (e.state === 'stun') {
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'move';
          e.st = Math.max(700, 1300 - lvl * 120);
        }
      } else if (e.state === 'cast') {
        e.st -= dt;
        if (e.st <= 0) {
          if (e.cast === 'summon') {
            // Ratas de la corte: más flojas que las de las salas, y nunca demasiadas a la vez
            const rats = g.enemies.filter((o) => o.kind === 'rat' && !o.dead).length;
            const n = Math.min(2 + Math.floor(lvl / 2), 3 + lvl - rats);
            const spots = [...g.map.grates].sort((a, b) => Math.hypot(b.x - g.x, b.y - g.y) - Math.hypot(a.x - g.x, a.y - g.y));
            for (let i = 0; i < n; i++) {
              const p = spots[i % spots.length];
              const r = makeEnemy(g, 'rat', p.x + (i >= spots.length ? 10 : 0), p.y);
              r.hp = r.max = Math.round(STATS.rat.hp * (1 + 0.3 * lvl));
              r.emerge = 420;
              g.enemies.push(r);
              ev.summon.push({ x: p.x, y: p.y });
            }
          } else if (e.cast === 'sweep') {
            ev.sweep = { x: e.x, y: e.y };
            if (Math.hypot(g.x - e.x, g.y - e.y) < SWEEP_R + HURT_R) hurtPlayer(g, ev, e.x, e.y);
            if (lvl >= 1) ring(g, e.x, e.y, 10 + lvl * 2, 95, rand() * Math.PI, ev);
          } else if (e.cast === 'spit') ring(g, e.x, e.y, 12 + lvl * 2, 100, rand() * Math.PI, ev);
          e.cast = '';
          e.state = 'move';
          e.st = Math.max(700, 1300 - lvl * 120);
        }
      }
      break;
    }
  }

  // Empujón de los impactos (se apaga solo)
  mx += e.kx;
  my += e.ky;
  e.kx *= Math.max(0, 1 - 8 * s);
  e.ky *= Math.max(0, 1 - 8 * s);
  if (mx || my) {
    const bumped = moveBody(g, e, mx * s, my * s, e.r, ground);
    if (bumped && e.state === 'dash') {
      const big = e.kind !== 'croc';
      e.state = 'stun';
      e.st = big ? 1000 : 650;
      ev.slams.push({ x: e.x + e.dx * e.r, y: e.y + e.dy * e.r, big });
    }
  }
  e.vx = mx;
  e.vy = my;
  if (e.state === 'warn' || e.state === 'dash') {
    if (Math.abs(e.dx) > 0.2) e.face = e.dx > 0 ? 1 : -1;
  } else if (e.kind === 'shroom' || e.kind === 'slug') {
    if (Math.abs(g.x - e.x) > 4) e.face = g.x > e.x ? 1 : -1;
  } else if (Math.abs(mx) > 6) e.face = mx > 0 ? 1 : -1;
}

/**
 * Avanza la partida `dt` ms. `move` es la dirección del joystick o del teclado (largo 0..1): si es
 * casi cero estás quieto y disparas.
 */
export function step(g: SewerGame, dt: number, move: Vec, rand: Rand): SewerEvents {
  const ev = newEvents();
  if (g.phase !== 'play') return ev;
  const s = dt / 1000;
  g.t += dt;

  // Cruzando la puerta: sales por arriba, se funde a negro y entras por abajo en la sala nueva
  if (g.trans > 0) {
    g.trans -= dt;
    if (!g.transHalf) {
      g.y -= 80 * s;
      if (g.trans <= TRANS_MS / 2) {
        g.transHalf = true;
        enterRoom(g, g.room + 1, rand, ev);
      }
    } else {
      const k = clamp(1 - g.trans / (TRANS_MS / 2), 0, 1);
      g.y = RY1 + 12 - 38 * k;
    }
    if (g.trans <= 0) {
      g.trans = 0;
      g.y = RY1 - 26;
    }
    g.mx = 0;
    g.my = -1;
    g.moving = true;
    return ev;
  }

  g.inv = Math.max(0, g.inv - dt);
  if (g.open) g.openT += dt;

  // Tú
  const mag = Math.min(1, Math.hypot(move.x, move.y));
  g.moving = mag > 0.15;
  let slowed = false;
  for (const sl of g.slime) {
    const dx = sl.x - g.x;
    const dy = sl.y - g.y;
    if (dx * dx + dy * dy < sl.r * sl.r) {
      slowed = true;
      break;
    }
  }
  const sp = speedOf(g) * (slowed ? 0.5 : 1) * (inWater(g, g.x, g.y) ? 0.7 : 1);
  let dx = (g.moving ? move.x * sp : 0) + g.kx;
  const dy = (g.moving ? move.y * sp : 0) + g.ky;
  g.kx *= Math.max(0, 1 - 10 * s);
  g.ky *= Math.max(0, 1 - 10 * s);
  if (g.moving) {
    g.mx = move.x / mag;
    g.my = move.y / mag;
  }
  // Con la puerta abierta, cerca de ella te encarrila hacia el centro del hueco
  const nearDoor = g.open && g.y < RY0 + 34 && g.x > DOOR_X0 - 16 && g.x < DOOR_X1 + 16 && dy < 0;
  if (nearDoor) dx += clamp(FIELD_W / 2 - g.x, -1, 1) * 70;
  g.x += dx * s;
  for (const b of g.map.crates) pushOut(g, PLAYER_R, b);
  g.x = clamp(g.x, RX0 + PLAYER_R, RX1 - PLAYER_R);
  if (g.y < RY0 + PLAYER_R) g.x = clamp(g.x, DOOR_X0 + PLAYER_R, DOOR_X1 - PLAYER_R);
  g.y += dy * s;
  for (const b of g.map.crates) pushOut(g, PLAYER_R, b);
  const inGap = g.open && g.x >= DOOR_X0 + PLAYER_R - 0.01 && g.x <= DOOR_X1 - PLAYER_R + 0.01;
  g.y = clamp(g.y, inGap ? RY0 - 40 : RY0 + PLAYER_R, RY1 - PLAYER_R);
  if (g.open && g.y < RY0 - 4) {
    g.trans = TRANS_MS;
    g.transHalf = false;
    g.firing = false;
    g.target = 0;
    ev.door = true;
    return ev;
  }

  // Segunda tanda
  if (g.reserve.length && g.enemies.filter((e) => !e.dead).length <= 2) {
    const next = g.reserve.splice(0, 6);
    next.forEach((k, i) => spawn(g, k, rand, i * 120, 150));
  }

  // Mapa de caminos hacia ti
  g.flowT -= dt;
  const cell = cellOf(g.x, g.y);
  if (g.flowT <= 0 || cell !== g.flowCell) {
    buildFlow(g);
    g.flowT = 300;
  }

  // Enemigos
  for (const e of g.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    if (e.emerge > 0) {
      e.emerge -= dt;
      if (e.emerge <= 0) {
        e.emerge = 0;
        ev.emerged.push({ x: e.x, y: e.y, kind: e.kind });
      }
      continue;
    }
    e.age += dt;
    e.slow = Math.max(0, e.slow - dt);
    e.orbT = Math.max(0, e.orbT - dt);
    if (e.burn > 0) {
      e.burn -= dt;
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick += 250;
        damage(g, e, e.burnDps * 0.25, rand, ev);
        if (e.dead) continue;
      }
    }
    stepEnemy(g, e, dt, rand, ev);
  }

  // Se separan entre ellos (los jefes empujan y no se dejan empujar)
  const live = g.enemies;
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    if (a.dead || a.emerge > 0) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      if (b.dead || b.emerge > 0 || (a.kind === 'bat') !== (b.kind === 'bat')) continue;
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const min = (a.r + b.r) * 0.9;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const ux = ddx / d;
      const uy = ddy / d;
      const aFix = a.kind === 'shroom' || a.kind === 'king' || a.kind === 'gator';
      const bFix = b.kind === 'shroom' || b.kind === 'king' || b.kind === 'gator';
      if (!aFix) {
        a.x -= ux * push * (bFix ? 2 : 1);
        a.y -= uy * push * (bFix ? 2 : 1);
      }
      if (!bFix) {
        b.x += ux * push * (aFix ? 2 : 1);
        b.y += uy * push * (aFix ? 2 : 1);
      }
    }
  }

  // Apuntar: el enemigo visible más cercano (si no se ve ninguno, el más cercano)
  let best: Enemy | null = null;
  let bestD = Infinity;
  let bestVis = false;
  for (const e of g.enemies) {
    if (e.dead || e.emerge > 0) continue;
    const d = (e.x - g.x) ** 2 + (e.y - g.y) ** 2;
    const vis = clearLine(g, g.x, g.y, e.x, e.y, 0);
    if ((vis && !bestVis) || (vis === bestVis && d < bestD)) {
      best = e;
      bestD = d;
      bestVis = vis;
    }
  }
  g.target = best ? best.id : 0;
  if (best) {
    g.aimX = best.x;
    g.aimY = best.y;
  }
  g.stillT = g.moving ? 0 : g.stillT + dt;
  g.gunT = Math.max(0, g.gunT - dt);
  g.firing = !g.moving && !!best && g.stillT >= STILL_MS;
  if (g.firing && best && g.gunT <= 0) {
    fire(g, best.x, best.y, ev);
    g.gunT = fireMs(g);
  }

  // Balas propias
  const fireLv = levelOf(g.lv, 'fire');
  const iceLv = levelOf(g.lv, 'ice');
  for (const sh of g.shots) {
    if (sh.gone) continue;
    const px = sh.x;
    const py = sh.y;
    sh.x += sh.vx * s;
    sh.y += sh.vy * s;
    sh.life -= dt;
    if (sh.life <= 0) {
      sh.gone = true;
      continue;
    }
    // Paredes y cajas: rebota si puede
    let wallX = sh.x < RX0 || sh.x > RX1;
    let wallY = sh.y < RY0 || sh.y > RY1;
    if (!wallX && !wallY) {
      for (const b of g.map.crates) {
        if (!inRect(sh.x, sh.y, b)) continue;
        if (px < b.x || px > b.x + b.w) wallX = true;
        else wallY = true;
        break;
      }
    }
    if (wallX || wallY) {
      if (sh.bounce > 0) {
        sh.bounce--;
        sh.x = px;
        sh.y = py;
        if (wallX) sh.vx = -sh.vx;
        if (wallY) sh.vy = -sh.vy;
        sh.hitIds.length = 0;
      } else {
        sh.gone = true;
        if (ev.puffs.length < 10) ev.puffs.push({ x: px, y: py, mine: true });
      }
      continue;
    }
    for (const e of g.enemies) {
      if (e.dead || e.emerge > 0) continue;
      const rr = e.r + SHOT_R;
      const ex = e.x - sh.x;
      const ey = e.y - sh.y;
      if (ex * ex + ey * ey > rr * rr || sh.hitIds.includes(e.id)) continue;
      const big = e.kind === 'king' || e.kind === 'gator';
      if (!big && e.kind !== 'shroom') {
        const k = norm(sh.vx, sh.vy);
        e.kx += k.x * 70;
        e.ky += k.y * 70;
      }
      if (fireLv) {
        e.burn = 2000;
        e.burnDps = sh.dmg * 0.35 * fireLv;
        if (e.burnTick <= 0) e.burnTick = 250;
      }
      if (iceLv) {
        e.slow = iceLv >= 2 ? 2200 : 1500;
        e.slowK = iceLv >= 2 ? 0.4 : 0.55;
      }
      damage(g, e, sh.dmg, rand, ev);
      if (!e.dead && ev.hits.length < 12) ev.hits.push({ x: sh.x, y: sh.y, burn: fireLv > 0, ice: iceLv > 0 });
      if (sh.pierce > 0) {
        sh.pierce--;
        sh.hitIds.push(e.id);
      } else {
        sh.gone = true;
        break;
      }
    }
  }
  g.shots = g.shots.filter((sh) => !sh.gone);

  // Escudo orbital
  const orbs = levelOf(g.lv, 'orbit');
  g.orbA += 3.4 * s;
  if (orbs) {
    for (let i = 0; i < orbs; i++) {
      const a = g.orbA + (i / orbs) * Math.PI * 2;
      const ox = g.x + Math.cos(a) * ORBIT_R;
      const oy = g.y + Math.sin(a) * ORBIT_R;
      for (const e of g.enemies) {
        if (e.dead || e.emerge > 0 || e.orbT > 0) continue;
        if (Math.hypot(e.x - ox, e.y - oy) < e.r + 6) {
          e.orbT = 350;
          damage(g, e, dmgOf(g) * 0.7, rand, ev);
          if (!e.dead && ev.hits.length < 12) ev.hits.push({ x: ox, y: oy, burn: false, ice: false });
        }
      }
      for (const sp of g.spores) if (!sp.gone && Math.hypot(sp.x - ox, sp.y - oy) < sp.r + 6) sp.gone = true;
    }
  }

  // Choques contigo
  for (const e of g.enemies) {
    if (e.dead || e.emerge > 0) continue;
    const rr = e.r * 0.8 + HURT_R;
    if ((e.x - g.x) ** 2 + (e.y - g.y) ** 2 < rr * rr) {
      hurtPlayer(g, ev, e.x, e.y);
      break;
    }
  }

  // Esporas
  for (const b of g.spores) {
    if (b.gone) continue;
    b.x += b.vx * s;
    b.y += b.vy * s;
    let blocked = b.x < RX0 || b.x > RX1 || b.y < RY0 || b.y > RY1;
    if (!blocked) for (const c of g.map.crates) if (inRect(b.x, b.y, c)) blocked = true;
    if (blocked) {
      b.gone = true;
      if (ev.puffs.length < 10) ev.puffs.push({ x: b.x, y: b.y, mine: false });
      continue;
    }
    const rr = b.r + HURT_R;
    if ((b.x - g.x) ** 2 + (b.y - g.y) ** 2 < rr * rr && g.inv <= 0) {
      b.gone = true;
      hurtPlayer(g, ev, b.x - b.vx, b.y - b.vy);
    }
  }
  g.spores = g.spores.filter((b) => !b.gone);

  // Babas
  for (const sl of g.slime) sl.life -= dt;
  g.slime = g.slime.filter((sl) => sl.life > 0);

  g.enemies = g.enemies.filter((e) => !e.dead);

  // Chatarra y corazones
  for (const p of g.pickups) {
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (g.done || d < MAGNET_R) p.pulled = true;
    if (p.pulled) {
      const n = norm(g.x - p.x, g.y - p.y);
      p.vx = n.x * 380;
      p.vy = n.y * 380;
    } else {
      p.vx *= Math.max(0, 1 - 4 * s);
      p.vy *= Math.max(0, 1 - 4 * s);
    }
    p.x = clamp(p.x + p.vx * s, RX0 + 4, RX1 - 4);
    p.y = clamp(p.y + p.vy * s, RY0 - 30, RY1 - 4);
    if (d < 12) collect(g, p, ev);
  }
  g.pickups = g.pickups.filter((p) => !p.got);

  if (g.phase !== 'play') {
    g.score = scoreOf(g);
    return ev;
  }

  // Sala limpia: eliges hallazgo y luego se abre la puerta
  if (!g.done && g.enemies.length === 0 && g.reserve.length === 0) {
    g.done = true;
    g.cleared++;
    g.clearT = CLEAR_MS;
    g.spores = [];
    g.firing = false;
    ev.roomClear = true;
  } else if (g.done && g.clearT > 0) {
    g.clearT -= dt;
    if (g.clearT <= 0) {
      g.clearT = 0;
      for (const p of g.pickups) collect(g, p, ev);
      g.pickups = [];
      const pool = HALLAZGOS.filter((h) => h.id !== 'heal' || g.hp < maxHp(g));
      g.offer = rollUpgrades(pool, g.lv, rand, choicesN(g));
      if (g.offer.length) {
        g.phase = 'choice';
        ev.choice = true;
      } else {
        g.open = true;
        g.openT = 0;
      }
    }
  }
  g.score = scoreOf(g);
  return ev;
}

function collect(g: SewerGame, p: Pickup, ev: SewerEvents) {
  if (p.got) return;
  p.got = true;
  if (p.kind === 'scrap') {
    g.scrap += p.value;
    ev.scrap += p.value;
  } else if (g.hp < maxHp(g)) {
    g.hp++;
    ev.heal++;
  }
}
