import { cupWeekKey, seasonOf } from './cup';

// Pase de temporada (gratuito): una pista de 25 niveles que se recorre con los mismos puntos que ya
// da el juego (liga, Copa y Conquista) durante las 4 semanas de cada temporada de la Copa. Los
// premios se cobran nivel a nivel; al cambiar de temporada, los niveles ganados y no cobrados se
// pagan solos y la pista vuelve a empezar. El último nivel da el cosmético exclusivo de la temporada.

export type PassRewardKind = 'gems' | 'tickets' | 'card' | 'pack' | 'chips' | 'deco';

export interface PassReward {
  kind: PassRewardKind;
  /** Cantidad (gemas, tickets o fichas); 1 para carta, sobre y cosmético. */
  n: number;
  /** Cosmético que da (solo kind 'deco'). */
  deco?: string;
  /** Gemas que acompañan al cosmético del último nivel. */
  gems?: number;
}

export interface PassLevel {
  /** Puntos que cuesta subir a este nivel desde el anterior. */
  cost: number;
  reward: PassReward;
}

export interface PassState {
  /** Temporada (índice de la Copa) a la que corresponde la pista. */
  season: number;
  /** Puntos acumulados en la temporada. */
  xp: number;
  /** Niveles ya cobrados (0..PASS_LEVELS.length). */
  claimed: number;
  /** Cosméticos conseguidos (ids de PASS_DECOS): los de temporada por el pase y los de la tienda con gemas. */
  decos: string[];
  /** Cosméticos conseguidos pero apagados (no se dibujan ni se publican). */
  hidden: string[];
  /** Puntos ganados en total (para el periódico y las estadísticas). */
  total: number;
}

export interface DecoDef {
  emoji: string;
  name: string;
  desc: string;
  /** Precio en gemas en la tienda de Decoración; sin precio = exclusivo del pase de temporada. */
  price?: number;
}

/**
 * Cosméticos de la ciudad. Los cuatro primeros son exclusivos de temporada (el de la temporada n es
 * DECO_ORDER[n % 4]); el resto se compra con gemas en Mejoras → Decoración. Todos se dibujan en la
 * escena de la ciudad y viajan en el campo `deco` de la ciudad pública.
 */
export const PASS_DECOS: Record<string, DecoDef> = {
  zeppelin: { emoji: '🛩️', name: 'Zepelín dorado', desc: 'Un zepelín dorado sobrevuela tu ciudad' },
  aurora: { emoji: '🌌', name: 'Aurora', desc: 'Una aurora boreal ilumina tus noches' },
  fountain: { emoji: '⛲', name: 'Fuente de mármol', desc: 'Una fuente monumental en la plaza' },
  lanterns: { emoji: '🏮', name: 'Farolillos', desc: 'Farolillos de colores entre los edificios' },
  garden: { emoji: '🌷', name: 'Jardín floral', desc: 'Parterres de flores delante del ayuntamiento', price: 40 },
  kites: { emoji: '🪁', name: 'Cometas', desc: 'Cometas de colores bailan sobre la ciudad', price: 50 },
  birds: { emoji: '🕊️', name: 'Bandada', desc: 'Una bandada de pájaros cruza el cielo', price: 60 },
  statue: { emoji: '🗽', name: 'Estatua del alcalde', desc: 'Una estatua tuya en la plaza', price: 90 },
  neon: { emoji: '💡', name: 'Luces de neón', desc: 'Los edificios se perfilan con neón por la noche', price: 100 },
  fireworks: { emoji: '🎆', name: 'Fuegos artificiales', desc: 'Fuegos artificiales cada noche', price: 120 },
};
const DECO_ORDER = ['zeppelin', 'aurora', 'fountain', 'lanterns'];
/** Ids de la tienda, en orden de precio. */
export const SHOP_DECOS = Object.keys(PASS_DECOS).filter((id) => PASS_DECOS[id].price !== undefined);
/** Máximo de cosméticos que viajan en la ciudad pública (lo mismo que admiten las reglas). */
export const DECO_PUBLIC_MAX = 8;

export function seasonDeco(season: number): string {
  return DECO_ORDER[((season % DECO_ORDER.length) + DECO_ORDER.length) % DECO_ORDER.length];
}

const gems = (n: number): PassReward => ({ kind: 'gems', n });
const tickets = (n: number): PassReward => ({ kind: 'tickets', n });
const card: PassReward = { kind: 'card', n: 1 };
const pack: PassReward = { kind: 'pack', n: 1 };

/** Los 25 niveles: 60 puntos los diez primeros, 100 los diez siguientes y 140 los cinco últimos (2300 en total). */
export const PASS_LEVELS: PassLevel[] = [
  { cost: 60, reward: gems(3) },
  { cost: 60, reward: tickets(1) },
  { cost: 60, reward: gems(4) },
  { cost: 60, reward: tickets(1) },
  { cost: 60, reward: card },
  { cost: 60, reward: gems(5) },
  { cost: 60, reward: tickets(1) },
  { cost: 60, reward: gems(5) },
  { cost: 60, reward: tickets(2) },
  { cost: 60, reward: pack },
  { cost: 100, reward: gems(6) },
  { cost: 100, reward: { kind: 'chips', n: 300 } },
  { cost: 100, reward: tickets(1) },
  { cost: 100, reward: gems(6) },
  { cost: 100, reward: card },
  { cost: 100, reward: gems(8) },
  { cost: 100, reward: tickets(2) },
  { cost: 100, reward: gems(8) },
  { cost: 100, reward: tickets(1) },
  { cost: 100, reward: pack },
  { cost: 140, reward: gems(10) },
  { cost: 140, reward: card },
  { cost: 140, reward: tickets(2) },
  { cost: 140, reward: gems(10) },
  { cost: 140, reward: { kind: 'deco', n: 1, gems: 30 } },
];

export const PASS_MAX = PASS_LEVELS.length;
export const PASS_TOTAL_XP = PASS_LEVELS.reduce((n, l) => n + l.cost, 0);

export function newPass(season = 0): PassState {
  return { season, xp: 0, claimed: 0, decos: [], hidden: [], total: 0 };
}

/** Temporada del pase en un instante dado (la de la Copa). */
export function passSeason(t: number): number {
  return seasonOf(cupWeekKey(t));
}

/** Nivel alcanzado con `xp` puntos (0..PASS_MAX). */
export function passLevel(xp: number): number {
  let lvl = 0;
  let acc = 0;
  for (const l of PASS_LEVELS) {
    acc += l.cost;
    if (xp < acc) break;
    lvl++;
  }
  return lvl;
}

/** Puntos acumulados necesarios para llegar al nivel `lvl` (1..PASS_MAX). */
export function passThreshold(lvl: number): number {
  return PASS_LEVELS.slice(0, Math.max(0, Math.min(PASS_MAX, lvl))).reduce((n, l) => n + l.cost, 0);
}

/** Progreso hacia el siguiente nivel: puntos dentro del nivel y coste del nivel (ambos 0 si está completo). */
export function passProgress(p: PassState): { level: number; into: number; cost: number } {
  const level = passLevel(p.xp);
  if (level >= PASS_MAX) return { level, into: 0, cost: 0 };
  return { level, into: p.xp - passThreshold(level), cost: PASS_LEVELS[level].cost };
}

/** Niveles ganados y aún sin cobrar. */
export function passClaimable(p: PassState): number {
  return Math.max(0, passLevel(p.xp) - p.claimed);
}

/** Premio del nivel `lvl` (1..PASS_MAX) en la temporada `season`, con el cosmético resuelto. */
export function passRewardAt(lvl: number, season: number): PassReward {
  const r = PASS_LEVELS[lvl - 1].reward;
  return r.kind === 'deco' ? { ...r, deco: seasonDeco(season) } : r;
}

/** Suma puntos al pase (si la temporada cambió, primero se cierra la anterior con `rolloverPass`). */
export function addPassXp(p: PassState, n: number): PassState {
  if (!(n > 0)) return p;
  const add = Math.floor(n);
  return { ...p, xp: p.xp + add, total: p.total + add };
}

/**
 * Cambio de temporada: devuelve la pista nueva y los premios de los niveles ganados y no cobrados de la
 * anterior (para pagarlos solos). Si la temporada es la misma, no hay nada que hacer.
 */
export function rolloverPass(p: PassState, season: number): { pass: PassState; owed: PassReward[] } {
  if (season === p.season) return { pass: p, owed: [] };
  const level = passLevel(p.xp);
  const owed: PassReward[] = [];
  for (let l = p.claimed + 1; l <= level; l++) owed.push(passRewardAt(l, p.season));
  return { pass: { ...newPass(season), decos: p.decos, hidden: p.hidden, total: p.total }, owed };
}

/** Cobra el siguiente nivel pendiente; null si no hay. */
export function claimNext(p: PassState): { pass: PassState; level: number; reward: PassReward } | null {
  if (passClaimable(p) <= 0) return null;
  const level = p.claimed + 1;
  const reward = passRewardAt(level, p.season);
  const decos = reward.deco && !p.decos.includes(reward.deco) ? [...p.decos, reward.deco] : p.decos;
  return { pass: { ...p, claimed: level, decos }, level, reward };
}

/** Conseguido (aunque esté apagado). */
export function ownsDeco(p: PassState, id: string): boolean {
  return p.decos.includes(id);
}

/** Conseguido y encendido: es lo que se dibuja y se publica. */
export function hasDeco(p: PassState, id: string): boolean {
  return p.decos.includes(id) && !p.hidden.includes(id);
}

/** Cosméticos activos, en el orden en que se consiguieron (como mucho DECO_PUBLIC_MAX). */
export function activeDecos(p: PassState): string[] {
  return p.decos.filter((d) => !p.hidden.includes(d)).slice(0, DECO_PUBLIC_MAX);
}

/** Compra un cosmético de la tienda; null si no existe, ya se tiene o no alcanzan las gemas. */
export function buyDecoWith(p: PassState, id: string, gems: number): { pass: PassState; price: number } | null {
  const price = PASS_DECOS[id]?.price;
  if (price === undefined || p.decos.includes(id) || !(gems >= price)) return null;
  return { pass: { ...p, decos: [...p.decos, id] }, price };
}

/** Enciende o apaga un cosmético conseguido. */
export function toggleDeco(p: PassState, id: string): PassState {
  if (!p.decos.includes(id)) return p;
  const hidden = p.hidden.includes(id) ? p.hidden.filter((d) => d !== id) : [...p.hidden, id];
  return { ...p, hidden };
}

/** Texto corto de un premio, para los avisos. */
export function passRewardText(r: PassReward): string {
  switch (r.kind) {
    case 'gems':
      return `+${r.n} 💎`;
    case 'tickets':
      return `+${r.n} 🎟️`;
    case 'card':
      return 'carta de la Copa 🃏';
    case 'pack':
      return 'sobre de consejero 📜';
    case 'chips':
      return `+${r.n} 🎰`;
    case 'deco': {
      const d = r.deco ? PASS_DECOS[r.deco] : null;
      return `${d ? `${d.emoji} ${d.name}` : 'cosmético'}${r.gems ? ` y +${r.gems} 💎` : ''}`;
    }
  }
}

// ---------- Lectura de partidas guardadas ----------

export function passState(v: unknown, season: number): PassState {
  const base = newPass(season);
  if (!v || typeof v !== 'object') return base;
  const r = v as Partial<PassState>;
  const int = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d);
  return {
    season: int(r.season, season),
    xp: int(r.xp, 0),
    claimed: Math.min(PASS_MAX, int(r.claimed, 0)),
    decos: Array.isArray(r.decos) ? r.decos.filter((d): d is string => typeof d === 'string' && d in PASS_DECOS) : [],
    hidden: Array.isArray(r.hidden) ? r.hidden.filter((d): d is string => typeof d === 'string' && d in PASS_DECOS) : [],
    total: int(r.total, 0),
  };
}
