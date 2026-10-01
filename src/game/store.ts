import { create } from 'zustand';
import { dateKey, isNewDay, now, prevDateKey } from './clock';
import {
  ACHIEVEMENTS,
  BUILDINGS,
  GEM_SHOP,
  LEGACY,
  RARE,
  UPGRADE_BY_ID,
  achievementClaimed,
  achievementGems,
  achievementReached,
  addBoost,
  autoTapsPerSec,
  availableStars,
  buildingCost,
  costDiscount,
  critChance,
  gemLevel,
  isBuildingEraLocked,
  legacyLevel,
  maxAffordable,
  maxTickets,
  offlineCapSeconds,
  offlineEfficiency,
  pendingStars,
  productionPerSec,
  regenTickets,
  startingCapital,
  tapValue,
  type RareDef,
} from './economy';
import {
  CARDS,
  HISTORY_MAX,
  PICK_STAKES,
  TRAINING_MAX,
  attemptsFor,
  cardSlots,
  cupRewards,
  cupScoreOf,
  randomCard,
  registeredFor,
  returnCards,
  seasonReward,
  trackActivity,
  trainingCost,
  type CardId,
  type CupOutcome,
  type CupReward,
  type CupSlot,
} from './cup';

export interface CupClaim extends CupReward {
  card: CardId | null;
}

/** Afición de la Copa: cuenta los días jugados entre semana. */
function withActivity(s: GameState, t: number): GameState {
  const cup = trackActivity(s.cup, t);
  return cup === s.cup ? s : { ...s, cup };
}

/** Carta de la Copa como premio extra (de misiones, cofre o retos diarios). */
function withCard(s: GameState, card: CardId): GameState {
  return { ...s, cup: { ...s.cup, cards: { ...s.cup.cards, [card]: s.cup.cards[card] + 1 } } };
}
import { DECREE_BY_ID, pickDecrees, type DecreeId } from './events';
import { fmt } from './format';
import { isNameAllowed, sanitizeName } from './names';
import { memoryTickets } from '../minigames/memory/logic';
import {
  CHEST_REWARD,
  DAILY_REWARD,
  DIVISIONS,
  PUZZLE_POINTS,
  WEEKLY_REWARD,
  addPoints,
  bump,
  chestReady,
  divisionOf,
  isDone,
  syncPeriods,
  type Division,
} from './missions';
import { newState, type GameState } from './state';
import { STOCK_BY_ID, investedTotal, saleValue, stockInvestCap, stockPrice, unitsFor } from './stocks';
import { WHEEL, pickSegment } from './wheel';

export interface OfflineReport {
  earned: number;
  seconds: number;
}

export interface Toast {
  id: number;
  text: string;
  ms: number;
}

export interface StackReward {
  coins: number;
  mult: number;
  seconds: number;
  newBest: boolean;
}

export interface MergeReward {
  coins: number;
  gems: number;
  newRare: RareDef[];
  newBest: boolean;
}

export interface DailyReward {
  coins: number;
  gems: number;
  streak: number;
  /** Carta de la Copa de regalo (a veces). */
  card?: CardId;
}

export interface ThiefReward {
  coins: number;
  gems: number;
  newBest: boolean;
}

export interface MemoryReward {
  coins: number;
  /** Tickets ganados (sin pasar del máximo). */
  tickets: number;
  /** Tickets que no cupieron porque ya estabas al máximo. */
  lost: number;
  newBest: boolean;
}

export interface DecreeOffer {
  options: [DecreeId, DecreeId];
  expires: number;
}

interface GameStore {
  s: GameState;
  ready: boolean;
  offline: OfflineReport | null;
  toasts: Toast[];
  decree: DecreeOffer | null;
  init(state: GameState): void;
  tick(): void;
  tap(): { amount: number; crit: boolean };
  buyBuilding(id: string, amount: number): boolean;
  buyUpgrade(id: string): void;
  buyGemItem(id: string): void;
  buyLegacy(id: string): void;
  collectOffline(double: boolean): void;
  spendTicket(): boolean;
  rewardStack(score: number): StackReward;
  rewardMerge(score: number, maxTile: number): MergeReward;
  completeDaily(date: string, moves: number, par: number): DailyReward | null;
  completeRoads(date: string, moves: number, par: number): DailyReward | null;
  completeParks(date: string, moves: number, par: number): DailyReward | null;
  rewardTraffic(score: number): StackReward;
  rewardMemory(rounds: number): MemoryReward;
  rewardFire(score: number): ThiefReward;
  rewardMetro(score: number): StackReward;
  /** Reclama una misión completada; devuelve el texto del premio o null. */
  claimMission(kind: 'daily' | 'weekly', index: number): string | null;
  claimChest(): string | null;
  /** Cobra el premio de la liga de la semana anterior. */
  claimLeague(): { division: Division; points: number } | null;
  /** Marca la inscripción en la Copa de esa semana. */
  cupRegister(week: string): void;
  /** Gasta un intento de una prueba de la Copa; false si no quedan. */
  cupAttempt(slot: CupSlot): boolean;
  /**
   * Guarda el resultado de un intento: aplica el entrenamiento y la carta usada, y con el escudo
   * devuelve el intento si no mejoró. Devuelve la marca que cuenta y la mejor.
   */
  cupScore(slot: CupSlot, raw: number, card?: CardId | null): { score: number; best: number; improved: boolean; refunded: boolean };
  /** Gasta una carta equipada. La de intento extra suma el intento en esa prueba. */
  cupUseCard(card: CardId, slot: CupSlot): boolean;
  cupEquip(card: CardId): boolean;
  cupUnequip(index: number): void;
  /** Sube de nivel el centro de entrenamiento; devuelve el coste o 0 si no se pudo. */
  cupTrain(): number;
  cupPredict(week: string, uid: string, name: string, stake: number): boolean;
  /** Cobra los premios de una Copa terminada (una sola vez), con el pronóstico si lo hubo. */
  cupClaim(week: string, outcome: CupOutcome, pickGems?: number): CupClaim | null;
  seasonClaim(season: number, rank: number): { gems: number; flag: boolean } | null;
  rewardGolden(): string;
  offerDecree(): void;
  chooseDecree(id: DecreeId): string;
  claimAchievement(id: string): number;
  prestige(): number;
  spinWheel(): { index: number; message: string; free: boolean } | null;
  rewardThief(score: number): ThiefReward;
  /** Devuelve las monedas realmente invertidas (0 si no se pudo). */
  buyStock(id: string, coins: number): number;
  sellStock(id: string, fraction: number): { value: number; profit: number } | null;
  /** Devuelve un mensaje de error, o null si el nombre se guardó. */
  setName(name: string): string | null;
  toast(text: string): void;
}

// Si pasan más de 15 s entre ticks (app en segundo plano) se trata como tiempo offline.
const OFFLINE_THRESHOLD_S = 15;
const DECREE_DURATION_MS = 60_000;
let toastId = 0;

function offlineGain(s: GameState, seconds: number): OfflineReport {
  const secs = Math.min(Math.max(0, seconds), offlineCapSeconds(s));
  return { seconds: secs, earned: productionPerSec(s, 0, false) * secs * offlineEfficiency(s) };
}

function capped(n: number): number {
  return Number.isFinite(n) ? n : Number.MAX_VALUE;
}

function addCoins(s: GameState, amount: number): GameState {
  return {
    ...s,
    coins: capped(s.coins + amount),
    totalEarned: capped(s.totalEarned + amount),
    allTimeEarned: capped(s.allTimeEarned + amount),
  };
}

/** Completa un reto diario (Apagón, Calles o Plan verde): un premio por día, con racha y gemas extra dentro del par. */
function finishDaily(s: GameState, key: 'daily' | 'roads' | 'parks', date: string, moves: number, par: number) {
  const rec = s[key];
  if (!isNewDay(rec.last, date)) return null;
  const streak = rec.last === prevDateKey(date) ? rec.streak + 1 : 1;
  const gems = 3 + Math.min(streak, 7) + (moves <= par ? 2 : 0);
  const coins = Math.round(Math.max(100, productionPerSec(s, now(), false) * 120));
  const done: GameState = {
    ...addCoins(s, coins),
    gems: s.gems + gems,
    [key]: { last: date, streak, bestStreak: Math.max(rec.bestStreak, streak) },
  };
  let next = addPoints(bump(bump(done, key), 'puzzle'), PUZZLE_POINTS);
  // A veces regala una carta para la Copa
  const card = Math.random() < 0.35 ? randomCard(Math.random) : undefined;
  if (card) next = withCard(next, card);
  return { next, reward: { coins, gems, streak, card } };
}

export const useGame = create<GameStore>((set, get) => ({
  s: newState(now()),
  ready: false,
  offline: null,
  toasts: [],
  decree: null,

  init(state) {
    const t = now();
    const report = offlineGain(state, (t - state.lastTick) / 1000);
    // Si la partida viene "del futuro" (reloj adelantado), no se retrocede: se espera a que llegue esa hora.
    const lastTick = Math.max(state.lastTick, t);
    let s: GameState = withActivity(syncPeriods({ ...state, lastTick, ...regenTickets(state, lastTick) }, lastTick), lastTick);
    const showReport = report.seconds >= 60 && report.earned > 0;
    // Ausencias de menos de un minuto: se cobran sin ventana
    if (!showReport && report.earned > 0) s = addCoins(s, report.earned);
    set({ s, ready: true, decree: null, offline: showReport ? report : null });
  },

  tick() {
    const { s, offline, decree } = get();
    const t = now();
    const dt = (t - s.lastTick) / 1000;
    if (decree && t > decree.expires) set({ decree: null });
    // El tiempo nunca retrocede: si el reloj va hacia atrás, no se produce nada hasta alcanzarlo
    if (dt <= 0) return;
    const boosts = s.boosts.some((b) => b.u <= t) ? s.boosts.filter((b) => b.u > t) : s.boosts;
    if (dt > OFFLINE_THRESHOLD_S) {
      // Tiempo en segundo plano: se acumula en el informe offline, con el tope total respetado
      const prev = offline ?? { earned: 0, seconds: 0 };
      const r = offlineGain(s, dt);
      const seconds = Math.min(offlineCapSeconds(s), prev.seconds + r.seconds);
      const added = Math.max(0, seconds - prev.seconds);
      const earned = r.seconds > 0 ? r.earned * (added / r.seconds) : 0;
      const base = withActivity(syncPeriods({ ...s, boosts, lastTick: t, ...regenTickets(s, t) }, t), t);
      if (!offline && seconds < 60) {
        // Ausencias cortas: se cobran directamente, sin ventana
        set({ s: addCoins(base, earned) });
      } else {
        set({ s: base, offline: { seconds, earned: prev.earned + earned } });
      }
      return;
    }
    const auto = autoTapsPerSec(s);
    const gain = productionPerSec(s, t) * dt + (auto > 0 ? tapValue(s, t) * auto * dt : 0);
    set({ s: withActivity(syncPeriods({ ...addCoins(s, gain), boosts, lastTick: t, ...regenTickets(s, t) }, t), t) });
  },

  tap() {
    const { s } = get();
    const crit = Math.random() < critChance(s);
    const amount = tapValue(s, now()) * (crit ? 10 : 1);
    set({ s: bump({ ...addCoins(s, amount), taps: s.taps + 1 }, 'tap') });
    return { amount, crit };
  },

  buyBuilding(id, amount) {
    const { s } = get();
    const idx = BUILDINGS.findIndex((b) => b.id === id);
    if (idx < 0 || isBuildingEraLocked(s, idx)) return false;
    const def = BUILDINGS[idx];
    const owned = s.buildings[id] ?? 0;
    const discount = costDiscount(s);
    let n = amount < 0 ? maxAffordable(def, owned, s.coins, discount) : amount;
    let cost = buildingCost(def, owned, n, discount);
    // "Máx" usa logaritmos: por redondeo puede pasarse por una unidad
    while (amount < 0 && n > 0 && cost > s.coins) cost = buildingCost(def, owned, --n, discount);
    if (n <= 0 || cost > s.coins) return false;
    set({ s: bump({ ...s, coins: s.coins - cost, buildings: { ...s.buildings, [id]: owned + n } }, 'build', n) });
    return true;
  },

  buyUpgrade(id) {
    const { s } = get();
    const u = UPGRADE_BY_ID.get(id);
    if (!u || s.upgrades.includes(id) || !u.unlocked(s) || s.coins < u.cost) return;
    set({ s: bump({ ...s, coins: s.coins - u.cost, upgrades: [...s.upgrades, id] }, 'upgrade') });
  },

  buyGemItem(id) {
    const { s } = get();
    const item = GEM_SHOP.find((g) => g.id === id);
    if (!item) return;
    const lvl = gemLevel(s, id);
    const cost = item.cost(lvl);
    if (lvl >= item.max || s.gems < cost) return;
    set({ s: { ...s, gems: s.gems - cost, gemLevels: { ...s.gemLevels, [id]: lvl + 1 } } });
  },

  buyLegacy(id) {
    const { s } = get();
    const item = LEGACY.find((g) => g.id === id);
    if (!item) return;
    const lvl = legacyLevel(s, id);
    const cost = item.cost(lvl);
    if (lvl >= item.max || availableStars(s) < cost) return;
    set({ s: { ...s, starsSpent: s.starsSpent + cost, legacy: { ...s.legacy, [id]: lvl + 1 } } });
  },

  collectOffline(double) {
    const { s, offline } = get();
    if (!offline) return;
    if (double && s.tickets < 1) return;
    const earned = offline.earned * (double ? 2 : 1);
    let next = addCoins(s, earned);
    if (double) next = { ...next, tickets: next.tickets - 1 };
    set({ s: next, offline: null });
  },

  spendTicket() {
    const { s } = get();
    if (s.tickets < 1) return false;
    set({ s: { ...s, tickets: s.tickets - 1 } });
    return true;
  },

  rewardStack(score) {
    const { s } = get();
    const t = now();
    const pps = productionPerSec(s, t, false);
    const coins = Math.round(score * Math.max(15, pps * 10));
    const mult = score >= 60 ? 5 : score >= 40 ? 4 : score >= 25 ? 3 : score >= 10 ? 2 : score >= 5 ? 1.5 : 1;
    const seconds = Math.min(900, score * 15);
    let next = { ...addCoins(s, coins), stackBest: Math.max(s.stackBest, score) };
    if (mult > 1) next = { ...next, boosts: addBoost(s, t, 'stack', mult, seconds) };
    set({ s: bump(bump(next, 'arcade'), 'stack', score) });
    return { coins, mult, seconds, newBest: score > s.stackBest };
  },

  rewardMerge(score, maxTile) {
    const { s } = get();
    const pps = productionPerSec(s, now(), false);
    const coins = Math.round(score * Math.max(1, pps * 0.1));
    const gems =
      maxTile >= 4096 ? 25 : maxTile >= 2048 ? 15 : maxTile >= 1024 ? 8 : maxTile >= 512 ? 4 : maxTile >= 256 ? 2 : maxTile >= 128 ? 1 : 0;
    const newRare = RARE.filter((r) => maxTile >= r.tile && !s.rare.includes(r.id));
    const next: GameState = {
      ...addCoins(s, coins),
      gems: s.gems + gems,
      rare: [...s.rare, ...newRare.map((r) => r.id)],
      mergeBest: Math.max(s.mergeBest, score),
      mergeBestTile: Math.max(s.mergeBestTile, maxTile),
    };
    set({ s: bump(bump(next, 'arcade'), 'merge', maxTile) });
    return { coins, gems, newRare, newBest: score > s.mergeBest };
  },

  completeDaily(date, moves, par) {
    const r = finishDaily(get().s, 'daily', date, moves, par);
    if (!r) return null;
    set({ s: r.next });
    return r.reward;
  },

  completeRoads(date, moves, par) {
    const r = finishDaily(get().s, 'roads', date, moves, par);
    if (!r) return null;
    set({ s: r.next });
    return r.reward;
  },

  completeParks(date, moves, par) {
    const r = finishDaily(get().s, 'parks', date, moves, par);
    if (!r) return null;
    set({ s: r.next });
    return r.reward;
  },

  rewardFire(score) {
    const { s } = get();
    const pps = productionPerSec(s, now(), false);
    const coins = Math.round(score * Math.max(15, pps * 4));
    const gems = score >= 400 ? 6 : score >= 250 ? 4 : score >= 120 ? 2 : score >= 60 ? 1 : 0;
    set({ s: bump(bump({ ...addCoins(s, coins), gems: s.gems + gems, fireBest: Math.max(s.fireBest, score) }, 'arcade'), 'fire', score) });
    return { coins, gems, newBest: score > s.fireBest };
  },

  rewardMetro(score) {
    const { s } = get();
    const t = now();
    const pps = productionPerSec(s, t, false);
    const coins = Math.round(score * Math.max(25, pps * 8));
    const mult = score >= 150 ? 4 : score >= 100 ? 3 : score >= 50 ? 2 : score >= 20 ? 1.5 : 1;
    const seconds = Math.min(900, score * 12);
    // Fuente propia ('metro'): se multiplica con los boosts de Stack y Semáforo
    let next = { ...addCoins(s, coins), metroBest: Math.max(s.metroBest, score) };
    if (mult > 1) next = { ...next, boosts: addBoost(s, t, 'metro', mult, seconds) };
    set({ s: bump(bump(next, 'arcade'), 'metro', score) });
    return { coins, mult, seconds, newBest: score > s.metroBest };
  },

  rewardTraffic(score) {
    const { s } = get();
    const t = now();
    const pps = productionPerSec(s, t, false);
    const coins = Math.round(score * Math.max(10, pps * 6));
    const mult = score >= 120 ? 5 : score >= 80 ? 4 : score >= 50 ? 3 : score >= 25 ? 2 : score >= 10 ? 1.5 : 1;
    const seconds = Math.min(900, score * 10);
    // Fuente propia ('semaforo'): se multiplica con el boost de Stack en vez de sustituirlo
    let next = { ...addCoins(s, coins), trafficBest: Math.max(s.trafficBest, score) };
    if (mult > 1) next = { ...next, boosts: addBoost(s, t, 'semaforo', mult, seconds) };
    set({ s: bump(bump(next, 'arcade'), 'traffic', score) });
    return { coins, mult, seconds, newBest: score > s.trafficBest };
  },

  rewardMemory(rounds) {
    const { s } = get();
    const coins = Math.round(rounds * Math.max(20, productionPerSec(s, now(), false) * 8));
    const won = memoryTickets(rounds);
    // Los tickets ganados no pasan del máximo: Memoria rellena, no permite acumular sin fin
    const tickets = Math.max(s.tickets, Math.min(maxTickets(s), s.tickets + won));
    set({ s: bump(bump({ ...addCoins(s, coins), tickets, memoryBest: Math.max(s.memoryBest, rounds) }, 'arcade'), 'memory', rounds) });
    return { coins, tickets: tickets - s.tickets, lost: won - (tickets - s.tickets), newBest: rounds > s.memoryBest };
  },

  rewardGolden() {
    const { s } = get();
    const coins = Math.round(Math.max(50, productionPerSec(s, now(), false) * 90));
    const gem = Math.random() < 0.1 ? 1 : 0;
    set({ s: bump({ ...addCoins(s, coins), gems: s.gems + gem, balloons: s.balloons + 1 }, 'balloon') });
    return gem ? `+${fmt(coins)} 🪙 y +1 💎` : `+${fmt(coins)} 🪙`;
  },

  offerDecree() {
    if (get().decree) return;
    set({ decree: { options: pickDecrees(), expires: now() + DECREE_DURATION_MS } });
  },

  chooseDecree(id) {
    const { s, decree } = get();
    if (!decree || !decree.options.includes(id)) return '';
    const t = now();
    const pps = productionPerSec(s, t, false);
    const def = DECREE_BY_ID.get(id)!;
    let next = s;
    let msg = `${def.emoji} ${def.title}`;
    switch (id) {
      case 'festival':
        next = { ...s, tapBoostMult: 7, tapBoostUntil: t + 45_000 };
        break;
      case 'obras':
        next = { ...s, boosts: addBoost(s, t, 'obras', 2, 180) };
        break;
      case 'mecenas':
        next = { ...s, boosts: addBoost(s, t, 'mecenas', 5, 30) };
        break;
      case 'recaudacion': {
        const c = Math.max(100, pps * 600);
        next = addCoins(s, c);
        msg += `: +${fmt(c)} 🪙`;
        break;
      }
      case 'turistas':
        next = { ...s, tickets: s.tickets + 1 };
        msg += ': +1 🎟️';
        break;
      case 'loteria':
        if (Math.random() < 0.5) {
          const c = Math.max(250, pps * 2400);
          next = addCoins(s, c);
          msg += `: ¡premio! +${fmt(c)} 🪙`;
        } else {
          msg += ': esta vez no hubo suerte';
        }
        break;
      case 'mina':
        next = { ...s, gems: s.gems + 2 };
        msg += ': +2 💎';
        break;
    }
    set({ s: bump(next, 'decree'), decree: null });
    return msg;
  },

  claimAchievement(id) {
    const { s } = get();
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return 0;
    const claimed = achievementClaimed(s, id);
    const reached = achievementReached(def, s);
    if (reached <= claimed) return 0;
    let gems = 0;
    for (let k = claimed; k < reached; k++) gems += achievementGems(k);
    set({ s: bump({ ...s, gems: s.gems + gems, achievements: { ...s.achievements, [id]: reached } }, 'achievement', reached - claimed) });
    return gems;
  },

  prestige() {
    const { s } = get();
    const gain = pendingStars(s);
    if (gain < 1) return 0;
    const t = now();
    const next: GameState = {
      ...s,
      era: s.era + 1,
      stars: s.stars + gain,
      coins: 0,
      totalEarned: 0,
      buildings: {},
      upgrades: [],
      boosts: [],
      tapBoostMult: 1,
      tapBoostUntil: 0,
      stocks: {},
      lastTick: t,
    };
    next.coins = startingCapital(next);
    set({ s: next, decree: null });
    return gain;
  },

  spinWheel() {
    const { s } = get();
    const t = now();
    const today = dateKey(t);
    const free = isNewDay(s.wheelLast, today);
    if (!free && s.tickets < 1) return null;
    const index = pickSegment();
    const prize = WHEEL[index].prize;
    const pps = productionPerSec(s, t, false);
    let next: GameState = { ...s, wheelSpins: s.wheelSpins + 1, ...(free ? { wheelLast: today } : { tickets: s.tickets - 1 }) };
    let message = '';
    switch (prize.kind) {
      case 'coins': {
        const c = Math.max(100 * prize.minutes, pps * 60 * prize.minutes);
        next = addCoins(next, c);
        message = `+${fmt(c)} 🪙`;
        break;
      }
      case 'gems':
        next = { ...next, gems: next.gems + prize.amount };
        message = `+${prize.amount} 💎`;
        break;
      case 'tickets':
        next = { ...next, tickets: next.tickets + prize.amount };
        message = `+${prize.amount} 🎟️`;
        break;
      case 'boost':
        next = { ...next, boosts: addBoost(next, t, 'rueda', prize.mult, prize.seconds) };
        message = `⚡ Producción x${prize.mult} durante ${prize.seconds / 60} min`;
        break;
      case 'festival':
        next = { ...next, tapBoostMult: 7, tapBoostUntil: t + 60_000 };
        message = '🎉 ¡Fiesta! Toques x7 durante 60 s';
        break;
      case 'rare': {
        const r = RARE.find((x) => !next.rare.includes(x.id));
        if (r) {
          next = { ...next, rare: [...next.rare, r.id] };
          message = `${r.emoji} ¡${r.name}! +${Math.round(r.bonus * 100)}% producción`;
        } else {
          next = { ...next, gems: next.gems + 25 };
          message = '+25 💎 (ya tienes todos los raros)';
        }
        break;
      }
    }
    set({ s: bump(next, 'wheel') });
    return { index, message, free };
  },

  rewardThief(score) {
    const { s } = get();
    const pps = productionPerSec(s, now(), false);
    const coins = Math.round(score * Math.max(20, pps * 4));
    const gems = score >= 150 ? 6 : score >= 100 ? 4 : score >= 60 ? 2 : score >= 30 ? 1 : 0;
    set({ s: bump(bump({ ...addCoins(s, coins), gems: s.gems + gems, thiefBest: Math.max(s.thiefBest, score) }, 'arcade'), 'thief', score) });
    return { coins, gems, newBest: score > s.thiefBest };
  },

  buyStock(id, coins) {
    const { s } = get();
    const def = STOCK_BY_ID.get(id);
    // Límite de inversión: la bolsa complementa la ciudad, no la sustituye
    const room = stockInvestCap(s, now()) - investedTotal(s);
    const amount = Math.min(coins, s.coins, room);
    if (!def || !(amount >= 1)) return 0;
    const price = stockPrice(def, now());
    const h = s.stocks[id] ?? { u: 0, c: 0 };
    set({
      s: { ...s, coins: s.coins - amount, stocks: { ...s.stocks, [id]: { u: h.u + unitsFor(amount, price), c: h.c + amount } } },
    });
    return amount;
  },

  sellStock(id, fraction) {
    const { s } = get();
    const def = STOCK_BY_ID.get(id);
    const h = s.stocks[id];
    if (!def || !h || fraction <= 0) return null;
    const f = Math.min(1, fraction);
    const all = f >= 0.999;
    const units = all ? h.u : h.u * f;
    const cost = all ? h.c : h.c * f;
    const value = saleValue(units, stockPrice(def, now()));
    const profit = value - cost;
    const stocks = { ...s.stocks };
    if (all) delete stocks[id];
    else stocks[id] = { u: h.u - units, c: h.c - cost };
    // La bolsa no cuenta para estrellas ni rankings (sería especulación sin riesgo real):
    // solo lleva su propio balance neto, que también baja con las pérdidas.
    set({ s: { ...s, coins: capped(s.coins + value), stockProfit: s.stockProfit + profit, stocks } });
    return { value, profit };
  },

  claimMission(kind, index) {
    const { s } = get();
    const list = kind === 'daily' ? s.missions.daily : s.missions.weekly;
    const slot = list[index];
    if (!slot || slot.c || !isDone(slot)) return null;
    const claimed = list.map((x, i) => (i === index ? { ...x, c: true } : x));
    const missions = kind === 'daily' ? { ...s.missions, daily: claimed } : { ...s.missions, weekly: claimed };
    let next: GameState = { ...s, missions, missionsDone: s.missionsDone + 1 };
    if (kind === 'daily') {
      next = addPoints({ ...next, gems: next.gems + DAILY_REWARD.gems, tickets: next.tickets + DAILY_REWARD.tickets }, DAILY_REWARD.points);
      set({ s: next });
      return `+${DAILY_REWARD.gems} 💎 · +${DAILY_REWARD.tickets} 🎟️ · +${DAILY_REWARD.points} pts de liga`;
    }
    const card = randomCard(Math.random);
    next = withCard(addPoints({ ...next, gems: next.gems + WEEKLY_REWARD.gems }, WEEKLY_REWARD.points), card);
    set({ s: next });
    return `+${WEEKLY_REWARD.gems} 💎 · +${WEEKLY_REWARD.points} pts de liga · ${CARDS[card].emoji} carta de la Copa`;
  },

  claimChest() {
    const { s } = get();
    if (!chestReady(s)) return null;
    const t = now();
    const card = randomCard(Math.random);
    const next = withCard(
      addPoints(
        {
          ...s,
          missions: { ...s.missions, chest: true },
          gems: s.gems + CHEST_REWARD.gems,
          boosts: addBoost(s, t, 'cofre', CHEST_REWARD.boost, CHEST_REWARD.boostSeconds),
        },
        CHEST_REWARD.points,
      ),
      card,
    );
    set({ s: next });
    return `+${CHEST_REWARD.gems} 💎 · ⚡ Producción x${CHEST_REWARD.boost} ${CHEST_REWARD.boostSeconds / 60} min · +${CHEST_REWARD.points} pts de liga · ${CARDS[card].emoji} carta de la Copa`;
  },

  claimLeague() {
    const { s } = get();
    const prev = s.league.prev;
    if (!prev) return null;
    const division = divisionOf(prev.points);
    set({
      s: {
        ...s,
        gems: s.gems + division.gems,
        tickets: s.tickets + division.tickets,
        league: { ...s.league, prev: null, best: Math.max(s.league.best, DIVISIONS.indexOf(division)) },
      },
    });
    return { division, points: prev.points };
  },

  cupRegister(week) {
    const { s } = get();
    set({ s: { ...s, cup: registeredFor(s.cup, week) } });
  },

  cupAttempt(slot) {
    const { s } = get();
    if (!s.cup.week || s.cup.used[slot] >= attemptsFor(s.cup, s.cup.week, slot)) return false;
    set({ s: { ...s, cup: { ...s.cup, used: { ...s.cup.used, [slot]: s.cup.used[slot] + 1 } } } });
    return true;
  },

  cupScore(slot, raw, card = null) {
    const { s } = get();
    const score = cupScoreOf(raw, s.cup.training, card);
    const old = s.cup.best[slot];
    const best = Math.max(old, score);
    const improved = best > old;
    // El escudo devuelve el intento si no sirvió para mejorar
    const refunded = card === 'shield' && !improved && s.cup.used[slot] > 0;
    if (improved || refunded) {
      set({
        s: {
          ...s,
          cup: {
            ...s.cup,
            best: { ...s.cup.best, [slot]: best },
            used: refunded ? { ...s.cup.used, [slot]: s.cup.used[slot] - 1 } : s.cup.used,
          },
        },
      });
    }
    return { score, best, improved, refunded };
  },

  cupUseCard(card, slot) {
    const { s } = get();
    const i = s.cup.loadout.indexOf(card);
    if (i < 0 || (CARDS[card].finalOnly && slot !== 'f')) return false;
    const loadout = s.cup.loadout.filter((_, k) => k !== i);
    const bonus = card === 'extra' ? { ...s.cup.bonus, [slot]: s.cup.bonus[slot] + 1 } : s.cup.bonus;
    set({ s: { ...s, cup: { ...s.cup, loadout, bonus } } });
    return true;
  },

  cupEquip(card) {
    const { s } = get();
    const c = s.cup;
    if ((c.cards[card] ?? 0) < 1 || c.loadout.length >= cardSlots(c.training)) return false;
    set({ s: { ...s, cup: { ...c, cards: { ...c.cards, [card]: c.cards[card] - 1 }, loadout: [...c.loadout, card] } } });
    return true;
  },

  cupUnequip(index) {
    const { s } = get();
    const c = s.cup;
    const card = c.loadout[index];
    if (!card) return;
    set({ s: { ...s, cup: { ...c, cards: returnCards(c.cards, [card]), loadout: c.loadout.filter((_, k) => k !== index) } } });
  },

  cupTrain() {
    const { s } = get();
    if (s.cup.training >= TRAINING_MAX) return 0;
    const cost = trainingCost(s.cup.training, productionPerSec(s, now(), false));
    if (s.coins < cost) return 0;
    set({ s: { ...s, coins: s.coins - cost, cup: { ...s.cup, training: s.cup.training + 1 } } });
    return cost;
  },

  cupPredict(week, uid, name, stake) {
    const { s } = get();
    if (s.cup.pick?.week === week || s.gems < stake || !PICK_STAKES.includes(stake)) return false;
    set({ s: { ...s, gems: s.gems - stake, cup: { ...s.cup, pick: { week, uid, name, stake } } } });
    return true;
  },

  cupClaim(week, outcome, pickGems = 0) {
    const { s } = get();
    const c = s.cup;
    if (c.claimed === week || c.history.some((h) => h.week === week)) return null;
    const reward = cupRewards(outcome);
    const lines = reward.lines.slice();
    const pick = c.pick?.week === week ? c.pick : null;
    if (pick) lines.push(pickGems > 0 ? `Pronóstico (${pick.name}): +${pickGems} 💎` : `Pronóstico (${pick.name}): esta vez no hubo suerte`);
    // Una carta para la próxima Copa por haber jugado
    const card = outcome.played ? randomCard(Math.random) : null;
    if (card) lines.push(`Carta para la próxima Copa: ${CARDS[card].emoji} ${CARDS[card].name}`);
    const gems = reward.gems + pickGems;
    const record = { week, group: outcome.groupRank, size: outcome.groupSize, final: outcome.finalRank, gems };
    const cup = {
      ...c,
      claimed: week,
      prev: c.prev === week ? null : c.prev,
      pick: pick ? null : c.pick,
      cards: card ? { ...c.cards, [card]: c.cards[card] + 1 } : c.cards,
      gold: c.gold + (reward.trophy === 'gold' ? 1 : 0),
      silver: c.silver + (reward.trophy === 'silver' ? 1 : 0),
      bronze: c.bronze + (reward.trophy === 'bronze' ? 1 : 0),
      finals: c.finals + (outcome.finalist ? 1 : 0),
      played: c.played + (outcome.played ? 1 : 0),
      history: [...c.history, record].slice(-HISTORY_MAX),
    };
    set({ s: { ...s, gems: s.gems + gems, tickets: s.tickets + reward.tickets, cup } });
    return { ...reward, gems, lines, card };
  },

  seasonClaim(season, rank) {
    const { s } = get();
    if (season <= s.cup.seasonClaimed) return null;
    const r = seasonReward(rank);
    const gems = r?.gems ?? 0;
    const flag = !!r?.flag;
    set({ s: { ...s, gems: s.gems + gems, cup: { ...s.cup, seasonClaimed: season, seasons: s.cup.seasons + (flag ? 1 : 0) } } });
    return { gems, flag };
  },

  setName(name) {
    const clean = sanitizeName(name);
    if (clean.length < 3) return 'El nombre debe tener al menos 3 letras o números';
    if (!isNameAllowed(clean)) return 'Ese nombre no está permitido';
    set({ s: { ...get().s, name: clean } });
    return null;
  },

  toast(text) {
    const id = ++toastId;
    // Los mensajes largos (errores con instrucciones) se quedan más tiempo
    const ms = Math.min(7000, 2600 + Math.max(0, text.length - 40) * 45);
    set({ toasts: [...get().toasts.slice(-3), { id, text, ms }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), ms);
  },
}));
