import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { now } from './clock';
import { currentUid, ensureUser } from './cloud';
import {
  SIGNUP_DAYS,
  buildCup,
  cupStart,
  cupWeekKey,
  mergeResults,
  seasonWeeks,
  summarizeCup,
  tierOf,
  type CupEntry,
  type CupResult,
  type CupSlot,
  type CupSummary,
  type ResultsSnapshot,
} from './cup';
import type { GameState } from './state';

// Copa de Alcaldes en Firestore:
//   cup/{lunes}/entries/{uid}  inscripción (solo de lunes a viernes, no se puede cambiar después)
//   cup/{lunes}/results/{uid}  mejores marcas: g1–g3 el sábado y f el domingo

const MAX_PLAYERS = 2000;
const RESULTS_MS = 20_000;
/** Cada cuánto se vuelve a leer la lista entera de marcas en vez de solo las nuevas. */
const RESULTS_FULL_MS = 10 * 60_000;
/**
 * Margen al pedir solo las marcas nuevas: la hora que pone el servidor es la de la petición, y una
 * subida puede terminar de guardarse un instante después de que otra más reciente ya se leyera.
 */
const RESULTS_OVERLAP_MS = 30_000;
/** at: última lectura; fullAt: última lectura completa. */
const resultsCache = new Map<string, { at: number; fullAt: number; snap: ResultsSnapshot }>();
const entriesCache = new Map<string, { at: number; data: CupEntry[] }>();

function need() {
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

// Las lecturas de la Copa van siempre al servidor: sin conexión, getDocs devolvería la caché (vacía)
// como si nadie se hubiera inscrito, y eso se guardaría y se cobraría como definitivo.

export async function registerCup(week: string, s: GameState): Promise<void> {
  const d = need();
  const user = await ensureUser();
  if (!user) throw new Error('Sin sesión');
  const ref = doc(d, 'cup', week, 'entries', user.uid);
  try {
    await setDoc(ref, {
      name: s.name,
      tier: tierOf(s.allTimeEarned),
      gold: int(s.cup.gold),
      silver: int(s.cup.silver),
      bronze: int(s.cup.bronze),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Ya inscrito (desde otro dispositivo o con una partida que no llegó a guardarlo): las reglas
    // no dejan reescribir la inscripción, pero vale la que ya está.
    if ((e as { code?: string })?.code !== 'permission-denied' || !(await getDocFromServer(ref)).exists()) throw e;
  }
  entriesCache.delete(week);
}

const ENTRIES_KEY = 'torre-cup-entries:';
/** Semanas de inscritos que se guardan en el dispositivo (la actual y las anteriores aún por cobrar). */
const ENTRIES_KEEP_WEEKS = 3;

/** Borra las listas de inscritos de semanas viejas: con muchos jugadores llenarían el almacenamiento (y la partida no se podría guardar). */
function pruneEntries(week: string) {
  try {
    const oldest = cupWeekKey(cupStart(week) - (ENTRIES_KEEP_WEEKS - 1) * 7 * 86_400_000 + 86_400_000);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ENTRIES_KEY) && k.slice(ENTRIES_KEY.length) < oldest) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Inscritos de una semana. Cuando cierra la inscripción la lista ya no cambia, así que se guarda en el
 * dispositivo y no se vuelve a descargar.
 */
export async function fetchCupEntries(week: string): Promise<CupEntry[]> {
  const d = need();
  // Margen de 2 minutos tras el cierre por si el reloj del móvil va algo adelantado respecto al servidor
  const closed = now() > cupStart(week) + SIGNUP_DAYS * 86_400_000 + 120_000;
  const storeKey = ENTRIES_KEY + week;
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
  const snap = await getDocsFromServer(query(collection(d, 'cup', week, 'entries'), limit(MAX_PLAYERS)));
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
    pruneEntries(week);
    try {
      localStorage.setItem(storeKey, JSON.stringify(data));
    } catch {
      /* sin almacenamiento */
    }
  }
  return data;
}

/**
 * Marcas de la Copa. Tras una lectura completa, las siguientes piden solo las marcas subidas desde
 * entonces: cada recarga cuesta lo que se movió y no una lectura por inscrito.
 */
export async function fetchCupResults(week: string, fresh = false): Promise<Map<string, CupResult>> {
  const d = need();
  const hit = resultsCache.get(week);
  const t = Date.now();
  if (!fresh && hit && t - hit.at < RESULTS_MS) return hit.snap.data;
  await ensureUser();
  // Cada cierto tiempo se vuelve a leer todo: así se notan las marcas que el administrador borró
  const base = hit && t - hit.fullAt < RESULTS_FULL_MS ? hit : null;
  const col = collection(d, 'cup', week, 'results');
  const q = base
    ? query(col, where('updatedAt', '>', Timestamp.fromMillis(Math.max(0, base.snap.maxAt - RESULTS_OVERLAP_MS))), limit(MAX_PLAYERS))
    : query(col, limit(MAX_PLAYERS));
  const res = await getDocsFromServer(q);
  const docs = res.docs.map((x) => {
    const v = x.data();
    return {
      uid: x.id,
      result: { g1: int(v.g1), g2: int(v.g2), g3: int(v.g3), f: int(v.f) },
      at: v.updatedAt instanceof Timestamp ? v.updatedAt.toMillis() : 0,
    };
  });
  const snap = mergeResults(base?.snap ?? null, docs);
  resultsCache.set(week, { at: t, fullAt: base ? base.fullAt : t, snap });
  return snap.data;
}

/** La próxima lectura de marcas va a la nube aunque la última sea reciente (y sigue pidiendo solo lo nuevo). */
function staleResults(week: string) {
  const hit = resultsCache.get(week);
  if (hit) hit.at = 0;
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

/**
 * Vuelve a subir de una vez las mejores marcas que el servidor no tiene (una subida perdida al cerrar
 * la app sin conexión, o que agotó los reintentos). Sin reintentos: la Copa lo vuelve a comprobar al recargar.
 */
export async function syncCupBest(week: string, scores: Partial<Record<CupSlot, number>>, name: string): Promise<void> {
  const d = need();
  const uid = currentUid();
  const fields = Object.fromEntries(Object.entries(scores).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => [k, Math.floor(v!)]));
  if (!uid || !Object.keys(fields).length) return;
  await setDoc(doc(d, 'cup', week, 'results', uid), { name, ...fields, updatedAt: serverTimestamp() }, { merge: true });
  staleResults(week);
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
    staleResults(week);
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
