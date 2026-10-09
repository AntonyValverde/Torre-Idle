import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { STEP_MS } from '../shooter/stage';
import {
  LAUNCHES,
  MAX_DIST,
  MAYOR_R,
  SHOP,
  SHOP_MAX,
  buy,
  fuelMax,
  leaveLanding,
  newCannon,
  nextLaunch,
  score,
  shopCost,
  step,
  type CannonGame,
  type ShopId,
} from './logic';

const idle = { press: false, hold: false };

/** Avanza hasta que la aguja (o la barra) pase por el valor buscado y pulsa. */
function pressAt(g: CannonGame, want: (g: CannonGame) => boolean) {
  for (let i = 0; i < 2000; i++) {
    if (want(g)) {
      step(g, STEP_MS, { press: true, hold: true });
      return;
    }
    step(g, STEP_MS, idle);
  }
  throw new Error('no llegó');
}

interface Bot {
  angle: number;
  power: number;
  /** Usa el cohete al caer. */
  rocket: boolean;
  order: ShopId[];
}

/** Un intento entero con un bot; devuelve la distancia. */
function launch(g: CannonGame, bot: Bot): number {
  pressAt(g, (x) => x.angle >= bot.angle);
  pressAt(g, (x) => x.power >= bot.power);
  let hold = true;
  for (let i = 0; i < 60 * 130 && g.phase === 'fly'; i++) {
    // Suelta tras disparar y vuelve a pulsar al empezar a caer
    if (hold && i > 3 && !g.burning) hold = false;
    if (bot.rocket && g.vy < 2 && g.fuel > 0) hold = true;
    step(g, STEP_MS, { press: false, hold });
  }
  expect(g.phase).toBe('landed');
  return g.launches[g.launches.length - 1].dist;
}

function shop(g: CannonGame, order: ShopId[]) {
  // Compra lo que puede en el orden de preferencia, una vuelta tras otra
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of order) if (buy(g, id)) bought = true;
  }
}

function feria(seed: number, bot: Bot): { dists: number[]; score: number; lv: string } {
  const rand = mulberry32(seed);
  const g = newCannon(rand);
  const dists: number[] = [];
  for (let i = 0; i < LAUNCHES; i++) {
    dists.push(launch(g, bot));
    if (leaveLanding(g) === 'shop') {
      shop(g, bot.order);
      nextLaunch(g, rand);
    }
  }
  expect(g.phase).toBe('over');
  return { dists, score: score(g), lv: SHOP.map((d) => g.lv[d.id]).join('') };
}

const BEGINNER = (r: () => number): Bot => ({ angle: 25 + r() * 35, power: 0.45 + r() * 0.4, rocket: false, order: ['magnet', 'springs', 'cannon', 'suit', 'glider', 'rocket'] });
const DECENT = (r: () => number): Bot => ({ angle: 36 + r() * 14, power: 0.75 + r() * 0.2, rocket: true, order: ['cannon', 'springs', 'rocket', 'suit', 'glider', 'magnet'] });
const GREAT: Bot = { angle: 44, power: 0.95, rocket: true, order: ['cannon', 'rocket', 'springs', 'suit', 'glider', 'magnet'] };

describe('Alcalde bala', () => {
  it('apuntar, fijar la fuerza y disparar', () => {
    const g = newCannon(mulberry32(1));
    expect(g.phase).toBe('aim');
    step(g, 500, idle);
    expect(g.angle).toBeGreaterThan(12);
    expect(step(g, STEP_MS, { press: true, hold: true }).locked).toBe(true);
    expect(g.phase).toBe('power');
    const a = g.angle;
    step(g, 300, idle);
    expect(g.angle).toBe(a);
    const ev = step(g, STEP_MS, { press: true, hold: true });
    expect(ev.fired).toBe(true);
    expect(g.phase).toBe('fly');
    expect(g.vx).toBeGreaterThan(0);
    expect(g.vy).toBeGreaterThan(0);
  });

  it('el cohete no arranca con el mismo dedo que dispara, sí con una pulsación nueva', () => {
    const g = newCannon(mulberry32(2));
    g.lv.rocket = 2;
    g.fuel = 1.7;
    pressAt(g, (x) => x.angle >= 40);
    pressAt(g, (x) => x.power >= 0.8);
    step(g, STEP_MS, { press: false, hold: true });
    expect(g.burning).toBe(false);
    step(g, STEP_MS, idle);
    step(g, STEP_MS, { press: true, hold: true });
    expect(g.burning).toBe(true);
    expect(g.fuel).toBeLessThan(1.7);
  });

  it('el barro para en seco y una cama elástica lanza hacia arriba', () => {
    const g = newCannon(mulberry32(3));
    pressAt(g, (x) => x.angle >= 40);
    pressAt(g, (x) => x.power >= 0.5);
    g.muds = [{ x: 100, w: 15, used: false }];
    g.tramps = [];
    Object.assign(g, { x: 105, y: MAYOR_R + 0.1, vx: 30, vy: -10 });
    const ev = step(g, STEP_MS, idle);
    expect(ev.mud).not.toBeNull();
    expect(g.phase).toBe('landed');
    expect(g.launches[0].mud).toBe(true);

    const h = newCannon(mulberry32(4));
    pressAt(h, (x) => x.angle >= 40);
    pressAt(h, (x) => x.power >= 0.5);
    h.muds = [];
    h.tramps = [{ x: 100, w: 12, used: false }];
    Object.assign(h, { x: 105, y: MAYOR_R + 0.1, vx: 30, vy: -10 });
    const ev2 = step(h, STEP_MS, idle);
    expect(ev2.tramps.length).toBe(1);
    expect(h.vy).toBeGreaterThanOrEqual(22);
  });

  it('monedas: se cogen al tocarlas y el imán atrae las cercanas', () => {
    const g = newCannon(mulberry32(5));
    pressAt(g, (x) => x.angle >= 40);
    pressAt(g, (x) => x.power >= 0.5);
    Object.assign(g, { x: 50, y: 30, vx: 20, vy: 0 });
    g.coins = [
      { x: 51, y: 30, value: 1, got: false, pulled: false },
      { x: 60, y: 30, value: 1, got: false, pulled: false },
    ];
    const ev = step(g, STEP_MS, idle);
    expect(ev.coins.length).toBe(1);
    expect(g.coins[1].pulled).toBe(true);
  });

  it('el taller cobra y sube niveles hasta el máximo; solo se compra en el taller', () => {
    const g = newCannon(mulberry32(6));
    g.money = 10000;
    expect(buy(g, 'cannon')).toBe(false);
    g.phase = 'shop';
    for (let i = 0; i < SHOP_MAX; i++) expect(buy(g, 'cannon')).toBe(true);
    expect(buy(g, 'cannon')).toBe(false);
    expect(shopCost(g, 'cannon')).toBeNull();
    expect(g.money).toBe(10000 - SHOP[0].costs.reduce((a, b) => a + b, 0));
  });

  it('cinco intentos y la puntuación es el mejor', () => {
    const r = feria(7, DECENT(mulberry32(70)));
    expect(r.dists.length).toBe(5);
    expect(r.score).toBe(Math.max(...r.dists));
  });

  it('escala de distancias de los bots', () => {
    const rows: string[] = [];
    const stats = (name: string, mk: (seed: number) => Bot) => {
      const scores: number[] = [];
      const first: number[] = [];
      for (let seed = 1; seed <= 24; seed++) {
        const r = feria(seed * 31, mk(seed));
        scores.push(r.score);
        first.push(r.dists[0]);
        if (seed <= 3) rows.push(`${name} #${seed}: ${r.dists.join(' / ')} m · niveles ${r.lv}`);
      }
      scores.sort((a, b) => a - b);
      first.sort((a, b) => a - b);
      const med = (x: number[]) => x[Math.floor(x.length / 2)];
      rows.push(`${name}: 1er intento mediana ${med(first)} m · mejor de la feria min ${scores[0]} med ${med(scores)} max ${scores[scores.length - 1]}`);
      return { first: med(first), best: med(scores), max: scores[scores.length - 1] };
    };
    const b = stats('principiante', (s) => BEGINNER(mulberry32(s)));
    const d = stats('normal', (s) => DECENT(mulberry32(s)));
    const gr = stats('experto', () => GREAT);
    console.log(rows.join('\n'));
    expect(d.first).toBeGreaterThanOrEqual(70);
    expect(d.first).toBeLessThanOrEqual(160);
    expect(b.best).toBeLessThan(d.best);
    expect(d.best).toBeLessThan(gr.best);
    expect(gr.max).toBeLessThan(MAX_DIST);
  });

  it('con todo al máximo y disparo perfecto no llega al tope', () => {
    let best = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const g = newCannon(mulberry32(seed));
      for (const d of SHOP) g.lv[d.id] = SHOP_MAX;
      g.fuel = fuelMax(SHOP_MAX);
      best = Math.max(best, launch(g, GREAT));
    }
    console.log(`todo al máximo: ${best} m`);
    expect(best).toBeLessThan(MAX_DIST);
  });
});
