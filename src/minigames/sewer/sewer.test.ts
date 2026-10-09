import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { emptySewerLevels, type SewerLevels } from './meta';
import {
  CELL,
  CLEAR_MS,
  COLS,
  ROWS,
  RX0,
  FIELD_W,
  RY0,
  RY1,
  TRANS_MS,
  addEnemy,
  clearLine,
  bossFor,
  dmgOf,
  maxHp,
  newSewer,
  pickHallazgo,
  speedOf,
  step,
  type SewerGame,
} from './logic';

const DT = 1000 / 60;
const still = { x: 0, y: 0 };

/** Deja la sala vacía y con un único enemigo quieto (sin animación de salida). */
function solo(g: SewerGame) {
  g.enemies = [];
  g.reserve = [];
  const e = addEnemy(g, 'shroom', FIELD_W / 2, RY0 + 60);
  e.cool = 1e9;
  return e;
}

function run(g: SewerGame, ms: number, move = still, seed = 9) {
  const r = mulberry32(seed);
  let shots = 0;
  for (let t = 0; t < ms; t += DT) shots += step(g, DT, move, r).shots;
  return shots;
}

describe('Alcantarillas', () => {
  it('las mejoras del taller se aplican a la partida', () => {
    const lv: SewerLevels = { ...emptySewerLevels(), hp: 2, dmg: 3, speed: 2 };
    const g = newSewer(mulberry32(1), lv);
    expect(maxHp(g)).toBe(5);
    expect(g.hp).toBe(5);
    expect(dmgOf(g)).toBeCloseTo(13);
    expect(speedOf(g)).toBeCloseTo(125 * 1.12);
    const base = newSewer(mulberry32(1), emptySewerLevels());
    expect(maxHp(base)).toBe(3);
    expect(base.reviveLeft).toBe(false);
    expect(Object.keys(base.lv)).toHaveLength(0);
    // Mochila: empiezas con un hallazgo; trébol: eliges entre 4
    const packed = newSewer(mulberry32(2), { ...emptySewerLevels(), pack: 1, luck: 1 });
    expect(packed.packed).not.toBeNull();
    expect(Object.values(packed.lv).reduce((a, b) => a + (b ?? 0), 0)).toBe(1);
    packed.enemies = [];
    packed.reserve = [];
    run(packed, CLEAR_MS + 100);
    expect(packed.phase).toBe('choice');
    expect(packed.offer).toHaveLength(4);
  });

  it('la segunda oportunidad te salva una sola vez', () => {
    const g = newSewer(mulberry32(3), { ...emptySewerLevels(), revive: 1, hp: 1 });
    const e = solo(g);
    g.hp = 1;
    e.x = g.x;
    e.y = g.y;
    const r = mulberry32(4);
    const ev = step(g, DT, still, r);
    expect(ev.revive).toBe(true);
    expect(g.phase).toBe('play');
    expect(g.hp).toBe(2);
    expect(g.reviveLeft).toBe(false);
    // Otra vez a cero: ahora sí se acaba
    g.inv = 0;
    g.hp = 1;
    e.x = g.x;
    e.y = g.y;
    e.kx = e.ky = 0;
    const ev2 = step(g, DT, still, r);
    expect(ev2.revive).toBe(false);
    expect(ev2.lost).toBe(true);
    expect(g.phase).toBe('over');
  });

  it('quieto disparas al más cercano; moviéndote no', () => {
    const g = newSewer(mulberry32(5), emptySewerLevels());
    solo(g);
    expect(run(g, 1000, still)).toBeGreaterThanOrEqual(2);
    const h = newSewer(mulberry32(5), emptySewerLevels());
    solo(h);
    expect(run(h, 1000, { x: 1, y: 0 })).toBe(0);
    expect(h.firing).toBe(false);
    // Al pararte vuelves a disparar enseguida
    expect(run(h, 200, still)).toBeGreaterThanOrEqual(1);
  });

  it('al limpiar la sala se abre la puerta, eliges hallazgo y pasas a la siguiente', () => {
    const g = newSewer(mulberry32(6), emptySewerLevels());
    expect(g.open).toBe(false);
    g.enemies = [];
    g.reserve = [];
    const r = mulberry32(7);
    const ev = step(g, DT, still, r);
    expect(ev.roomClear).toBe(true);
    expect(g.done).toBe(true);
    // La puerta se abre al elegir el hallazgo
    expect(g.open).toBe(false);
    expect(g.score).toBe(10);
    run(g, CLEAR_MS);
    expect(g.phase).toBe('choice');
    expect(g.offer.length).toBe(3);
    expect(pickHallazgo(g, g.offer[0].id)).toBe(true);
    expect(g.phase).toBe('play');
    expect(g.open).toBe(true);
    // Sube por la puerta
    g.x = FIELD_W / 2;
    let started = false;
    let start = 0;
    for (let i = 0; i < 600 && !start; i++) {
      const e = step(g, DT, { x: 0, y: -1 }, r);
      started ||= e.door;
      start = e.roomStart;
    }
    expect(started).toBe(true);
    expect(start).toBe(2);
    expect(g.room).toBe(2);
    expect(g.open).toBe(false);
    run(g, TRANS_MS);
    expect(g.trans).toBe(0);
    expect(g.y).toBeCloseTo(RY1 - 26);
  });

  it('la puerta no deja pasar con la sala sin limpiar', () => {
    const g = newSewer(mulberry32(8), emptySewerLevels());
    solo(g);
    g.inv = 1e9;
    g.x = FIELD_W / 2;
    run(g, 6000, { x: 0, y: -1 });
    expect(g.room).toBe(1);
    expect(g.y).toBeGreaterThanOrEqual(RY0);
  });

  it('cada 5 salas hay un jefe, alternando Rey Rata y Cocodrilo gigante', () => {
    expect(bossFor(4)).toBeNull();
    expect(bossFor(5)).toBe('king');
    expect(bossFor(10)).toBe('gator');
    expect(bossFor(15)).toBe('king');
    expect(bossFor(11)).toBeNull();
    // Llega a la sala 5 limpiando salas
    const g = newSewer(mulberry32(10), emptySewerLevels());
    const r = mulberry32(11);
    for (let room = 1; room < 5; room++) {
      g.enemies = [];
      g.reserve = [];
      run(g, CLEAR_MS + 50);
      if (g.phase === 'choice') pickHallazgo(g, g.offer[0].id);
      g.x = FIELD_W / 2;
      g.y = RY0 + 10;
      for (let i = 0; i < 200 && g.room === room; i++) step(g, DT, { x: 0, y: -1 }, r);
      run(g, TRANS_MS);
    }
    expect(g.room).toBe(5);
    expect(g.enemies.map((e) => e.kind)).toEqual(['king']);
    // Al caer el jefe: +50 y suelta un corazón
    const b = g.enemies[0];
    b.emerge = 0;
    b.hp = 1;
    const before = g.score;
    g.x = b.x;
    g.y = b.y + 60;
    let down = false;
    for (let i = 0; i < 120 && !down; i++) down = step(g, DT, still, r).bossDown;
    expect(down).toBe(true);
    expect(g.bosses).toBe(1);
    expect(g.score - before).toBeGreaterThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------------------------
// Bot: se aparta de lo que tiene cerca y, si no, se queda quieto disparando. Sirve para ver que la
// partida acaba y que la puntuación cae en la escala del arcade.
// ---------------------------------------------------------------------------------------------

/** Primer paso del camino más corto (por la rejilla) hasta una casilla desde la que se vea (tx, ty). */
function pathToSight(g: SewerGame, tx: number, ty: number, jump = false): { x: number; y: number } | null {
  const cx = (i: number) => RX0 + ((i % COLS) + 0.5) * CELL;
  const cy = (i: number) => RY0 + (Math.floor(i / COLS) + 0.5) * CELL;
  const start = Math.floor((g.y - RY0) / CELL) * COLS + Math.floor((g.x - RX0) / CELL);
  const prev = new Int32Array(COLS * ROWS).fill(-2);
  prev[start] = -1;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i !== start && clearLine(g, cx(i), cy(i), tx, ty, 2)) {
      if (jump) {
        // Atasco largo: el bot se planta ahí directamente (la navegación no es lo que se mide)
        g.x = cx(i);
        g.y = cy(i);
        return still;
      }
      let j = i;
      while (prev[j] !== start && prev[j] >= 0) j = prev[j];
      const k = Math.hypot(cx(j) - g.x, cy(j) - g.y) || 1;
      return { x: (cx(j) - g.x) / k, y: (cy(j) - g.y) / k };
    }
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + ox;
      const nr = r + oy;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (prev[ni] !== -2 || g.map.blocked[ni]) continue;
      prev[ni] = i;
      q.push(ni);
    }
  }
  return null;
}

interface BotMem {
  kills: number;
  quiet: number;
  side: number;
  /** Despistes: ratos en los que no ve el peligro (cuanto menos hábil, más). */
  lapse: number;
  rand: () => number;
}

function bot(g: SewerGame, skill: number, mem: BotMem): { x: number; y: number } {
  if (g.open) {
    // Va directo a la puerta (la navegación no es lo que se mide)
    if (g.y > RY0 + 20 || Math.abs(g.x - FIELD_W / 2) > 10) {
      g.x = FIELD_W / 2;
      g.y = RY0 + 20;
    }
    return { x: 0, y: -1 };
  }
  // Si lleva rato sin matar nada se planta a disparar un momento (como haría una persona)
  if (g.kills !== mem.kills) {
    mem.kills = g.kills;
    mem.quiet = 0;
  }
  mem.quiet += DT;
  mem.lapse -= DT;
  if (mem.lapse < -1000 && mem.rand() < (1 - skill) * 0.05) mem.lapse = 700;
  const brave = (mem.quiet > 9000 && mem.quiet % 4000 < 1500) || mem.lapse > 0;
  let ax = 0;
  let ay = 0;
  if (!brave) {
    for (const e of g.enemies) {
      if (e.emerge > 0) continue;
      const d = Math.hypot(e.x - g.x, e.y - g.y);
      // Embestida: se aparta de la línea de carga
      if ((e.state === 'warn' || e.state === 'dash') && d < 260 * skill) {
        const side = (g.x - e.x) * -e.dy + (g.y - e.y) * e.dx >= 0 ? 1 : -1;
        ax += -e.dy * side * 2;
        ay += e.dx * side * 2;
        continue;
      }
      const danger = (e.state === 'dash' || e.state === 'warn' ? 110 : 50) * skill + e.r;
      if (d < danger) {
        ax += (g.x - e.x) / (d + 1);
        ay += (g.y - e.y) / (d + 1);
      }
      if (e.cast === 'sweep' && d < 110) {
        ax += (g.x - e.x) / (d + 1);
        ay += (g.y - e.y) / (d + 1);
      }
    }
    for (const s of g.spores) {
      const d = Math.hypot(s.x - g.x, s.y - g.y);
      if (d < 40 * skill) {
        // Se aparta de lado
        ax += -s.vy / 100;
        ay += s.vx / 100;
      }
    }
  }
  const m = Math.hypot(ax, ay);
  if (m < 0.01) {
    // Sin peligro: si no ve a nadie, se acerca al más cercano para tenerlo a tiro
    const t = g.enemies.find((e) => e.id === g.target);
    if (t && !clearLine(g, g.x, g.y, t.x, t.y)) {
      const to = pathToSight(g, t.x, t.y, mem.quiet > 15000);
      if (to) return to;
    }
    return still;
  }
  // Algo hacia el centro para no quedarse en las esquinas
  ax += (FIELD_W / 2 - g.x) / 600;
  ay += ((RY0 + RY1) / 2 - g.y) / 600;
  const k = Math.hypot(ax, ay);
  return { x: ax / k, y: ay / k };
}

function botRun(seed: number, skill: number, meta: SewerLevels, capMin = 40) {
  const r = mulberry32(seed);
  const g = newSewer(r, meta);
  const mem = { kills: 0, quiet: 0, side: 0, lapse: 0, rand: mulberry32(seed * 7) };
  let t = 0;
  while (g.phase !== 'over' && t < capMin * 60 * 1000) {
    if (g.phase === 'choice') {
      pickHallazgo(g, g.offer[Math.floor(r() * g.offer.length)].id);
      continue;
    }
    step(g, DT, bot(g, skill, mem), r);
    t += DT;
  }
  return { score: g.score, room: g.room, kills: g.kills, scrap: g.scrap, min: t / 60000, over: g.phase === 'over' };
}

describe('Alcantarillas: partidas de prueba', () => {
  it('la partida acaba y la puntuación cae en la escala del arcade', { timeout: 240000 }, () => {
    const rows: string[] = [];
    for (const [name, skill, meta, n, cap] of [
      ['novato', 0.5, emptySewerLevels(), 6, 40],
      ['normal', 0.8, emptySewerLevels(), 6, 40],
      ['con taller', 1.4, { hp: 2, dmg: 3, speed: 2, pack: 1, luck: 1, revive: 1 }, 3, 25],
    ] as [string, number, SewerLevels, number, number][]) {
      const res = Array.from({ length: n }, (_, i) => botRun(100 + i, skill, meta, cap));
      for (const x of res) {
        expect(x.over).toBe(true);
        expect(x.score).toBeLessThan(5000);
      }
      const avg = (f: (x: (typeof res)[number]) => number) => Math.round((res.reduce((a, x) => a + f(x), 0) / res.length) * 10) / 10;
      rows.push(
        `${name}: puntos ${avg((x) => x.score)} (${Math.min(...res.map((x) => x.score))}–${Math.max(...res.map((x) => x.score))}) · sala ${avg((x) => x.room)} · bajas ${avg((x) => x.kills)} · chatarra ${avg((x) => x.scrap)} · ${avg((x) => x.min)} min`,
      );
    }
    console.log(rows.join('\n'));
  });
});
