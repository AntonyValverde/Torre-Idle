import { dateKey } from '../game/clock';
import { totalAchievements, totalBuildings } from '../game/economy';
import type { GameState } from '../game/state';
import { TUTORIAL, TUTORIAL_SINCE, stepsCompleted } from '../game/tutorial';
import { LAWS } from '../game/laws';

// Métricas del panel de administración, calculadas a partir de las partidas guardadas en Firestore.
// Funciones puras: no leen la red, así se pueden probar.

export interface Player {
  uid: string;
  name: string;
  /** Último guardado en la nube (ms) o null si nunca guardó. */
  savedAt: number | null;
  s: GameState;
}

export interface Bucket {
  label: string;
  value: number;
}

const DAY = 86_400_000;

export interface GameAdoption {
  id: string;
  label: string;
  played: (s: GameState) => boolean;
  best?: (s: GameState) => number;
}

export const GAMES: GameAdoption[] = [
  { id: 'daily', label: '🌃 Apagón', played: (s) => s.daily.last !== null, best: (s) => s.daily.bestStreak },
  { id: 'roads', label: '🛣️ Calles', played: (s) => s.roads.last !== null, best: (s) => s.roads.bestStreak },
  { id: 'parks', label: '🌳 Plan verde', played: (s) => s.parks.last !== null, best: (s) => s.parks.bestStreak },
  { id: 'wheel', label: '🎡 Rueda', played: (s) => s.wheelSpins > 0, best: (s) => s.wheelSpins },
  { id: 'thief', label: '🦹 Ladrón', played: (s) => s.thiefBest > 0, best: (s) => s.thiefBest },
  { id: 'stack', label: '🏗️ Stack', played: (s) => s.stackBest > 0, best: (s) => s.stackBest },
  { id: 'traffic', label: '🚦 Semáforo', played: (s) => s.trafficBest > 0, best: (s) => s.trafficBest },
  { id: 'memory', label: '🧠 Memoria', played: (s) => s.memoryBest > 0, best: (s) => s.memoryBest },
  { id: 'fire', label: '🚒 Bomberos', played: (s) => s.fireBest > 0, best: (s) => s.fireBest },
  { id: 'metro', label: '🚇 Metro', played: (s) => s.metroBest > 0, best: (s) => s.metroBest },
  { id: 'merge', label: '🧱 Fusión', played: (s) => s.mergeBest > 0, best: (s) => s.mergeBest },
  { id: 'stocks', label: '📈 Bolsa', played: (s) => s.stockProfit !== 0 || Object.keys(s.stocks).length > 0 },
];

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Últimos `days` días (el más antiguo primero) como claves AAAA-MM-DD. */
export function lastDays(nowMs: number, days: number): string[] {
  const out: string[] = [];
  const d = new Date(nowMs);
  for (let k = days - 1; k >= 0; k--) out.push(dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - k, 12).getTime()));
  return out;
}

export interface Summary {
  total: number;
  active24h: number;
  active7d: number;
  new7d: number;
  prestiged: number;
  medianEarned: number;
  gemsInCirculation: number;
  avgAchievements: number;
  avgBuildings: number;
  /** Misiones completadas por todos los jugadores. */
  missionsDone: number;
  /** Jugadores que hoy abrieron el cofre de las tres misiones diarias. */
  chestsToday: number;
  signups: Bucket[];
  lastSeen: Bucket[];
  eras: Bucket[];
  adoption: Bucket[];
  records: { game: string; value: number; name: string }[];
  /** Embudo del tutorial (solo partidas creadas desde que existe): cuántos completaron cada paso. */
  tutorial: Bucket[];
  /** Partidas que pudieron ver el tutorial, y cuántas lo saltaron. */
  tutorialPlayers: number;
  tutorialSkipped: number;
  /** Jugadores que rigen su era actual con cada ley. */
  laws: Bucket[];
}

export function tutorialFunnel(players: Player[]): { funnel: Bucket[]; players: number; skipped: number } {
  const fresh = players.filter((p) => p.s.createdAt >= TUTORIAL_SINCE);
  return {
    funnel: TUTORIAL.map((step, i) => ({
      label: `${i + 1}. ${step.label}`,
      value: fresh.filter((p) => stepsCompleted(p.s.tutorial) > i).length,
    })),
    players: fresh.length,
    skipped: fresh.filter((p) => p.s.tutorial.skip !== undefined).length,
  };
}

export function summarize(players: Player[], nowMs: number): Summary {
  const total = players.length;
  const seenWithin = (ms: number) => players.filter((p) => p.savedAt !== null && nowMs - p.savedAt <= ms).length;

  const days = lastDays(nowMs, 14);
  const byDay = new Map(days.map((d) => [d, 0]));
  for (const p of players) {
    const k = dateKey(p.s.createdAt);
    if (byDay.has(k)) byDay.set(k, byDay.get(k)! + 1);
  }

  const lastSeen: Bucket[] = [
    { label: 'Hoy (24 h)', value: 0 },
    { label: '1–7 días', value: 0 },
    { label: '8–30 días', value: 0 },
    { label: 'Más de 30 días', value: 0 },
  ];
  for (const p of players) {
    const ago = p.savedAt === null ? Infinity : nowMs - p.savedAt;
    lastSeen[ago <= DAY ? 0 : ago <= 7 * DAY ? 1 : ago <= 30 * DAY ? 2 : 3].value++;
  }

  const maxEra = Math.max(1, ...players.map((p) => p.s.era));
  const eras: Bucket[] = Array.from({ length: Math.min(maxEra, 12) }, (_, i) => ({ label: `Era ${i + 1}`, value: 0 }));
  for (const p of players) eras[Math.min(p.s.era, eras.length) - 1].value++;
  if (maxEra > 12) eras[11].label = 'Era 12+';

  const records = GAMES.filter((g) => g.best).map((g) => {
    let best: Player | null = null;
    for (const p of players) if (!best || g.best!(p.s) > g.best!(best.s)) best = p;
    return { game: g.label, value: best ? g.best!(best.s) : 0, name: best?.name ?? '-' };
  });
  const tut = tutorialFunnel(players);

  return {
    total,
    active24h: seenWithin(DAY),
    active7d: seenWithin(7 * DAY),
    new7d: players.filter((p) => nowMs - p.s.createdAt <= 7 * DAY).length,
    prestiged: players.filter((p) => p.s.era > 1).length,
    medianEarned: median(players.map((p) => p.s.allTimeEarned)),
    gemsInCirculation: players.reduce((n, p) => n + p.s.gems, 0),
    avgAchievements: total ? players.reduce((n, p) => n + totalAchievements(p.s), 0) / total : 0,
    avgBuildings: total ? players.reduce((n, p) => n + totalBuildings(p.s), 0) / total : 0,
    missionsDone: players.reduce((n, p) => n + p.s.missionsDone, 0),
    chestsToday: players.filter((p) => p.s.missions.day === dateKey(nowMs) && p.s.missions.chest).length,
    signups: days.map((d) => ({ label: d, value: byDay.get(d)! })),
    lastSeen,
    eras,
    adoption: GAMES.map((g) => ({ label: g.label, value: players.filter((p) => g.played(p.s)).length })),
    records: records.filter((r) => r.value > 0),
    tutorial: tut.funnel,
    tutorialPlayers: tut.players,
    tutorialSkipped: tut.skipped,
    laws: LAWS.map((l) => ({ label: `${l.emoji} ${l.name}`, value: players.filter((p) => p.s.law === l.id).length })),
  };
}

/** "hace 5 min", "hace 3 h", "hace 2 días". */
export function ago(ms: number | null, nowMs: number): string {
  if (ms === null) return 'nunca';
  const s = Math.max(0, (nowMs - ms) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
