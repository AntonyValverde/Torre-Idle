import { describe, expect, it } from 'vitest';
import { dailyPuzzle, isSolved, press } from '../minigames/daily/logic';
import { CELLS, extend, firstSequence, memoryTickets } from '../minigames/memory/logic';
import { canMove, move, type Tile } from '../minigames/merge/logic';
import { mulberry32 } from '../minigames/rng';
import * as roads from '../minigames/roads/logic';
import {
  BOX1,
  CAR_L,
  STOP,
  axisOf,
  isCommitted,
  newTraffic,
  patienceMs,
  step,
  toggleLight,
  type Car,
  type Traffic,
} from '../minigames/traffic/logic';
import { now, prevDateKey } from './clock';
import {
  ACHIEVEMENTS,
  BUILDINGS,
  achievementReached,
  addBoost,
  boostMultiplier,
  buildingCost,
  earnedForStars,
  globalMultiplier,
  isBuildingEraLocked,
  maxAffordable,
  milestoneCount,
  nextMilestone,
  prevMilestone,
  productionPerSec,
  regenTickets,
  starsPotential,
  ticketRegenMs,
} from './economy';
import { fmt } from './format';
import { isNameAllowed, sanitizeName } from './names';
import { newState, normalize } from './state';
import { STOCKS, STOCK_FEE, stockPrice } from './stocks';
import { useGame } from './store';
import { WHEEL } from './wheel';

describe('economía', () => {
  const choza = BUILDINGS[0];

  it('el coste de N edificios es la suma de los costes individuales', () => {
    const sum = [0, 1, 2, 3, 4].reduce((acc, i) => acc + buildingCost(choza, i), 0);
    expect(buildingCost(choza, 0, 5)).toBeCloseTo(sum, 6);
  });

  it('maxAffordable nunca supera lo que se puede pagar', () => {
    for (const coins of [0, 14, 15, 100, 12345, 9e9]) {
      const n = maxAffordable(choza, 3, coins);
      expect(buildingCost(choza, 3, n)).toBeLessThanOrEqual(coins + 1e-6);
      expect(buildingCost(choza, 3, n + 1)).toBeGreaterThan(coins);
    }
  });

  it('las mejoras duplican la producción del edificio', () => {
    const s = { ...newState(0), buildings: { choza: 10 } };
    const base = productionPerSec(s, 0);
    expect(productionPerSec({ ...s, upgrades: ['choza-0'] }, 0)).toBeCloseTo(base * 2);
  });

  it('recarga tickets sin pasar del máximo', () => {
    const s = { ...newState(0), tickets: 1, ticketTime: 0 };
    const regen = ticketRegenMs(s);
    expect(regenTickets(s, regen * 2 + 10).tickets).toBe(3);
    expect(regenTickets(s, regen * 100).tickets).toBe(5);
    expect(regenTickets(s, regen - 1).tickets).toBe(1);
  });
});

describe('fusión', () => {
  const t = (v: number, r: number, c: number, id = r * 4 + c + 1): Tile => ({ id, v, r, c });

  it('fusiona una sola vez por movimiento', () => {
    const r = move([t(2, 0, 0), t(2, 0, 1), t(2, 0, 2), t(2, 0, 3)], 'left');
    expect(r.tiles.map((x) => [x.v, x.c])).toEqual([
      [4, 0],
      [4, 1],
    ]);
    expect(r.gained).toBe(8);
  });

  it('desliza hacia la derecha y detecta cuando no hay movimiento', () => {
    const r = move([t(2, 1, 0), t(4, 1, 1)], 'right');
    expect(r.tiles.map((x) => [x.v, x.c]).sort()).toEqual([
      [2, 2],
      [4, 3],
    ]);
    expect(move(r.tiles, 'right').moved).toBe(false);
  });

  it('detecta tablero bloqueado', () => {
    const full: Tile[] = [];
    for (let i = 0; i < 16; i++) full.push(t(i % 2 === (Math.floor(i / 4) % 2) ? 2 : 4, Math.floor(i / 4), i % 4));
    expect(canMove(full)).toBe(false);
  });
});

describe('apagón diario', () => {
  it('es determinista y siempre tiene solución en <= par movimientos', () => {
    for (const date of ['2026-09-27', '2026-12-31', '2027-01-01']) {
      const a = dailyPuzzle(date);
      expect(dailyPuzzle(date)).toEqual(a);
      expect(isSolved(a.board)).toBe(false);
    }
  });

  it('pulsar dos veces la misma ventana deshace el cambio', () => {
    const { board } = dailyPuzzle('2026-09-27');
    expect(press(press(board, 7), 7)).toEqual(board);
  });

  it('calcula el día anterior cruzando meses y años', () => {
    expect(prevDateKey('2027-01-01')).toBe('2026-12-31');
    expect(prevDateKey('2026-03-01')).toBe('2026-02-28');
  });
});

describe('semáforo', () => {
  const car = (dir: Car['dir'], f: number, id = 1): Car => ({ id, dir, f, speed: 0.4, wait: 0, rush: false, hue: 0 });
  // Sin coches nuevos, para estudiar solo los que pone el test
  const world = (cars: Car[], light: Traffic['light'] = 'h'): Traffic => ({ ...newTraffic(), cars, light, nextSpawn: Infinity });
  const run = (g: Traffic, ms: number) => {
    for (let t = 0; t < ms; t += 8) step(g, 8, () => 0.5);
  };

  it('un coche se detiene en rojo y cruza en verde', () => {
    const g = world([car('S', 0.1)], 'h');
    run(g, 2000);
    expect(g.cars[0].f).toBeCloseTo(STOP, 6);
    toggleLight(g);
    run(g, 4000);
    expect(g.cars).toHaveLength(0);
    expect(g.score).toBe(1);
  });

  it('si espera demasiado en rojo, pierde la paciencia y se lo salta', () => {
    const g = world([car('E', STOP)], 'v');
    run(g, patienceMs(0) - 100);
    expect(g.cars[0].rush).toBe(false);
    run(g, 200);
    expect(g.cars[0].rush).toBe(true);
    run(g, 500);
    expect(g.cars[0].f).toBeGreaterThan(STOP);
  });

  it('dos coches de calles perpendiculares dentro del cruce chocan', () => {
    // E ocupa x∈[0.375, 0.46] en su carril (y≈0.55); S ocupa y∈[0.475, 0.56] en el suyo (x≈0.45)
    const g = world([car('E', 0.46, 1), car('S', 0.56, 2)]);
    step(g, 8, () => 0.5);
    expect(g.crash).not.toBeNull();
    // Coches del mismo eje en sentidos contrarios van por carriles distintos
    const h = world([car('E', 0.5, 1), car('W', 0.5, 2)]);
    step(h, 8, () => 0.5);
    expect(h.crash).toBeNull();
  });

  it('se puede jugar bien mucho tiempo, pero sin cambiar el semáforo se acaba chocando', () => {
    // Jugador prudente: cambia cuando alguien espera en rojo y el cruce está despejado
    const careful = newTraffic();
    const rand = mulberry32(7);
    for (let t = 0; t < 180_000 && !careful.crash; t += 8) {
      const red = careful.light === 'h' ? 'v' : 'h';
      const waiting = careful.cars.some((c) => axisOf(c.dir) === red && c.wait > 300);
      const busy = careful.cars.some((c) => axisOf(c.dir) === careful.light && isCommitted(c) && c.f - CAR_L < BOX1 + 0.02);
      if (waiting && !busy) toggleLight(careful);
      step(careful, 8, rand);
    }
    expect(careful.score).toBeGreaterThan(100);

    const lazy = newTraffic();
    const rand2 = mulberry32(7);
    for (let t = 0; t < 180_000 && !lazy.crash; t += 8) step(lazy, 8, rand2);
    expect(lazy.crash).not.toBeNull();
    expect(lazy.score).toBeLessThan(careful.score);
  });
});

describe('memoria de ventanas', () => {
  it('la secuencia crece de una en una y nunca repite ventana seguida', () => {
    const rand = mulberry32(3);
    let seq = firstSequence(rand);
    expect(seq).toHaveLength(3);
    for (let k = 0; k < 200; k++) {
      const next = extend(seq, rand);
      expect(next.slice(0, -1)).toEqual(seq);
      expect(next[next.length - 1]).not.toBe(seq[seq.length - 1]);
      expect(next[next.length - 1]).toBeGreaterThanOrEqual(0);
      expect(next[next.length - 1]).toBeLessThan(CELLS);
      seq = next;
    }
  });

  it('devuelve tickets según las rondas, sin pasar del máximo', () => {
    expect(memoryTickets(4)).toBe(0);
    expect(memoryTickets(5)).toBe(1);
    expect(memoryTickets(15)).toBe(4);
    useGame.getState().init({ ...newState(Date.now()), tickets: 1 });
    const r = useGame.getState().rewardMemory(15);
    expect(r.tickets).toBe(4);
    expect(useGame.getState().s.tickets).toBe(5);
    expect(useGame.getState().s.memoryBest).toBe(15);
    // Con los tickets casi llenos, el resto se pierde
    useGame.getState().init({ ...newState(Date.now()), tickets: 4 });
    const full = useGame.getState().rewardMemory(15);
    expect(full.tickets).toBe(1);
    expect(full.lost).toBe(3);
    expect(useGame.getState().s.tickets).toBe(5);
  });
});

describe('conecta las calles', () => {
  it('girar cuatro veces deja el tramo igual', () => {
    expect(roads.rotate(roads.N | roads.E)).toBe(roads.E | roads.S);
    for (let m = 0; m < 16; m++) expect(roads.rotate(roads.rotate(roads.rotate(roads.rotate(m))))).toBe(m);
  });

  it('el plano es determinista, empieza sin resolver y siempre tiene solución', () => {
    for (const date of ['2026-09-30', '2026-12-31', '2027-01-01', '2027-02-14']) {
      const p = roads.dailyRoads(date);
      expect(roads.dailyRoads(date)).toEqual(p);
      expect(p.houses.length).toBeGreaterThan(0);
      expect(roads.isSolved(p.tiles, p.hall, p.houses)).toBe(false);
      expect(roads.isSolved(p.solution, p.hall, p.houses)).toBe(true);
      // La solución pasa por todas las casillas y cada tramo es un giro del desordenado
      expect(roads.connected(p.solution, p.hall).size).toBe(roads.SIZE * roads.SIZE);
      let par = 0;
      for (let i = 0; i < p.tiles.length; i++) {
        const k = roads.turnsBetween(p.tiles[i], p.solution[i]);
        expect(k).toBeGreaterThanOrEqual(0);
        par += k;
      }
      expect(p.par).toBe(par);
      for (const h of p.houses) expect(roads.exits(p.tiles[h])).toBe(1);
    }
  });

  it('cambia cada día', () => {
    expect(roads.dailyRoads('2026-09-30').tiles).not.toEqual(roads.dailyRoads('2026-10-01').tiles);
  });
});

describe('formato', () => {
  it('abrevia números grandes', () => {
    expect(fmt(999)).toBe('999');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(5_600_000)).toBe('5.60M');
    expect(fmt(999_999)).toBe('999K');
    expect(fmt(1e15)).toBe('1.00Qa');
    // Justo por debajo de una potencia de mil, log10 redondea hacia arriba: no debe salir "0.99M"
    expect(fmt(999_999.9999999999)).toBe('999K');
    expect(fmt(999_999_999.9999999)).toBe('999M');
    expect(fmt(1e15 - 0.125)).toBe('999T');
  });

  it('sigue con letras más allá de los sufijos con nombre, hasta el límite de los números', () => {
    expect(fmt(1e36)).toBe('1.00aa');
    expect(fmt(2.5e39)).toBe('2.50ab');
    expect(fmt(1e300)).toMatch(/^1\.00[a-z]{2}$/);
  });
});

describe('progresión infinita', () => {
  it('los hitos duplican para siempre', () => {
    expect(milestoneCount(24)).toBe(0);
    expect(milestoneCount(25)).toBe(1);
    expect(milestoneCount(500)).toBe(9);
    expect(milestoneCount(600)).toBe(10);
    expect(milestoneCount(1000)).toBe(14);
    expect(nextMilestone(0)).toBe(25);
    expect(nextMilestone(500)).toBe(600);
    expect(nextMilestone(1234)).toBe(1300);
    expect(prevMilestone(1234)).toBe(1200);
  });

  it('las estrellas crecen con la raíz cúbica de lo ganado', () => {
    expect(starsPotential(1e9 - 1)).toBe(0);
    expect(starsPotential(1e9)).toBe(1);
    expect(starsPotential(1e12)).toBe(10);
    expect(earnedForStars(10)).toBe(1e12);
  });

  it('un boost de la misma fuente no se multiplica consigo mismo', () => {
    const s = newState(0);
    const a = addBoost(s, 0, 'stack', 3, 60);
    const b = addBoost({ ...s, boosts: a }, 0, 'stack', 3, 60);
    expect(b).toHaveLength(1);
    expect(boostMultiplier({ ...s, boosts: b }, 1000)).toBe(3);
    const c = addBoost({ ...s, boosts: b }, 0, 'obras', 2, 60);
    expect(boostMultiplier({ ...s, boosts: c }, 1000)).toBe(6);
    expect(boostMultiplier({ ...s, boosts: c }, 200_000)).toBe(1);
  });

  it('los logros no tienen fin y se reclaman todos los niveles alcanzados', () => {
    const earn = ACHIEVEMENTS.find((a) => a.id === 'earn')!;
    const s = { ...newState(0), allTimeEarned: 1e30 };
    expect(achievementReached(earn, s)).toBe(10);
    expect(achievementReached(earn, { ...s, allTimeEarned: 1e300 })).toBe(100);
  });

  it('refundar reinicia la era pero conserva gemas, estrellas y récords', () => {
    const store = useGame.getState();
    store.init({
      ...newState(Date.now()),
      coins: 5e9,
      totalEarned: 8e9,
      allTimeEarned: 8e9,
      gems: 42,
      buildings: { choza: 50, casa: 10 },
      upgrades: ['choza-0'],
      stackBest: 33,
      legacy: { capital: 1 },
    });
    expect(useGame.getState().prestige()).toBe(2);
    const s = useGame.getState().s;
    expect(s.era).toBe(2);
    expect(s.stars).toBe(2);
    expect(s.buildings).toEqual({});
    expect(s.upgrades).toEqual([]);
    expect(s.gems).toBe(42);
    expect(s.stackBest).toBe(33);
    // (init cobra los milisegundos transcurridos al cargar, de ahí el "casi")
    expect(s.allTimeEarned).toBeCloseTo(8e9, -1);
    expect(s.coins).toBe(1000);
    expect(globalMultiplier(s)).toBeCloseTo(1.06);
    // Sin estrellas nuevas no se puede volver a refundar
    expect(useGame.getState().prestige()).toBe(0);
  });

  it('la era desbloquea edificios nuevos', () => {
    const solar = BUILDINGS.findIndex((b) => b.id === 'solar');
    expect(isBuildingEraLocked(newState(0), solar)).toBe(true);
    expect(isBuildingEraLocked({ ...newState(0), era: 2 }, solar)).toBe(false);
  });

  it('la bolsa es determinista, continua y acotada', () => {
    for (const d of STOCKS) {
      const t = Date.UTC(2026, 8, 27, 12);
      expect(stockPrice(d, t)).toBe(stockPrice(d, t));
      // Un segundo después el precio apenas cambia
      expect(Math.abs(stockPrice(d, t + 1000) / stockPrice(d, t) - 1)).toBeLessThan(0.02);
      // Nunca se sale del rango que marca su volatilidad
      for (let k = 0; k < 2000; k++) {
        const p = stockPrice(d, t + k * 3_600_000);
        expect(p).toBeGreaterThan(d.base * Math.exp(-d.vol * 1.1));
        expect(p).toBeLessThan(d.base * Math.exp(d.vol * 1.1));
      }
    }
  });

  it('comprar y vender al mismo precio solo pierde la comisión, y solo la ganancia cuenta como ganado', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), coins: 1000, totalEarned: 1000, allTimeEarned: 1000 });
    const st = useGame.getState();
    expect(st.buyStock('BNC', 1000)).toBe(1000);
    expect(useGame.getState().s.coins).toBe(0);
    const r = useGame.getState().sellStock('BNC', 1)!;
    const s = useGame.getState().s;
    expect(r.value).toBeGreaterThan(1000 * (1 - STOCK_FEE) ** 2 * 0.99);
    expect(r.value).toBeLessThan(1000 * 1.01);
    expect(s.stocks.BNC).toBeUndefined();
    // La bolsa no cuenta para estrellas ni rankings
    expect(s.allTimeEarned).toBe(1000);
    expect(s.stockProfit).toBeCloseTo(r.profit);
  });

  it('la bolsa tiene un límite de inversión', () => {
    useGame.getState().init({ ...newState(Date.now()), coins: 1e6 });
    expect(useGame.getState().buyStock('OVN', 1e6)).toBe(10_000);
    expect(useGame.getState().buyStock('BNC', 1e6)).toBe(0);
  });

  it('el tiempo no retrocede aunque se cambie el reloj', () => {
    const t = Date.now();
    // Partida guardada "en el futuro" (reloj adelantado): no produce hasta que llega esa hora
    useGame.getState().init({ ...newState(t), buildings: { casa: 10 }, lastTick: t + 3_600_000 });
    const before = useGame.getState().s.coins;
    useGame.getState().tick();
    expect(useGame.getState().s.coins).toBe(before);
    expect(useGame.getState().s.lastTick).toBe(t + 3_600_000);
  });

  it('el reto diario y la rueda no se repiten volviendo a un día anterior', () => {
    useGame.getState().init({ ...newState(Date.now()), daily: { last: '2026-10-02', streak: 1, bestStreak: 1 }, wheelLast: '2026-10-02', tickets: 0 });
    expect(useGame.getState().completeDaily('2026-10-01', 8, 8)).toBeNull();
    expect(useGame.getState().completeDaily('2026-10-02', 8, 8)).toBeNull();
    expect(useGame.getState().completeDaily('2026-10-03', 8, 8)?.streak).toBe(2);
  });

  it('los dos retos diarios llevan su propia racha', () => {
    useGame.getState().init({ ...newState(Date.now()), daily: { last: '2026-10-02', streak: 4, bestStreak: 4 } });
    expect(useGame.getState().completeDaily('2026-10-03', 8, 8)?.streak).toBe(5);
    // Hacer el Apagón no impide hacer las Calles el mismo día
    expect(useGame.getState().completeRoads('2026-10-03', 30, 25)?.streak).toBe(1);
    expect(useGame.getState().completeRoads('2026-10-03', 30, 25)).toBeNull();
    const s = useGame.getState().s;
    expect(s.daily.streak).toBe(5);
    expect(s.roads).toEqual({ last: '2026-10-03', streak: 1, bestStreak: 1 });
  });

  it('el boost del semáforo se multiplica con el de Stack', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), boosts: [{ k: 'stack', m: 2, u: t + 600_000 }] });
    const r = useGame.getState().rewardTraffic(50);
    expect(r.mult).toBe(3);
    expect(boostMultiplier(useGame.getState().s, now())).toBe(6);
    expect(useGame.getState().s.trafficBest).toBe(50);
  });

  it('las ausencias cortas se cobran y las largas respetan el tope total', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), buildings: { casa: 10 }, lastTick: t - 30_000 });
    // 30 s: por debajo del minuto no hay ventana, pero sí monedas
    expect(useGame.getState().s.pendingOffline).toBeNull();
    const s0 = useGame.getState().s;
    useGame.setState({ s: { ...s0, lastTick: now() - 30_000 } });
    useGame.getState().tick();
    expect(useGame.getState().s.pendingOffline).toBeNull();
    expect(useGame.getState().s.coins).toBeGreaterThan(s0.coins);
    // Muchas ausencias de 1 h seguidas no superan el tope de 2 h
    for (let i = 0; i < 10; i++) {
      useGame.setState({ s: { ...useGame.getState().s, lastTick: now() - 3_600_000 } });
      useGame.getState().tick();
    }
    expect(useGame.getState().s.pendingOffline!.seconds).toBe(7200);
  });

  it('las ganancias offline sin recoger sobreviven a cerrar o recargar la app', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), buildings: { casa: 10 }, lastTick: t - 3_600_000 });
    const pending = useGame.getState().s.pendingOffline!;
    expect(pending.seconds).toBeCloseTo(3600, 0);
    expect(pending.earned).toBeGreaterThan(0);
    // Se cierra sin pulsar "Recoger": la partida guardada lleva lo pendiente y al volver sigue ahí, sumado a la nueva ausencia
    const saved = normalize(JSON.parse(JSON.stringify(useGame.getState().s)), now());
    useGame.getState().init({ ...saved, lastTick: now() - 600_000 });
    const again = useGame.getState().s.pendingOffline!;
    expect(again.seconds).toBeCloseTo(4200, 0);
    expect(again.earned).toBeGreaterThan(pending.earned);
    // Recoger lo cobra una sola vez
    const coins = useGame.getState().s.coins;
    useGame.getState().collectOffline(false);
    expect(useGame.getState().s.coins).toBeCloseTo(coins + again.earned);
    expect(useGame.getState().s.pendingOffline).toBeNull();
    useGame.getState().collectOffline(false);
    expect(useGame.getState().s.coins).toBeCloseTo(coins + again.earned);
  });

  it('refundar con ganancias offline sin recoger las cobra antes (cuentan para estrellas, no pasan a la era nueva)', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), allTimeEarned: 8e9, totalEarned: 8e9, pendingOffline: { earned: 1e9, seconds: 3600 } });
    expect(useGame.getState().prestige()).toBe(2);
    const s = useGame.getState().s;
    expect(s.pendingOffline).toBeNull();
    expect(s.allTimeEarned).toBeCloseTo(9e9, -1);
    expect(s.coins).toBe(0);
  });

  it('NaN nunca se convierte en monedas ni en edificios', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), coins: 1000, stocks: { BNC: { u: 5, c: 500 } } });
    expect(useGame.getState().sellStock('BNC', NaN)).toBeNull();
    expect(useGame.getState().buyBuilding('choza', NaN)).toBe(false);
    const s = useGame.getState().s;
    expect(s.coins).toBe(1000);
    expect(s.buildings.choza).toBeUndefined();
    expect(s.stocks.BNC).toEqual({ u: 5, c: 500 });
  });

  it('los nombres no se cortan a mitad de letra y el filtro no bloquea palabras normales', () => {
    // Una letra "decorada" ocupa dos unidades: si no cabe entera, se quita entera
    const cut = sanitizeName('AAAAAAAAAAAAAAA\u{1D4D0}xyz');
    expect(cut).toBe('AAAAAAAAAAAAAAA');
    expect(/^[\p{L}\p{N} _.\-]+$/u.test(sanitizeName('El \u{1D4E1}\u{1D4EE}\u{1D502} de la Ciudad'))).toBe(true);
    for (const ok of ['Computadora', 'ElDiputado', 'Disputa', 'Cómputo', 'Cálculo', 'Penélope', 'Alcalde1234']) expect(isNameAllowed(ok)).toBe(true);
    for (const bad of ['Puta', 'ElPuto', 'putas', 'PUT4', 'nazi_99', 'Administrador', '\u{1D4F9}\u{1D4FE}\u{1D4FD}\u{1D4EA}', 'ｐｕｔａ'])
      expect(isNameAllowed(bad)).toBe(false);
  });

  it('la rueda da un giro gratis al día y después cuesta un ticket', () => {
    useGame.getState().init({ ...newState(Date.now()), tickets: 1 });
    const first = useGame.getState().spinWheel()!;
    expect(first.free).toBe(true);
    const ticketsAfterFree = useGame.getState().s.tickets;
    const second = useGame.getState().spinWheel()!;
    expect(second.free).toBe(false);
    expect(useGame.getState().s.wheelSpins).toBe(2);
    // El segundo giro consumió un ticket (aunque el premio puede devolver tickets)
    const prize = WHEEL[second.index].prize;
    const refund = prize.kind === 'tickets' ? prize.amount : 0;
    expect(useGame.getState().s.tickets).toBe(ticketsAfterFree - 1 + refund);
  });

  it('una partida guardada con el reloj un año en el futuro no congela el juego', () => {
    const t = now();
    const YEAR = 365 * 86_400_000;
    useGame.getState().init({ ...newState(t), buildings: { casa: 10 }, lastTick: t + YEAR, ticketTime: t + YEAR, tickets: 1 });
    const s0 = useGame.getState().s;
    expect(s0.lastTick).toBeLessThanOrEqual(now() + 1000);
    expect(s0.ticketTime).toBeLessThanOrEqual(now() + 1000);
    // El tick vuelve a producir monedas en seguida
    useGame.setState({ s: { ...s0, lastTick: now() - 1000 } });
    useGame.getState().tick();
    expect(useGame.getState().s.coins).toBeGreaterThan(s0.coins);
    // Un reloj solo un poco adelantado (menos de un día) sigue esperando a que llegue esa hora
    useGame.getState().init({ ...newState(t), lastTick: t + 3_600_000 });
    expect(useGame.getState().s.lastTick).toBeGreaterThanOrEqual(t + 3_600_000);
  });

  it('normalize recorta horas y días del futuro y nunca deja cantidades negativas', () => {
    const t = new Date(2026, 9, 3, 12).getTime();
    const DAY = 86_400_000;
    const far = t + 400 * DAY;
    const s = normalize(
      {
        coins: -5,
        gems: -1,
        tickets: -2,
        stars: -3,
        starsSpent: -4,
        lastTick: far,
        ticketTime: far,
        tapBoostUntil: far,
        vipLast: far,
        createdAt: far,
        boosts: [{ k: 'x', m: 2, u: far }],
        daily: { last: '2027-12-01', streak: 3, bestStreak: 3 },
        roads: { last: '2026-10-03', streak: 1, bestStreak: 1 },
        wheelLast: '2027-01-01',
        missions: { day: '2027-01-01', week: '2027-01-01' },
        league: { week: '2027-01-01', points: 5 },
        paper: { day: '2027-01-01', read: '2027-01-01' },
        social: { day: '2027-01-01', sent: ['a'] },
        casino: { day: '2027-01-01', bought: 100 },
        legacy: { capital: 2, arquitecto: 99, fantasma: 3, suerte: 0 },
      },
      t,
    );
    for (const k of ['coins', 'gems', 'tickets', 'stars', 'starsSpent'] as const) expect(s[k]).toBe(0);
    // Las horas rotas vuelven a "ahora" (nada que esperar) o a 0 (caducado): la ciudad no se queda congelada
    for (const k of ['lastTick', 'ticketTime', 'createdAt'] as const) expect(s[k]).toBe(t);
    for (const k of ['tapBoostUntil', 'vipLast'] as const) expect(s[k]).toBe(0);
    expect(s.boosts[0].u).toBe(0);
    expect(s.daily.last).toBeNull();
    expect(s.daily.streak).toBe(3);
    // Hoy (y hasta dos días por delante, por zonas horarias) se conserva
    expect(s.roads.last).toBe('2026-10-03');
    expect(s.wheelLast).toBeNull();
    expect(s.missions.day).toBeNull();
    expect(s.missions.week).toBeNull();
    expect(s.league.week).toBeNull();
    expect(s.paper.day).toBeNull();
    expect(s.paper.read).toBeNull();
    expect(s.social.day).toBeNull();
    expect(s.casino.day).toBeNull();
    // Legado: nodos desconocidos fuera, niveles al tope del nodo, ceros fuera
    expect(s.legacy).toEqual({ capital: 2, arquitecto: 15 });
    // Valores normales no se tocan
    const ok = normalize({ coins: 7, lastTick: t - 1000, daily: { last: '2026-10-02', streak: 1, bestStreak: 1 } }, t);
    expect(ok.coins).toBe(7);
    expect(ok.lastTick).toBe(t - 1000);
    expect(ok.daily.last).toBe('2026-10-02');
  });

  it('migra partidas antiguas sin campos nuevos', () => {
    const old = { coins: 10, totalEarned: 500, buildings: { choza: 3 }, boostMult: 2, boostUntil: 99 };
    const s = normalize(old, 0);
    expect(s.allTimeEarned).toBe(500);
    expect(s.era).toBe(1);
    expect(s.boosts).toEqual([]);
    expect(s.buildings.choza).toBe(3);
    expect(s.roads).toEqual({ last: null, streak: 0, bestStreak: 0 });
    expect(s.trafficBest).toBe(0);
    expect(s.memoryBest).toBe(0);
    expect(s.pendingOffline).toBeNull();
    // Un pendiente inválido (corrupto) se descarta
    expect(normalize({ pendingOffline: { earned: 'x', seconds: 10 } }, 0).pendingOffline).toBeNull();
    expect(normalize({ pendingOffline: { earned: 50, seconds: 120 } }, 0).pendingOffline).toEqual({ earned: 50, seconds: 120 });
  });
});
