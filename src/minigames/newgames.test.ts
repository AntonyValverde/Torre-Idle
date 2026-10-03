import { describe, expect, it } from 'vitest';
import * as fire from './fire/logic';
import * as metro from './metro/logic';
import * as parks from './parks/logic';
import * as towers from './towers/logic';
import { mulberry32 } from './rng';

describe('Guerra de torres', () => {
  const connected = (adj: number[][]) => {
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) for (const j of adj[stack.pop()!]) if (!seen.has(j)) seen.add(j), stack.push(j);
    return seen.size === adj.length;
  };

  it('cada batalla tiene tu torre, la del rival y caminos que lo unen todo', () => {
    for (let battle = 1; battle <= 9; battle++) {
      for (let seed = 1; seed <= 20; seed++) {
        const { towers: ts, adj } = towers.makeBattle(battle, mulberry32(seed * 31 + battle));
        expect(ts).toHaveLength(towers.towerCount(battle));
        expect(ts.filter((t) => t.owner === towers.PLAYER)).toHaveLength(1);
        expect(ts.filter((t) => towers.isAi(t.owner))).toHaveLength(towers.aiCount(battle));
        expect(connected(adj)).toBe(true);
        // Los caminos van en los dos sentidos
        adj.forEach((ns, a) => ns.forEach((b) => expect(adj[b]).toContain(a)));
        for (const t of ts) {
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.x).toBeLessThanOrEqual(towers.FIELD_W);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeLessThanOrEqual(towers.FIELD_H);
        }
      }
    }
  });

  it('en la primera batalla el primer envío ya conquista una vecina (casi siempre)', () => {
    let ok = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const g = towers.newTowers(mulberry32(seed));
      const me = g.towers.findIndex((t) => t.owner === towers.PLAYER);
      const out = towers.sendAmount(g.towers[me].units);
      if (g.adj[me].some((j) => g.towers[j].owner === towers.NEUTRAL && g.towers[j].units < out)) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(45);
  });

  it('la misma semilla da el mismo mapa', () => {
    expect(towers.makeBattle(3, mulberry32(7))).toEqual(towers.makeBattle(3, mulberry32(7)));
  });

  it('enviar manda todos los soldados por un camino y al llegar conquista con lo que sobra', () => {
    const g = towers.newTowers(mulberry32(5));
    g.aiTimer = [0, 0, 1e9, 1e9];
    const me = g.towers.findIndex((t) => t.owner === towers.PLAYER);
    // Una vecina que no sea la del rival (si no, conquistarla ganaría la batalla)
    const to = g.adj[me].find((j) => !towers.isAi(g.towers[j].owner))!;
    const other = g.towers.findIndex((_, i) => i !== me && !g.adj[me].includes(i));
    g.towers[me].units = 20;
    g.towers[to] = { ...g.towers[to], owner: towers.NEUTRAL, units: 4 };
    // Sin camino o desde una torre ajena no se puede
    if (other >= 0) expect(towers.send(g, me, other)).toBe(0);
    expect(towers.send(g, to, me)).toBe(0);
    expect(towers.send(g, me, to)).toBe(20);
    expect(g.towers[me].units).toBe(0);
    // Sin soldados ya no se puede volver a enviar
    expect(towers.send(g, me, to)).toBe(0);
    const len = g.packets[0].len;
    towers.step(g, (len / towers.SPEED) * 1000 + 50, mulberry32(1));
    expect(g.towers[to].owner).toBe(towers.PLAYER);
    expect(g.towers[to].units).toBeCloseTo(16, 0);
    expect(g.captured).toBe(1);
    expect(g.score).toBe(towers.CAPTURE_POINTS);
  });

  it('los refuerzos a una torre propia se suman', () => {
    const g = towers.newTowers(mulberry32(8));
    g.aiTimer = [0, 0, 1e9, 1e9];
    const me = g.towers.findIndex((t) => t.owner === towers.PLAYER);
    const to = g.adj[me].find((j) => !towers.isAi(g.towers[j].owner))!;
    g.towers[to] = { ...g.towers[to], owner: towers.PLAYER, units: 3 };
    g.towers[me].units = 9;
    expect(towers.send(g, me, to)).toBe(9);
    towers.step(g, (g.packets[0].len / towers.SPEED) * 1000 + 50, mulberry32(1));
    expect(g.towers[to].units).toBeGreaterThan(11);
    expect(g.towers[to].owner).toBe(towers.PLAYER);
  });

  it('lo que pasa del tope se va perdiendo', () => {
    const g = towers.newTowers(mulberry32(8));
    g.aiTimer = [0, 0, 1e9, 1e9];
    const me = g.towers.findIndex((t) => t.owner === towers.PLAYER);
    const t = g.towers[me];
    t.units = t.cap + 10;
    towers.step(g, 2000, mulberry32(1));
    expect(t.units).toBeCloseTo(t.cap + 10 - 2 * towers.OVER_DECAY);
    towers.step(g, 10_000, mulberry32(1));
    expect(t.units).toBe(t.cap);
  });

  it('gana la batalla quien elimina al rival, y la siguiente es más grande', () => {
    const g = towers.newTowers(mulberry32(3));
    for (const t of g.towers) if (towers.isAi(t.owner)) t.owner = towers.PLAYER;
    const ev = towers.step(g, 100, mulberry32(1));
    expect(ev.battleWon).toBe(true);
    expect(g.state).toBe('won');
    expect(g.won).toBe(1);
    expect(g.score).toBeGreaterThanOrEqual(towers.WIN_POINTS);
    const next = towers.nextBattle(g, mulberry32(4));
    expect(next.battle).toBe(2);
    expect(next.score).toBe(g.score);
    expect(next.towers.length).toBeGreaterThan(g.towers.length);
    expect(next.state).toBe('play');
  });

  it('pierdes si te quedas sin torres ni soldados en camino', () => {
    const g = towers.newTowers(mulberry32(3));
    for (const t of g.towers) if (t.owner === towers.PLAYER) t.owner = 2;
    const ev = towers.step(g, 100, mulberry32(1));
    expect(ev.battleLost).toBe(true);
    expect(g.over).toBe(true);
    // Terminada, ya no cambia nada
    expect(towers.step(g, 1000, mulberry32(1)).battleLost).toBe(false);
  });

  it('al acabarse el tiempo gana quien tiene más torres', () => {
    const g = towers.newTowers(mulberry32(9));
    g.aiTimer = [0, 0, 1e9, 1e9];
    const neutral = g.towers.findIndex((t) => t.owner === towers.NEUTRAL);
    g.towers[neutral].owner = towers.PLAYER;
    g.t = towers.BATTLE_MS - 10;
    expect(towers.step(g, 20, mulberry32(1)).battleWon).toBe(true);

    const h = towers.newTowers(mulberry32(9));
    h.aiTimer = [0, 0, 1e9, 1e9];
    h.t = towers.BATTLE_MS - 10;
    // Empate (una torre cada uno): pierdes
    expect(towers.step(h, 20, mulberry32(1)).battleLost).toBe(true);
  });

  it('el rival ataca si puede ganar una torre vecina', () => {
    const g = towers.newTowers(mulberry32(11));
    const ai = g.towers.findIndex((t) => t.owner === 2);
    const to = g.adj[ai][0];
    g.towers[ai].units = 30;
    g.towers[to] = { ...g.towers[to], owner: towers.NEUTRAL, units: 2 };
    g.battle = 9; // sin dudas
    expect(towers.aiMove(g, 2, mulberry32(1))).toBe(true);
    expect(g.packets.some((p) => p.owner === 2)).toBe(true);
  });

  it('si no haces nada, el rival se expande', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = towers.newTowers(mulberry32(seed));
      const rand = mulberry32(seed + 100);
      for (let t = 0; t < 60_000 && g.state === 'play'; t += 50) towers.step(g, 50, rand);
      expect(g.towers.filter((t) => t.owner === 2).length).toBeGreaterThan(1);
    }
  });
});

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
    const d = metro.addStation(g, mulberry32(9))!;
    expect(metro.connect(g, d.id, a).kind).toBe('new');
    expect(g.lines.length).toBe(metro.MAX_LINES);
    metro.removeLine(g, g.lines[2].id);
    expect(g.lines.length).toBe(2);
  });

  it('no hay más de tres líneas', () => {
    const g = setup();
    const rand = mulberry32(5);
    while (g.stations.length < 6) metro.addStation(g, rand);
    const [s0, s1, s2, s3, s4, s5] = g.stations.map((s) => s.id);
    expect(metro.connect(g, s0, s1).kind).toBe('new');
    expect(metro.connect(g, s1, s2).kind).toBe('extend');
    expect(metro.connect(g, s3, s4).kind).toBe('new');
    expect(metro.connect(g, s5, s0).kind).toBe('new');
    // Desde una estación intermedia saldría otra línea, pero ya no quedan
    expect(metro.connect(g, s1, s3)).toEqual({ kind: 'none', reason: 'nolines' });
    expect(new Set(g.lines.map((l) => l.color)).size).toBe(metro.MAX_LINES);
  });

  it('desde el extremo de una línea, pasar por una estación de esa misma línea no crea otra repetida', () => {
    const g = setup();
    const [a, b, c] = g.stations.map((s) => s.id);
    metro.connect(g, a, b);
    metro.connect(g, b, c);
    // a-b-c: arrastrar desde c y rozar b no gasta una línea nueva
    expect(metro.connect(g, c, b)).toEqual({ kind: 'none', reason: 'inline' });
    expect(metro.connect(g, a, b)).toEqual({ kind: 'none', reason: 'inline' });
    expect(g.lines.length).toBe(1);
    // Pero si es extremo de otra línea que no pasa por esa estación, la alarga
    const d = metro.addStation(g, mulberry32(9))!;
    expect(metro.connect(g, d.id, c).kind).toBe('new');
    expect(metro.connect(g, c, a).kind).toBe('extend');
    expect(g.lines[1].stops).toEqual([d.id, c, a]);
  });

  it('al borrar una línea, los viajeros que iban a la estación donde se bajan cuentan como entregados', () => {
    const g = setup();
    const [sa, sb, sc] = g.stations;
    metro.connect(g, sa.id, sb.id);
    const line = g.lines[0];
    // El tren sigue en la primera parada (sa)
    line.train.cargo = [sa.shape, sc.shape, sa.shape];
    expect(metro.removeLine(g, line.id)).toBe(2);
    expect(g.score).toBe(2);
    expect(sa.queue).toEqual([sc.shape]);
    expect(g.lines.length).toBe(0);
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
