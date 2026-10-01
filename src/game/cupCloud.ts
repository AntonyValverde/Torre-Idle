import { collection, doc, getCountFromServer, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { now } from './clock';
import { currentUid, ensureUser } from './cloud';
import {
  SIGNUP_DAYS,
  buildCup,
  cupStart,
  seasonWeeks,
  summarizeCup,
  tierOf,
  type CupEntry,
  type CupResult,
  type CupSlot,
  type CupSummary,
} from './cup';
import type { GameState } from './state';

// Copa de Alcaldes en Firestore:
//   cup/{lunes}/entries/{uid}  inscripción (solo de lunes a viernes, no se puede cambiar después)
//   cup/{lunes}/results/{uid}  mejores marcas: g1–g3 el sábado y f el domingo

const MAX_PLAYERS = 2000;
const RESULTS_MS = 20_000;
const resultsCache = new Map<string, { at: number; data: Map<string, CupResult> }>();
const entriesCache = new Map<string, { at: number; data: CupEntry[] }>();

function need() {
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

export async function registerCup(week: string, s: GameState): Promise<void> {
  const d = need();
  const user = await ensureUser();
  if (!user) throw new Error('Sin sesión');
  await setDoc(doc(d, 'cup', week, 'entries', user.uid), {
    name: s.name,
    tier: tierOf(s.allTimeEarned),
    gold: int(s.cup.gold),
    silver: int(s.cup.silver),
    bronze: int(s.cup.bronze),
    createdAt: serverTimestamp(),
  });
  entriesCache.delete(week);
}

/**
 * Inscritos de una semana. Cuando cierra la inscripción la lista ya no cambia, así que se guarda en el
 * dispositivo y no se vuelve a descargar.
 */
export async function fetchCupEntries(week: string): Promise<CupEntry[]> {
  const d = need();
  // Margen de 2 minutos tras el cierre por si el reloj del móvil va algo adelantado respecto al servidor
  const closed = now() > cupStart(week) + SIGNUP_DAYS * 86_400_000 + 120_000;
  const storeKey = `torre-cup-entries:${week}`;
  if (closed) {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved) return JSON.parse(saved) as CupEntry[];
    } catch {
      /* sin almacenamiento */
    }
  }
  const hit = entriesCache.get(week);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  await ensureUser();
  const snap = await getDocs(query(collection(d, 'cup', week, 'entries'), limit(MAX_PLAYERS)));
  const data = snap.docs.map((x) => {
    const v = x.data();
    return {
      uid: x.id,
      name: typeof v.name === 'string' ? v.name.slice(0, 20) : '???',
      tier: int(v.tier),
      gold: int(v.gold),
      silver: int(v.silver),
      bronze: int(v.bronze),
    };
  });
  entriesCache.set(week, { at: Date.now(), data });
  // Se guarda un rato después del cierre, para que ya estén todas las inscripciones de última hora
  if (closed) {
    try {
      localStorage.setItem(storeKey, JSON.stringify(data));
    } catch {
      /* sin almacenamiento */
    }
  }
  return data;
}

export async function fetchCupResults(week: string, fresh = false): Promise<Map<string, CupResult>> {
  const d = need();
  const hit = resultsCache.get(week);
  if (!fresh && hit && Date.now() - hit.at < RESULTS_MS) return hit.data;
  await ensureUser();
  const snap = await getDocs(query(collection(d, 'cup', week, 'results'), limit(MAX_PLAYERS)));
  const data = new Map<string, CupResult>(snap.docs.map((x) => {
    const v = x.data();
    return [x.id, { g1: int(v.g1), g2: int(v.g2), g3: int(v.g3), f: int(v.f) }];
  }));
  resultsCache.set(week, { at: Date.now(), data });
  return data;
}

/**
 * Resumen de una Copa (podio y puntos de temporada). Las ya terminadas no cambian: se guardan en el
 * dispositivo y no se vuelven a descargar.
 */
export async function fetchCupSummary(week: string): Promise<CupSummary> {
  const finished = now() >= cupStart(week) + 7 * 86_400_000 + 120_000;
  const key = `torre-cup-summary:${week}`;
  if (finished) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved) as CupSummary;
    } catch {
      /* sin almacenamiento */
    }
  }
  const [entries, results] = await Promise.all([fetchCupEntries(week), fetchCupResults(week)]);
  const summary = summarizeCup(buildCup(entries, results, week), week);
  if (finished) {
    try {
      localStorage.setItem(key, JSON.stringify(summary));
    } catch {
      /* sin almacenamiento */
    }
  }
  return summary;
}

/** Copas de una temporada que ya empezaron a jugarse (desde el sábado de cada semana). */
export async function fetchSeason(season: number): Promise<CupSummary[]> {
  const t = now();
  const weeks = seasonWeeks(season).filter((w) => t >= cupStart(w) + SIGNUP_DAYS * 86_400_000);
  return Promise.all(weeks.map(fetchCupSummary));
}

export async function cupEntryCount(week: string): Promise<number> {
  return (await getCountFromServer(collection(need(), 'cup', week, 'entries'))).data().count;
}

const retries = new Map<CupSlot, ReturnType<typeof setTimeout>>();

/**
 * Sube una mejor marca. Las reglas solo aceptan una subida cada 5 s: si llega antes, se reintenta
 * un poco después con la marca más reciente.
 */
export async function submitCupScore(week: string, slot: CupSlot, score: number, name: string, attempt = 0): Promise<void> {
  const d = need();
  const uid = currentUid();
  if (!uid || score <= 0) return;
  try {
    await setDoc(doc(d, 'cup', week, 'results', uid), { name, [slot]: Math.floor(score), updatedAt: serverTimestamp() }, { merge: true });
    resultsCache.delete(week);
  } catch (e) {
    if ((e as { code?: string })?.code === 'permission-denied' && attempt < 2) {
      clearTimeout(retries.get(slot));
      retries.set(
        slot,
        setTimeout(() => submitCupScore(week, slot, score, name, attempt + 1).catch(() => {}), 6000),
      );
      return;
    }
    throw e;
  }
}
