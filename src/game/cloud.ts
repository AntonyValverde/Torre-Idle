import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  onIdTokenChanged,
  signInAnonymously,
  signInWithCredential,
  signOut,
  type AuthError,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  Timestamp,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { citySnapshot, parseCups, parseDecos, parseLayout, type CitySnapshot } from './cities';
import { dateKey, now, resyncFromDevice, setServerTime, weekKey } from './clock';
import { cupWeekKey } from './cup';
import {
  addPendingDaily,
  clampDailyMoves,
  clampScore,
  isArcadeBoard,
  livePendingDaily,
  markSubmitted,
  nextResend,
  removePendingDaily,
} from './pending';
import { newState, normalize, type GameState } from './state';
import type { GiftIn } from './social';
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
    // Primero la copia de seguridad: apartar la corrupta puede fallar (p. ej. sin espacio) y no debe impedirlo
    let backup: GameState | null = null;
    try {
      backup = parseSave(localStorage.getItem(BACKUP_KEY));
    } catch {
      backup = null;
    }
    try {
      localStorage.setItem(CORRUPT_KEY, localStorage.getItem(LOCAL_KEY) ?? '');
    } catch {
      /* sin espacio: no se puede apartar */
    }
    return backup;
  }
}

let lastBackup = 0;

export function saveLocal(s: GameState): boolean {
  // Cuenta eliminada: no se vuelve a guardar nada mientras se recarga
  if (wiping) return false;
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
// Cuenta eliminada por el administrador
// =====================================================================

/** true desde que se detecta que el administrador eliminó la cuenta: ya no se guarda ni se sube nada. */
let wiping = false;
const DELETED_NOTICE_KEY = 'torre-account-deleted';

/**
 * El administrador eliminó la cuenta (en la nube solo queda la marca `deleted`): se borra también lo
 * que hay en el dispositivo y la cuenta de Firebase, y se recarga para empezar de cero.
 * Si se detecta al entrar con Google desde una partida de invitado, esa partida se conserva.
 */
async function wipeDeletedAccount(): Promise<never> {
  const keepLocal = switching;
  wiping = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('torre-') && !(keepLocal && k.startsWith('torre-save'))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    sessionStorage.setItem(DELETED_NOTICE_KEY, keepLocal ? 'kept' : 'reset');
  } catch {
    /* sin almacenamiento */
  }
  const a = auth;
  const user = a?.currentUser;
  if (a && user) {
    // Borrarla libera también su cuenta de Google. Si Firebase pide un inicio de sesión reciente, basta con salir
    await withTimeout(user.delete(), 5000)
      .catch(() => signOut(a))
      .catch(() => {});
  }
  location.reload();
  return new Promise<never>(() => {});
}

/** Tras la recarga: avisa de por qué se empieza de cero. */
function noticeDeleted() {
  try {
    const v = sessionStorage.getItem(DELETED_NOTICE_KEY);
    if (!v) return;
    sessionStorage.removeItem(DELETED_NOTICE_KEY);
    useGame
      .getState()
      .toast(v === 'kept' ? '🗑️ Esa cuenta de Google fue eliminada. Sigues con tu partida de invitado' : '🗑️ Tu cuenta fue eliminada. Empiezas una partida nueva');
  } catch {
    /* sin almacenamiento */
  }
}

// =====================================================================
// Auth
// =====================================================================

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Inicio de sesión en curso: todas las llamadas simultáneas lo comparten (si no, se crearían dos invitados). */
let signingIn: Promise<User | null> | null = null;

export function ensureUser(): Promise<User | null> {
  const a = auth;
  if (!a) return Promise.resolve(null);
  if (!signingIn) {
    signingIn = (async () => {
      await a.authStateReady();
      if (!a.currentUser) await signInAnonymously(a);
      return a.currentUser;
    })().finally(() => {
      // Al terminar (bien o mal) se olvida: si falló, la próxima llamada lo reintenta
      signingIn = null;
    });
  }
  return signingIn;
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
  if (data?.deleted === true) await wipeDeletedAccount();
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
  const best = (await pickBest(local)).best ?? newState(now());
  noticeDeleted();
  return best;
}

/**
 * Como loadBestState, pero también devuelve la partida de la nube (null si no hay) y si la lectura llegó a hacerse:
 * `readOk` false distingue "sin conexión" de "la cuenta no tiene partida".
 */
async function pickBest(local: GameState | null): Promise<{ best: GameState | null; cloud: GameState | null; readOk: boolean }> {
  let best = local;
  let cloudState: GameState | null = null;
  let readOk = false;
  try {
    const cloud = await withTimeout(fetchCloud(), 7000);
    if (cloud) {
      if (cloud.serverNow) setServerTime(cloud.serverNow);
      cloudState = cloud.state;
      if (cloud.state && (!best || cloud.state.allTimeEarned > best.allTimeEarned)) best = cloud.state;
      cloudRead = true;
      readOk = true;
    }
  } catch (e) {
    console.warn('Sin conexión con Firebase, usando partida local', e);
  }
  return { best, cloud: cloudState, readOk };
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
  if (!auth || !db || wiping) return;
  if (!auth.currentUser) {
    // El inicio de sesión de invitado pudo fallar al arrancar (p. ej. sin conexión): se reintenta
    try {
      await withTimeout(ensureUser(), 7000);
    } catch {
      return;
    }
    if (!auth.currentUser) return;
  }
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
  // El administrador eliminó la cuenta mientras se jugaba
  if (snap.data()?.deleted === true) await wipeDeletedAccount();
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

/** Olvida lo que el guardado automático en marcha ya subió (se fija al arrancarlo). */
let autoSaveReset: () => void = () => {};

/**
 * Al cambiar de cuenta: lo que ya se subió (liga, ciudad pública, marca de la ciudad) se subió con el uid
 * anterior, así que con la cuenta nueva hay que volver a subirlo.
 */
export function resetAutoSaveState() {
  autoSaveReset();
}

/** Guardado automático: local cada 5 s, nube cada 60 s y al minimizar la app. */
export function startAutoSave(): () => void {
  let lastCloud = Date.now();
  let lastCity = 0;
  let lastCityScore = 0;
  let lastLeague = 0;
  let leagueSent = '';
  let lastCityDoc = 0;
  let citySent = '';
  autoSaveReset = () => {
    lastCityScore = 0;
    leagueSent = '';
    citySent = '';
  };

  const flush = () => {
    const s = useGame.getState().s;
    saveLocal(s);
    if (!switching) saveCloud(s).catch(() => {});
  };

  const timer = setInterval(() => {
    const s = useGame.getState().s;
    saveLocal(s);
    // Mientras se cambia de cuenta, nada a la nube: se subiría la partida del invitado a la cuenta nueva
    if (switching) return;
    const t = Date.now();
    if (t - lastCloud >= 60_000) {
      lastCloud = t;
      saveCloud(s).catch(() => {});
    }
    retryPending(s);
    const cityScore = Math.floor(s.allTimeEarned);
    if (t - lastCity >= 5 * 60_000 && cityScore > lastCityScore && cityScore > 0) {
      lastCity = t;
      lastCityScore = cityScore;
      submitScore('city', cityScore, s.name).catch(() => {});
    }
    // Liga: sube los puntos de la semana cuando cambian (las reglas admiten una subida cada 5 s)
    const lg = s.league;
    const sig = `${lg.week}:${lg.points}`;
    if (lg.week && lg.points > 0 && sig !== leagueSent && t - lastLeague >= 6000) {
      lastLeague = t;
      // Si se rechaza (p. ej. otro dispositivo ya subió más), no se reintenta hasta que cambien los puntos
      const done = () => (leagueSent = sig);
      submitLeague(lg.week, lg.points, s.name).then(done, (e) => errCode(e) === 'permission-denied' && done());
    }
    // Ciudad pública: cuando cambia lo que se ve (como mucho una vez por minuto)
    const citySig = citySignature(citySnapshot(s));
    if (citySig !== citySent && t - lastCityDoc >= 60_000) {
      lastCityDoc = t;
      publishCity(s).then(
        (sent) => sent && (citySent = citySig),
        (e) => errCode(e) === 'permission-denied' && (citySent = citySig),
      );
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
    autoSaveReset = () => {};
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
  };
}

// =====================================================================
// Rankings
// =====================================================================

export type Board = 'stack' | 'merge' | 'city' | 'stars' | 'thief' | 'traffic' | 'memory' | 'fire' | 'metro' | 'towers';
export const BOARDS: Board[] = ['stack', 'merge', 'city', 'stars', 'thief', 'traffic', 'memory', 'fire', 'metro', 'towers'];

/** Colección de cada reto diario en Firestore: `daily` (Apagón), `roads` (Conecta las calles) y `parks` (Plan verde). */
export type DailyKind = 'daily' | 'roads' | 'parks';
export const DAILY_KINDS: DailyKind[] = ['daily', 'roads', 'parks'];

export interface ScoreEntry {
  uid: string;
  name: string;
  score: number;
  moves?: number;
  timeMs?: number;
}

export function currentUid(): string | null {
  // Cuenta eliminada: sin uid no se sube nada a los rankings, la liga, la ciudad ni la Copa
  if (wiping) return null;
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

/** Aplica un cambio a la partida en memoria (lo guarda el guardado automático). */
function patchState(fn: (s: GameState) => GameState) {
  const st = useGame.getState();
  if (!st.ready) return;
  const next = fn(st.s);
  if (next !== st.s) useGame.setState({ s: next });
}

// Subidas en curso (sin conexión, Firestore las retiene hasta que vuelve la red): no se repiten mientras tanto
const scoresInFlight = new Set<string>();
// Última subida aceptada de cada ranking en esta sesión: las reglas rechazan otra en menos de 5 s
const lastScoreWrite = new Map<string, number>();

export async function submitScore(board: Board, score: number, name: string) {
  const uid = currentUid();
  if (!uid || !db || !(score >= 0)) return;
  // Sin pasar del tope de las reglas: si no, rechazarían la marca y quedaría apuntada como subida sin estarlo
  const n = clampScore(board, score);
  const arcade = isArcadeBoard(board);
  cache.delete(board);
  scoresInFlight.add(board);
  try {
    await setDoc(doc(db, 'leaderboards', board, 'scores', uid), { name, score: n, updatedAt: serverTimestamp() });
    lastScoreWrite.set(board, Date.now());
    if (arcade) patchState((s) => markSubmitted(s, board, n));
  } catch (e) {
    // Rechazo de las reglas: el ranking ya tiene esa marca o más (otro dispositivo), o no es válida.
    // Reintentar no serviría, salvo que el rechazo fuera por subir dos veces en menos de 5 s.
    const throttled = Date.now() - (lastScoreWrite.get(board) ?? 0) < 6000;
    if (arcade && errCode(e) === 'permission-denied' && !throttled) patchState((s) => markSubmitted(s, board, n));
    throw e;
  } finally {
    scoresInFlight.delete(board);
  }
}

const RANKED_NAME_KEY = 'torre-ranked-name';

/** Cambia el nombre en todos los rankings donde ya aparece el jugador (globales y los retos de hoy). */
export async function renameInLeaderboards(name: string) {
  const uid = currentUid();
  if (!uid || !db) return;
  const d = db;
  const refs = [
    ...BOARDS.map((b) => doc(d, 'leaderboards', b, 'scores', uid)),
    ...DAILY_KINDS.map((k) => doc(d, k, dateKey(), 'scores', uid)),
    doc(d, 'league', weekKey(), 'scores', uid),
    // Los resultados de la Copa no: las reglas exigen marcar la hora del servidor en cada cambio y el juego
    // no lee ese nombre (usa el de la inscripción). Se actualiza solo con la próxima marca.
    doc(d, 'cup', cupWeekKey(now()), 'entries', uid),
  ];
  // updateDoc falla con "not-found" si no hay puntuación en ese ranking: eso es normal.
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

export async function submitDaily(date: string, moves: number, timeMs: number, name: string, kind: DailyKind = 'daily') {
  if (!db) return;
  // Las reglas solo aceptan de 1 a 999 movimientos: más allá se registra como 999
  moves = clampDailyMoves(moves);
  const t = Math.min(9_999_999, Math.max(1000, moves * 250, Math.round(timeMs)));
  // Queda pendiente en la partida hasta que el ranking lo acepte: si falla, el guardado automático lo reintenta
  patchState((s) => addPendingDaily(s, { kind, date, moves, timeMs: t }));
  const uid = currentUid();
  const key = `${kind}:${date}`;
  if (!uid || dailyInFlight.has(key)) return;
  cache.delete(key);
  dailyInFlight.add(key);
  try {
    await setDoc(doc(db, kind, date, 'scores', uid), {
      name,
      moves,
      timeMs: t,
      score: moves * 10_000_000 + t,
      createdAt: serverTimestamp(),
    });
    patchState((s) => removePendingDaily(s, kind, date));
  } catch (e) {
    // Rechazo de las reglas: ya había un resultado de ese día (solo se admite uno) o el día ya pasó
    if (errCode(e) === 'permission-denied') patchState((s) => removePendingDaily(s, kind, date));
    throw e;
  } finally {
    dailyInFlight.delete(key);
  }
}

const dailyInFlight = new Set<string>();
// Próximo reintento permitido de cada subida pendiente (para no insistir cada 5 s si algo falla rápido)
const retryAt = new Map<string, number>();

/** Reintenta las subidas a rankings que quedaron pendientes: récords de minijuegos y retos diarios. */
function retryPending(s: GameState) {
  if (!db || !currentUid()) return;
  const t = Date.now();
  const due = (key: string) => {
    if ((retryAt.get(key) ?? 0) > t) return false;
    retryAt.set(key, t + 30_000);
    return true;
  };
  const live = livePendingDaily(s.pendingDaily, dateKey());
  // Los de días que el ranking ya no aceptaría se descartan
  if (live.length !== s.pendingDaily.length) patchState((x) => ({ ...x, pendingDaily: livePendingDaily(x.pendingDaily, dateKey()) }));
  for (const p of live) {
    const key = `${p.kind}:${p.date}`;
    if (!dailyInFlight.has(key) && due(`daily:${key}`)) submitDaily(p.date, p.moves, p.timeMs, s.name, p.kind).catch(() => {});
  }
  // Un récord por vuelta, para repartir las escrituras
  const next = nextResend(s, (b) => scoresInFlight.has(b) || (retryAt.get(`score:${b}`) ?? 0) > t);
  if (next && due(`score:${next.board}`)) submitScore(next.board, next.score, s.name).catch(() => {});
}

export async function fetchDailyTop(date: string, kind: DailyKind = 'daily', n = 25): Promise<ScoreEntry[]> {
  const d = db;
  if (!d) return [];
  return cached(`${kind}:${date}`, async () => {
    await ensureUser();
    const snap = await getDocs(query(collection(d, kind, date, 'scores'), orderBy('score', 'asc'), limit(n)));
    return snap.docs.map((x) => cleanEntry(x.id, x.data()));
  });
}

// =====================================================================
// Liga semanal
// =====================================================================

/** Sube los puntos de liga de la semana (su lunes, AAAA-MM-DD). Solo pueden subir. */
export async function submitLeague(week: string, points: number, name: string) {
  const uid = currentUid();
  if (!uid || !db) return;
  cache.delete(`league:${week}`);
  await setDoc(doc(db, 'league', week, 'scores', uid), { name, score: Math.floor(points), updatedAt: serverTimestamp() });
}

export async function fetchLeagueTop(week: string, n = 50): Promise<ScoreEntry[]> {
  const d = db;
  if (!d) return [];
  return cached(`league:${week}`, async () => {
    await ensureUser();
    const snap = await getDocs(query(collection(d, 'league', week, 'scores'), orderBy('score', 'desc'), limit(n)));
    return snap.docs.map((x) => cleanEntry(x.id, x.data()));
  });
}

/** Posición en la liga: cuántos tienen más puntos (una consulta de recuento, no descarga documentos). */
export async function leaguePosition(week: string, points: number): Promise<{ position: number; total: number } | null> {
  const d = db;
  if (!d || points <= 0) return null;
  await ensureUser();
  const col = collection(d, 'league', week, 'scores');
  const [above, total] = await Promise.all([
    getCountFromServer(query(col, where('score', '>', points))),
    getCountFromServer(col),
  ]);
  return { position: above.data().count + 1, total: total.data().count };
}

// =====================================================================
// Ciudades públicas (para visitar la ciudad de otros)
// =====================================================================

export interface PublicCity extends CitySnapshot {
  uid: string;
  updatedAt: number | null;
}

export function citySignature(c: CitySnapshot): string {
  return `${c.name}|${c.era}|${c.layout}|${c.buildings}|${c.stars}|${c.cups}|${c.gifts ?? 0}|${c.conq ?? 0}|${c.deco ?? ''}`;
}

/** Publica la ciudad del jugador (solo lo que se ve al visitarla). */
export async function publishCity(s: GameState): Promise<boolean> {
  const uid = currentUid();
  if (!uid || !db) return false;
  await setDoc(doc(db, 'cities', uid), { ...citySnapshot(s), updatedAt: serverTimestamp() });
  return true;
}

export async function fetchCity(uid: string): Promise<PublicCity | null> {
  const d = db;
  if (!d) return null;
  await ensureUser();
  const snap = await getDoc(doc(d, 'cities', uid));
  return parseCity(uid, snap.data());
}

/** Valida una ciudad leída de la nube (puede venir de una versión vieja del juego). */
function parseCity(uid: string, x: Record<string, unknown> | undefined): PublicCity | null {
  const layout = parseLayout(x?.layout);
  if (!x || !layout) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    uid,
    name: typeof x.name === 'string' ? x.name.slice(0, 20) : '???',
    era: Math.max(1, Math.floor(n(x.era))),
    layout,
    buildings: n(x.buildings),
    earned: n(x.earned),
    stars: n(x.stars),
    cups: parseCups(x.cups).join(','),
    gifts: Math.max(0, Math.floor(n(x.gifts))),
    conq: Math.max(0, Math.floor(n(x.conq))),
    ...(parseDecos(x.deco).length ? { deco: parseDecos(x.deco).join(',') } : {}),
    updatedAt: (x.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
  };
}

/** Ciudades con actividad reciente, para descubrir a quién visitar. */
export async function fetchActiveCities(n = 15): Promise<PublicCity[]> {
  const d = db;
  if (!d) return [];
  await ensureUser();
  const snap = await getDocs(query(collection(d, 'cities'), orderBy('updatedAt', 'desc'), limit(n)));
  return snap.docs.map((x) => parseCity(x.id, x.data())).filter((c): c is PublicCity => !!c);
}

// El mapa del mundo lee muchas ciudades de golpe: se guardan unos minutos para no releerlas al reabrirlo
const WORLD_CACHE_MS = 10 * 60_000;
export const WORLD_MAX = 200;
let worldCache: { at: number; cities: PublicCity[] } | null = null;

/** Ciudades para el mapa del mundo (las de actividad más reciente, hasta WORLD_MAX). */
export async function fetchWorldCities(force = false): Promise<PublicCity[]> {
  if (!force && worldCache && Date.now() - worldCache.at < WORLD_CACHE_MS) return worldCache.cities;
  const cities = await fetchActiveCities(WORLD_MAX);
  worldCache = { at: Date.now(), cities };
  return cities;
}

// =====================================================================
// Regalos entre ciudades: gifts/{destinatario}/inbox/{remitente}, uno por remitente y día
// =====================================================================

/** Deja un regalo en la ciudad de otro jugador (las reglas solo admiten uno al día por ciudad). */
export async function sendGiftCloud(toUid: string, name: string): Promise<void> {
  const uid = currentUid();
  if (!uid || !db) throw new Error('Sin conexión');
  await setDoc(doc(db, 'gifts', toUid, 'inbox', uid), { name, day: dateKey(now()), createdAt: serverTimestamp() });
}

/** Regalos recibidos después de `sinceMs` (hora del servidor). */
export async function fetchNewGifts(sinceMs: number): Promise<GiftIn[]> {
  const uid = currentUid();
  const d = db;
  if (!uid || !d) return [];
  const q = query(collection(d, 'gifts', uid, 'inbox'), where('createdAt', '>', Timestamp.fromMillis(sinceMs)), orderBy('createdAt'), limit(30));
  const snap = await getDocs(q);
  return snap.docs
    .map((x) => {
      const v = x.data();
      const at = v.createdAt?.toMillis?.();
      return typeof at === 'number' && typeof v.name === 'string' ? { from: x.id, name: v.name.slice(0, 20), at } : null;
    })
    .filter((g): g is GiftIn => !!g);
}

// =====================================================================
// Sugerencias y administración
// =====================================================================

export type SuggestionKind = 'idea' | 'bug' | 'otro';
export const SUGGESTION_MIN = 5;
export const SUGGESTION_MAX = 1000;
const OFFLINE_MSG = 'Sin conexión a internet. Inténtalo de nuevo';

/**
 * Texto de la sugerencia tal como se envía: sin espacios en los extremos y como mucho SUGGESTION_MAX
 * caracteres. Se cuentan como las reglas de Firestore (un emoji es un carácter, no dos).
 */
export function suggestionText(text: string): string {
  return [...text.trim()].slice(0, SUGGESTION_MAX).join('');
}

/** Longitud que cuentan las reglas (caracteres Unicode, no unidades UTF-16). */
export function suggestionLength(text: string): number {
  return [...suggestionText(text)].length;
}

/**
 * Envía una sugerencia. Va en un lote con `suggestionMeta/{uid}`, que guarda la hora del último
 * envío: las reglas solo aceptan uno por minuto.
 */
export async function sendSuggestion(kind: SuggestionKind, text: string, s: GameState): Promise<void> {
  const d = db;
  let user: User | null = null;
  try {
    user = d ? await withTimeout(ensureUser(), 10_000) : null;
  } catch {
    throw new Error(OFFLINE_MSG);
  }
  if (!d || !user) throw new Error(OFFLINE_MSG);
  const body = suggestionText(text);
  if (suggestionLength(body) < SUGGESTION_MIN) throw new Error(`Escribe al menos ${SUGGESTION_MIN} caracteres`);
  const batch = writeBatch(d);
  batch.set(doc(collection(d, 'suggestions')), {
    uid: user.uid,
    name: s.name,
    kind,
    text: body,
    era: s.era,
    ua: navigator.userAgent.slice(0, 200),
    status: 'nuevo',
    createdAt: serverTimestamp(),
  });
  batch.set(doc(d, 'suggestionMeta', user.uid), { lastAt: serverTimestamp() });
  try {
    // Sin conexión, Firestore no falla: deja el envío en cola. Pasado un rato se avisa al jugador
    await withTimeout(batch.commit(), 10_000);
  } catch (e) {
    if (errCode(e) === 'permission-denied') throw new Error('Espera un minuto antes de enviar otra sugerencia');
    if ((e as Error)?.message === 'timeout' || errCode(e) === 'unavailable') {
      throw new Error('Sin conexión: tu sugerencia se enviará sola al recuperar internet (no cierres el juego)');
    }
    throw e;
  }
}

/**
 * ¿Es el administrador? Lo deciden las reglas de Firestore (no el cliente): solo el administrador
 * puede leer `admin/access`, así que basta con intentarlo.
 */
export async function checkAdmin(): Promise<boolean> {
  if (!db || !auth?.currentUser) return false;
  try {
    await getDoc(doc(db, 'admin', 'access'));
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// Cuenta de Google
// =====================================================================

/** Explica en lenguaje claro por qué falló la vinculación con Google. */
export function authErrorMessage(e: unknown): string {
  const code = errCode(e);
  switch (code) {
    case 'auth/unauthorized-domain':
      return `Este dominio (${location.hostname}) no está autorizado en Firebase → Authentication → Dominios autorizados`;
    case 'auth/operation-not-allowed':
      return 'El inicio de sesión con Google no está activado en Firebase';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'Cancelaste el inicio de sesión';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Inténtalo de nuevo';
    case 'auth/web-storage-unsupported':
      return 'Tu navegador bloquea el inicio de sesión (modo privado o cookies desactivadas)';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento';
    case 'auth/provider-already-linked':
      return 'Esta partida ya está vinculada a una cuenta de Google';
    default:
      return code ? `No se pudo vincular la cuenta (${code})` : 'No se pudo vincular la cuenta';
  }
}

/** true mientras se cambia a una cuenta de Google ya existente: el guardado automático no sube nada. */
let switching = false;

/** Copia de la partida que se descartó al cambiar de cuenta (por si había que recuperarla a mano). */
const REPLACED_KEY = 'torre-save-replaced';

function keepReplaced(s: GameState) {
  try {
    localStorage.setItem(REPLACED_KEY, JSON.stringify({ at: Date.now(), state: s }));
  } catch {
    /* sin espacio */
  }
}

/** Si esa cuenta de Google ya existía, entra en ella y conserva la partida con más progreso. */
async function switchToExistingAccount(e: unknown): Promise<'switched'> {
  const cred = GoogleAuthProvider.credentialFromError(e as AuthError);
  if (!auth || !cred) throw e;
  let best: GameState;
  switching = true;
  try {
    const local = useGame.getState().s;
    // La del invitado se guarda siempre: si gana la de la nube (o la nube rechaza luego el guardado), es la que se pierde
    keepReplaced(local);
    await signInWithCredential(auth, cred);
    // Cuenta nueva: lo leído de la nube era de la otra. Hasta volver a leer, saveCloud se pone al día antes de subir.
    cloudRead = false;
    resetAutoSaveState();
    const picked = await pickBest(local);
    // Sin leer la nube no se sabe qué partida tiene la cuenta: no se sobrescribe nada
    if (!picked.readOk) throw new Error('Sin conexión: inténtalo de nuevo');
    best = picked.best ?? local;
    // Si gana la del invitado, la que se sobrescribe es la que ya tenía la cuenta de Google
    if (best === local && picked.cloud) keepReplaced(picked.cloud);
    // Los récords del invitado se subieron con su uid: con la cuenta nueva hay que volver a subirlos
    if (best === local) best = { ...local, submittedBest: {} };
    useGame.getState().init(best);
    saveLocal(useGame.getState().s);
  } finally {
    switching = false;
  }
  // Si falla, el guardado automático lo reintenta: el cambio de cuenta ya está hecho
  await saveCloud(useGame.getState().s).catch(() => {});
  cache.clear();
  return 'switched';
}

/** Marca (en esta pestaña) que salimos hacia Google: al volver se sabe si la vinculación se perdió por el camino. */
const REDIRECT_KEY = 'torre-google-redirect';

async function startRedirect(user: User, provider: GoogleAuthProvider): Promise<'redirecting'> {
  saveLocal(useGame.getState().s);
  try {
    sessionStorage.setItem(REDIRECT_KEY, '1');
  } catch {
    /* sin almacenamiento */
  }
  try {
    await linkWithRedirect(user, provider);
  } catch (e) {
    try {
      sessionStorage.removeItem(REDIRECT_KEY);
    } catch {
      /* sin almacenamiento */
    }
    throw e;
  }
  return 'redirecting';
}

/**
 * Vincula la cuenta anónima con Google para no perder el progreso.
 * Usa una ventana emergente; si el navegador la bloquea (móviles, app instalada), usa redirección.
 */
export async function linkGoogle(): Promise<'linked' | 'switched' | 'redirecting'> {
  const user = auth?.currentUser;
  if (!auth || !user) throw new Error('Sin sesión');
  const provider = new GoogleAuthProvider();
  // En la app instalada en la pantalla de inicio las ventanas emergentes no funcionan bien
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return startRedirect(user, provider);
  try {
    await linkWithPopup(user, provider);
    await saveCloud(useGame.getState().s);
    return 'linked';
  } catch (e) {
    const code = errCode(e);
    if (code === 'auth/credential-already-in-use') return switchToExistingAccount(e);
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') {
      return startRedirect(user, provider);
    }
    throw e;
  }
}

/** Al volver de la redirección de Google: termina la vinculación. */
export async function completeGoogleRedirect(): Promise<'linked' | 'switched' | null> {
  if (!auth) return null;
  let started = false;
  try {
    started = sessionStorage.getItem(REDIRECT_KEY) === '1';
    sessionStorage.removeItem(REDIRECT_KEY);
  } catch {
    /* sin almacenamiento */
  }
  try {
    const r = await getRedirectResult(auth);
    if (!r) {
      // Salimos hacia Google pero no volvió nada: el navegador perdió el resultado por el camino
      // (p. ej. Safari o la app instalada bloquean el almacenamiento entre sitios)
      if (started) {
        useGame
          .getState()
          .toast('⚠️ No se pudo completar la vinculación con Google. Inténtalo de nuevo o ábrelo en el navegador (no en la app instalada)');
      }
      return null;
    }
    // Ya está vinculada: si el guardado falla ahora, el automático lo reintenta
    await saveCloud(useGame.getState().s).catch(() => {});
    return 'linked';
  } catch (e) {
    if (errCode(e) === 'auth/credential-already-in-use') return switchToExistingAccount(e);
    console.warn('No se pudo completar la vinculación con Google', e);
    if (started) useGame.getState().toast(`⚠️ ${authErrorMessage(e)}`);
    return null;
  }
}
