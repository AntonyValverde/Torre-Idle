import { isNewDay } from './clock';
import type { GameState } from './state';

// Estado del periódico diario: cada día guarda una foto de las estadísticas de la ciudad. Al empezar
// un día nuevo se compara con la foto anterior y sale el resumen de "tu ciudad ayer" (o desde tu
// última visita, si pasaron varios días).

/** Récords de minijuego que se vigilan para la portada. */
export const PAPER_RECORDS = {
  stackBest: { emoji: '🏗️', name: 'Stack Tower', unit: 'pisos' },
  thiefBest: { emoji: '🦹', name: 'Atrapa al ladrón', unit: 'puntos' },
  trafficBest: { emoji: '🚦', name: 'Semáforo', unit: 'coches' },
  memoryBest: { emoji: '🧠', name: 'Memoria', unit: 'rondas' },
  fireBest: { emoji: '🚒', name: 'Bomberos', unit: 'puntos' },
  metroBest: { emoji: '🚇', name: 'Metro', unit: 'viajeros' },
  mergeBestTile: { emoji: '🧱', name: 'Fusión', unit: '(ficha)' },
} as const;

export type RecordKey = keyof typeof PAPER_RECORDS;

export interface PaperStats {
  earned: number;
  taps: number;
  balloons: number;
  missions: number;
  spins: number;
  era: number;
  stars: number;
  gold: number;
  silver: number;
  bronze: number;
  league: number;
  achievements: number;
  /** Regalos recibidos de otros alcaldes. */
  gifts: number;
  bests: Record<RecordKey, number>;
}

export interface PaperDelta {
  /** Día de la foto anterior (el resumen va desde ese día hasta ayer). */
  since: string;
  earned: number;
  taps: number;
  balloons: number;
  missions: number;
  spins: number;
  achievements: number;
  gifts: number;
  /** Eras ganadas (refundaciones). */
  eras: number;
  stars: number;
  era: number;
  trophy: 'gold' | 'silver' | 'bronze' | null;
  /** Mejor división de liga alcanzada por primera vez (índice), o -1. */
  league: number;
  records: { key: RecordKey; value: number }[];
}

export interface PaperState {
  /** Último día en que se leyó el periódico (cobra la propina una vez al día). */
  read: string | null;
  /** Día de la foto actual. */
  day: string | null;
  snap: PaperStats | null;
  /** Resumen de la edición de hoy (null: primera edición). */
  prev: PaperDelta | null;
}

/** Propina del repartidor por leer el periódico del día. */
export const PAPER_GEMS = 2;

export function newPaper(): PaperState {
  return { read: null, day: null, snap: null, prev: null };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function statsOf(v: unknown): PaperStats | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const b = (r.bests && typeof r.bests === 'object' ? r.bests : {}) as Record<string, unknown>;
  const bests = {} as Record<RecordKey, number>;
  for (const k of Object.keys(PAPER_RECORDS) as RecordKey[]) bests[k] = num(b[k]);
  return {
    earned: num(r.earned),
    taps: num(r.taps),
    balloons: num(r.balloons),
    missions: num(r.missions),
    spins: num(r.spins),
    era: Math.max(1, num(r.era)),
    stars: num(r.stars),
    gold: num(r.gold),
    silver: num(r.silver),
    bronze: num(r.bronze),
    league: Number.isFinite(r.league) ? (r.league as number) : -1,
    achievements: num(r.achievements),
    gifts: num(r.gifts),
    bests,
  };
}

export function paperState(v: unknown): PaperState {
  if (!v || typeof v !== 'object') return newPaper();
  const r = v as Record<string, unknown>;
  const p = r.prev && typeof r.prev === 'object' ? (r.prev as PaperDelta) : null;
  return {
    read: str(r.read),
    day: str(r.day),
    snap: statsOf(r.snap),
    prev:
      p && typeof p.since === 'string'
        ? {
            ...p,
            records: Array.isArray(p.records) ? p.records.filter((x) => x && x.key in PAPER_RECORDS && Number.isFinite(x.value)) : [],
          }
        : null,
  };
}

export function paperStats(s: GameState): PaperStats {
  const bests = {} as Record<RecordKey, number>;
  for (const k of Object.keys(PAPER_RECORDS) as RecordKey[]) bests[k] = s[k];
  return {
    earned: s.allTimeEarned,
    taps: s.taps,
    balloons: s.balloons,
    missions: s.missionsDone,
    spins: s.wheelSpins,
    era: s.era,
    stars: s.stars,
    gold: s.cup.gold,
    silver: s.cup.silver,
    bronze: s.cup.bronze,
    league: s.league.best,
    achievements: Object.values(s.achievements).reduce((n, x) => n + x, 0),
    gifts: s.social.received,
    bests,
  };
}

export function paperDelta(a: PaperStats, b: PaperStats, since: string): PaperDelta {
  const trophy = b.gold > a.gold ? 'gold' : b.silver > a.silver ? 'silver' : b.bronze > a.bronze ? 'bronze' : null;
  const records = (Object.keys(PAPER_RECORDS) as RecordKey[]).filter((k) => b.bests[k] > a.bests[k] && b.bests[k] > 0).map((k) => ({ key: k, value: b.bests[k] }));
  return {
    since,
    earned: Math.max(0, b.earned - a.earned),
    taps: Math.max(0, b.taps - a.taps),
    balloons: Math.max(0, b.balloons - a.balloons),
    missions: Math.max(0, b.missions - a.missions),
    spins: Math.max(0, b.spins - a.spins),
    achievements: Math.max(0, b.achievements - a.achievements),
    gifts: Math.max(0, b.gifts - a.gifts),
    eras: Math.max(0, b.era - a.era),
    stars: Math.max(0, b.stars - a.stars),
    era: b.era,
    trophy,
    league: b.league > a.league ? b.league : -1,
    records,
  };
}

/**
 * Cambio de día: el resumen de la edición sale de comparar la foto anterior con la ciudad de ahora,
 * y se hace una foto nueva. Si no cambia el día, devuelve la misma partida.
 */
export function rollPaper(s: GameState, today: string): GameState {
  const p = s.paper;
  if (!isNewDay(p.day, today)) return s;
  const now = paperStats(s);
  const prev = p.snap && p.day ? paperDelta(p.snap, now, p.day) : null;
  return { ...s, paper: { ...p, day: today, snap: now, prev } };
}

/** Hay periódico nuevo sin leer. */
export function paperUnread(s: GameState, today: string): boolean {
  return isNewDay(s.paper.read, today);
}
