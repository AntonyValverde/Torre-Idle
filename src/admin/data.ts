import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, updateDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { dateKey, now, weekKey } from '../game/clock';
import { BOARDS, DAILY_KINDS, type Board, type DailyKind } from '../game/cloud';
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

export interface RankEntry {
  board: Board | DailyKind | 'league';
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
  ];
  const snaps = await Promise.all(refs.map(([, r]) => getDoc(r)));
  return snaps.flatMap((s, i) => (s.exists() ? [{ board: refs[i][0], score: Number(s.data().score ?? 0) }] : []));
}

/** Quita a un jugador de todos los rankings (por trampas). Su partida no se toca. */
export async function removeFromRankings(uid: string) {
  const d = need();
  const today = dateKey();
  await Promise.all([
    ...BOARDS.map((b) => deleteDoc(doc(d, 'leaderboards', b, 'scores', uid))),
    ...DAILY_KINDS.map((k) => deleteDoc(doc(d, k, today, 'scores', uid))),
    deleteDoc(doc(d, 'league', weekKey(), 'scores', uid)),
  ]);
}
