import { bjDeal, bjDouble, bjHit, bjStand, canDouble, type BjHand } from '../minigames/casino/blackjack';
import { newHandId } from '../minigames/casino/cards';
import { canCash, hiloCash, hiloGuess, hiloStart, type HiLoGuess, type HiLoRun } from '../minigames/casino/hilo';
import { cashMultAt, crashPoint, rocketAutoPay, rocketOver, ROCKET_MAX, type RocketRun } from '../minigames/casino/rocket';
import { isValidBet, rouletteWin, spinRoulette, totalStake } from '../minigames/casino/roulette';
import { SCRATCH_PRICE, newTicket, type ScratchTicket } from '../minigames/casino/scratch';
import { spinSlots } from '../minigames/casino/slots';
import { dateKey, isNewDay } from './clock';
import { randomCard, type CardId } from './cup';
import { addBoost, productionPerSec } from './economy';
import { lawMult } from './laws';
import type { GameState } from './state';

// Casino de la ciudad (desde la era 2). Se juega con fichas, una moneda aparte: se compran con
// monedas (con un tope diario) o se reciben gratis cada día, y se gastan en la tienda del casino.
// Las fichas nunca vuelven a ser monedas, así que el casino no toca las monedas ganadas, ni las
// estrellas, ni el ranking. Todos los juegos devuelven menos del 100% a la larga.

export const CASINO_ERA = 2;
export const MIN_BET = 5;
export const WELCOME_CHIPS = 500;
export const PACK_CHIPS = 100;
/** Fichas que se pueden comprar con monedas cada día. */
export const DAILY_BUY_MAX = 1000;

export interface VipLevel {
  name: string;
  emoji: string;
  /** Fichas apostadas en total para llegar. */
  at: number;
  /** Apuesta máxima en las mesas. */
  maxBet: number;
}

export const VIP: VipLevel[] = [
  { name: 'Bronce', emoji: '🥉', at: 0, maxBet: 50 },
  { name: 'Plata', emoji: '🥈', at: 2_000, maxBet: 100 },
  { name: 'Oro', emoji: '🥇', at: 10_000, maxBet: 250 },
  { name: 'Platino', emoji: '💠', at: 50_000, maxBet: 500 },
  { name: 'Diamante', emoji: '💎', at: 250_000, maxBet: 1000 },
];

export interface CasinoState {
  chips: number;
  /** Día de los contadores diarios (bono, compras, rasca gratis). */
  day: string | null;
  bonus: boolean;
  bought: number;
  freeScratch: boolean;
  welcome: boolean;
  /** Fichas apostadas desde siempre (sube el nivel VIP). */
  wagered: number;
  /** Fichas cobradas desde siempre. */
  won: number;
  /** Partidas jugadas (para el logro). */
  hands: number;
  /** Mayor cobro de una sola partida. */
  best: number;
  bj: BjHand | null;
  hilo: HiLoRun | null;
  rocket: RocketRun | null;
  /** Boleto de rasca comprado, para seguir rascándolo si se cierra la pantalla. */
  ticket: ScratchTicket | null;
}

export function newCasino(): CasinoState {
  return {
    chips: 0,
    day: null,
    bonus: false,
    bought: 0,
    freeScratch: false,
    welcome: false,
    wagered: 0,
    won: 0,
    hands: 0,
    best: 0,
    bj: null,
    hilo: null,
    rocket: null,
    ticket: null,
  };
}

// ---------- Lectura de partidas guardadas ----------

const nonNeg = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isCards = (v: unknown): v is number[] => Array.isArray(v) && v.every((c) => Number.isInteger(c) && c >= 0 && c < 52);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function bjOf(v: unknown): BjHand | null {
  if (!isObj(v) || !isCards(v.player) || !isCards(v.dealer) || !(nonNeg(v.bet) > 0)) return null;
  const results = ['blackjack', 'win', 'push', 'lose', 'bust'];
  return {
    bet: nonNeg(v.bet),
    // Partidas antiguas guardaban la semilla como `seed`: vale como id (ya no sirve para calcular cartas)
    id: nonNeg(v.id) || nonNeg(v.seed),
    n: nonNeg(v.n),
    player: v.player,
    dealer: v.dealer,
    doubled: v.doubled === true,
    result: typeof v.result === 'string' && results.includes(v.result) ? (v.result as BjHand['result']) : null,
    paid: nonNeg(v.paid),
  };
}

function hiloOf(v: unknown): HiLoRun | null {
  if (!isObj(v) || !isCards(v.cards) || v.cards.length < 1 || !(nonNeg(v.bet) > 0)) return null;
  const mult = typeof v.mult === 'number' && Number.isFinite(v.mult) && v.mult >= 1 ? v.mult : 1;
  return {
    bet: nonNeg(v.bet),
    id: nonNeg(v.id) || nonNeg(v.seed),
    n: nonNeg(v.n),
    cards: v.cards,
    mult,
    result: v.result === 'lose' || v.result === 'cash' ? v.result : null,
    paid: nonNeg(v.paid),
  };
}

function rocketOf(v: unknown): RocketRun | null {
  if (!isObj(v) || !(nonNeg(v.bet) > 0) || typeof v.crash !== 'number' || !(v.crash >= 1) || typeof v.start !== 'number') return null;
  const auto = typeof v.auto === 'number' && v.auto > 1 ? Math.min(ROCKET_MAX, v.auto) : 0;
  return { bet: nonNeg(v.bet), crash: Math.min(ROCKET_MAX, v.crash), start: v.start, auto };
}

function ticketOf(v: unknown): ScratchTicket | null {
  if (!isObj(v) || !Array.isArray(v.cells) || v.cells.length !== 9 || !v.cells.every((c) => typeof c === 'string')) return null;
  return { cells: v.cells as string[], prize: typeof v.prize === 'number' ? v.prize : -1, win: nonNeg(v.win) };
}

export function casinoState(v: unknown): CasinoState {
  const base = newCasino();
  if (!isObj(v)) return base;
  return {
    chips: nonNeg(v.chips),
    day: typeof v.day === 'string' ? v.day : null,
    bonus: v.bonus === true,
    bought: nonNeg(v.bought),
    freeScratch: v.freeScratch === true,
    welcome: v.welcome === true,
    wagered: nonNeg(v.wagered),
    won: nonNeg(v.won),
    hands: nonNeg(v.hands),
    best: nonNeg(v.best),
    bj: bjOf(v.bj),
    hilo: hiloOf(v.hilo),
    rocket: rocketOf(v.rocket),
    ticket: ticketOf(v.ticket),
  };
}

// ---------- Acceso, día, VIP ----------

export function casinoOpen(s: GameState): boolean {
  return s.era >= CASINO_ERA;
}

/** Contadores del día al día de hoy. Solo se reinician si el día avanzó (no al retroceder el reloj o la zona horaria). */
export function casinoToday(c: CasinoState, t: number): CasinoState {
  const today = dateKey(t);
  return isNewDay(c.day, today) ? { ...c, day: today, bonus: false, bought: 0, freeScratch: false } : c;
}

export function vipIndex(c: CasinoState): number {
  let i = 0;
  while (i + 1 < VIP.length && c.wagered >= VIP[i + 1].at) i++;
  return i;
}

export function maxBet(c: CasinoState): number {
  return VIP[vipIndex(c)].maxBet;
}

export function dailyBonus(s: GameState): number {
  return Math.round((100 + 25 * vipIndex(s.casino)) * lawMult(s, 'casinoBonus'));
}

export function packPrice(s: GameState, t: number): number {
  return Math.round(Math.max(2_000, productionPerSec(s, t, false) * 600) * lawMult(s, 'chipPrice'));
}

/** Paquetes que aún se pueden comprar hoy. */
export function packsLeft(s: GameState, t: number): number {
  return Math.max(0, Math.floor((DAILY_BUY_MAX - casinoToday(s.casino, t).bought) / PACK_CHIPS));
}

// ---------- Movimientos de fichas ----------

type Result<X = object> = ({ s: GameState } & X) | null;

function withCasino(s: GameState, c: CasinoState): GameState {
  return { ...s, casino: c };
}

/** Cobra una apuesta (y cuenta la partida). null si no es válida. */
function stake(c: CasinoState, amount: number, countHand = true): CasinoState | null {
  if (!Number.isInteger(amount) || !(amount >= 1) || amount > c.chips) return null;
  return { ...c, chips: c.chips - amount, wagered: c.wagered + amount, hands: c.hands + (countHand ? 1 : 0) };
}

function validBet(c: CasinoState, bet: number): boolean {
  return Number.isInteger(bet) && bet >= MIN_BET && bet <= maxBet(c) && bet <= c.chips;
}

function pay(c: CasinoState, amount: number): CasinoState {
  const a = Math.max(0, Math.floor(amount));
  if (a === 0) return c;
  return { ...c, chips: c.chips + a, won: c.won + a, best: Math.max(c.best, a) };
}

export function claimWelcome(s: GameState): Result<{ chips: number }> {
  if (!casinoOpen(s) || s.casino.welcome) return null;
  return { s: withCasino(s, { ...s.casino, welcome: true, chips: s.casino.chips + WELCOME_CHIPS }), chips: WELCOME_CHIPS };
}

export function claimBonus(s: GameState, t: number): Result<{ chips: number }> {
  const c = casinoToday(s.casino, t);
  if (!casinoOpen(s) || c.bonus) return null;
  const chips = dailyBonus(s);
  return { s: withCasino(s, { ...c, bonus: true, chips: c.chips + chips }), chips };
}

export function buyPacks(s: GameState, t: number, packs: number): Result<{ chips: number; cost: number }> {
  const c = casinoToday(s.casino, t);
  const n = Math.min(Math.floor(packs), packsLeft(s, t));
  const cost = packPrice(s, t) * n;
  if (!casinoOpen(s) || !(n >= 1) || !(cost <= s.coins)) return null;
  const chips = n * PACK_CHIPS;
  // Gastar monedas no cuenta como ganarlas ni perderlas: solo bajan las monedas disponibles
  return { s: { ...s, coins: s.coins - cost, casino: { ...c, chips: c.chips + chips, bought: c.bought + chips } }, chips, cost };
}

// ---------- Juegos de una sola jugada ----------

export function playSlots(s: GameState, bet: number, rand: () => number): Result<{ reels: [number, number, number]; mult: number; win: number }> {
  const c = s.casino;
  if (!validBet(c, bet)) return null;
  const staked = stake(c, bet)!;
  const { reels, mult } = spinSlots(rand);
  const win = Math.floor(bet * mult);
  return { s: withCasino(s, pay(staked, win)), reels, mult, win };
}

export function playRoulette(s: GameState, bets: Record<string, number>, rand: () => number): Result<{ n: number; win: number; total: number }> {
  const c = s.casino;
  const entries = Object.entries(bets).filter(([, v]) => v > 0);
  if (!entries.length || entries.some(([id, v]) => !isValidBet(id) || !Number.isInteger(v))) return null;
  const clean = Object.fromEntries(entries);
  const total = totalStake(clean);
  if (total < MIN_BET || total > maxBet(c) || total > c.chips) return null;
  const n = spinRoulette(rand);
  const win = rouletteWin(clean, n);
  return { s: withCasino(s, pay(stake(c, total)!, win)), n, win, total };
}

/** Rasca: el gratis del día o uno comprado. El premio se cobra ya; las casillas solo lo enseñan. */
export function buyScratch(s: GameState, t: number, free: boolean, rand: () => number): Result<{ ticket: ScratchTicket }> {
  let c = casinoToday(s.casino, t);
  if (!casinoOpen(s)) return null;
  if (free) {
    if (c.freeScratch) return null;
    c = { ...c, freeScratch: true, hands: c.hands + 1 };
  } else {
    const staked = stake(c, SCRATCH_PRICE);
    if (!staked) return null;
    c = staked;
  }
  const ticket = newTicket(rand);
  return { s: withCasino(s, { ...pay(c, ticket.win), ticket }), ticket };
}

export function clearTicket(s: GameState): GameState {
  return s.casino.ticket ? withCasino(s, { ...s.casino, ticket: null }) : s;
}

// ---------- Blackjack ----------

export function startBlackjack(s: GameState, bet: number, rand: () => number): Result<{ hand: BjHand }> {
  const c = s.casino;
  if ((c.bj && !c.bj.result) || !validBet(c, bet)) return null;
  const hand = bjDeal(bet, newHandId(rand));
  return { s: withCasino(s, { ...pay(stake(c, bet)!, hand.paid), bj: hand }), hand };
}

export function blackjackMove(s: GameState, move: 'hit' | 'stand' | 'double'): Result<{ hand: BjHand }> {
  let c = s.casino;
  const h = c.bj;
  if (!h || h.result) return null;
  let hand: BjHand;
  if (move === 'double') {
    if (!canDouble(h)) return null;
    // La apuesta extra no cuenta como otra partida ni tiene que caber en el máximo de la mesa
    const staked = stake(c, h.bet, false);
    if (!staked) return null;
    c = staked;
    hand = bjDouble(h);
  } else hand = move === 'hit' ? bjHit(h) : bjStand(h);
  return { s: withCasino(s, { ...pay(c, hand.result ? hand.paid : 0), bj: hand }), hand };
}

// ---------- Más alto o más bajo ----------

export function startHiLo(s: GameState, bet: number, rand: () => number): Result<{ run: HiLoRun }> {
  const c = s.casino;
  if ((c.hilo && !c.hilo.result) || !validBet(c, bet)) return null;
  const run = hiloStart(bet, newHandId(rand));
  return { s: withCasino(s, { ...stake(c, bet)!, hilo: run }), run };
}

export function hiloMove(s: GameState, move: HiLoGuess | 'cash'): Result<{ run: HiLoRun }> {
  const c = s.casino;
  const r = c.hilo;
  if (!r || r.result) return null;
  if (move === 'cash' && !canCash(r)) return null;
  const run = move === 'cash' ? hiloCash(r) : hiloGuess(r, move);
  if (run === r) return null;
  return { s: withCasino(s, { ...pay(c, run.paid), hilo: run }), run };
}

// ---------- Cohete ----------

export function launchRocket(s: GameState, bet: number, auto: number, t: number, rand: () => number): Result<{ run: RocketRun }> {
  const c = s.casino;
  if (c.rocket || !validBet(c, bet)) return null;
  const run: RocketRun = { bet, crash: crashPoint(rand), start: t, auto: auto > 1 ? Math.min(ROCKET_MAX, auto) : 0 };
  return { s: withCasino(s, { ...stake(c, bet)!, rocket: run }), run };
}

/** Cobrar a mano. null si ya explotó (entonces hay que cerrar el vuelo con settleRocket). */
export function cashRocket(s: GameState, t: number): Result<{ mult: number; win: number }> {
  const run = s.casino.rocket;
  if (!run) return null;
  const mult = cashMultAt(run, t);
  if (mult === null) return null;
  const win = Math.floor(run.bet * mult);
  return { s: withCasino(s, { ...pay(s.casino, win), rocket: null }), mult, win };
}

/** Cierra un vuelo que terminó solo (explosión o cobro automático). */
export function settleRocket(s: GameState, t: number): Result<{ run: RocketRun; win: number }> {
  const run = s.casino.rocket;
  if (!run || !rocketOver(run, t)) return null;
  const win = rocketAutoPay(run);
  return { s: withCasino(s, { ...pay(s.casino, win), rocket: null }), run, win };
}

// ---------- Tienda del casino ----------

export type ShopId = 'fiesta' | 'ticket' | 'boost' | 'card' | 'gems';

export interface CasinoShopItem {
  id: ShopId;
  emoji: string;
  name: string;
  desc: string;
  price: number;
}

export const CASINO_SHOP: CasinoShopItem[] = [
  { id: 'fiesta', emoji: '🎉', name: 'Fiesta', desc: 'Toques x7 durante 60 s', price: 80 },
  { id: 'ticket', emoji: '🎟️', name: 'Ticket', desc: '+1 ticket para los arcade', price: 120 },
  { id: 'boost', emoji: '⚡', name: 'Noche de neón', desc: 'Producción x2 durante 15 min', price: 250 },
  { id: 'card', emoji: '🃏', name: 'Carta de la Copa', desc: 'Una carta al azar', price: 300 },
  { id: 'gems', emoji: '💎', name: 'Cofre de gemas', desc: '+5 gemas', price: 1000 },
];

export function buyShopItem(s: GameState, id: ShopId, t: number, rand: () => number): Result<{ card?: CardId }> {
  const item = CASINO_SHOP.find((i) => i.id === id);
  const c = s.casino;
  if (!item || !casinoOpen(s) || c.chips < item.price) return null;
  let next: GameState = withCasino(s, { ...c, chips: c.chips - item.price });
  let card: CardId | undefined;
  switch (id) {
    case 'fiesta':
      {
        // Varias fiestas seguidas se suman, hasta 3 minutos; una fiesta más larga ya activa (decreto, rueda) no se acorta
        // ni pierde su multiplicador si era mayor
        const active = next.tapBoostUntil > t;
        next = {
          ...next,
          tapBoostMult: active ? Math.max(next.tapBoostMult, 7) : 7,
          tapBoostUntil: Math.max(next.tapBoostUntil, Math.min(t + 180_000, Math.max(next.tapBoostUntil, t) + 60_000)),
        };
      }
      break;
    case 'ticket':
      next = { ...next, tickets: next.tickets + 1 };
      break;
    case 'boost':
      next = { ...next, boosts: addBoost(next, t, 'casino', 2, 900) };
      break;
    case 'card':
      card = randomCard(rand);
      next = { ...next, cup: { ...next.cup, cards: { ...next.cup.cards, [card]: next.cup.cards[card] + 1 } } };
      break;
    case 'gems':
      next = { ...next, gems: next.gems + 5 };
      break;
  }
  return { s: next, card };
}
