import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { dateKey, now, prevDateKey, weekKey } from '../game/clock';
import { BOARDS, DAILY_KINDS, type Board, type DailyKind } from '../game/cloud';
import { cupWeekKey } from '../game/cup';
import { normalize } from '../game/state';
import type { Player } from './metrics';

// Lecturas y acciones del panel de administración. Las reglas de Firestore solo se las permiten al administrador.

export const PLAYER_LIMIT = 1000;

function millis(v: unknown): number | null {
  return (v as Timestamp | undefined)?.toMillis?.() ?? null;
}

function need() {
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

/** Partidas guardadas, de la más reciente a la más antigua. */
export async function loadPlayers(): Promise<Player[]> {
  const d = need();
  const snap = await getDocs(query(collection(d, 'users'), orderBy('savedAt', 'desc'), limit(PLAYER_LIMIT)));
  const t = now();
  return snap.docs
    .filter((x) => x.data().state)
    .map((x) => {
      const data = x.data();
      const s = normalize(data.state, t);
      return { uid: x.id, name: typeof data.name === 'string' ? data.name : s.name, savedAt: millis(data.savedAt), s };
    });
}

export type SuggestionStatus = 'nuevo' | 'leido' | 'hecho' | 'descartado';

export interface Suggestion {
  id: string;
  uid: string;
  name: string;
  kind: 'idea' | 'bug' | 'otro';
  text: string;
  era: number | null;
  ua: string;
  status: SuggestionStatus;
  createdAt: number | null;
}

export async function loadSuggestions(): Promise<Suggestion[]> {
  const d = need();
  const snap = await getDocs(query(collection(d, 'suggestions'), orderBy('createdAt', 'desc'), limit(300)));
  return snap.docs.map((x) => {
    const v = x.data();
    return {
      id: x.id,
      uid: String(v.uid ?? ''),
      name: String(v.name ?? '???'),
      kind: v.kind === 'bug' || v.kind === 'otro' ? v.kind : 'idea',
      text: String(v.text ?? ''),
      era: typeof v.era === 'number' ? v.era : null,
      ua: String(v.ua ?? ''),
      status: (['nuevo', 'leido', 'hecho', 'descartado'].includes(v.status) ? v.status : 'nuevo') as SuggestionStatus,
      createdAt: millis(v.createdAt),
    };
  });
}

export function setSuggestionStatus(id: string, status: SuggestionStatus) {
  return updateDoc(doc(need(), 'suggestions', id), { status });
}

export function deleteSuggestion(id: string) {
  return deleteDoc(doc(need(), 'suggestions', id));
}

/** Participantes de cada reto diario por día (consultas de recuento: no descargan los documentos). */
export type DailyCounts = { date: string } & Record<DailyKind, number>;

export async function dailyParticipation(days: string[]): Promise<DailyCounts[]> {
  const d = need();
  const count = async (kind: DailyKind, date: string) => (await getCountFromServer(collection(d, kind, date, 'scores'))).data().count;
  return Promise.all(
    days.map(async (date) => {
      const [daily, roads, parks] = await Promise.all(DAILY_KINDS.map((k) => count(k, date)));
      return { date, daily, roads, parks };
    }),
  );
}

/** Jugadores con puntos en la liga de esta semana. */
export async function leagueCount(): Promise<number> {
  return (await getCountFromServer(collection(need(), 'league', weekKey(), 'scores'))).data().count;
}

/** Inscritos en la Copa de esta semana. */
export async function cupCount(): Promise<number> {
  return (await getCountFromServer(collection(need(), 'cup', cupWeekKey(now()), 'entries'))).data().count;
}

export interface RankEntry {
  board: Board | DailyKind | 'league' | 'cup';
  score: number;
}

/** En qué rankings aparece un jugador (globales, los retos de hoy y la liga de esta semana). */
export async function rankingsOf(uid: string): Promise<RankEntry[]> {
  const d = need();
  const today = dateKey();
  const refs: [RankEntry['board'], ReturnType<typeof doc>][] = [
    ...BOARDS.map((b) => [b, doc(d, 'leaderboards', b, 'scores', uid)] as [Board, ReturnType<typeof doc>]),
    ...DAILY_KINDS.map((k) => [k, doc(d, k, today, 'scores', uid)] as [DailyKind, ReturnType<typeof doc>]),
    ['league', doc(d, 'league', weekKey(), 'scores', uid)],
    ['cup', doc(d, 'cup', cupWeekKey(now()), 'results', uid)],
  ];
  const snaps = await Promise.all(refs.map(([, r]) => getDoc(r)));
  return snaps.flatMap((s, i) => {
    if (!s.exists()) return [];
    const v = s.data();
    // En la Copa no hay una sola puntuación: se muestra la suma de sus marcas
    const score = refs[i][0] === 'cup' ? ['g1', 'g2', 'g3', 'f'].reduce((n, k) => n + Number(v[k] ?? 0), 0) : Number(v.score ?? 0);
    return [{ board: refs[i][0], score }];
  });
}

/** Borra documentos en lotes (Firestore admite hasta 500 escrituras por lote). Los que no existen no dan error. */
async function deleteAll(refs: DocumentReference[]) {
  const d = need();
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(d);
    for (const r of refs.slice(i, i + 450)) batch.delete(r);
    await batch.commit();
  }
}

/**
 * Todo lo del jugador en la Conquista de esta semana: su documento de miembro, su reserva en el mundo,
 * sus partes de batalla y sus territorios (vuelven a los bandidos). Si no juega, no hay nada.
 */
async function conquestRefsOf(uid: string): Promise<DocumentReference[]> {
  const d = need();
  const week = cupWeekKey(now());
  const member = doc(d, 'conquest', week, 'members', uid);
  const snap = await getDoc(member);
  const w = snap.exists() ? snap.data().w : null;
  if (typeof w !== 'string' || !w) return [];
  const world = ['conquest', week, 'worlds', w] as const;
  const [reports, tiles] = await Promise.all([
    getDocs(collection(d, ...world, 'players', uid, 'reports')),
    getDocs(query(collection(d, ...world, 'tiles'), where('owner', '==', uid))),
  ]);
  // Los partes y territorios antes que el jugador y el miembro: si algo falla a medias, repetirlo los vuelve a encontrar
  return [...reports.docs.map((x) => x.ref), ...tiles.docs.map((x) => x.ref), doc(d, ...world, 'players', uid), member];
}

/** Quita a un jugador de todos los rankings (por trampas). Su partida no se toca. */
export async function removeFromRankings(uid: string) {
  const d = need();
  const today = dateKey();
  // Los retos diarios van por la fecha local del jugador: con otra zona horaria, su "hoy" puede ser nuestro ayer o mañana
  const days = [prevDateKey(today), today, addDays(today, 1)];
  const conquest = await conquestRefsOf(uid);
  await deleteAll([
    ...BOARDS.map((b) => doc(d, 'leaderboards', b, 'scores', uid)),
    ...DAILY_KINDS.flatMap((k) => days.map((day) => doc(d, k, day, 'scores', uid))),
    doc(d, 'league', weekKey(), 'scores', uid),
    // Copa: sus marcas siempre; la inscripción solo se puede borrar antes de que se formen los grupos
    doc(d, 'cup', cupWeekKey(now()), 'results', uid),
    ...conquest,
  ]);
  await deleteDoc(doc(d, 'cup', cupWeekKey(now()), 'entries', uid)).catch(() => {});
}

/** Primer día con datos en la nube: desde aquí se buscan los retos diarios y las semanas de liga de un jugador. */
export const FIRST_DAY = '2026-09-26';

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Días desde `first` hasta `last` (ambos incluidos). */
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let k = first; k <= last; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Lunes desde la semana de `first` hasta la de `last` (ambos incluidos). */
export function mondaysBetween(first: string, last: string): string[] {
  const at = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  };
  const out: string[] = [];
  for (let k = weekKey(at(first)); k <= last; k = addDays(k, 7)) out.push(k);
  return out;
}

/**
 * Elimina del todo la cuenta de un jugador: su partida queda sustituida por una marca `deleted`
 * (su juego la ve y borra también lo que tiene en el dispositivo) y se borran sus rankings, retos
 * diarios y semanas de liga de todas las fechas, su ciudad pública, su buzón de regalos, la Copa y la
 * Conquista de esta semana (sus territorios vuelven a los bandidos) y sus sugerencias. Las Copas ya jugadas no se tocan: cambiarían los grupos y el podio de los demás.
 * Se puede repetir sin problema si algo falla a medias.
 */
export async function deleteAccount(uid: string): Promise<void> {
  const d = need();
  // Primero la marca: si el jugador sigue jugando, desde ahora las reglas rechazan sus guardados
  await setDoc(doc(d, 'users', uid), { deleted: true, deletedAt: serverTimestamp() });

  // Un día de margen a cada lado: los retos van por la fecha local del jugador
  const tomorrow = addDays(dateKey(), 1);
  const [sugg, inbox, conquest] = await Promise.all([
    getDocs(query(collection(d, 'suggestions'), where('uid', '==', uid))),
    // Su buzón de regalos (solo el destinatario y el administrador pueden leerlo y borrarlo)
    getDocs(collection(d, 'gifts', uid, 'inbox')),
    conquestRefsOf(uid),
  ]);
  const refs = [
    ...BOARDS.map((b) => doc(d, 'leaderboards', b, 'scores', uid)),
    ...DAILY_KINDS.flatMap((k) => daysBetween(FIRST_DAY, tomorrow).map((day) => doc(d, k, day, 'scores', uid))),
    ...mondaysBetween(FIRST_DAY, tomorrow).map((w) => doc(d, 'league', w, 'scores', uid)),
    doc(d, 'cup', cupWeekKey(now()), 'results', uid),
    doc(d, 'cities', uid),
    doc(d, 'suggestionMeta', uid),
    ...sugg.docs.map((x) => x.ref),
    ...inbox.docs.map((x) => x.ref),
    ...conquest,
  ];
  // Borrar un documento que no existe no da error: así no hace falta mirar antes cuáles hay
  await deleteAll(refs);
  // La inscripción de la Copa solo se puede borrar antes de que se formen los grupos
  await deleteDoc(doc(d, 'cup', cupWeekKey(now()), 'entries', uid)).catch(() => {});
}
