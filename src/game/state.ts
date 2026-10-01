import { isNameAllowed, randomName, sanitizeName } from './names';

export interface Boost {
  k: string;
  m: number;
  u: number;
}

/** Progreso de un reto diario: último día completado y racha. */
export interface DailyRecord {
  last: string | null;
  streak: number;
  bestStreak: number;
}

export interface GameState {
  v: 1;
  name: string;
  coins: number;
  /** Monedas ganadas en la era actual (se reinicia al refundar). */
  totalEarned: number;
  /** Monedas ganadas desde siempre (nunca se reinicia). */
  allTimeEarned: number;
  gems: number;
  buildings: Record<string, number>;
  upgrades: string[];
  rare: string[];
  gemLevels: Record<string, number>;
  /** Era actual (1 = Aldea). Sube al refundar la ciudad. */
  era: number;
  /** Estrellas de legado obtenidas en total (dan bonus pasivo). */
  stars: number;
  /** Estrellas gastadas en el árbol de legado. */
  starsSpent: number;
  legacy: Record<string, number>;
  /** Nivel de logro reclamado por categoría. */
  achievements: Record<string, number>;
  tickets: number;
  /** Momento (hora de confianza) desde el que se cuenta la recarga del próximo ticket. */
  ticketTime: number;
  /** Boosts de producción activos: uno por fuente (k); fuentes distintas se multiplican. */
  boosts: Boost[];
  tapBoostMult: number;
  tapBoostUntil: number;
  lastTick: number;
  taps: number;
  balloons: number;
  stackBest: number;
  mergeBest: number;
  mergeBestTile: number;
  thiefBest: number;
  /** Récord de coches que cruzaron en Semáforo. */
  trafficBest: number;
  /** Récord de rondas completadas en Memoria de ventanas. */
  memoryBest: number;
  /** Apagón diario. */
  daily: DailyRecord;
  /** Conecta las calles (segundo puzzle diario). */
  roads: DailyRecord;
  /** Día del último giro gratis de la rueda. */
  wheelLast: string | null;
  wheelSpins: number;
  /** Acciones en bolsa: u = unidades, c = monedas invertidas (para calcular ganancias). */
  stocks: Record<string, Holding>;
  stockProfit: number;
  createdAt: number;
}

export interface Holding {
  u: number;
  c: number;
}

export function newState(t: number): GameState {
  return {
    v: 1,
    name: randomName(),
    coins: 0,
    totalEarned: 0,
    allTimeEarned: 0,
    gems: 0,
    buildings: {},
    upgrades: [],
    rare: [],
    gemLevels: {},
    era: 1,
    stars: 0,
    starsSpent: 0,
    legacy: {},
    achievements: {},
    tickets: 3,
    ticketTime: t,
    boosts: [],
    tapBoostMult: 1,
    tapBoostUntil: 0,
    lastTick: t,
    taps: 0,
    balloons: 0,
    stackBest: 0,
    mergeBest: 0,
    mergeBestTile: 0,
    thiefBest: 0,
    trafficBest: 0,
    memoryBest: 0,
    daily: { last: null, streak: 0, bestStreak: 0 },
    roads: { last: null, streak: 0, bestStreak: 0 },
    wheelLast: null,
    wheelSpins: 0,
    stocks: {},
    stockProfit: 0,
    createdAt: t,
  };
}

function holdings(v: unknown): Record<string, Holding> {
  const out: Record<string, Holding> = {};
  if (v && typeof v === 'object') {
    for (const [k, h] of Object.entries(v as Record<string, Partial<Holding>>)) {
      if (h && Number.isFinite(h.u) && Number.isFinite(h.c) && (h.u as number) > 0) out[k] = { u: h.u as number, c: h.c as number };
    }
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function dailyRecord(v: Partial<DailyRecord> | undefined): DailyRecord {
  return {
    last: typeof v?.last === 'string' ? v.last : null,
    streak: num(v?.streak, 0),
    bestStreak: num(v?.bestStreak, 0),
  };
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  }
  return out;
}

/** Completa una partida guardada (local o de la nube) con valores por defecto. */
export function normalize(raw: unknown, t: number): GameState {
  const base = newState(t);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GameState>;
  const totalEarned = num(r.totalEarned, 0);
  return {
    ...base,
    name: (typeof r.name === 'string' && isNameAllowed(sanitizeName(r.name)) && sanitizeName(r.name)) || base.name,
    coins: num(r.coins, 0),
    totalEarned,
    allTimeEarned: Math.max(num(r.allTimeEarned, 0), totalEarned),
    gems: num(r.gems, 0),
    buildings: numRecord(r.buildings),
    upgrades: Array.isArray(r.upgrades) ? r.upgrades.filter((x) => typeof x === 'string') : [],
    rare: Array.isArray(r.rare) ? r.rare.filter((x) => typeof x === 'string') : [],
    gemLevels: numRecord(r.gemLevels),
    era: Math.max(1, Math.floor(num(r.era, 1))),
    stars: num(r.stars, 0),
    starsSpent: num(r.starsSpent, 0),
    legacy: numRecord(r.legacy),
    achievements: numRecord(r.achievements),
    tickets: num(r.tickets, base.tickets),
    ticketTime: num(r.ticketTime, t),
    boosts: Array.isArray(r.boosts)
      ? r.boosts
          .filter((b) => b && typeof b.k === 'string' && Number.isFinite(b.m) && Number.isFinite(b.u))
          .map((b) => ({ k: b.k, m: b.m, u: b.u }))
      : [],
    tapBoostMult: num(r.tapBoostMult, 1),
    tapBoostUntil: num(r.tapBoostUntil, 0),
    lastTick: num(r.lastTick, t),
    taps: num(r.taps, 0),
    balloons: num(r.balloons, 0),
    stackBest: num(r.stackBest, 0),
    mergeBest: num(r.mergeBest, 0),
    mergeBestTile: num(r.mergeBestTile, 0),
    thiefBest: num(r.thiefBest, 0),
    trafficBest: num(r.trafficBest, 0),
    memoryBest: num(r.memoryBest, 0),
    wheelLast: typeof r.wheelLast === 'string' ? r.wheelLast : null,
    wheelSpins: num(r.wheelSpins, 0),
    stocks: holdings(r.stocks),
    stockProfit: num(r.stockProfit, 0),
    daily: dailyRecord(r.daily),
    roads: dailyRecord(r.roads),
    createdAt: num(r.createdAt, t),
  };
}
