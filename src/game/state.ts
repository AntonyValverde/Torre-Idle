import { MISSION_BY_ID, newLeague, newMissions, type LeagueState, type MissionSlot, type MissionsState } from './missions';
import { isNameAllowed, randomName, sanitizeName } from './names';
import { CARD_IDS, HISTORY_MAX, TRAINING_MAX, newCup, type CardId, type CupState } from './cup';
import { newTutorial, tutorialState, type TutorialState } from './tutorial';
import { LAW_BY_ID } from './laws';
import { advisorsState, newAdvisors, type AdvisorsState } from './advisors';
import { casinoState, newCasino, type CasinoState } from './casino';

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
  /** Récord de puntos en Bomberos. */
  fireBest: number;
  /** Récord de viajeros llevados en Metro. */
  metroBest: number;
  /** Apagón diario. */
  daily: DailyRecord;
  /** Conecta las calles (segundo puzzle diario). */
  roads: DailyRecord;
  /** Plan verde (tercer puzzle diario). */
  parks: DailyRecord;
  /** Récord ya subido a cada ranking de minijuego: si el local es mayor, se reintenta la subida. */
  submittedBest: Record<string, number>;
  /** Resultados de retos diarios que aún no llegaron al ranking (sin conexión, sin sesión…): se reintentan. */
  pendingDaily: PendingDaily[];
  /** Día del último giro gratis de la rueda. */
  wheelLast: string | null;
  wheelSpins: number;
  /** Acciones en bolsa: u = unidades, c = monedas invertidas (para calcular ganancias). */
  stocks: Record<string, Holding>;
  stockProfit: number;
  /** Misiones diarias y semanales activas. */
  missions: MissionsState;
  /** Misiones completadas desde siempre (para el logro). */
  missionsDone: number;
  league: LeagueState;
  /** Copa de Alcaldes: inscripción, intentos, mejores marcas y trofeos. */
  cup: CupState;
  /**
   * Ganancias offline pendientes de recoger. Se guardan con la partida: si se cierra o recarga
   * la app sin pulsar "Recoger", no se pierden (lastTick ya avanzó y no se volverían a contar).
   */
  pendingOffline: OfflineReport | null;
  /** Tutorial de Clara: paso actual y su progreso. */
  tutorial: TutorialState;
  /** Ley elegida para la era actual (null: aún sin elegir o en la era 1). Se reinicia al refundar. */
  law: string | null;
  /** Consejeros: colección, sillas del consejo y sobres sin abrir. */
  advisors: AdvisorsState;
  /** Reorganizar el legado sale gratis (una vez por era). */
  respecFree: boolean;
  /** Última partida gratis del Pase VIP (hora de confianza). */
  vipLast: number;
  /** Casino (desde la era 2): fichas, nivel de socio y partidas a medias. Sobrevive a las refundaciones. */
  casino: CasinoState;
  createdAt: number;
}

export interface OfflineReport {
  earned: number;
  seconds: number;
}

export interface Holding {
  u: number;
  c: number;
}

/** Resultado de un reto diario pendiente de subir a su ranking. */
export interface PendingDaily {
  kind: 'daily' | 'roads' | 'parks';
  date: string;
  moves: number;
  timeMs: number;
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
    fireBest: 0,
    metroBest: 0,
    daily: { last: null, streak: 0, bestStreak: 0 },
    roads: { last: null, streak: 0, bestStreak: 0 },
    parks: { last: null, streak: 0, bestStreak: 0 },
    submittedBest: {},
    pendingDaily: [],
    wheelLast: null,
    wheelSpins: 0,
    stocks: {},
    stockProfit: 0,
    missions: newMissions(),
    missionsDone: 0,
    league: newLeague(),
    cup: newCup(),
    pendingOffline: null,
    tutorial: newTutorial(),
    law: null,
    advisors: newAdvisors(),
    respecFree: true,
    vipLast: 0,
    casino: newCasino(),
    createdAt: t,
  };
}

function offlineReport(v: Partial<OfflineReport> | null | undefined): OfflineReport | null {
  if (!v || typeof v !== 'object') return null;
  const earned = num(v.earned, 0);
  const seconds = num(v.seconds, 0);
  return earned > 0 && seconds > 0 ? { earned, seconds } : null;
}

function cupState(v: Partial<CupState> | undefined): CupState {
  const base = newCup();
  if (!v || typeof v !== 'object') return base;
  const slotsOf = (x: unknown) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return { g1: Math.max(0, num(r.g1, 0)), g2: Math.max(0, num(r.g2, 0)), g3: Math.max(0, num(r.g3, 0)), f: Math.max(0, num(r.f, 0)) };
  };
  const str = (x: unknown) => (typeof x === 'string' ? x : null);
  const cards = (x: unknown) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const out = { ...base.cards };
    for (const id of CARD_IDS) out[id] = Math.max(0, Math.floor(num(r[id], 0)));
    return out;
  };
  const pick = v.pick && typeof v.pick === 'object' ? v.pick : null;
  return {
    week: str(v.week),
    prev: str(v.prev),
    used: slotsOf(v.used),
    best: slotsOf(v.best),
    bonus: slotsOf(v.bonus),
    training: Math.max(0, Math.min(TRAINING_MAX, Math.floor(num(v.training, 0)))),
    cards: cards(v.cards),
    loadout: Array.isArray(v.loadout) ? v.loadout.filter((x): x is CardId => (CARD_IDS as string[]).includes(x)).slice(0, 3) : [],
    activity: {
      week: str(v.activity?.week),
      days: Math.max(0, Math.floor(num(v.activity?.days, 0))) & 31,
    },
    pick:
      pick && typeof pick.week === 'string' && typeof pick.uid === 'string'
        ? { week: pick.week, uid: pick.uid, name: typeof pick.name === 'string' ? pick.name : '???', stake: Math.max(0, num(pick.stake, 0)) }
        : null,
    seasons: Math.max(0, num(v.seasons, 0)),
    seasonClaimed: Math.floor(num(v.seasonClaimed, -1)),
    claimed: str(v.claimed),
    gold: Math.max(0, num(v.gold, 0)),
    silver: Math.max(0, num(v.silver, 0)),
    bronze: Math.max(0, num(v.bronze, 0)),
    finals: Math.max(0, num(v.finals, 0)),
    played: Math.max(0, num(v.played, 0)),
    history: Array.isArray(v.history)
      ? v.history
          .filter((h) => h && typeof h.week === 'string')
          .slice(-HISTORY_MAX)
          .map((h) => ({
            week: h.week,
            group: typeof h.group === 'number' ? h.group : null,
            size: num(h.size, 0),
            final: typeof h.final === 'number' ? h.final : null,
            gems: num(h.gems, 0),
          }))
      : [],
  };
}

function slots(v: unknown): MissionSlot[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x.id === 'string' && MISSION_BY_ID.has(x.id))
    .map((x) => ({ id: x.id, p: Math.max(0, num(x.p, 0)), c: x.c === true }));
}

function missionsState(v: Partial<MissionsState> | undefined): MissionsState {
  return {
    day: typeof v?.day === 'string' ? v.day : null,
    daily: slots(v?.daily),
    chest: v?.chest === true,
    week: typeof v?.week === 'string' ? v.week : null,
    weekly: slots(v?.weekly),
  };
}

function leagueState(v: Partial<LeagueState> | undefined): LeagueState {
  const prev = v?.prev;
  return {
    week: typeof v?.week === 'string' ? v.week : null,
    points: Math.max(0, num(v?.points, 0)),
    prev: prev && typeof prev.week === 'string' && Number.isFinite(prev.points) ? { week: prev.week, points: prev.points } : null,
    best: Math.floor(num(v?.best, -1)),
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

const PENDING_KINDS: PendingDaily['kind'][] = ['daily', 'roads', 'parks'];

function pendingDaily(v: unknown): PendingDaily[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (p) =>
        p &&
        PENDING_KINDS.includes(p.kind) &&
        typeof p.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
        Number.isFinite(p.moves) &&
        Number.isFinite(p.timeMs),
    )
    .slice(-9)
    .map((p) => ({ kind: p.kind, date: p.date, moves: p.moves, timeMs: p.timeMs }));
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
    fireBest: num(r.fireBest, 0),
    metroBest: num(r.metroBest, 0),
    submittedBest: numRecord(r.submittedBest),
    pendingDaily: pendingDaily(r.pendingDaily),
    wheelLast: typeof r.wheelLast === 'string' ? r.wheelLast : null,
    wheelSpins: num(r.wheelSpins, 0),
    stocks: holdings(r.stocks),
    stockProfit: num(r.stockProfit, 0),
    daily: dailyRecord(r.daily),
    roads: dailyRecord(r.roads),
    parks: dailyRecord(r.parks),
    missions: missionsState(r.missions),
    missionsDone: num(r.missionsDone, 0),
    league: leagueState(r.league),
    cup: cupState(r.cup),
    pendingOffline: offlineReport(r.pendingOffline),
    // Sin campo: partida de antes del tutorial, que ya no lo necesita
    tutorial: tutorialState(r.tutorial),
    // Una ley que ya no existe (de otra versión) se descarta: se vuelve a elegir
    law: typeof r.law === 'string' && LAW_BY_ID.has(r.law) ? r.law : null,
    advisors: advisorsState(r.advisors),
    // Sin campo (partidas de antes del árbol con ramas): la primera reorganización es gratis
    respecFree: r.respecFree !== false,
    vipLast: num(r.vipLast, 0),
    casino: casinoState(r.casino),
    createdAt: num(r.createdAt, t),
  };
}
