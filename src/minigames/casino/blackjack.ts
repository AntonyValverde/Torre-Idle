import { drawCard, forgetHand, rankOf, type Card } from './cards';

// Blackjack con baraja infinita: el crupier pide hasta 17 y se planta con 17 blando, el blackjack
// paga 3:2, se puede doblar con las dos primeras cartas y no hay separación. Si el crupier tiene
// blackjack se descubre al repartir. Con la estrategia básica devuelve ≈ 99%.

export type BjResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface BjHand {
  bet: number;
  /** Id público de la mano (su secreto está en memoria, ver cards.ts). */
  id: number;
  /** Cartas sacadas de la baraja (la siguiente es la número n). */
  n: number;
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  /** null mientras se juega. */
  result: BjResult | null;
  /** Fichas cobradas al terminar (incluida la apuesta). */
  paid: number;
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 1) aces++;
    total += r === 1 ? 1 : Math.min(10, r);
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

function draw(h: BjHand): Card {
  return drawCard(h.id, h.n++);
}

/** Veces la apuesta (contando lo doblado) que se cobra con cada resultado. */
const RETURN: Record<BjResult, number> = { blackjack: 2.5, win: 2, push: 1, lose: 0, bust: 0 };

function settle(h: BjHand, result: BjResult): BjHand {
  forgetHand(h.id);
  return { ...h, result, paid: Math.floor(h.bet * (h.doubled ? 2 : 1) * RETURN[result]) };
}

function dealerPlays(h: BjHand): BjHand {
  const next = { ...h, dealer: h.dealer.slice() };
  while (handValue(next.dealer).total < 17) next.dealer.push(draw(next));
  const p = handValue(next.player).total;
  const d = handValue(next.dealer).total;
  return settle(next, d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose');
}

export function bjDeal(bet: number, id: number): BjHand {
  const h: BjHand = { bet, id, n: 0, player: [], dealer: [], doubled: false, result: null, paid: 0 };
  h.player.push(draw(h));
  h.dealer.push(draw(h));
  h.player.push(draw(h));
  h.dealer.push(draw(h));
  const pBj = isBlackjack(h.player);
  const dBj = isBlackjack(h.dealer);
  if (pBj || dBj) return settle(h, pBj && dBj ? 'push' : pBj ? 'blackjack' : 'lose');
  return h;
}

export function bjHit(h: BjHand): BjHand {
  if (h.result) return h;
  const next = { ...h, player: h.player.slice() };
  next.player.push(draw(next));
  const v = handValue(next.player).total;
  if (v > 21) return settle(next, 'bust');
  return v === 21 ? dealerPlays(next) : next;
}

export function bjStand(h: BjHand): BjHand {
  return h.result ? h : dealerPlays(h);
}

export function canDouble(h: BjHand): boolean {
  return !h.result && h.player.length === 2 && !h.doubled;
}

/** Dobla la apuesta, recibe una sola carta y se planta (la apuesta extra la cobra quien llama). */
export function bjDouble(h: BjHand): BjHand {
  if (!canDouble(h)) return h;
  const next = { ...h, doubled: true, player: h.player.slice() };
  next.player.push(draw(next));
  if (handValue(next.player).total > 21) return settle(next, 'bust');
  return dealerPlays(next);
}

/** Estrategia básica (sin separar, baraja infinita, crupier se planta con 17 blando). Solo para la prueba de retorno. */
export function basicMove(h: BjHand): 'hit' | 'stand' | 'double' {
  const { total, soft } = handValue(h.player);
  const up = Math.min(10, rankOf(h.dealer[0]));
  const d = up === 1 ? 11 : up;
  const two = h.player.length === 2;
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return d >= 9 ? 'hit' : two && d >= 3 && d <= 6 ? 'double' : 'stand';
    if (two && ((total >= 17 && d >= 3 && d <= 6) || (total >= 15 && d >= 4 && d <= 6) || (total >= 13 && d >= 5 && d <= 6))) return 'double';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return two ? 'double' : 'hit';
  if (total === 10) return two && d <= 9 ? 'double' : 'hit';
  if (total === 9) return two && d >= 3 && d <= 6 ? 'double' : 'hit';
  return 'hit';
}
