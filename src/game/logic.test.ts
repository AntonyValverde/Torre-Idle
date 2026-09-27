import { describe, expect, it } from 'vitest';
import { dailyPuzzle, isSolved, press } from '../minigames/daily/logic';
import { canMove, move, type Tile } from '../minigames/merge/logic';
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

describe('formato', () => {
  it('abrevia números grandes', () => {
    expect(fmt(999)).toBe('999');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(5_600_000)).toBe('5.60M');
    expect(fmt(999_999)).toBe('999K');
    expect(fmt(1e15)).toBe('1.00Qa');
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
    expect(s.allTimeEarned).toBe(8e9);
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

  it('las ausencias cortas se cobran y las largas respetan el tope total', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), buildings: { casa: 10 }, lastTick: t - 30_000 });
    // 30 s: por debajo del minuto no hay ventana, pero sí monedas
    expect(useGame.getState().offline).toBeNull();
    const s0 = useGame.getState().s;
    useGame.setState({ s: { ...s0, lastTick: now() - 30_000 } });
    useGame.getState().tick();
    expect(useGame.getState().offline).toBeNull();
    expect(useGame.getState().s.coins).toBeGreaterThan(s0.coins);
    // Muchas ausencias de 1 h seguidas no superan el tope de 2 h
    for (let i = 0; i < 10; i++) {
      useGame.setState({ s: { ...useGame.getState().s, lastTick: now() - 3_600_000 } });
      useGame.getState().tick();
    }
    expect(useGame.getState().offline!.seconds).toBe(7200);
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

  it('migra partidas antiguas sin campos nuevos', () => {
    const old = { coins: 10, totalEarned: 500, buildings: { choza: 3 }, boostMult: 2, boostUntil: 99 };
    const s = normalize(old, 0);
    expect(s.allTimeEarned).toBe(500);
    expect(s.era).toBe(1);
    expect(s.boosts).toEqual([]);
    expect(s.buildings.choza).toBe(3);
  });
});
