import type { GameState } from './state';

// Regalos entre ciudades: al visitar la ciudad de otro jugador se le puede dejar un regalo (uno al día
// por ciudad). Quien regala gana gemas y quien lo recibe, tickets la próxima vez que entra.

/** Regalos que se pueden enviar al día (a ciudades distintas). Cada uno da GIFT_GEMS al que regala. */
export const GIFTS_PER_DAY = 5;
export const GIFT_GEMS = 1;
/** Tickets que se pueden recibir al día por regalos (los demás cuentan para el ❤️, sin ticket). */
export const GIFT_TICKETS_PER_DAY = 5;
const RECENT_MAX = 8;

export interface GiftIn {
  from: string;
  name: string;
  /** Hora del servidor en que se dejó (ms). */
  at: number;
}

export interface SocialState {
  /** Día al que corresponden `sent` y `ticketsToday`. */
  day: string | null;
  /** Ciudades a las que ya regalaste hoy. */
  sent: string[];
  /** Tickets recibidos hoy por regalos. */
  ticketsToday: number;
  /** Hora del último regalo recibido y cobrado (solo se piden los posteriores). */
  seenAt: number;
  /** Regalos recibidos en total (se ve como ❤️ en tu ciudad). */
  received: number;
  /** Últimos que te regalaron. */
  recent: { name: string; at: number }[];
}

export function newSocial(): SocialState {
  return { day: null, sent: [], ticketsToday: 0, seenAt: 0, received: 0, recent: [] };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function socialState(v: unknown): SocialState {
  if (!v || typeof v !== 'object') return newSocial();
  const r = v as Partial<SocialState>;
  return {
    day: typeof r.day === 'string' ? r.day : null,
    sent: Array.isArray(r.sent) ? [...new Set(r.sent.filter((x): x is string => typeof x === 'string'))].slice(0, GIFTS_PER_DAY) : [],
    ticketsToday: Math.floor(num(r.ticketsToday)),
    seenAt: num(r.seenAt),
    received: Math.floor(num(r.received)),
    recent: Array.isArray(r.recent)
      ? r.recent
          .filter((x) => x && typeof x.name === 'string' && Number.isFinite(x.at))
          .slice(0, RECENT_MAX)
          .map((x) => ({ name: x.name.slice(0, 20), at: x.at }))
      : [],
  };
}

/** El estado del día: si cambió el día, los contadores diarios empiezan de cero. */
function today(s: SocialState, day: string): SocialState {
  return s.day === day ? s : { ...s, day, sent: [], ticketsToday: 0 };
}

/** Por qué no se puede regalar a esa ciudad hoy (null: se puede). */
export function giftBlock(s: Pick<GameState, 'social'>, uid: string, day: string, myUid: string | null): string | null {
  if (!myUid) return 'Necesitas conexión para regalar';
  if (uid === myUid) return 'No puedes regalarte a ti mismo';
  const so = today(s.social, day);
  if (so.sent.includes(uid)) return 'Ya le dejaste un regalo hoy';
  if (so.sent.length >= GIFTS_PER_DAY) return `Ya repartiste tus ${GIFTS_PER_DAY} regalos de hoy`;
  return null;
}

export function giftsLeft(s: GameState, day: string): number {
  return GIFTS_PER_DAY - today(s.social, day).sent.length;
}

/** Apunta un regalo enviado (ya guardado en la nube) y da sus gemas. */
export function applyGiftSent(s: GameState, uid: string, day: string): GameState {
  const so = today(s.social, day);
  if (so.sent.includes(uid) || so.sent.length >= GIFTS_PER_DAY) return s;
  return { ...s, gems: s.gems + GIFT_GEMS, social: { ...so, sent: [...so.sent, uid] } };
}

/** Cobra los regalos recibidos nuevos: tickets (con tope diario), contador y quién fue. */
export function applyGiftsReceived(s: GameState, gifts: GiftIn[], day: string): { s: GameState; count: number; tickets: number; names: string[] } {
  const so = today(s.social, day);
  const fresh = gifts.filter((g) => g.at > so.seenAt).sort((a, b) => b.at - a.at);
  if (!fresh.length) return { s, count: 0, tickets: 0, names: [] };
  const tickets = Math.min(fresh.length, Math.max(0, GIFT_TICKETS_PER_DAY - so.ticketsToday));
  const social: SocialState = {
    ...so,
    ticketsToday: so.ticketsToday + tickets,
    seenAt: Math.max(so.seenAt, fresh[0].at),
    received: so.received + fresh.length,
    recent: [...fresh.map((g) => ({ name: g.name, at: g.at })), ...so.recent].slice(0, RECENT_MAX),
  };
  return { s: { ...s, tickets: s.tickets + tickets, social }, count: fresh.length, tickets, names: fresh.map((g) => g.name) };
}
