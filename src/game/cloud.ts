import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  onIdTokenChanged,
  signInAnonymously,
  signInWithCredential,
  type AuthError,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { dateKey, now, resyncFromDevice, setServerTime } from './clock';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const LOCAL_KEY = 'torre-save-v1';
const BACKUP_KEY = 'torre-save-backup';
const CORRUPT_KEY = 'torre-save-corrupt';
const BACKUP_EVERY_MS = 10 * 60_000;

function errCode(e: unknown): string {
  return (e as { code?: string })?.code ?? '';
}

// =====================================================================
// Guardado local (con copia de seguridad)
// =====================================================================

function parseSave(raw: string | null): GameState | null {
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw new Error('Partida inválida');
  return normalize(data, now());
}

/** Carga la partida local. Si está corrupta, la aparta (no se borra) y usa la copia de seguridad. */
export function loadLocal(): GameState | null {
  try {
    return parseSave(localStorage.getItem(LOCAL_KEY));
  } catch (e) {
    console.error('Partida local corrupta, usando la copia de seguridad', e);
    try {
      localStorage.setItem(CORRUPT_KEY, localStorage.getItem(LOCAL_KEY) ?? '');
      return parseSave(localStorage.getItem(BACKUP_KEY));
    } catch {
      return null;
    }
  }
}

let lastBackup = 0;

export function saveLocal(s: GameState): boolean {
  try {
    const json = JSON.stringify(s);
    localStorage.setItem(LOCAL_KEY, json);
    if (Date.now() - lastBackup > BACKUP_EVERY_MS) {
      localStorage.setItem(BACKUP_KEY, json);
      lastBackup = Date.now();
    }
    return true;
  } catch (e) {
    console.warn('No se pudo guardar en el dispositivo', e);
    return false;
  }
}

// =====================================================================
// Auth
// =====================================================================

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

export async function ensureUser(): Promise<User | null> {
  if (!auth) return null;
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

export interface AccountInfo {
  uid: string;
  googleEmail: string | null;
}

/** Notifica cambios de sesión, incluida la vinculación con Google (que refresca el token). */
export function onAccountChange(cb: (info: AccountInfo | null) => void): () => void {
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onIdTokenChanged(auth, (u) => {
    if (!u) return cb(null);
    const google = u.providerData.find((p) => p.providerId === 'google.com');
    cb({ uid: u.uid, googleEmail: google ? (google.email ?? '') : null });
  });
}

// =====================================================================
// Partida en la nube
// =====================================================================

interface CloudData {
  state: GameState | null;
  serverNow: number | null;
}

/** Escribe un ping con la hora del servidor y lee la partida guardada. */
async function fetchCloud(): Promise<CloudData | null> {
  const user = await ensureUser();
  if (!user || !db) return null;
  const ref = doc(db, 'users', user.uid);
  let pinged = true;
  try {
    await setDoc(ref, { ping: serverTimestamp() }, { merge: true });
  } catch (e) {
    // Aunque falle el ping (p. ej. datos antiguos que ya no cumplen las reglas), se puede leer la partida
    console.warn('No se pudo sincronizar la hora con el servidor', e);
    pinged = false;
  }
  const snap = await getDoc(ref);
  const data = snap.data();
  const serverNow: number | null = pinged ? (data?.ping?.toMillis?.() ?? null) : null;
  return { state: data?.state ? normalize(data.state, now()) : null, serverNow };
}

/**
 * true cuando en esta sesión ya se leyó la partida de la nube. Hasta entonces no se sube nada:
 * si el arranque fue sin conexión, la partida local podría ser más vieja que la de la nube.
 */
let cloudRead = false;

/** Elige entre la partida local y la de la nube: gana la que tenga más progreso total. */
export async function loadBestState(local: GameState | null): Promise<GameState> {
  let best = local;
  try {
    const cloud = await withTimeout(fetchCloud(), 7000);
    if (cloud) {
      if (cloud.serverNow) setServerTime(cloud.serverNow);
      if (cloud.state && (!best || cloud.state.allTimeEarned > best.allTimeEarned)) best = cloud.state;
      cloudRead = true;
    }
  } catch (e) {
    console.warn('Sin conexión con Firebase, usando partida local', e);
  }
  return best ?? newState(now());
}

/** Reintenta leer la nube (tras un arranque sin conexión) y carga esa partida si va más avanzada. */
async function catchUpWithCloud(): Promise<boolean> {
  try {
    const cloud = await withTimeout(fetchCloud(), 7000);
    if (!cloud) return false;
    if (cloud.serverNow) setServerTime(cloud.serverNow);
    const local = useGame.getState().s;
    if (cloud.state && cloud.state.allTimeEarned > local.allTimeEarned) {
      useGame.getState().init(cloud.state);
      saveLocal(cloud.state);
      useGame.getState().toast('☁️ Cargamos tu partida más avanzada de la nube');
    }
    cloudRead = true;
    return true;
  } catch {
    return false;
  }
}

let lastTimeSync = 0;

/** Al volver a la app: recupera el tiempo en segundo plano y, cada pocos minutos, re-sincroniza con el servidor. */
export function onAppVisible() {
  resyncFromDevice();
  if (!auth?.currentUser || !db || Date.now() - lastTimeSync < 3 * 60_000) return;
  lastTimeSync = Date.now();
  const ref = doc(db, 'users', auth.currentUser.uid);
  setDoc(ref, { ping: serverTimestamp() }, { merge: true })
    .then(() => getDoc(ref))
    .then((snap) => {
      const ms = snap.data()?.ping?.toMillis?.();
      if (ms) setServerTime(ms);
    })
    .catch(() => {});
}

let saving: Promise<void> | null = null;
let pendingSave = false;

/**
 * Guarda en la nube. Si otro dispositivo ya guardó más progreso, las reglas rechazan la escritura:
 * entonces se carga esa partida (la buena) en lugar de perderla.
 */
export async function saveCloud(s: GameState): Promise<void> {
  if (!auth?.currentUser || !db) return;
  if (saving) {
    pendingSave = true;
    return saving;
  }
  const uid = auth.currentUser.uid;
  const d = db;
  saving = (async () => {
    try {
      if (!cloudRead && !(await catchUpWithCloud())) return;
      // Siempre el estado más reciente (si al ponerse al día se cargó la partida de la nube, esa)
      const state = useGame.getState().ready ? useGame.getState().s : s;
      await setDoc(
        doc(d, 'users', uid),
        { state, name: state.name, totalEarned: state.allTimeEarned, savedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      if (errCode(e) === 'permission-denied') await resolveConflict(uid);
      else throw e;
    } finally {
      saving = null;
    }
  })();
  await saving;
  if (pendingSave) {
    pendingSave = false;
    await saveCloud(useGame.getState().s);
  }
}

async function resolveConflict(uid: string) {
  if (!db) return;
  const snap = await getDoc(doc(db, 'users', uid));
  const raw = snap.data()?.state;
  const cloud = raw ? normalize(raw, now()) : null;
  const local = useGame.getState().s;
  if (cloud && cloud.allTimeEarned > local.allTimeEarned) {
    useGame.getState().init(cloud);
    saveLocal(cloud);
    useGame.getState().toast('☁️ Cargamos tu partida más avanzada (jugaste en otro dispositivo)');
  } else {
    console.warn('La nube rechazó el guardado y no tiene más progreso que la partida local');
  }
}

/** Guardado automático: local cada 5 s, nube cada 60 s y al minimizar la app. */
export function startAutoSave(): () => void {
  let lastCloud = Date.now();
  let lastCity = 0;
  let lastCityScore = 0;

  const flush = () => {
    const s = useGame.getState().s;
    saveLocal(s);
    saveCloud(s).catch(() => {});
  };

  const timer = setInterval(() => {
    const s = useGame.getState().s;
    saveLocal(s);
    const t = Date.now();
    if (t - lastCloud >= 60_000) {
      lastCloud = t;
      saveCloud(s).catch(() => {});
    }
    const cityScore = Math.floor(s.allTimeEarned);
    if (t - lastCity >= 5 * 60_000 && cityScore > lastCityScore && cityScore > 0) {
      lastCity = t;
      lastCityScore = cityScore;
      submitScore('city', cityScore, s.name).catch(() => {});
    }
  }, 5000);

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
    else onAppVisible();
  };
  const onHide = () => saveLocal(useGame.getState().s);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
  };
}

// =====================================================================
// Rankings
// =====================================================================

export type Board = 'stack' | 'merge' | 'city' | 'stars' | 'thief';

export interface ScoreEntry {
  uid: string;
  name: string;
  score: number;
  moves?: number;
  timeMs?: number;
}

export function currentUid(): string | null {
  return auth?.currentUser?.uid ?? null;
}

// Caché corta para no releer el ranking cada vez que se cambia de pestaña
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; rows: ScoreEntry[] }>();

async function cached(key: string, load: () => Promise<ScoreEntry[]>): Promise<ScoreEntry[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = await load();
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

export async function submitScore(board: Board, score: number, name: string) {
  const uid = currentUid();
  if (!uid || !db || !(score >= 0)) return;
  cache.delete(board);
  await setDoc(doc(db, 'leaderboards', board, 'scores', uid), { name, score: Math.floor(score), updatedAt: serverTimestamp() });
}

const RANKED_NAME_KEY = 'torre-ranked-name';

/** Cambia el nombre en todos los rankings donde ya aparece el jugador (global y el reto de hoy). */
export async function renameInLeaderboards(name: string) {
  const uid = currentUid();
  if (!uid || !db) return;
  const d = db;
  const boards: Board[] = ['stack', 'merge', 'city', 'stars', 'thief'];
  const refs = [...boards.map((b) => doc(d, 'leaderboards', b, 'scores', uid)), doc(d, 'daily', dateKey(), 'scores', uid)];
  // updateDoc falla con "not-found" si no hay puntuación en ese ranking: eso es normal
  const results = await Promise.allSettled(refs.map((ref) => updateDoc(ref, { name })));
  cache.clear();
  const failed = results.some((r) => r.status === 'rejected' && errCode(r.reason) !== 'not-found');
  if (failed) throw new Error('No se pudo actualizar el nombre en algún ranking');
  try {
    localStorage.setItem(RANKED_NAME_KEY, `${uid}:${name}`);
  } catch {
    /* ignorar */
  }
}

/** Al arrancar: si el nombre del perfil cambió desde la última sincronización con los rankings, lo actualiza. */
export function syncRankingName(name: string) {
  const uid = currentUid();
  if (!uid) return;
  let last: string | null = null;
  try {
    last = localStorage.getItem(RANKED_NAME_KEY);
  } catch {
    /* ignorar */
  }
  if (last !== `${uid}:${name}`) renameInLeaderboards(name).catch(() => {});
}

function cleanEntry(id: string, x: Record<string, unknown>): ScoreEntry {
  return {
    uid: id,
    name: typeof x.name === 'string' ? x.name.slice(0, 20) : '???',
    score: typeof x.score === 'number' ? x.score : 0,
    moves: typeof x.moves === 'number' ? x.moves : undefined,
    timeMs: typeof x.timeMs === 'number' ? x.timeMs : undefined,
  };
}

export async function fetchTop(board: Board, n = 25): Promise<ScoreEntry[]> {
  const d = db;
  if (!d) return [];
  return cached(board, async () => {
    await ensureUser();
    const snap = await getDocs(query(collection(d, 'leaderboards', board, 'scores'), orderBy('score', 'desc'), limit(n)));
    return snap.docs.map((x) => cleanEntry(x.id, x.data()));
  });
}

export async function submitDaily(date: string, moves: number, timeMs: number, name: string) {
  const uid = currentUid();
  if (!uid || !db) return;
  const t = Math.min(9_999_999, Math.max(1000, moves * 250, Math.round(timeMs)));
  cache.delete(`daily:${date}`);
  await setDoc(doc(db, 'daily', date, 'scores', uid), {
    name,
    moves,
    timeMs: t,
    score: moves * 10_000_000 + t,
    createdAt: serverTimestamp(),
  });
}

export async function fetchDailyTop(date: string, n = 25): Promise<ScoreEntry[]> {
  const d = db;
  if (!d) return [];
  return cached(`daily:${date}`, async () => {
    await ensureUser();
    const snap = await getDocs(query(collection(d, 'daily', date, 'scores'), orderBy('score', 'asc'), limit(n)));
    return snap.docs.map((x) => cleanEntry(x.id, x.data()));
  });
}

// =====================================================================
// Cuenta de Google
// =====================================================================

/** Si esa cuenta de Google ya existía, entra en ella y conserva la partida con más progreso. */
async function switchToExistingAccount(e: unknown): Promise<'switched'> {
  const cred = GoogleAuthProvider.credentialFromError(e as AuthError);
  if (!auth || !cred) throw e;
  const local = useGame.getState().s;
  await signInWithCredential(auth, cred);
  const best = await loadBestState(local);
  useGame.getState().init(best);
  await saveCloud(best);
  cache.clear();
  return 'switched';
}

/**
 * Vincula la cuenta anónima con Google para no perder el progreso.
 * Usa una ventana emergente; si el navegador la bloquea (móviles, app instalada), usa redirección.
 */
export async function linkGoogle(): Promise<'linked' | 'switched' | 'redirecting'> {
  if (!auth?.currentUser) throw new Error('Sin sesión');
  const provider = new GoogleAuthProvider();
  // En la app instalada en la pantalla de inicio las ventanas emergentes no funcionan bien
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) {
    saveLocal(useGame.getState().s);
    await linkWithRedirect(auth.currentUser, provider);
    return 'redirecting';
  }
  try {
    await linkWithPopup(auth.currentUser, provider);
    await saveCloud(useGame.getState().s);
    return 'linked';
  } catch (e) {
    const code = errCode(e);
    if (code === 'auth/credential-already-in-use') return switchToExistingAccount(e);
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') {
      saveLocal(useGame.getState().s);
      await linkWithRedirect(auth.currentUser, provider);
      return 'redirecting';
    }
    throw e;
  }
}

/** Al volver de la redirección de Google: termina la vinculación. */
export async function completeGoogleRedirect(): Promise<'linked' | 'switched' | null> {
  if (!auth) return null;
  try {
    const r = await getRedirectResult(auth);
    if (!r) return null;
    await saveCloud(useGame.getState().s);
    return 'linked';
  } catch (e) {
    if (errCode(e) === 'auth/credential-already-in-use') return switchToExistingAccount(e);
    console.warn('No se pudo completar la vinculación con Google', e);
    return null;
  }
}
