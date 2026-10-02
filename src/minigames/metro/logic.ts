// "Metro": aparecen estaciones (● ▲ ■) y viajeros que quieren ir a una estación de otra forma.
// El jugador traza líneas uniendo estaciones; en cada línea va un tren que recoge a los viajeros
// cuyo destino está en esa línea y los deja al llegar. Si una estación acumula demasiada gente
// durante un rato, se acaba la partida. Cada viajero que llega es un punto.

export type Shape = 0 | 1 | 2;
export const SHAPES: Shape[] = [0, 1, 2];

/** Tamaño del plano en unidades (vertical, para el móvil). */
export const FIELD_W = 100;
export const FIELD_H = 140;
export const MAX_LINES = 3;
export const MAX_STATIONS = 12;
export const CAPACITY = 6;
/** Viajeros que caben en el andén sin agobio. */
export const QUEUE_MAX = 6;
/** Tiempo con el andén desbordado hasta perder. */
export const OVER_MS = 9000;
export const TRAIN_SPEED = 24;
export const DWELL_MS = 450;
const MIN_GAP = 24;
const MARGIN = 10;

export interface Station {
  id: number;
  x: number;
  y: number;
  shape: Shape;
  queue: Shape[];
  /** ms acumulados con el andén desbordado. */
  over: number;
}

export interface Train {
  /** Distancia recorrida desde la primera parada de la línea. */
  d: number;
  dir: 1 | -1;
  cargo: Shape[];
  /** ms que le quedan parado en la estación. */
  dwell: number;
  /** Índice de la última parada atendida (para no atenderla dos veces seguidas). */
  served: number;
}

export interface Line {
  id: number;
  /** Índice de color (0, 1 o 2). */
  color: number;
  stops: number[];
  train: Train;
}

export interface Metro {
  t: number;
  stations: Station[];
  lines: Line[];
  score: number;
  over: boolean;
  /** Estación que se desbordó (fin de partida). */
  lostAt: number | null;
  nextStation: number;
  nextPassenger: number;
  seq: number;
}

export function passengerMs(t: number): number {
  return Math.max(450, 2600 / (1 + t / 50_000));
}

export const STATION_EVERY_MS = 14_000;

function place(g: Metro, rand: () => number): { x: number; y: number } | null {
  for (let k = 0; k < 40; k++) {
    const x = MARGIN + rand() * (FIELD_W - 2 * MARGIN);
    const y = MARGIN + rand() * (FIELD_H - 2 * MARGIN);
    if (g.stations.every((s) => Math.hypot(s.x - x, s.y - y) >= MIN_GAP)) return { x, y };
  }
  return null;
}

export function addStation(g: Metro, rand: () => number, shape?: Shape): Station | null {
  if (g.stations.length >= MAX_STATIONS) return null;
  const p = place(g, rand);
  if (!p) return null;
  const r = rand();
  const st: Station = { id: ++g.seq, ...p, shape: shape ?? (r < 0.55 ? 0 : r < 0.85 ? 1 : 2), queue: [], over: 0 };
  g.stations.push(st);
  return st;
}

export function newMetro(rand: () => number): Metro {
  const g: Metro = { t: 0, stations: [], lines: [], score: 0, over: false, lostAt: null, nextStation: 8000, nextPassenger: 1500, seq: 0 };
  for (const shape of SHAPES) addStation(g, rand, shape);
  return g;
}

export function stationById(g: Metro, id: number): Station | undefined {
  return g.stations.find((s) => s.id === id);
}

/** Distancias acumuladas de cada parada desde la primera. */
export function stopDistances(g: Metro, line: Line): number[] {
  const out = [0];
  for (let i = 1; i < line.stops.length; i++) {
    const a = stationById(g, line.stops[i - 1])!;
    const b = stationById(g, line.stops[i])!;
    out.push(out[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}

/** Posición del tren en el plano y su ángulo. */
export function trainPosition(g: Metro, line: Line): { x: number; y: number; angle: number } {
  const dist = stopDistances(g, line);
  const d = line.train.d;
  let i = 0;
  while (i < dist.length - 2 && d > dist[i + 1]) i++;
  const a = stationById(g, line.stops[i])!;
  const b = stationById(g, line.stops[i + 1])!;
  const len = dist[i + 1] - dist[i] || 1;
  const u = Math.min(1, Math.max(0, (d - dist[i]) / len));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export type ConnectResult = { kind: 'new' | 'extend'; line: Line } | { kind: 'none'; reason: 'same' | 'nolines' | 'inline' };

/**
 * Une dos estaciones. Si `a` es el extremo de una línea (la indicada o cualquiera) y `b` no está en ella,
 * la alarga. Si no, crea una línea nueva (si quedan).
 */
export function connect(g: Metro, a: number, b: number, lineId?: number): ConnectResult {
  if (a === b) return { kind: 'none', reason: 'same' };
  const candidates = lineId !== undefined ? g.lines.filter((l) => l.id === lineId) : g.lines;
  // Extremo de una línea que ya pasa por `b`: al arrastrar desde ahí y rozar `b` no debe
  // salir una línea nueva repetida (gastaría una de las tres)
  let alongOwnLine = false;
  for (const line of candidates) {
    const first = line.stops[0];
    const last = line.stops[line.stops.length - 1];
    if (a !== first && a !== last) continue;
    if (line.stops.includes(b)) {
      if (lineId !== undefined) return { kind: 'none', reason: 'inline' };
      alongOwnLine = true;
      continue;
    }
    if (a === last) {
      line.stops.push(b);
    } else {
      // Al añadir por delante, todo se desplaza: el tren conserva su sitio
      const sa = stationById(g, a)!;
      const sb = stationById(g, b)!;
      line.stops.unshift(b);
      line.train.d += Math.hypot(sa.x - sb.x, sa.y - sb.y);
      if (line.train.served >= 0) line.train.served++;
    }
    return { kind: 'extend', line };
  }
  if (lineId !== undefined || alongOwnLine) return { kind: 'none', reason: 'inline' };
  if (g.lines.length >= MAX_LINES) return { kind: 'none', reason: 'nolines' };
  const used = new Set(g.lines.map((l) => l.color));
  const color = [0, 1, 2].find((c) => !used.has(c))!;
  const line: Line = { id: ++g.seq, color, stops: [a, b], train: { d: 0, dir: 1, cargo: [], dwell: 0, served: -1 } };
  g.lines.push(line);
  return { kind: 'new', line };
}

/**
 * Quita una línea. Los viajeros que iban en su tren se bajan en la estación más cercana:
 * los que iban a esa forma ya han llegado (cuentan como entregados) y el resto espera allí.
 * Devuelve cuántos llegaron así.
 */
export function removeLine(g: Metro, id: number): number {
  const line = g.lines.find((l) => l.id === id);
  if (!line) return 0;
  let delivered = 0;
  if (line.train.cargo.length) {
    const p = trainPosition(g, line);
    const near = g.stations.reduce((m, s) => (Math.hypot(s.x - p.x, s.y - p.y) < Math.hypot(m.x - p.x, m.y - p.y) ? s : m));
    delivered = line.train.cargo.filter((c) => c === near.shape).length;
    g.score += delivered;
    near.queue.push(...line.train.cargo.filter((c) => c !== near.shape));
  }
  g.lines = g.lines.filter((l) => l.id !== id);
  return delivered;
}

function lineShapes(g: Metro, line: Line): Set<Shape> {
  return new Set(line.stops.map((id) => stationById(g, id)!.shape));
}

/** El tren llega a una parada: bajan los que van a esa forma y suben los que pueden llegar en esta línea. */
function serve(g: Metro, line: Line, stop: number): { delivered: number; boarded: number } {
  const st = stationById(g, line.stops[stop])!;
  const tr = line.train;
  const before = tr.cargo.length;
  tr.cargo = tr.cargo.filter((c) => c !== st.shape);
  const delivered = before - tr.cargo.length;
  g.score += delivered;
  const reach = lineShapes(g, line);
  let boarded = 0;
  st.queue = st.queue.filter((p) => {
    if (tr.cargo.length < CAPACITY && reach.has(p)) {
      tr.cargo.push(p);
      boarded++;
      return false;
    }
    return true;
  });
  tr.served = stop;
  if (delivered || boarded) tr.dwell = DWELL_MS;
  return { delivered, boarded };
}

function moveTrain(g: Metro, line: Line, dt: number): number {
  const tr = line.train;
  let delivered = 0;
  if (tr.dwell > 0) {
    tr.dwell = Math.max(0, tr.dwell - dt);
    return 0;
  }
  const dist = stopDistances(g, line);
  const end = dist[dist.length - 1];
  const EPS = 1e-4;
  tr.d = Math.min(end, Math.max(0, tr.d));
  let left = (TRAIN_SPEED * dt) / 1000;
  for (let guard = 0; left > 0 && guard < 64; guard++) {
    // Parado en una estación que aún no atendió: la atiende
    const at = dist.findIndex((x) => Math.abs(x - tr.d) < EPS);
    if (at >= 0 && tr.served !== at) {
      delivered += serve(g, line, at).delivered;
      if (tr.dwell > 0) break;
    }
    // En los extremos da la vuelta
    if (tr.dir > 0 && tr.d >= end - EPS) tr.dir = -1;
    else if (tr.dir < 0 && tr.d <= EPS) tr.dir = 1;
    const next = tr.dir > 0 ? dist.findIndex((x) => x > tr.d + EPS) : findLastIndex(dist, (x) => x < tr.d - EPS);
    if (next < 0) break;
    const gap = Math.abs(dist[next] - tr.d);
    if (gap > left) {
      tr.d += left * tr.dir;
      left = 0;
    } else {
      tr.d = dist[next];
      left -= gap;
    }
  }
  return delivered;
}

function findLastIndex<T>(xs: T[], f: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i])) return i;
  return -1;
}

export interface MetroEvents {
  delivered: number;
  newStation: boolean;
  lost: boolean;
}

export function step(g: Metro, dt: number, rand: () => number): MetroEvents {
  const ev: MetroEvents = { delivered: 0, newStation: false, lost: false };
  if (g.over) return ev;
  g.t += dt;

  g.nextStation -= dt;
  if (g.nextStation <= 0) {
    g.nextStation += STATION_EVERY_MS;
    ev.newStation = !!addStation(g, rand);
  }

  g.nextPassenger -= dt;
  if (g.nextPassenger <= 0) {
    g.nextPassenger += passengerMs(g.t) * (0.6 + rand() * 0.8);
    const st = g.stations[Math.floor(rand() * g.stations.length)];
    const shapes = [...new Set(g.stations.map((s) => s.shape))].filter((s) => s !== st.shape);
    if (shapes.length) st.queue.push(shapes[Math.floor(rand() * shapes.length)]);
  }

  for (const line of g.lines) ev.delivered += moveTrain(g, line, dt);

  for (const st of g.stations) {
    st.over = st.queue.length > QUEUE_MAX ? st.over + dt : Math.max(0, st.over - dt * 0.5);
    if (st.over >= OVER_MS && !g.over) {
      g.over = true;
      g.lostAt = st.id;
      ev.lost = true;
    }
  }
  return ev;
}

/** Estación más cercana a un punto (dentro de `radius`). */
export function stationAt(g: Metro, x: number, y: number, radius = 9): Station | null {
  let best: Station | null = null;
  let bestD = radius;
  for (const s of g.stations) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
