import { describe, expect, it } from 'vitest';
import * as fire from './fire/logic';
import * as metro from './metro/logic';
import * as parks from './parks/logic';
import { mulberry32 } from './rng';

describe('Bomberos', () => {
  it('empieza sin fuego y con el depósito lleno', () => {
    const g = fire.newFire();
    expect(fire.burning(g)).toBe(0);
    expect(g.water).toBe(fire.WATER_MAX);
  });

  it('salen fuegos que crecen hasta el máximo y luego se propagan', () => {
    const g = fire.newFire();
    const rand = mulberry32(1);
    fire.step(g, 700, rand);
    expect(fire.burning(g)).toBe(1);
    const i = g.level.findIndex((l) => l > 0);
    // Sin tocar nada: crece de nivel en nivel
    g.nextSpawn = 1e9;
    for (let k = 0; k < 2; k++) fire.step(g, fire.growMs(g.t) + 1, rand);
    expect(g.level[i]).toBe(fire.MAX_LEVEL);
    fire.step(g, fire.growMs(g.t) + 1, rand);
    expect(fire.burning(g)).toBe(2);
    expect(fire.neighbors(i).some((j) => g.level[j] > 0)).toBe(true);
  });

  it('cada chorro baja un nivel y apagar del todo da puntos extra', () => {
    const g = fire.newFire();
    g.level[5] = 2;
    expect(fire.spray(g, 5)).toEqual({ kind: 'hit', points: fire.HIT_POINTS, out: false });
    expect(fire.spray(g, 5)).toEqual({ kind: 'hit', points: fire.HIT_POINTS + fire.PUT_OUT_BONUS, out: true });
    expect(g.score).toBe(2 * fire.HIT_POINTS + fire.PUT_OUT_BONUS);
    expect(g.putOut).toBe(1);
    // Tocar una ventana sin fuego gasta agua igualmente
    expect(fire.spray(g, 0)).toEqual({ kind: 'miss' });
    expect(g.water).toBe(fire.WATER_MAX - 3);
  });

  it('sin agua no se puede apagar y el depósito se recarga solo', () => {
    const g = fire.newFire();
    g.level[3] = 3;
    g.water = 0;
    expect(fire.spray(g, 3).kind).toBe('empty');
    expect(g.level[3]).toBe(3);
    g.nextSpawn = 1e9;
    g.timer[3] = 1e9;
    fire.step(g, fire.WATER_REFILL_MS * 3 + 10, mulberry32(2));
    expect(g.water).toBe(3);
  });

  it('se pierde con LOSE_AT ventanas ardiendo a la vez', () => {
    const g = fire.newFire();
    for (let i = 0; i < fire.LOSE_AT - 1; i++) {
      g.level[i] = 1;
      g.timer[i] = 1e9;
    }
    g.nextSpawn = 1;
    const ev = fire.step(g, 5, mulberry32(3));
    expect(ev.lost).toBe(true);
    expect(g.over).toBe(true);
    expect(fire.spray(g, 0).kind).toBe('miss');
  });

  it('cada vez va más rápido, con un límite', () => {
    expect(fire.spawnMs(120_000)).toBeLessThan(fire.spawnMs(0));
    expect(fire.growMs(120_000)).toBeLessThan(fire.growMs(0));
    expect(fire.spawnMs(1e9)).toBe(300);
    expect(fire.growMs(1e9)).toBe(700);
  });
});

describe('Plan verde', () => {
  const rows = (c: parks.Cell[]) => Array.from({ length: parks.SIZE }, (_, r) => c.slice(r * parks.SIZE, (r + 1) * parks.SIZE));

  it('el plano del día es el mismo para todos y cambia cada día', () => {
    expect(parks.dailyParks('2026-10-01')).toEqual(parks.dailyParks('2026-10-01'));
    expect(parks.dailyParks('2026-10-01').givens).not.toEqual(parks.dailyParks('2026-10-02').givens);
  });

  it('la solución cumple las reglas y las casillas fijas coinciden con ella', () => {
    for (const date of ['2026-10-01', '2026-12-24', '2027-02-28']) {
      const p = parks.dailyParks(date);
      expect(parks.isSolved(p.solution)).toBe(true);
      for (const row of rows(p.solution)) expect(row.filter((x) => x === parks.HOUSE).length).toBe(parks.HALF);
      p.givens.forEach((g, i) => g && expect(g).toBe(p.solution[i]));
    }
  });

  it('tiene una única solución y deja casillas para jugar', () => {
    for (const date of ['2026-10-01', '2026-11-15', '2027-01-07']) {
      const p = parks.dailyParks(date);
      const r = parks.countSolutions(p.givens, 3);
      expect(r.count).toBe(1);
      expect(r.first).toEqual(p.solution);
      const free = p.givens.filter((g) => !g).length;
      expect(free).toBeGreaterThan(15);
      // Par: una casa es 1 toque y un parque 2
      expect(p.par).toBeGreaterThanOrEqual(free);
      expect(p.par).toBeLessThanOrEqual(free * 2);
    }
  });

  it('marca tres iguales seguidos y filas con más de la mitad', () => {
    const c: parks.Cell[] = Array(36).fill(parks.EMPTY);
    c[0] = c[1] = c[2] = parks.HOUSE;
    expect([...parks.problems(c)].sort()).toEqual([0, 1, 2]);
    const v: parks.Cell[] = Array(36).fill(parks.EMPTY);
    v[0] = v[2] = v[4] = v[5] = parks.PARK;
    expect(parks.problems(v).has(5)).toBe(true);
    expect(parks.isSolved(v)).toBe(false);
  });

  it('al tocar se pasa de vacío a casa, a parque y otra vez a vacío', () => {
    expect(parks.cycle(parks.EMPTY)).toBe(parks.HOUSE);
    expect(parks.cycle(parks.HOUSE)).toBe(parks.PARK);
    expect(parks.cycle(parks.PARK)).toBe(parks.EMPTY);
  });
});

describe('Metro', () => {
  const setup = () => {
    const g = metro.newMetro(mulberry32(7));
    g.nextStation = 1e12;
    g.nextPassenger = 1e12;
    return g;
  };

  it('empieza con una estación de cada forma, separadas', () => {
    const g = setup();
    expect(g.stations.map((s) => s.shape)).toEqual([0, 1, 2]);
    const [a, b] = g.stations;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(24);
  });

  it('crea líneas, las alarga por los extremos y respeta el máximo', () => {
    const g = setup();
    const [a, b, c] = g.stations.map((s) => s.id);
    const r1 = metro.connect(g, a, b);
    expect(r1.kind).toBe('new');
    expect(metro.connect(g, b, c).kind).toBe('extend');
    expect(g.lines[0].stops).toEqual([a, b, c]);
    expect(metro.connect(g, a, a)).toEqual({ kind: 'none', reason: 'same' });
    // Desde una estación intermedia sale una línea nueva
    expect(metro.connect(g, b, a).kind).toBe('new');
    expect(metro.connect(g, c, b, g.lines[1].id)).toEqual({ kind: 'none', reason: 'inline' });
    metro.connect(g, c, a);
    expect(g.lines.length).toBe(metro.MAX_LINES);
    metro.removeLine(g, g.lines[2].id);
    expect(g.lines.length).toBe(2);
  });

  it('no hay más de tres líneas', () => {
    const g = setup();
    const [a, b] = g.stations.map((s) => s.id);
    for (let k = 0; k < metro.MAX_LINES; k++) expect(metro.connect(g, a, b).kind).toBe('new');
    expect(metro.connect(g, a, b)).toEqual({ kind: 'none', reason: 'nolines' });
    expect(new Set(g.lines.map((l) => l.color)).size).toBe(metro.MAX_LINES);
  });

  it('el tren recoge a los viajeros y los deja en su destino', () => {
    const g = setup();
    const [sa, sb, sc] = g.stations;
    metro.connect(g, sa.id, sb.id);
    sa.queue.push(sb.shape, sb.shape, sc.shape);
    const rand = mulberry32(1);
    // El viajero que va a ▲ (sc) no está en la línea: se queda esperando
    let delivered = 0;
    for (let k = 0; k < 400 && delivered < 2; k++) delivered += metro.step(g, 50, rand).delivered;
    expect(delivered).toBe(2);
    expect(g.score).toBe(2);
    expect(sa.queue).toEqual([sc.shape]);
  });

  it('al alargar la línea por delante el tren no salta de sitio', () => {
    const g = setup();
    const [sa, sb, sc] = g.stations;
    metro.connect(g, sa.id, sb.id);
    for (let k = 0; k < 10; k++) metro.step(g, 50, mulberry32(1));
    const before = metro.trainPosition(g, g.lines[0]);
    metro.connect(g, sa.id, sc.id);
    expect(g.lines[0].stops[0]).toBe(sc.id);
    const after = metro.trainPosition(g, g.lines[0]);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('si un andén está desbordado demasiado tiempo se acaba la partida', () => {
    const g = setup();
    const st = g.stations[0];
    for (let k = 0; k <= metro.QUEUE_MAX; k++) st.queue.push(1);
    const rand = mulberry32(1);
    let lost = false;
    for (let k = 0; k < metro.OVER_MS / 100 + 2 && !lost; k++) lost = metro.step(g, 100, rand).lost;
    expect(lost).toBe(true);
    expect(g.lostAt).toBe(st.id);
  });

  it('salen estaciones nuevas y viajeros que van a otra forma', () => {
    const g = metro.newMetro(mulberry32(3));
    const rand = mulberry32(4);
    for (let k = 0; k < 400; k++) metro.step(g, 50, rand);
    expect(g.stations.length).toBeGreaterThan(3);
    for (const s of g.stations) for (const p of s.queue) expect(p).not.toBe(s.shape);
    expect(metro.stationAt(g, g.stations[0].x + 2, g.stations[0].y)?.id).toBe(g.stations[0].id);
    expect(metro.stationAt(g, -50, -50)).toBeNull();
  });
});
