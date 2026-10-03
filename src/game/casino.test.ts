import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../minigames/rng';
import { basicMove, bjDeal, bjDouble, bjHit, bjStand, handValue, type BjHand } from '../minigames/casino/blackjack';
import { cardAt } from '../minigames/casino/cards';
import { hiloCash, hiloGuess, hiloStart, stepMult, winChance } from '../minigames/casino/hilo';
import { cashMultAt, crashPoint, msToMult, rocketOver } from '../minigames/casino/rocket';
import { betReturn, isValidBet } from '../minigames/casino/roulette';
import { SCRATCH_PRIZES, newTicket, scratchRtp } from '../minigames/casino/scratch';
import { slotsRtp, spinSlots } from '../minigames/casino/slots';
import {
  CASINO_SHOP,
  DAILY_BUY_MAX,
  MIN_BET,
  PACK_CHIPS,
  WELCOME_CHIPS,
  blackjackMove,
  buyPacks,
  buyScratch,
  buyShopItem,
  casinoToday,
  cashRocket,
  claimBonus,
  claimWelcome,
  hiloMove,
  launchRocket,
  maxBet,
  packPrice,
  packsLeft,
  playRoulette,
  playSlots,
  settleRocket,
  startBlackjack,
  startHiLo,
  vipIndex,
} from './casino';
import { normalize, newState, type GameState } from './state';

const T = Date.UTC(2026, 9, 5, 15);
const DAY = 86_400_000;

function player(chips = 1000, extra: Partial<GameState> = {}): GameState {
  const s = newState(T);
  return { ...s, era: 2, coins: 1e9, ...extra, casino: { ...s.casino, chips, welcome: true, ...(extra.casino ?? {}) } };
}

describe('retorno de los juegos (siempre menos del 100%)', () => {
  it('tragaperras: ≈95% exacto y la simulación coincide', () => {
    const rtp = slotsRtp();
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(0.96);
    const rand = mulberry32(1);
    let paid = 0;
    const N = 400_000;
    for (let i = 0; i < N; i++) paid += spinSlots(rand).mult;
    expect(Math.abs(paid / N - rtp)).toBeLessThan(0.02);
  });

  it('ruleta: todas las apuestas devuelven 36/37', () => {
    const ids = ['red', 'black', 'even', 'odd', 'low', 'high', 'd1', 'd2', 'd3', 'c1', 'c2', 'c3', 'n0', 'n17', 'n36'];
    for (const id of ids) {
      expect(isValidBet(id)).toBe(true);
      let sum = 0;
      for (let n = 0; n <= 36; n++) sum += betReturn(id, n);
      expect(sum / 37).toBeCloseTo(36 / 37, 10);
    }
    expect(isValidBet('n37')).toBe(false);
    expect(isValidBet('verde')).toBe(false);
  });

  it('blackjack con estrategia básica: entre 97% y 100%', () => {
    const rand = mulberry32(7);
    let staked = 0;
    let paid = 0;
    for (let i = 0; i < 300_000; i++) {
      let h: BjHand = bjDeal(10, Math.floor(rand() * 2 ** 32));
      while (!h.result) {
        const m = basicMove(h);
        h = m === 'hit' ? bjHit(h) : m === 'stand' ? bjStand(h) : bjDouble(h);
      }
      staked += h.doubled ? 20 : 10;
      paid += h.paid;
    }
    const rtp = paid / staked;
    expect(rtp).toBeGreaterThan(0.97);
    expect(rtp).toBeLessThan(1);
  });

  it('cohete: llega a x2 un 48% de las veces y cobrar en cualquier punto devuelve ≈96%', () => {
    const rand = mulberry32(3);
    const N = 200_000;
    const crashes = Array.from({ length: N }, () => crashPoint(rand));
    expect(crashes.filter((c) => c > 2).length / N).toBeCloseTo(0.48, 1);
    for (const target of [1.5, 2, 5, 10]) {
      const ev = (crashes.filter((c) => c > target).length * target) / N;
      expect(ev).toBeLessThan(0.985);
      expect(ev).toBeGreaterThan(0.92);
    }
    expect(crashes.every((c) => c >= 1 && c <= 100)).toBe(true);
  });

  it('más alto o más bajo: cada paso devuelve menos de 1', () => {
    for (let r = 1; r <= 13; r++) {
      for (const g of ['hi', 'lo'] as const) {
        const ev = winChance(r, g) * stepMult(r, g);
        expect(ev).toBeLessThan(0.98);
      }
    }
    expect(stepMult(13, 'hi')).toBe(0);
    expect(stepMult(1, 'lo')).toBe(0);
  });

  it('rasca: ≈88,5% y el boleto enseña su premio (un solo trío o ninguno)', () => {
    expect(scratchRtp()).toBeCloseTo(0.885, 3);
    const rand = mulberry32(9);
    for (let i = 0; i < 3000; i++) {
      const tk = newTicket(rand);
      expect(tk.cells).toHaveLength(9);
      const counts = new Map<string, number>();
      for (const c of tk.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
      const trios = [...counts.entries()].filter(([, n]) => n >= 3);
      if (tk.prize < 0) expect(trios).toHaveLength(0);
      else {
        expect(trios).toEqual([[SCRATCH_PRIZES[tk.prize].emoji, 3]]);
        expect(tk.win).toBe(25 * SCRATCH_PRIZES[tk.prize].mult);
      }
    }
  });
});

describe('fichas', () => {
  it('cerrado en la era 1', () => {
    const s = { ...player(), era: 1 };
    expect(claimWelcome({ ...s, casino: { ...s.casino, welcome: false } })).toBeNull();
    expect(claimBonus(s, T)).toBeNull();
    expect(buyPacks(s, T, 1)).toBeNull();
  });

  it('regalo de bienvenida una vez y bono una vez al día', () => {
    const base = player(0);
    const fresh = { ...base, casino: { ...base.casino, welcome: false } };
    const w = claimWelcome(fresh)!;
    expect(w.s.casino.chips).toBe(WELCOME_CHIPS);
    expect(claimWelcome(w.s)).toBeNull();
    const b = claimBonus(w.s, T)!;
    expect(b.chips).toBe(100);
    expect(claimBonus(b.s, T + 1000)).toBeNull();
    expect(claimBonus(b.s, T + DAY)).not.toBeNull();
    // Retroceder el reloj a "ayer" no devuelve el bono ni las compras del día
    expect(claimBonus(b.s, T - DAY)).toBeNull();
    const bought = buyPacks({ ...b.s, coins: 1e12 }, T, 999)!.s;
    expect(packsLeft(bought, T - DAY)).toBe(0);
    expect(casinoToday(bought.casino, T - DAY)).toBe(bought.casino);
    expect(casinoToday(bought.casino, T + DAY).bought).toBe(0);
  });

  it('comprar fichas gasta monedas sin tocar lo ganado (estrellas y ranking) y tiene tope diario', () => {
    const s = player(0, { coins: 1e12, totalEarned: 5e9, allTimeEarned: 7e9 });
    const price = packPrice(s, T);
    const r = buyPacks(s, T, 3)!;
    expect(r.s.casino.chips).toBe(3 * PACK_CHIPS);
    expect(r.s.coins).toBe(1e12 - 3 * price);
    expect(r.s.totalEarned).toBe(5e9);
    expect(r.s.allTimeEarned).toBe(7e9);
    const all = buyPacks(r.s, T, 999)!;
    expect(all.s.casino.bought).toBe(DAILY_BUY_MAX);
    expect(buyPacks(all.s, T, 1)).toBeNull();
    expect(buyPacks(all.s, T + DAY, 1)).not.toBeNull();
    expect(buyPacks({ ...s, coins: price - 1 }, T, 1)).toBeNull();
  });

  it('ganar fichas no da monedas', () => {
    let s = player(100000);
    const rand = mulberry32(5);
    for (let i = 0; i < 500; i++) s = playSlots(s, MIN_BET, rand)!.s;
    expect(s.coins).toBe(1e9);
    expect(s.allTimeEarned).toBe(0);
  });

  it('apuestas no válidas se rechazan', () => {
    const s = player(100);
    expect(playSlots(s, 0, Math.random)).toBeNull();
    expect(playSlots(s, MIN_BET - 1, Math.random)).toBeNull();
    expect(playSlots(s, NaN, Math.random)).toBeNull();
    expect(playSlots(s, 7.5, Math.random)).toBeNull();
    expect(playSlots(s, maxBet(s.casino) + 1, Math.random)).toBeNull();
    expect(playSlots(player(4), MIN_BET, Math.random)).toBeNull();
    expect(playRoulette(s, { red: 1000 }, Math.random)).toBeNull();
    expect(playRoulette(s, { trampa: 10 }, Math.random)).toBeNull();
    expect(playRoulette(s, { red: -10, black: 20 }, Math.random)).not.toBeNull();
  });

  it('el nivel de socio sube con lo apostado y abre mesas más altas', () => {
    const s = player();
    expect(maxBet(s.casino)).toBe(50);
    expect(vipIndex({ ...s.casino, wagered: 2000 })).toBe(1);
    expect(maxBet({ ...s.casino, wagered: 1e9 })).toBe(1000);
  });

  it('la ruleta cobra todas las apuestas y paga las ganadoras', () => {
    const s = player(1000);
    const r = playRoulette(s, { red: 10, n7: 5 }, () => 7 / 37 + 1e-9)!;
    expect(r.n).toBe(7);
    expect(r.win).toBe(10 * 2 + 5 * 36);
    expect(r.s.casino.chips).toBe(1000 - 15 + 200);
  });
});

describe('partidas a medias', () => {
  it('blackjack: recargar a mitad de mano no cambia la siguiente carta', () => {
    let s = player(1000);
    let found: GameState | null = null;
    for (let i = 0; i < 50 && !found; i++) {
      const r = startBlackjack(s, 10, mulberry32(i))!;
      if (!r.hand.result) found = r.s;
    }
    s = found!;
    expect(s.casino.chips).toBe(990);
    const reloaded = normalize(JSON.parse(JSON.stringify(s)), T);
    const a = blackjackMove(s, 'hit')!.hand;
    const b = blackjackMove(reloaded, 'hit')!.hand;
    expect(b.player).toEqual(a.player);
    expect(startBlackjack(s, 10, Math.random)).toBeNull();
  });

  it('blackjack: doblar cobra otra apuesta y termina la mano', () => {
    let s: GameState | null = null;
    for (let i = 0; i < 50 && !s; i++) {
      const r = startBlackjack(player(1000), 50, mulberry32(i))!;
      if (!r.hand.result) s = r.s;
    }
    const r = blackjackMove(s!, 'double')!;
    expect(r.hand.doubled).toBe(true);
    expect(r.hand.result).not.toBeNull();
    expect(r.s.casino.chips).toBe(1000 - 100 + r.hand.paid);
    expect(r.s.casino.hands).toBe(1);
  });

  it('las cartas salen de la semilla', () => {
    expect(cardAt(123, 4)).toBe(cardAt(123, 4));
    expect(handValue([0, 12]).total).toBe(21);
    expect(handValue([0, 0, 8]).total).toBe(21);
  });

  it('más alto o más bajo: cobra el multiplicador y recargar no cambia la carta', () => {
    let s = startHiLo(player(1000), 10, mulberry32(2))!.s;
    expect(hiloMove(s, 'cash')).toBeNull();
    const reloaded = normalize(JSON.parse(JSON.stringify(s)), T);
    const g = s.casino.hilo!.cards[0] % 13 < 6 ? 'hi' : 'lo';
    expect(hiloMove(reloaded, g)!.run.cards).toEqual(hiloMove(s, g)!.run.cards);
    // Un acierto seguro para comprobar el cobro
    const run = hiloStart(10, 1);
    const next = hiloGuess(run, 'hi');
    if (!next.result) expect(hiloCash(next).paid).toBe(Math.floor(10 * next.mult));
    s = hiloMove(s, g)!.s;
    if (!s.casino.hilo!.result) {
      const cash = hiloMove(s, 'cash')!;
      expect(cash.s.casino.chips).toBe(990 + Math.floor(10 * s.casino.hilo!.mult));
    }
  });

  it('cohete: cobrar antes de explotar paga; después ya no', () => {
    const r = launchRocket(player(1000), 10, 0, T, () => 0.75)!;
    const crash = r.run.crash;
    expect(crash).toBeCloseTo(3.84, 2);
    expect(launchRocket(r.s, 10, 0, T, Math.random)).toBeNull();
    const at2 = T + msToMult(2) + 5;
    const cash = cashRocket(r.s, at2)!;
    expect(cash.win).toBe(20);
    expect(cash.s.casino.chips).toBe(1010);
    const late = T + msToMult(crash) + 50;
    expect(cashRocket(r.s, late)).toBeNull();
    expect(rocketOver(r.run, late)).toBe(true);
    const settled = settleRocket(r.s, late)!;
    expect(settled.win).toBe(0);
    expect(settled.s.casino.rocket).toBeNull();
    expect(cashMultAt(r.run, T)).toBe(1);
  });

  it('cohete: el cobro automático paga aunque nadie mire', () => {
    const r = launchRocket(player(1000), 10, 2, T, () => 0.75)!;
    expect(settleRocket(r.s, T + 1000)).toBeNull();
    const done = settleRocket(r.s, T + DAY)!;
    expect(done.win).toBe(20);
    expect(done.s.casino.chips).toBe(1010);
  });

  it('rasca gratis una vez al día; el de pago cuesta fichas', () => {
    const s = player(30);
    const free = buyScratch(s, T, true, mulberry32(1))!;
    expect(free.s.casino.chips).toBe(30 + free.ticket.win);
    expect(buyScratch(free.s, T, true, Math.random)).toBeNull();
    expect(buyScratch(free.s, T + DAY, true, Math.random)).not.toBeNull();
    const paid = buyScratch(s, T, false, mulberry32(1))!;
    expect(paid.s.casino.chips).toBe(5 + paid.ticket.win);
    expect(buyScratch(player(10), T, false, Math.random)).toBeNull();
  });
});

describe('tienda y guardado', () => {
  it('cada artículo cobra sus fichas y da su premio', () => {
    for (const item of CASINO_SHOP) {
      const s = player(item.price);
      const r = buyShopItem(s, item.id, T, mulberry32(4))!;
      expect(r.s.casino.chips).toBe(0);
      if (item.id === 'ticket') expect(r.s.tickets).toBe(s.tickets + 1);
      if (item.id === 'gems') expect(r.s.gems).toBe(s.gems + 5);
      if (item.id === 'boost') expect(r.s.boosts.some((b) => b.k === 'casino' && b.m === 2)).toBe(true);
      if (item.id === 'fiesta') {
        expect(r.s.tapBoostUntil).toBe(T + 60_000);
        expect(r.s.tapBoostMult).toBe(7);
        // Una fiesta más larga y más fuerte ya activa (decreto con Fiestero) no se acorta ni pierde fuerza
        const big = buyShopItem({ ...s, tapBoostMult: 10, tapBoostUntil: T + 200_000 }, 'fiesta', T, Math.random)!.s;
        expect(big.tapBoostUntil).toBe(T + 200_000);
        expect(big.tapBoostMult).toBe(10);
        // Una fiesta caducada no cuenta: empieza una nueva normal
        const old = buyShopItem({ ...s, tapBoostMult: 10, tapBoostUntil: T - 1 }, 'fiesta', T, Math.random)!.s;
        expect(old.tapBoostUntil).toBe(T + 60_000);
        expect(old.tapBoostMult).toBe(7);
      }
      if (item.id === 'card') expect(Object.values(r.s.cup.cards).reduce((a, b) => a + b, 0)).toBe(1);
      expect(buyShopItem(player(item.price - 1), item.id, T, Math.random)).toBeNull();
    }
  });

  it('partidas sin casino o con datos rotos quedan con valores por defecto', () => {
    const old = normalize({ coins: 5 }, T);
    expect(old.casino.chips).toBe(0);
    expect(old.casino.bj).toBeNull();
    const broken = normalize({ casino: { chips: -5, bj: { bet: 'x' }, rocket: { bet: 10, crash: 'a' }, hilo: 3, ticket: { cells: [1] } } }, T);
    expect(broken.casino.chips).toBe(0);
    expect(broken.casino.bj).toBeNull();
    expect(broken.casino.rocket).toBeNull();
    expect(broken.casino.hilo).toBeNull();
    expect(broken.casino.ticket).toBeNull();
    const s = startBlackjack(player(500), 10, mulberry32(3))!.s;
    expect(normalize(JSON.parse(JSON.stringify(s)), T).casino).toEqual(s.casino);
  });
});
