// "Alcalde bala" (juego de mejoras, al estilo de Learn to Fly): en la feria de la ciudad el alcalde es la
// bala humana del cañón del circo. Un ticket es una feria de 5 intentos: apuntas, eliges la fuerza y
// sales volando; ganas dinero según la distancia y las monedas que cojas, y entre intento e intento lo
// gastas en el taller para llegar más lejos. Cuenta el mejor intento de la feria (en metros).
//
// Unidades: metros y segundos dentro de la física; el tiempo de `step` llega en ms como en el resto de
// shooters. El eje y mide la altura (hacia arriba), el suelo está en y = 0.

import { clamp, type Rand } from '../shooter/kit';

export const LAUNCHES = 5;
/** Gravedad (m/s²). Más que la real: los vuelos son más cortos y se sienten más rápidos. */
export const GRAVITY = 15;
/** Radio del alcalde (m). */
export const MAYOR_R = 3.5;
/** Eje del cañón y largo del cañón (m): el alcalde sale por la boca. */
export const PIVOT_X = 0;
export const PIVOT_Y = 7;
export const BARREL = 13;
/** Recorrido de la aguja (grados) y zona perfecta. */
export const ANGLE_MIN = 12;
export const ANGLE_MAX = 78;
export const PERFECT_ANGLE: [number, number] = [38, 52];
/** Ida y vuelta de la aguja y de la barra de fuerza (ms). */
export const AIM_MS = 2200;
export const POWER_MS = 1400;
/** Desde esta fuerza el disparo es perfecto. */
export const PERFECT_POWER = 0.9;
/** Premio de velocidad por cada parte perfecta. */
export const PERFECT_BONUS = 0.06;
/** Empuje del cohete (m/s²). */
export const THRUST = 30;
/** Frenada al rodar por el suelo (m/s²). */
export const ROLL_FRICTION = 11;
/** Por debajo de esta velocidad vertical ya no rebota: rueda. */
export const MIN_BOUNCE = 4;
/** Ya no se mueve. */
export const STOP_SPEED = 0.8;
/** Tope de la distancia (el ranking acepta menos de 5000). */
export const MAX_DIST = 4999;
/** Hasta dónde llega el recorrido con objetos (m). */
export const COURSE_END = 5200;
/** Un vuelo nunca dura más (por si acaso), ms. */
export const MAX_FLIGHT_MS = 120_000;
/** Dinero por metro recorrido. */
export const PAY_PER_M = 0.6;
export const COIN_R = 2.4;
export const BALLOON_R = 4.2;
export const BIRD_R = 3.4;
export const BIRD_SPEED = 6;

export type ShopId = 'cannon' | 'rocket' | 'glider' | 'springs' | 'magnet' | 'suit';

export interface ShopDef {
  id: ShopId;
  emoji: string;
  name: string;
  costs: number[];
  desc: (lv: number) => string;
}

const secs = (x: number) => `${x.toFixed(1).replace('.', ',')} s`;

/** Nivel máximo de cada mejora. */
export const SHOP_MAX = 5;

export const SHOP: ShopDef[] = [
  { id: 'cannon', emoji: '💥', name: 'Cañón', costs: [25, 55, 110, 200, 340], desc: (lv) => `Más pólvora: sales a ${launchSpeed(lv)} m/s` },
  { id: 'rocket', emoji: '🚀', name: 'Cohete', costs: [30, 70, 130, 230, 380], desc: (lv) => (lv === 1 ? `Mantén pulsado en el aire: ${secs(fuelMax(1))} de propulsión` : `Depósito para ${secs(fuelMax(lv))} de cohete`) },
  { id: 'glider', emoji: '🪂', name: 'Planeador', costs: [25, 60, 120, 210, 350], desc: (lv) => (lv === 1 ? 'Alas: caes más despacio y avanzas al bajar' : `Alas más grandes (planeo ${lv}/5)`) },
  { id: 'springs', emoji: '🌀', name: 'Muelles', costs: [20, 45, 90, 170, 290], desc: (lv) => `Rebotas más al tocar el suelo (+${Math.round((restitution(lv) / restitution(0) - 1) * 100)} %)` },
  { id: 'magnet', emoji: '🧲', name: 'Imán', costs: [15, 35, 70, 130, 230], desc: (lv) => `Atraes monedas a ${Math.round(magnetR(lv))} m` },
  { id: 'suit', emoji: '🥽', name: 'Traje aerodinámico', costs: [20, 50, 100, 180, 300], desc: (lv) => `El aire y el suelo te frenan menos (−${Math.round((1 - dragK(lv) / dragK(0)) * 100)} %)` },
];

// ---------------------------------------------------------------------------------------------
// Efecto de cada nivel
// ---------------------------------------------------------------------------------------------

/** Velocidad de salida con la fuerza al máximo (m/s). */
export function launchSpeed(lv: number): number {
  return 30 + 9 * lv;
}

/** Segundos de cohete. */
export function fuelMax(lv: number): number {
  return lv <= 0 ? 0 : 0.2 + 0.6 * lv;
}

/** Sustentación al caer (frena la caída y empuja hacia delante). */
export function glide(lv: number): number {
  return lv <= 0 ? 0 : 0.15 + 0.1 * lv;
}

/** Parte de la velocidad vertical que conserva al rebotar. */
export function restitution(lv: number): number {
  return 0.42 + 0.08 * lv;
}

/** Parte de la velocidad horizontal que conserva al rebotar. */
export function bounceKeep(lv: number): number {
  return 0.8 + 0.03 * lv;
}

/** Radio extra del imán (m). */
export function magnetR(lv: number): number {
  return 4 + 6 * lv;
}

/** Rozamiento al rodar (el traje también resbala por el suelo). */
export function rollK(lv: number): number {
  return 1 - 0.1 * lv;
}

/** Rozamiento del aire (a = -k·|v|·v). */
export function dragK(lv: number): number {
  return 0.0024 * (1 - 0.14 * lv);
}

// ---------------------------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------------------------

export type Phase = 'aim' | 'power' | 'fly' | 'landed' | 'shop' | 'over';

export interface Coin {
  x: number;
  y: number;
  value: number;
  got: boolean;
  pulled: boolean;
}

export interface Balloon {
  x: number;
  y: number;
  /** Color (índice de paleta en la vista). */
  hue: number;
  popped: boolean;
}

export interface Bird {
  x: number;
  y: number;
  /** Altura base: se mece arriba y abajo. */
  y0: number;
  phase: number;
  hit: boolean;
}

/** Cama elástica o charco de barro: un tramo del suelo. */
export interface Pad {
  x: number;
  w: number;
  used: boolean;
}

export interface LaunchResult {
  attempt: number;
  dist: number;
  distMoney: number;
  coinMoney: number;
  /** Monedas cogidas. */
  coins: number;
  earned: number;
  /** Partes perfectas del disparo (0..2). */
  perfect: number;
  /** Mejor intento de la feria hasta ahora. */
  best: boolean;
  peak: number;
  mud: boolean;
}

export interface CannonGame {
  phase: Phase;
  /** Tiempo total (ms) y tiempo en la fase actual (ms). */
  t: number;
  phaseT: number;
  attempt: number;
  /** Aguja (grados) y fuerza (0..1) actuales o fijadas. */
  angle: number;
  power: number;
  perfectA: boolean;
  perfectP: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rodando por el suelo. */
  ground: boolean;
  fuel: number;
  /** El cohete solo arranca con una pulsación nueva tras el disparo (no con el mismo dedo que dispara). */
  rocketArmed: boolean;
  burning: boolean;
  lv: Record<ShopId, number>;
  money: number;
  /** Mejor distancia de la feria (m). */
  best: number;
  launches: LaunchResult[];
  coinMoney: number;
  coinCount: number;
  peak: number;
  mud: boolean;
  coins: Coin[];
  balloons: Balloon[];
  birds: Bird[];
  tramps: Pad[];
  muds: Pad[];
}

export interface CannonInput {
  /** Toque o Espacio recién pulsado. */
  press: boolean;
  /** Algo sigue pulsado. */
  hold: boolean;
}

export interface CannonEvents {
  locked: boolean;
  fired: boolean;
  coins: { x: number; y: number; value: number }[];
  balloons: { x: number; y: number; hue: number }[];
  birds: { x: number; y: number }[];
  tramps: { x: number; y: number }[];
  /** Golpes contra el suelo (no las camas elásticas). */
  bounces: { x: number; impact: number }[];
  mud: { x: number } | null;
  burning: boolean;
  fuelOut: boolean;
  /** Pasó un múltiplo de 100 m (0 si no). */
  marker: number;
  landed: LaunchResult | null;
}

function noEvents(): CannonEvents {
  return { locked: false, fired: false, coins: [], balloons: [], birds: [], tramps: [], bounces: [], mud: null, burning: false, fuelOut: false, marker: 0, landed: null };
}

// ---------------------------------------------------------------------------------------------
// Recorrido: monedas, globos, pájaros, camas elásticas y barro. Se sortea en cada intento.
// ---------------------------------------------------------------------------------------------

/** Valor de una moneda según lo lejos que está (las lejanas valen más). */
export function coinValue(x: number): number {
  return 1 + Math.floor(x / 350);
}

export function makeCourse(rand: Rand): Pick<CannonGame, 'coins' | 'balloons' | 'birds' | 'tramps' | 'muds'> {
  const coins: Coin[] = [];
  const balloons: Balloon[] = [];
  const birds: Bird[] = [];
  const tramps: Pad[] = [];
  const muds: Pad[] = [];

  // Monedas en grupos: arcos, líneas y escaleras, a alturas que suben con la distancia
  for (let x = 35 + rand() * 20; x < COURSE_END; ) {
    // La mayoría a ras de suelo; algunas arriba para premiar los vuelos altos
    const high = rand() < 0.3;
    const top = high ? Math.min(300, 60 + x * 0.3) : Math.min(230, 28 + x * 0.09);
    const h = 6 + rand() * top;
    const n = 5 + Math.floor(rand() * 4);
    const kind = rand();
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const y = kind < 0.4 ? h + Math.sin(k * Math.PI) * 9 : kind < 0.7 ? h : h + (k - 0.5) * 14;
      const cx = x + i * 5.5;
      coins.push({ x: cx, y: Math.max(MAYOR_R + 1, y), value: coinValue(cx), got: false, pulled: false });
    }
    x += n * 5.5 + 22 + rand() * 40;
  }

  // Globos: rebote hacia arriba
  for (let x = 80 + rand() * 40; x < COURSE_END; x += 75 + rand() * 80) {
    const top = Math.min(150, 35 + x * 0.05);
    balloons.push({ x, y: 14 + rand() * top, hue: Math.floor(rand() * 4), popped: false });
  }

  // Pájaros: frenan. Aparecen pasados los primeros metros
  for (let x = 150 + rand() * 60; x < COURSE_END; x += 85 + rand() * 90) {
    const top = Math.min(130, 30 + x * 0.05);
    const y = 12 + rand() * top;
    birds.push({ x, y, y0: y, phase: rand() * Math.PI * 2, hit: false });
  }

  // Suelo: camas elásticas y charcos, sin pisarse entre sí
  const free = (x: number, w: number) => ![...tramps, ...muds].some((p) => x < p.x + p.w + 25 && x + w + 25 > p.x);
  for (let x = 70 + rand() * 50; x < COURSE_END; x += 120 + rand() * 120) tramps.push({ x, w: 12, used: false });
  for (let x = 190 + rand() * 80; x < COURSE_END; x += 210 + rand() * 170) {
    const w = 12 + rand() * 8;
    if (free(x, w)) muds.push({ x, w, used: false });
  }
  return { coins, balloons, birds, tramps, muds };
}

// ---------------------------------------------------------------------------------------------
// Partida
// ---------------------------------------------------------------------------------------------

/** Boca del cañón para un ángulo (grados). */
export function muzzle(angle: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: PIVOT_X + Math.cos(a) * BARREL, y: PIVOT_Y + Math.sin(a) * BARREL };
}

/** Aguja: va y vuelve entre el mínimo y el máximo. */
export function needle(phaseT: number): number {
  return ANGLE_MIN + (ANGLE_MAX - ANGLE_MIN) * (0.5 - 0.5 * Math.cos((2 * Math.PI * phaseT) / AIM_MS));
}

/** Barra de fuerza: sube y baja en diente de sierra simétrico. */
export function powerBar(phaseT: number): number {
  const k = (phaseT % POWER_MS) / POWER_MS;
  return k < 0.5 ? k * 2 : 2 - k * 2;
}

export function isPerfectAngle(a: number): boolean {
  return a >= PERFECT_ANGLE[0] && a <= PERFECT_ANGLE[1];
}

/** Velocidad del disparo (m/s) con la fuerza y lo perfecto que fue. */
export function shotSpeed(lv: number, power: number, perfectA: boolean, perfectP: boolean): number {
  return launchSpeed(lv) * (0.4 + 0.6 * power) * (1 + (perfectA ? PERFECT_BONUS : 0) + (perfectP ? PERFECT_BONUS : 0));
}

function resetFlight(g: CannonGame, rand: Rand) {
  g.phase = 'aim';
  g.phaseT = 0;
  g.angle = ANGLE_MIN;
  g.power = 0;
  g.perfectA = false;
  g.perfectP = false;
  const m = muzzle(g.angle);
  g.x = m.x;
  g.y = m.y;
  g.vx = 0;
  g.vy = 0;
  g.ground = false;
  g.fuel = fuelMax(g.lv.rocket);
  g.rocketArmed = false;
  g.burning = false;
  g.coinMoney = 0;
  g.coinCount = 0;
  g.peak = 0;
  g.mud = false;
  Object.assign(g, makeCourse(rand));
}

export function newCannon(rand: Rand): CannonGame {
  const g = {
    t: 0,
    attempt: 1,
    lv: { cannon: 0, rocket: 0, glider: 0, springs: 0, magnet: 0, suit: 0 },
    money: 0,
    best: 0,
    launches: [],
  } as unknown as CannonGame;
  resetFlight(g, rand);
  return g;
}

/** Distancia actual (m), sin pasar del tope. */
export function distance(g: CannonGame): number {
  return Math.min(MAX_DIST, Math.max(0, Math.floor(g.x - PIVOT_X)));
}

/** Puntuación: el mejor intento, o el vuelo en curso si ya lo supera (por si se sale a mitad). */
export function score(g: CannonGame): number {
  return g.phase === 'fly' ? Math.max(g.best, distance(g)) : g.best;
}

export function shopCost(g: CannonGame, id: ShopId): number | null {
  const d = SHOP.find((x) => x.id === id)!;
  const lv = g.lv[id];
  return lv < SHOP_MAX ? d.costs[lv] : null;
}

export function buy(g: CannonGame, id: ShopId): boolean {
  const cost = shopCost(g, id);
  if (g.phase !== 'shop' || cost === null || g.money < cost) return false;
  g.money -= cost;
  g.lv[id]++;
  return true;
}

/** Tras ver el resultado: al taller, o fin de la feria si era el último intento. */
export function leaveLanding(g: CannonGame): Phase {
  if (g.phase !== 'landed') return g.phase;
  g.phase = g.attempt >= LAUNCHES ? 'over' : 'shop';
  g.phaseT = 0;
  return g.phase;
}

/** Sale del taller hacia el siguiente intento. */
export function nextLaunch(g: CannonGame, rand: Rand): number {
  if (g.phase !== 'shop') return g.attempt;
  g.attempt++;
  resetFlight(g, rand);
  return g.attempt;
}

function fire(g: CannonGame) {
  const sp = shotSpeed(g.lv.cannon, g.power, g.perfectA, g.perfectP);
  const a = (g.angle * Math.PI) / 180;
  const m = muzzle(g.angle);
  g.x = m.x;
  g.y = m.y;
  g.vx = Math.cos(a) * sp;
  g.vy = Math.sin(a) * sp;
  g.phase = 'fly';
  g.phaseT = 0;
}

function land(g: CannonGame, ev: CannonEvents) {
  const dist = distance(g);
  const distMoney = Math.floor(dist * PAY_PER_M);
  const best = dist > g.best;
  const r: LaunchResult = {
    attempt: g.attempt,
    dist,
    distMoney,
    coinMoney: g.coinMoney,
    coins: g.coinCount,
    earned: distMoney + g.coinMoney,
    perfect: (g.perfectA ? 1 : 0) + (g.perfectP ? 1 : 0),
    best,
    peak: Math.round(g.peak),
    mud: g.mud,
  };
  g.money += r.earned;
  if (best) g.best = dist;
  g.launches.push(r);
  g.vx = 0;
  g.vy = 0;
  g.burning = false;
  g.phase = 'landed';
  g.phaseT = 0;
  ev.landed = r;
}

const inPad = (pads: Pad[], x: number) => pads.find((p) => x >= p.x && x <= p.x + p.w);

/** Un paso de vuelo (s en segundos). */
function fly(g: CannonGame, s: number, hold: boolean, ev: CannonEvents) {
  if (!hold) g.rocketArmed = true;
  const burn = hold && g.rocketArmed && g.fuel > 0;
  if (burn) {
    g.fuel = Math.max(0, g.fuel - s);
    if (g.fuel === 0) ev.fuelOut = true;
  }
  g.burning = burn;
  ev.burning = burn;

  const sp = Math.hypot(g.vx, g.vy);
  const k = dragK(g.lv.suit);
  let ax = -k * sp * g.vx;
  let ay = -GRAVITY - k * sp * g.vy;
  if (burn) {
    // Siempre empuja hacia delante y algo hacia arriba (también sirve para despegar del suelo)
    const a = clamp(Math.atan2(g.vy, g.vx), 0.15, 0.75);
    ax += THRUST * Math.cos(a);
    ay += THRUST * Math.sin(a);
  }
  if (!g.ground && g.vy < 0) {
    // Planeador: convierte parte de la caída en avance
    const gl = glide(g.lv.glider);
    ay += gl * -g.vy;
    ax += gl * 0.5 * -g.vy;
  }
  if (g.ground) {
    if (ay <= 0) {
      ay = 0;
      g.vy = 0;
      ax -= ROLL_FRICTION * rollK(g.lv.suit);
    } else g.ground = false;
  }
  const px = g.x;
  g.vx = Math.max(0, g.vx + ax * s);
  g.vy += ay * s;
  g.x += g.vx * s;
  g.y += g.vy * s;
  g.peak = Math.max(g.peak, g.y - MAYOR_R);

  if (Math.floor(g.x / 100) > Math.floor(px / 100) && g.x >= 100) ev.marker = Math.floor(g.x / 100) * 100;

  // Suelo
  if (g.y <= MAYOR_R) {
    g.y = MAYOR_R;
    if (inPad(g.muds, g.x)) {
      g.mud = true;
      ev.mud = { x: g.x };
      g.vx = 0;
      land(g, ev);
      return;
    }
    const tr = g.tramps.find((p) => !p.used && g.x >= p.x - 1 && g.x <= p.x + p.w + 1);
    if (tr && (g.vy < 0 || g.ground)) {
      tr.used = true;
      // Rodando solo da un saltito; cayendo, un buen rebote (sin acelerar casi: si no, se encadenan sin fin)
      if (g.ground) g.vy = 16;
      else {
        g.vy = clamp(-g.vy * 1.05, 22, 50) + g.lv.springs;
        g.vx = g.vx * 1.03 + 2;
      }
      g.ground = false;
      ev.tramps.push({ x: g.x, y: 0 });
    } else if (g.vy < 0) {
      const impact = -g.vy;
      const up = impact * restitution(g.lv.springs);
      g.vx *= bounceKeep(g.lv.springs);
      ev.bounces.push({ x: g.x, impact });
      if (up < MIN_BOUNCE) {
        g.vy = 0;
        g.ground = true;
      } else g.vy = up;
    }
  }

  // Objetos cercanos (solo se miran los que están a tiro en x)
  const reach = MAYOR_R + magnetR(g.lv.magnet) + COIN_R;
  for (const c of g.coins) {
    if (c.got) continue;
    const dx = c.x - g.x;
    if (!c.pulled && (dx > reach || dx < -reach)) continue;
    const dy = c.y - g.y;
    const d = Math.hypot(dx, dy);
    if (d <= MAYOR_R + COIN_R) {
      c.got = true;
      g.coinMoney += c.value;
      g.coinCount++;
      ev.coins.push({ x: c.x, y: c.y, value: c.value });
    } else if (c.pulled || d <= reach) {
      // El imán las trae volando
      c.pulled = true;
      const v = (40 + sp * 1.2) * s;
      c.x -= (dx / d) * Math.min(v, d);
      c.y -= (dy / d) * Math.min(v, d);
    }
  }
  for (const b of g.balloons) {
    if (b.popped || Math.abs(b.x - g.x) > 12) continue;
    if (Math.hypot(b.x - g.x, b.y - g.y) <= MAYOR_R + BALLOON_R) {
      b.popped = true;
      g.ground = false;
      g.vy = Math.max(g.vy, 0) * 0.5 + 22;
      g.vx += 3;
      ev.balloons.push({ x: b.x, y: b.y, hue: b.hue });
    }
  }
  for (const b of g.birds) {
    if (b.hit || Math.abs(b.x - g.x) > 10) continue;
    if (Math.hypot(b.x - g.x, b.y - g.y) <= MAYOR_R + BIRD_R) {
      b.hit = true;
      g.vx *= 0.62;
      g.vy = g.vy > 0 ? g.vy * 0.4 : g.vy - 4;
      ev.birds.push({ x: b.x, y: b.y });
    }
  }

  if (g.x - PIVOT_X >= MAX_DIST) {
    g.x = PIVOT_X + MAX_DIST;
    land(g, ev);
    return;
  }
  if ((g.ground && g.vx < STOP_SPEED) || g.phaseT > MAX_FLIGHT_MS) land(g, ev);
}

/** Avanza la partida `dt` ms. */
export function step(g: CannonGame, dt: number, input: CannonInput): CannonEvents {
  const ev = noEvents();
  g.t += dt;
  g.phaseT += dt;
  const s = dt / 1000;

  // Los pájaros vuelan siempre (despacio, hacia la izquierda, meciéndose)
  if (g.phase === 'fly') {
    for (const b of g.birds) {
      if (b.hit) {
        b.y -= 20 * s;
        continue;
      }
      if (Math.abs(b.x - g.x) > 400) continue;
      b.x -= BIRD_SPEED * s;
      b.y = b.y0 + Math.sin(g.t / 400 + b.phase) * 3;
    }
  }

  switch (g.phase) {
    case 'aim':
      g.angle = needle(g.phaseT);
      if (input.press) {
        g.perfectA = isPerfectAngle(g.angle);
        g.phase = 'power';
        g.phaseT = 0;
        g.power = 0;
        ev.locked = true;
      }
      break;
    case 'power':
      g.power = powerBar(g.phaseT);
      if (input.press) {
        g.perfectP = g.power >= PERFECT_POWER;
        fire(g);
        ev.fired = true;
      }
      break;
    case 'fly':
      fly(g, s, input.hold, ev);
      break;
    default:
      break;
  }
  return ev;
}
