// "Semáforo": llegan coches por las cuatro entradas de un cruce y el jugador cambia el semáforo.
// Si dos coches de calles perpendiculares se tocan dentro del cruce, se acaba la partida.
// Coordenadas normalizadas: el tablero mide 1×1 y el cruce ocupa [0.4, 0.6] en ambos ejes.

/** Sentido de marcha: E = hacia la derecha, W = izquierda, S = abajo, N = arriba. */
export type Dir = 'E' | 'W' | 'S' | 'N';
/** Eje con el semáforo en verde: h = calle horizontal (E/W), v = vertical (N/S). */
export type Light = 'h' | 'v';

export interface Car {
  id: number;
  dir: Dir;
  /** Posición del morro a lo largo del recorrido: 0 = asoma por su borde, 1 = llega al borde opuesto. */
  f: number;
  /** Unidades de tablero por segundo. */
  speed: number;
  /** ms parado en la línea de stop con el semáforo en rojo. */
  wait: number;
  /** Perdió la paciencia: se salta el rojo. */
  rush: boolean;
  hue: number;
}

export interface Traffic {
  cars: Car[];
  light: Light;
  score: number;
  /** ms de partida transcurridos. */
  t: number;
  nextSpawn: number;
  nextId: number;
  /** Punto del choque (si lo hubo): la partida queda congelada. */
  crash: { x: number; y: number } | null;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const DIRS: Dir[] = ['E', 'W', 'S', 'N'];
export const CAR_L = 0.085;
export const CAR_W = 0.07;
export const BOX0 = 0.4;
export const BOX1 = 0.6;
/** Donde se detiene el morro de un coche ante el rojo. */
export const STOP = BOX0 - 0.012;
/** Centro del carril de cada sentido (se circula por la derecha). */
export const LANE: Record<Dir, number> = { E: 0.55, W: 0.45, S: 0.45, N: 0.55 };
const GAP = 0.025;

export const axisOf = (d: Dir): Light => (d === 'E' || d === 'W' ? 'h' : 'v');

// La dificultad sube con los coches que ya cruzaron
export const carSpeed = (score: number) => 0.3 + Math.min(score, 200) * 0.0035;
export const spawnGapMs = (score: number) => Math.max(280, 1500 - score * 10);
export const patienceMs = (score: number) => Math.max(1600, 4800 - score * 25);

export function newTraffic(): Traffic {
  return { cars: [], light: 'h', score: 0, t: 0, nextSpawn: 300, nextId: 1, crash: null };
}

export function toggleLight(g: Traffic) {
  if (!g.crash) g.light = g.light === 'h' ? 'v' : 'h';
}

export function carRect(c: Car): Rect {
  const a = c.f - CAR_L;
  const b = c.f;
  const w0 = LANE[c.dir] - CAR_W / 2;
  const w1 = LANE[c.dir] + CAR_W / 2;
  switch (c.dir) {
    case 'E':
      return { x0: a, x1: b, y0: w0, y1: w1 };
    case 'W':
      return { x0: 1 - b, x1: 1 - a, y0: w0, y1: w1 };
    case 'S':
      return { x0: w0, x1: w1, y0: a, y1: b };
    case 'N':
      return { x0: w0, x1: w1, y0: 1 - b, y1: 1 - a };
  }
}

function overlap(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
}

/** Ya pasó la línea de stop: sigue aunque el semáforo se ponga en rojo. */
export function isCommitted(c: Car): boolean {
  return c.f > STOP + 1e-6;
}

export interface StepEvents {
  passed: number;
  crashed: boolean;
  /** Coches que acaban de perder la paciencia. */
  rushed: number;
}

/** Avanza la simulación `dtMs` milisegundos (modifica `g`). */
export function step(g: Traffic, dtMs: number, rand: () => number): StepEvents {
  const ev: StepEvents = { passed: 0, crashed: false, rushed: 0 };
  if (g.crash) return ev;
  g.t += dtMs;
  const dt = dtMs / 1000;
  const patience = patienceMs(g.score);

  for (const d of DIRS) {
    const green = g.light === axisOf(d);
    // Del primero al último del carril: cada uno respeta la distancia con el de delante
    const lane = g.cars.filter((c) => c.dir === d).sort((a, b) => b.f - a.f);
    let leader: Car | null = null;
    for (const c of lane) {
      let limit = leader ? leader.f - CAR_L - GAP : Infinity;
      const mustStop = !green && !c.rush && !isCommitted(c);
      if (mustStop) limit = Math.min(limit, STOP);
      const nf = Math.max(c.f, Math.min(c.f + c.speed * dt, limit));
      if (mustStop && STOP - nf < 0.004) {
        c.wait += dtMs;
        if (c.wait >= patience) {
          c.rush = true;
          ev.rushed++;
        }
      } else {
        c.wait = 0;
      }
      c.f = nf;
      leader = c;
    }
  }

  const before = g.cars.length;
  g.cars = g.cars.filter((c) => c.f - CAR_L <= 1);
  ev.passed = before - g.cars.length;
  g.score += ev.passed;

  for (let i = 0; i < g.cars.length && !g.crash; i++) {
    for (let j = i + 1; j < g.cars.length; j++) {
      const a = g.cars[i];
      const b = g.cars[j];
      if (axisOf(a.dir) === axisOf(b.dir)) continue;
      const o = overlap(carRect(a), carRect(b));
      if (o) {
        g.crash = { x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 };
        ev.crashed = true;
        break;
      }
    }
  }
  if (g.crash) return ev;

  if (g.t >= g.nextSpawn) {
    const order = DIRS.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const d of order) {
      const last = Math.min(...g.cars.filter((c) => c.dir === d).map((c) => c.f));
      // Solo entra si hay hueco en el borde (Math.min de una lista vacía es Infinity)
      if (last - CAR_L >= GAP + 0.01) {
        g.cars.push({
          id: g.nextId++,
          dir: d,
          f: 0,
          speed: carSpeed(g.score) * (0.9 + rand() * 0.2),
          wait: 0,
          rush: false,
          hue: Math.floor(rand() * 360),
        });
        break;
      }
    }
    g.nextSpawn = g.t + spawnGapMs(g.score) * (0.6 + rand() * 0.8);
  }
  return ev;
}
