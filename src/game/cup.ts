import { hashString, mulberry32 } from '../minigames/rng';

// Copa de Alcaldes: un torneo cada semana.
//  - Lunes a viernes: inscripción (y práctica de las pruebas, que se anuncian el lunes).
//  - Sábado: fase de grupos de hasta 8 jugadores, con tres pruebas (triatlón).
//  - Domingo: final con una prueba sorpresa entre los mejores de cada grupo.
//  - Desde el lunes siguiente: ceremonia y premios.
// Todo se calcula igual en cada móvil a partir de los datos de Firestore: no hay servidor.

/** La Copa va en hora de Costa Rica (UTC-6, sin horario de verano): los cortes son iguales para todos. */
export const CUP_OFFSET_MS = -6 * 3_600_000;
const DAY = 86_400_000;
export const SIGNUP_DAYS = 5;
export const ATTEMPTS = 3;
export const GROUP_MAX = 8;
/** Puntos por puesto en cada prueba del grupo. */
export const PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export type CupGame = 'thief' | 'fire' | 'metro' | 'traffic' | 'memory' | 'stack';
export type CupSlot = 'g1' | 'g2' | 'g3' | 'f';
export const GROUP_SLOTS: CupSlot[] = ['g1', 'g2', 'g3'];
export type CupPhase = 'signup' | 'groups' | 'final';

export const CUP_GAME_INFO: Record<CupGame, { emoji: string; name: string; unit: string }> = {
  thief: { emoji: '🦹', name: 'Atrapa al ladrón', unit: 'pts' },
  fire: { emoji: '🚒', name: 'Bomberos', unit: 'pts' },
  metro: { emoji: '🚇', name: 'Metro', unit: 'viajeros' },
  traffic: { emoji: '🚦', name: 'Semáforo', unit: 'coches' },
  memory: { emoji: '🧠', name: 'Memoria', unit: 'rondas' },
  stack: { emoji: '🏗️', name: 'Stack Tower', unit: 'pisos' },
};
const CUP_GAMES = Object.keys(CUP_GAME_INFO) as CupGame[];

const pad = (n: number) => String(n).padStart(2, '0');

/** Lunes (AAAA-MM-DD) de la semana de la Copa que contiene `ms`. */
export function cupWeekKey(ms: number): string {
  const d = new Date(ms + CUP_OFFSET_MS);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Instante en que empieza la semana: lunes a las 00:00 hora de la Copa. */
export function cupStart(week: string): number {
  const [y, m, d] = week.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - CUP_OFFSET_MS;
}

export function prevCupWeek(week: string): string {
  return cupWeekKey(cupStart(week) - DAY);
}

export interface PhaseInfo {
  week: string;
  phase: CupPhase;
  /** Cuándo termina la fase actual. */
  endsAt: number;
}

export function cupPhase(ms: number): PhaseInfo {
  const week = cupWeekKey(ms);
  const start = cupStart(week);
  const days = (ms - start) / DAY;
  if (days < SIGNUP_DAYS) return { week, phase: 'signup', endsAt: start + SIGNUP_DAYS * DAY };
  if (days < SIGNUP_DAYS + 1) return { week, phase: 'groups', endsAt: start + (SIGNUP_DAYS + 1) * DAY };
  return { week, phase: 'final', endsAt: start + 7 * DAY };
}

/** Las tres pruebas del sábado y la de la final: distintas cada semana, iguales para todos. */
export function cupEvents(week: string): Record<CupSlot, CupGame> {
  const rand = mulberry32(hashString('copa:' + week));
  const games = CUP_GAMES.slice();
  for (let i = games.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [games[i], games[j]] = [games[j], games[i]];
  }
  return { g1: games[0], g2: games[1], g3: games[2], f: games[3] };
}

/** Nivel para formar grupos parecidos: orden de magnitud de las monedas ganadas en total. */
export function tierOf(allTimeEarned: number): number {
  return Math.max(0, Math.min(400, Math.floor(Math.log10(Math.max(1, allTimeEarned)))));
}

export interface CupEntry {
  uid: string;
  name: string;
  tier: number;
  gold: number;
  silver: number;
  bronze: number;
}

export type CupResult = Partial<Record<CupSlot, number>>;

/**
 * Reparte a los inscritos en grupos de hasta 8, juntando a los de nivel parecido. El desempate es un
 * hash del UID y la semana: así todos los móviles obtienen exactamente los mismos grupos.
 */
export function makeGroups(entries: CupEntry[], week: string): CupEntry[][] {
  if (!entries.length) return [];
  const key = (e: CupEntry) => hashString(e.uid + ':' + week);
  const sorted = entries.slice().sort((a, b) => b.tier - a.tier || key(a) - key(b) || (a.uid < b.uid ? -1 : 1));
  const count = Math.ceil(sorted.length / GROUP_MAX);
  const base = Math.floor(sorted.length / count);
  const extra = sorted.length % count;
  const groups: CupEntry[][] = [];
  let at = 0;
  for (let g = 0; g < count; g++) {
    const size = base + (g < extra ? 1 : 0);
    groups.push(sorted.slice(at, at + size));
    at += size;
  }
  return groups;
}

export interface StandingRow {
  entry: CupEntry;
  scores: number[];
  /** Puesto en cada prueba (1 = mejor; 0 si no jugó esa prueba). */
  places: number[];
  points: number;
  rank: number;
  played: boolean;
}

/** Clasificación del grupo: cada prueba reparte puntos por puesto (los empates comparten puesto). */
export function groupStandings(group: CupEntry[], results: Map<string, CupResult>): StandingRow[] {
  const rows: StandingRow[] = group.map((entry) => {
    const r = results.get(entry.uid) ?? {};
    const scores = GROUP_SLOTS.map((k) => Math.max(0, Math.floor(r[k] ?? 0)));
    return { entry, scores, places: [0, 0, 0], points: 0, rank: 0, played: scores.some((x) => x > 0) };
  });
  GROUP_SLOTS.forEach((_, k) => {
    for (const row of rows) {
      const mine = row.scores[k];
      if (mine <= 0) continue;
      const place = 1 + rows.filter((o) => o.scores[k] > mine).length;
      row.places[k] = place;
      row.points += PLACE_POINTS[place - 1] ?? 0;
    }
  });
  const wins = (r: StandingRow) => r.places.filter((p) => p === 1).length;
  rows.sort((a, b) => b.points - a.points || wins(b) - wins(a) || b.scores.reduce((n, x) => n + x, 0) - a.scores.reduce((n, x) => n + x, 0) || (a.entry.uid < b.entry.uid ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** Finalistas: los dos primeros de cada grupo que hayan jugado. Si solo hay un grupo, pasan cuatro. */
export function finalistsOf(standings: StandingRow[][]): CupEntry[] {
  const per = standings.length === 1 ? 4 : 2;
  return standings.flatMap((rows) => rows.filter((r) => r.played).slice(0, per).map((r) => r.entry));
}

export interface FinalRow {
  entry: CupEntry;
  score: number;
  rank: number;
}

/** Clasificación de la final; los que no jugaron la final quedan detrás. */
export function finalStandings(finalists: CupEntry[], results: Map<string, CupResult>, groupPoints: Map<string, number>): FinalRow[] {
  const rows = finalists.map((entry) => ({ entry, score: Math.max(0, Math.floor(results.get(entry.uid)?.f ?? 0)), rank: 0 }));
  rows.sort((a, b) => b.score - a.score || (groupPoints.get(b.entry.uid) ?? 0) - (groupPoints.get(a.entry.uid) ?? 0) || (a.entry.uid < b.entry.uid ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/**
 * El rival directo: cada grupo se empareja en duelos fijos según el orden del grupo (nivel parecido):
 * 1º con 2º, 3º con 4º… Si el grupo es impar, el último se cruza con el penúltimo. Como no depende
 * de la clasificación, se puede superar al rival (o quedar por detrás) hasta el final.
 */
export function rivalOf(group: CupEntry[], uid: string): CupEntry | null {
  const i = group.findIndex((e) => e.uid === uid);
  if (i < 0 || group.length < 2) return null;
  const j = i % 2 === 1 ? i - 1 : i + 1 < group.length ? i + 1 : i - 1;
  return group[j];
}

export interface CupView {
  groups: CupEntry[][];
  standings: StandingRow[][];
  finalists: CupEntry[];
  final: FinalRow[];
}

export function buildCup(entries: CupEntry[], results: Map<string, CupResult>, week: string): CupView {
  const groups = makeGroups(entries, week);
  const standings = groups.map((g) => groupStandings(g, results));
  const finalists = finalistsOf(standings);
  const points = new Map(standings.flat().map((r) => [r.entry.uid, r.points]));
  return { groups, standings, finalists, final: finalStandings(finalists, results, points) };
}

export type Trophy = 'gold' | 'silver' | 'bronze';

export interface CupOutcome {
  played: boolean;
  groupRank: number | null;
  groupSize: number;
  finalist: boolean;
  /** Puesto en la final (solo si jugó la final). */
  finalRank: number | null;
  beatRival: boolean;
  rivalName: string | null;
}

export function outcomeOf(view: CupView, uid: string): CupOutcome {
  const g = view.groups.findIndex((grp) => grp.some((e) => e.uid === uid));
  const rows = g >= 0 ? view.standings[g] : [];
  const me = rows.find((r) => r.entry.uid === uid);
  const rivalEntry = g >= 0 ? rivalOf(view.groups[g], uid) : null;
  const rival = rivalEntry ? rows.find((r) => r.entry.uid === rivalEntry.uid) : undefined;
  const fin = view.final.find((r) => r.entry.uid === uid);
  return {
    played: !!me?.played || !!fin?.score,
    groupRank: me ? me.rank : null,
    groupSize: rows.length,
    finalist: !!fin,
    finalRank: fin && fin.score > 0 ? fin.rank : null,
    beatRival: !!me && !!rival && me.played && me.rank < rival.rank,
    rivalName: rival?.entry.name ?? null,
  };
}

export interface CupReward {
  gems: number;
  tickets: number;
  trophy: Trophy | null;
  lines: string[];
}

export const TROPHY_INFO: Record<Trophy, { emoji: string; name: string }> = {
  gold: { emoji: '🏆', name: 'Copa de oro' },
  silver: { emoji: '🥈', name: 'Copa de plata' },
  bronze: { emoji: '🥉', name: 'Copa de bronce' },
};

export function cupRewards(o: CupOutcome): CupReward {
  const r: CupReward = { gems: 0, tickets: 0, trophy: null, lines: [] };
  if (!o.played) return r;
  const add = (gems: number, tickets: number, line: string) => {
    r.gems += gems;
    r.tickets += tickets;
    r.lines.push(line);
  };
  add(5, 0, 'Participación: +5 💎');
  if (o.groupRank === 1) add(20, 2, '1º de tu grupo: +20 💎 +2 🎟️');
  else if (o.groupRank === 2) add(12, 1, '2º de tu grupo: +12 💎 +1 🎟️');
  else if (o.groupRank !== null && o.groupRank <= 4) add(6, 0, `${o.groupRank}º de tu grupo: +6 💎`);
  if (o.finalRank === 1) {
    r.trophy = 'gold';
    add(50, 0, '¡Campeón de la Copa! +50 💎 🏆');
  } else if (o.finalRank === 2) {
    r.trophy = 'silver';
    add(30, 0, 'Subcampeón: +30 💎 🥈');
  } else if (o.finalRank === 3) {
    r.trophy = 'bronze';
    add(20, 0, 'Tercer puesto: +20 💎 🥉');
  } else if (o.finalist) {
    add(10, 0, 'Finalista: +10 💎');
  }
  if (o.beatRival && o.rivalName) add(5, 0, `Superaste a tu rival (${o.rivalName}): +5 💎`);
  return r;
}

/** Lo que guarda la partida sobre la Copa. */
export interface CupRecord {
  week: string;
  group: number | null;
  size: number;
  final: number | null;
  gems: number;
}

// =====================================================================
// Preparación: centro de entrenamiento, cartas de ventaja y afición
// =====================================================================

export type CardId = 'extra' | 'shield' | 'boost' | 'star';

export const CARDS: Record<CardId, { emoji: string; name: string; desc: string; finalOnly?: boolean; weight: number }> = {
  extra: { emoji: '🎟️', name: 'Intento extra', desc: '+1 intento en la prueba donde la uses', weight: 30 },
  shield: { emoji: '🛡️', name: 'Escudo', desc: 'Si el intento no mejora tu marca, no lo gasta', weight: 30 },
  boost: { emoji: '⚡', name: 'Impulso', desc: 'Ese intento puntúa +15%', weight: 30 },
  star: { emoji: '⭐', name: 'Estrella', desc: 'Ese intento puntúa +30% (solo en la final)', finalOnly: true, weight: 10 },
};
export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function randomCard(rand: () => number): CardId {
  const total = CARD_IDS.reduce((n, id) => n + CARDS[id].weight, 0);
  let r = rand() * total;
  for (const id of CARD_IDS) {
    r -= CARDS[id].weight;
    if (r < 0) return id;
  }
  return 'boost';
}

export const TRAINING_MAX = 5;
/** +2% en las marcas de la Copa por nivel. */
export const TRAINING_BONUS = 0.02;

/** Huecos para equipar cartas: 1, y uno más en los niveles 2 y 4. */
export function cardSlots(training: number): number {
  return 1 + (training >= 2 ? 1 : 0) + (training >= 4 ? 1 : 0);
}

/** Coste de subir el centro de entrenamiento: unos minutos de producción que se triplican por nivel. */
export function trainingCost(level: number, pps: number): number {
  return Math.round(Math.max(2000, pps * 600) * 3 ** level);
}

/** Marca que cuenta en la Copa: la del minijuego más el entrenamiento y la carta usada. */
export function cupScoreOf(raw: number, training: number, card: CardId | null): number {
  const mult = (1 + TRAINING_BONUS * training) * (card === 'boost' ? 1.15 : card === 'star' ? 1.3 : 1);
  return Math.min(5000, Math.floor(raw * mult));
}

/** Días de lunes a viernes en que se jugó (máscara de bits) de una semana. */
export function activeDays(c: CupState, week: string): number {
  if (c.activity.week !== week) return 0;
  let n = 0;
  for (let d = 0; d < SIGNUP_DAYS; d++) if (c.activity.days & (1 << d)) n++;
  return n;
}

export const FANS_GROUPS = 3;
export const FANS_FINAL = 5;

/** Intentos extra por la afición: 3 días entre semana dan uno en cada prueba del sábado; 5, también en la final. */
export function fansBonus(c: CupState, week: string, slot: CupSlot): number {
  const days = activeDays(c, week);
  return slot === 'f' ? (days >= FANS_FINAL ? 1 : 0) : days >= FANS_GROUPS ? 1 : 0;
}

export function attemptsFor(c: CupState, week: string, slot: CupSlot): number {
  return ATTEMPTS + (c.week === week ? c.bonus[slot] : 0) + fansBonus(c, week, slot);
}

/** ¿Se puede jugar ahora esa prueba de la Copa de `week`? Las de grupos el sábado y la final el domingo. */
export function slotOpen(week: string, slot: CupSlot, ms: number): boolean {
  const info = cupPhase(ms);
  return info.week === week && info.phase === (slot === 'f' ? 'final' : 'groups');
}

/**
 * Mejores marcas locales que el servidor aún no tiene (p. ej. una subida que se perdió al cerrar la app
 * sin conexión). Solo las de las pruebas que se están jugando ahora: las demás las reglas ya no las aceptan.
 */
export function unsyncedBest(best: Record<CupSlot, number>, server: CupResult | undefined, phase: CupPhase): Partial<Record<CupSlot, number>> {
  const slots: CupSlot[] = phase === 'groups' ? GROUP_SLOTS : phase === 'final' ? ['f'] : [];
  const out: Partial<Record<CupSlot, number>> = {};
  for (const k of slots) {
    const mine = Math.min(5000, Math.floor(best[k]));
    if (mine > 0 && mine > (server?.[k] ?? 0)) out[k] = mine;
  }
  return out;
}

/** Marca el día de hoy como jugado (solo de lunes a viernes). Devuelve el mismo objeto si no cambia. */
export function trackActivity(c: CupState, ms: number): CupState {
  const info = cupPhase(ms);
  if (info.phase !== 'signup') return c;
  const bit = 1 << Math.floor((ms - cupStart(info.week)) / DAY);
  if (c.activity.week === info.week && c.activity.days & bit) return c;
  const days = c.activity.week === info.week ? c.activity.days | bit : bit;
  return { ...c, activity: { week: info.week, days } };
}

// =====================================================================
// Pronósticos y temporadas
// =====================================================================

export const PICK_STAKES = [5, 10, 25];

/** Pronóstico del sábado: ×5 si tu elegido gana la Copa, ×2 si sube al podio, se devuelve si llega a la final. */
export function pickPayout(pick: CupPick | null, view: CupView): { mult: number; gems: number } {
  if (!pick) return { mult: 0, gems: 0 };
  const fin = view.final.find((r) => r.entry.uid === pick.uid);
  const mult = !fin ? 0 : fin.score > 0 && fin.rank === 1 ? 5 : fin.score > 0 && fin.rank <= 3 ? 2 : 1;
  return { mult, gems: pick.stake * mult };
}

/** Primera Copa: las temporadas (de 4 semanas) se cuentan desde aquí. */
export const SEASON_EPOCH = '2026-09-28';
export const SEASON_WEEKS = 4;

export function seasonOf(week: string): number {
  return Math.floor(Math.round((cupStart(week) - cupStart(SEASON_EPOCH)) / (7 * DAY)) / SEASON_WEEKS);
}

export function seasonWeeks(season: number): string[] {
  return Array.from({ length: SEASON_WEEKS }, (_, k) => cupWeekKey(cupStart(SEASON_EPOCH) + ((season * SEASON_WEEKS + k) * 7 + 2) * DAY));
}

/** Puntos de temporada de una Copa. */
export function seasonPoints(o: CupOutcome): number {
  if (!o.played) return 0;
  let p = 5;
  if (o.groupRank !== null) p += [20, 15, 10, 5][o.groupRank - 1] ?? 0;
  if (o.finalRank === 1) p += 100;
  else if (o.finalRank === 2) p += 70;
  else if (o.finalRank === 3) p += 50;
  else if (o.finalist) p += 30;
  return p;
}

/** Resumen de una Copa terminada (no cambia: se guarda en el dispositivo). */
export interface CupSummary {
  week: string;
  podium: { uid: string; name: string }[];
  rows: { uid: string; name: string; pts: number }[];
}

export function summarizeCup(view: CupView, week: string): CupSummary {
  const all = view.standings.flat();
  return {
    week,
    podium: view.final.filter((r) => r.score > 0).slice(0, 3).map((r) => ({ uid: r.entry.uid, name: r.entry.name })),
    rows: all.map((r) => ({ uid: r.entry.uid, name: r.entry.name, pts: seasonPoints(outcomeOf(view, r.entry.uid)) })).filter((r) => r.pts > 0),
  };
}

export interface SeasonRow {
  uid: string;
  name: string;
  pts: number;
  cups: number;
  rank: number;
}

export function seasonStandings(summaries: CupSummary[]): SeasonRow[] {
  const map = new Map<string, SeasonRow>();
  for (const s of summaries) {
    for (const r of s.rows) {
      const row = map.get(r.uid) ?? { uid: r.uid, name: r.name, pts: 0, cups: 0, rank: 0 };
      row.pts += r.pts;
      row.name = r.name;
      map.set(r.uid, row);
    }
    const champ = s.podium[0];
    if (champ && map.has(champ.uid)) map.get(champ.uid)!.cups++;
  }
  const rows = [...map.values()].sort((a, b) => b.pts - a.pts || b.cups - a.cups || (a.uid < b.uid ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function seasonReward(rank: number): { gems: number; flag: boolean; line: string } | null {
  if (rank === 1) return { gems: 100, flag: true, line: '¡Campeón de la temporada! +100 💎 y 🚩 bandera para tu ayuntamiento' };
  if (rank === 2) return { gems: 60, flag: false, line: '2º de la temporada: +60 💎' };
  if (rank === 3) return { gems: 40, flag: false, line: '3º de la temporada: +40 💎' };
  if (rank <= 10) return { gems: 15, flag: false, line: `${rank}º de la temporada: +15 💎` };
  return null;
}

// =====================================================================
// Lo que guarda la partida
// =====================================================================

export interface CupRecord {
  week: string;
  group: number | null;
  size: number;
  final: number | null;
  gems: number;
}

export interface CupPick {
  week: string;
  uid: string;
  name: string;
  stake: number;
}

export interface CupState {
  /** Semana en la que el jugador está inscrito. */
  week: string | null;
  /** Copa anterior aún sin cobrar cuando se inscribió en otra (para no perder su premio). */
  prev: string | null;
  used: Record<CupSlot, number>;
  best: Record<CupSlot, number>;
  /** Intentos extra ganados con cartas en la Copa de `week`. */
  bonus: Record<CupSlot, number>;
  /** Última copa cuyo premio ya se cobró. */
  claimed: string | null;
  gold: number;
  silver: number;
  bronze: number;
  finals: number;
  played: number;
  history: CupRecord[];
  /** Nivel del centro de entrenamiento (0–5). */
  training: number;
  /** Cartas guardadas. */
  cards: Record<CardId, number>;
  /** Cartas equipadas para la Copa de `week` (se gastan al usarlas). */
  loadout: CardId[];
  /** Días jugados de lunes a viernes (máscara de bits) de una semana: es la afición. */
  activity: { week: string | null; days: number };
  /** Pronóstico de la semana. */
  pick: CupPick | null;
  /** Temporadas ganadas. */
  seasons: number;
  /** Última temporada cuyo premio ya se cobró (-1 = ninguna). */
  seasonClaimed: number;
}

const zeroSlots = (): Record<CupSlot, number> => ({ g1: 0, g2: 0, g3: 0, f: 0 });
const noCards = (): Record<CardId, number> => ({ extra: 0, shield: 0, boost: 0, star: 0 });

export function newCup(): CupState {
  return {
    week: null,
    prev: null,
    used: zeroSlots(),
    best: zeroSlots(),
    bonus: zeroSlots(),
    claimed: null,
    gold: 0,
    silver: 0,
    bronze: 0,
    finals: 0,
    played: 0,
    history: [],
    training: 0,
    cards: noCards(),
    loadout: [],
    activity: { week: null, days: 0 },
    pick: null,
    seasons: 0,
    seasonClaimed: -1,
  };
}

/**
 * ¿Ya se cobró esa Copa? Se cobran siempre de la más antigua a la más reciente, así que cualquier
 * semana hasta la última cobrada cuenta como cobrada (aunque ya no esté en el historial, que es corto).
 */
export function isClaimed(c: CupState, week: string): boolean {
  return (c.claimed !== null && week <= c.claimed) || c.history.some((h) => h.week === week);
}

/** Inscribe en otra semana: las cartas equipadas y no usadas vuelven a la colección. */
export function registeredFor(c: CupState, week: string): CupState {
  if (c.week === week) return c;
  const prev = c.week && !isClaimed(c, c.week) ? c.week : c.prev;
  return { ...c, week, prev, used: zeroSlots(), best: zeroSlots(), bonus: zeroSlots(), cards: returnCards(c.cards, c.loadout), loadout: [] };
}

export function returnCards(cards: Record<CardId, number>, loadout: CardId[]): Record<CardId, number> {
  const out = { ...cards };
  for (const id of loadout) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/** La Copa ya terminada más antigua en la que participó (o apostó) y aún no cobró, si la hay. */
export function pendingCup(c: CupState, currentWeek: string): string | null {
  let out: string | null = null;
  for (const w of [c.prev, c.week, c.pick?.week ?? null]) if (w && w < currentWeek && !isClaimed(c, w) && (!out || w < out)) out = w;
  return out;
}

/** Temporada ya terminada en la que jugó y aún no cobró. */
export function pendingSeason(c: CupState, currentWeek: string): number | null {
  const current = seasonOf(currentWeek);
  for (let s = c.seasonClaimed + 1; s < current; s++) {
    if (c.history.some((h) => seasonOf(h.week) === s && (h.group !== null || h.final !== null))) return s;
  }
  return null;
}

export const HISTORY_MAX = 12;
