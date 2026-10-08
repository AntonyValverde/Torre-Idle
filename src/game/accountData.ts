import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { dateKey, now, weekKey } from './clock';
import { BOARDS, DAILY_KINDS } from './cloud';
import { cupWeekKey } from './cup';

// Todo lo que un jugador tiene en la nube además de su partida: lo borra el administrador desde su panel
// o el propio jugador desde Perfil (las reglas solo se lo dejan después de marcar su partida como `deleted`).

/** Primer día con datos en la nube: desde aquí se buscan los retos diarios y las semanas de liga de un jugador. */
export const FIRST_DAY = '2026-09-26';

export function addDays(key: string, n: number): string {
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
 * Todo lo del jugador en la Conquista de esta semana: sus partes de batalla y sus territorios (vuelven a los
 * bandidos) en `first`, y su reserva en el mundo y su documento de miembro en `last`. Se borran en ese orden:
 * si algo falla a medias, repetirlo vuelve a encontrar el mundo. Si no juega, no hay nada.
 */
export async function conquestRefsOf(d: Firestore, uid: string): Promise<{ first: DocumentReference[]; last: DocumentReference[] }> {
  const week = cupWeekKey(now());
  const member = doc(d, 'conquest', week, 'members', uid);
  const snap = await getDoc(member);
  const w = snap.exists() ? snap.data().w : null;
  if (typeof w !== 'string' || !w) return { first: [], last: [] };
  const world = ['conquest', week, 'worlds', w] as const;
  const [reports, tiles] = await Promise.all([
    getDocs(collection(d, ...world, 'players', uid, 'reports')),
    getDocs(query(collection(d, ...world, 'tiles'), where('owner', '==', uid))),
  ]);
  return { first: [...reports.docs.map((x) => x.ref), ...tiles.docs.map((x) => x.ref)], last: [doc(d, ...world, 'players', uid), member] };
}

/** Borra documentos en lotes de `size`, `parallel` lotes a la vez. Los que no existen no dan error. */
async function deleteInBatches(d: Firestore, refs: DocumentReference[], size: number, parallel: number) {
  const batches: DocumentReference[][] = [];
  for (let i = 0; i < refs.length; i += size) batches.push(refs.slice(i, i + size));
  for (let i = 0; i < batches.length; i += parallel) {
    await Promise.all(
      batches.slice(i, i + parallel).map((list) => {
        const batch = writeBatch(d);
        for (const r of list) batch.delete(r);
        return batch.commit();
      }),
    );
  }
}

/** Borra documentos en lotes (Firestore admite hasta 500 escrituras por lote), uno detrás de otro. */
export function deleteAll(d: Firestore, refs: DocumentReference[]) {
  return deleteInBatches(d, refs, 450, 1);
}

/**
 * Borra todo lo del jugador menos su partida (que ya tiene que ser la marca `deleted`): rankings, retos diarios y
 * semanas de liga de todas las fechas, su ciudad pública, su buzón de regalos, la Copa y la Conquista de esta
 * semana (sus territorios vuelven a los bandidos) y sus sugerencias. Las Copas ya jugadas no se tocan: cambiarían
 * los grupos y el podio de los demás. Se puede repetir sin problema si algo falla a medias.
 *
 * `admin`: lotes grandes. `self` (el propio jugador): las reglas leen su partida en cada borrado y Firestore admite
 * 20 lecturas así por lote, así que van en lotes de 10.
 */
export async function eraseAccountData(d: Firestore, uid: string, by: 'admin' | 'self'): Promise<void> {
  // Un día de margen a cada lado: los retos van por la fecha local del jugador
  const tomorrow = addDays(dateKey(), 1);
  const [sugg, inbox, conquest] = await Promise.all([
    getDocs(query(collection(d, 'suggestions'), where('uid', '==', uid))),
    // Su buzón de regalos (solo el destinatario y el administrador pueden leerlo y borrarlo)
    getDocs(collection(d, 'gifts', uid, 'inbox')),
    conquestRefsOf(d, uid),
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
    ...conquest.first,
  ];
  if (by === 'admin') await deleteAll(d, [...refs, ...conquest.last]);
  else {
    await deleteInBatches(d, refs, 10, 6);
    await deleteInBatches(d, conquest.last, 10, 1);
  }
  // La inscripción de la Copa solo se puede borrar antes de que se formen los grupos
  await deleteDoc(doc(d, 'cup', cupWeekKey(now()), 'entries', uid)).catch(() => {});
}
