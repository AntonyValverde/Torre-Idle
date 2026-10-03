// "Guerra de torres": torres unidas por caminos. Las tuyas (y las del rival) generan soldados; desde
// una torre se envían todos sus soldados a una torre vecina. Al llegar, si son del mismo dueño se
// suman; si no, se restan, y la torre cambia de dueño si llegan más de los que tenía.
// Una partida son batallas seguidas, cada vez más difíciles, hasta que pierdes una.

import { mulberry32 } from '../rng';

/** Campo de juego en unidades del dibujo (vertical, como el móvil). */
export const FIELD_W = 100;
export const FIELD_H = 140;
/** Duración máxima de una batalla. Al acabar el tiempo gana quien tenga más torres. */
export const BATTLE_MS = 90_000;
/** Velocidad de los soldados por los caminos (unidades del campo por segundo). */
export const SPEED = 16;
/** Puntos por torre conquistada y por batalla ganada (más 1 por cada 15 s que sobren). */
export const CAPTURE_POINTS = 1;
export const WIN_POINTS = 5;
export const MAX_TOWERS = 13;
/** Soldados con los que empiezan tu torre y la del rival (el rival suma 2 por batalla). */
export const START_UNITS = 20;
/** Soldados por segundo que pierde una torre por encima de su tope. */
export const OVER_DECAY = 2;

export const NEUTRAL = 0;
export const PLAYER = 1;
/** Los rivales son los dueños 2 y 3. */
export const isAi = (owner: number) => owner >= 2;

export interface Tower {
  x: number;
  y: number;
  owner: number;
  /** Soldados (con decimales mientras crecen; se muestra la parte entera). */
  units: number;
  /** Hasta cuántos crecen solos. */
  cap: number;
  /** Soldados por segundo cuando tiene dueño. */
  rate: number;
  big: boolean;
}

export interface Packet {
  from: number;
  to: number;
  owner: number;
  count: number;
  /** Distancia recorrida y total del camino. */
  d: number;
  len: number;
}

export type BattleState = 'play' | 'won' | 'lost';

export interface TowersGame {
  battle: number;
  towers: Tower[];
  /** Vecinos de cada torre (caminos). */
  adj: number[][];
  packets: Packet[];
  /** Tiempo jugado en la batalla actual (ms). */
  t: number;
  /** ms hasta que piensa cada rival (índice = dueño). */
  aiTimer: number[];
  /** Multiplicador de crecimiento de los rivales en esta batalla. */
  aiRate: number;
  state: BattleState;
  score: number;
  /** Torres conquistadas en toda la partida. */
  captured: number;
  won: number;
  /** La partida terminó (perdiste una batalla). */
  over: boolean;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function towerCount(battle: number): number {
  return Math.min(MAX_TOWERS, 6 + battle);
}

/** Rivales en la batalla: uno al principio y dos desde la quinta. */
export function aiCount(battle: number): number {
  return battle >= 5 ? 2 : 1;
}

/** Cada cuánto decide un rival (ms): cada vez más rápido. */
export function aiThinkMs(battle: number): number {
  return Math.max(1100, 3000 - 220 * (battle - 1));
}

function makeTower(x: number, y: number, big: boolean, owner: number, units: number): Tower {
  return { x, y, owner, units, big, cap: big ? 40 : 25, rate: big ? 1.1 : 0.7 };
}

/** ¿Se cruzan los segmentos ab y cd (sin contar los extremos compartidos)? */
function crosses(a: Tower, b: Tower, c: Tower, d: Tower): boolean {
  const o = (p: Tower, q: Tower, r: Tower) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (a === c || a === d || b === c || b === d) return false;
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Caminos: un árbol mínimo (todo conectado) más los vecinos cercanos que no crucen otros caminos. */
export function makeLinks(towers: Tower[]): number[][] {
  const n = towers.length;
  const edges: [number, number][] = [];
  const inTree = new Set([0]);
  while (inTree.size < n) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const i of inTree)
      for (let j = 0; j < n; j++) {
        if (inTree.has(j)) continue;
        const d = dist(towers[i], towers[j]);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    edges.push(best!);
    inTree.add(best![1]);
  }
  const has = (i: number, j: number) => edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
  for (let i = 0; i < n; i++) {
    const near = towers
      .map((t, j) => ({ j, d: dist(towers[i], t) }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { j, d } of near) {
      if (d > 48 || has(i, j)) continue;
      if (edges.some(([a, b]) => crosses(towers[i], towers[j], towers[a], towers[b]))) continue;
      edges.push([i, j]);
    }
  }
  const adj: number[][] = towers.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

/** Torres de una batalla: la tuya abajo, los rivales arriba y neutrales en medio. */
export function makeBattle(battle: number, rand: () => number): { towers: Tower[]; adj: number[][] } {
  const n = towerCount(battle);
  const ais = aiCount(battle);
  const towers: Tower[] = [];
  // Empiezas con soldados de sobra para tomar una neutral al primer envío
  towers.push(makeTower(50 + (rand() - 0.5) * 30, FIELD_H - 16, true, PLAYER, START_UNITS));
  const aiUnits = START_UNITS + 2 * (battle - 1);
  if (ais === 1) towers.push(makeTower(50 + (rand() - 0.5) * 30, 16, true, 2, aiUnits));
  else {
    towers.push(makeTower(20 + rand() * 10, 16, true, 2, aiUnits));
    towers.push(makeTower(70 + rand() * 10, 16, true, 3, aiUnits));
  }
  let minD = 24;
  for (let tries = 0; towers.length < n; tries++) {
    if (tries > 0 && tries % 300 === 0) minD -= 2;
    const x = 10 + rand() * (FIELD_W - 20);
    const y = 14 + rand() * (FIELD_H - 28);
    if (towers.some((t) => dist(t, { x, y }) < minD)) continue;
    const big = rand() < 0.3;
    towers.push(makeTower(x, y, big, NEUTRAL, Math.floor(2 + rand() * 6 + (battle - 1) * 1.3 + (big ? 3 : 0))));
  }
  for (const t of towers) {
    t.x = Math.round(t.x * 10) / 10;
    t.y = Math.round(t.y * 10) / 10;
  }
  return { towers, adj: makeLinks(towers) };
}

function startBattle(g: Pick<TowersGame, 'battle'> & Partial<TowersGame>, rand: () => number): TowersGame {
  const { towers, adj } = makeBattle(g.battle, rand);
  const think = aiThinkMs(g.battle);
  return {
    battle: g.battle,
    towers,
    adj,
    packets: [],
    t: 0,
    // El primer movimiento del rival llega un poco después que el tuyo
    aiTimer: [0, 0, think * 1.2, think * 1.5],
    aiRate: Math.min(1.6, 1 + 0.07 * (g.battle - 1)),
    state: 'play',
    score: g.score ?? 0,
    captured: g.captured ?? 0,
    won: g.won ?? 0,
    over: false,
  };
}

export function newTowers(rand: () => number): TowersGame {
  return startBattle({ battle: 1 }, rand);
}

/** Pasa a la batalla siguiente (después de ganar una), conservando los puntos. */
export function nextBattle(g: TowersGame, rand: () => number): TowersGame {
  return startBattle({ battle: g.battle + 1, score: g.score, captured: g.captured, won: g.won }, rand);
}

export function linked(g: TowersGame, a: number, b: number): boolean {
  return g.adj[a]?.includes(b) ?? false;
}

/**
 * Soldados que salen al enviar desde una torre: todos. Con un tope por torre, enviar solo una parte
 * haría que defender fuera siempre mejor que atacar y las batallas se atascarían.
 */
export function sendAmount(units: number): number {
  return Math.floor(units);
}

/** Envía los soldados de `from` a la torre vecina `to`. Devuelve los enviados (0 si no se pudo). */
export function send(g: TowersGame, from: number, to: number, owner = PLAYER): number {
  if (g.state !== 'play' || from === to || !linked(g, from, to)) return 0;
  const src = g.towers[from];
  if (src.owner !== owner) return 0;
  const n = sendAmount(src.units);
  if (n < 1) return 0;
  src.units -= n;
  g.packets.push({ from, to, owner, count: n, d: 0, len: dist(src, g.towers[to]) });
  return n;
}

export function ownedBy(g: TowersGame, owner: number): number {
  return g.towers.filter((t) => t.owner === owner).length;
}

const aiOwned = (g: TowersGame) => g.towers.filter((t) => isAi(t.owner)).length;

/** Soldados con los que contará una torre dentro de `ms` (si nadie la toca). */
function unitsIn(g: TowersGame, t: Tower, ms: number): number {
  if (t.owner === NEUTRAL || t.units >= t.cap) return t.units;
  const rate = t.rate * (isAi(t.owner) ? g.aiRate : 1);
  return Math.min(t.cap, t.units + (rate * ms) / 1000);
}

/** Decide y hace (o no) un movimiento del rival `owner`. Devuelve true si envió soldados. */
export function aiMove(g: TowersGame, owner: number, rand: () => number): boolean {
  // Al principio a veces duda: las primeras batallas son más suaves
  if (rand() < Math.max(0, 0.3 - 0.05 * g.battle)) return false;
  let best: { from: number; to: number; value: number } | null = null;
  for (let from = 0; from < g.towers.length; from++) {
    const src = g.towers[from];
    if (src.owner !== owner || src.units < 6) continue;
    const out = sendAmount(src.units);
    for (const to of g.adj[from]) {
      const dst = g.towers[to];
      if (dst.owner === owner) continue;
      const travel = (dist(src, dst) / SPEED) * 1000;
      // Los suyos que ya van de camino hacia allí
      const incoming = g.packets.filter((p) => p.to === to).reduce((n, p) => n + (p.owner === owner ? p.count : 0), 0);
      const need = unitsIn(g, dst, travel) + 1 - incoming;
      if (out <= need) continue;
      const value = out - need + (dst.owner === PLAYER ? 4 : 0) + (dst.big ? 3 : 0) - dist(src, dst) * 0.05 + rand();
      if (!best || value > best.value) best = { from, to, value };
    }
  }
  if (best) return send(g, best.from, best.to, owner) > 0;
  // Sin ataque posible: las torres de retaguardia mandan refuerzos al frente (a las que no están llenas)
  const front = (i: number) => g.adj[i].some((j) => g.towers[j].owner !== owner);
  for (let from = 0; from < g.towers.length; from++) {
    const src = g.towers[from];
    if (src.owner !== owner || src.units < 10 || front(from)) continue;
    const to = g.adj[from].find((j) => front(j) && g.towers[j].units < g.towers[j].cap);
    if (to !== undefined && send(g, from, to, owner) > 0) return true;
  }
  return false;
}

export interface TowersEvents {
  /** Torres que conquistaste en este paso. */
  captured: number;
  /** Torres tuyas que cayeron. */
  lost: number;
  arrived: number;
  battleWon: boolean;
  battleLost: boolean;
}

function finish(g: TowersGame, ev: TowersEvents, won: boolean) {
  if (won) {
    g.state = 'won';
    g.won++;
    g.score += WIN_POINTS + Math.floor(Math.max(0, BATTLE_MS - g.t) / 15_000);
    ev.battleWon = true;
  } else {
    g.state = 'lost';
    g.over = true;
    ev.battleLost = true;
  }
}

/** Avanza la batalla `dt` ms. */
export function step(g: TowersGame, dt: number, rand: () => number): TowersEvents {
  const ev: TowersEvents = { captured: 0, lost: 0, arrived: 0, battleWon: false, battleLost: false };
  if (g.state !== 'play') return ev;
  g.t += dt;

  // Crecen las torres con dueño hasta su tope. Los refuerzos pueden pasarlo, pero lo que sobra se va
  // perdiendo: así no se forman murallas imposibles de tomar
  for (const t of g.towers) {
    if (t.units > t.cap) {
      t.units = Math.max(t.cap, t.units - (OVER_DECAY * dt) / 1000);
      continue;
    }
    if (t.owner === NEUTRAL || t.units === t.cap) continue;
    const rate = t.rate * (isAi(t.owner) ? g.aiRate : 1);
    t.units = Math.min(t.cap, t.units + (rate * dt) / 1000);
  }

  // Avanzan los soldados; al llegar se suman o luchan
  const moving: Packet[] = [];
  for (const p of g.packets) {
    p.d += (SPEED * dt) / 1000;
    if (p.d < p.len) {
      moving.push(p);
      continue;
    }
    ev.arrived++;
    const dst = g.towers[p.to];
    if (dst.owner === p.owner) {
      dst.units += p.count;
      continue;
    }
    dst.units -= p.count;
    if (dst.units < 0) {
      const prev = dst.owner;
      dst.owner = p.owner;
      dst.units = -dst.units;
      if (p.owner === PLAYER) {
        ev.captured++;
        g.captured++;
        g.score += CAPTURE_POINTS;
      } else if (prev === PLAYER) ev.lost++;
    }
  }
  g.packets = moving;

  // Piensan los rivales
  for (let owner = 2; owner < 2 + aiCount(g.battle); owner++) {
    g.aiTimer[owner] -= dt;
    if (g.aiTimer[owner] > 0) continue;
    g.aiTimer[owner] += aiThinkMs(g.battle) * (0.8 + rand() * 0.4);
    if (ownedBy(g, owner) > 0) aiMove(g, owner, rand);
  }

  // ¿Terminó la batalla?
  const enemyAlive = aiOwned(g) > 0 || g.packets.some((p) => isAi(p.owner));
  const meAlive = ownedBy(g, PLAYER) > 0 || g.packets.some((p) => p.owner === PLAYER);
  if (!meAlive) finish(g, ev, false);
  else if (!enemyAlive) finish(g, ev, true);
  else if (g.t >= BATTLE_MS) finish(g, ev, ownedBy(g, PLAYER) > aiOwned(g));
  return ev;
}

/** Posición de un grupo de soldados en su camino. */
export function packetPos(g: TowersGame, p: Packet): { x: number; y: number } {
  const a = g.towers[p.from];
  const b = g.towers[p.to];
  const k = Math.min(1, p.d / p.len);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Partida nueva con semilla aleatoria (para la pantalla). */
export function randomTowers(): { game: TowersGame; rand: () => number } {
  const rand = mulberry32(Math.floor(Math.random() * 2 ** 32));
  return { game: newTowers(rand), rand };
}
