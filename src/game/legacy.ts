import type { GameState } from './state';

// Árbol de legado: un tronco común y tres ramas (Magnate, Activo y Jugador), cada una con un estilo
// de juego. Los niveles de una rama se abren invirtiendo estrellas en ella; en el nivel 2 hay que elegir
// una de dos mejoras y el nivel 3 es una piedra angular (solo puede haber una activa en toda la ciudad).
// Las ocho mejoras de legado de antes conservan su id y su nivel: ahora están en el tronco o en una rama.

export type Branch = 'tronco' | 'magnate' | 'activo' | 'jugador';

export interface LegacyNode {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  max: number;
  cost: (level: number) => number;
  branch: Branch;
  tier: 1 | 2 | 3;
  /** Nodos del mismo grupo se excluyen entre sí: solo se puede tener uno. */
  group?: string;
}

export const BRANCHES: { id: Exclude<Branch, 'tronco'>; emoji: string; name: string; desc: string }[] = [
  { id: 'magnate', emoji: '💤', name: 'Magnate', desc: 'Ganar sin estar: edificios baratos y ganancias offline' },
  { id: 'activo', emoji: '👆', name: 'Activo', desc: 'Toques, críticos y fiestas' },
  { id: 'jugador', emoji: '🎮', name: 'Jugador', desc: 'Minijuegos, tickets y eventos' },
];

/** Estrellas invertidas en una rama para abrir cada nivel. */
export const TIER_STARS: Record<2 | 3, number> = { 2: 15, 3: 60 };
/** Grupo de las piedras angulares: una sola activa en todo el árbol. */
export const KEYSTONE_GROUP = 'piedra';
/** Precio de reorganizar el legado cuando no toca gratis (hay una gratis por era). */
export const RESPEC_GEMS = 50;
/** Cada cuánto da el Pase VIP una partida de arcade gratis. */
export const VIP_EVERY_MS = 3_600_000;

const exp = (base: number, growth: number) => (l: number) => Math.ceil(base * growth ** l);
const flat = (n: number) => () => n;

export const LEGACY_TREE: LegacyNode[] = [
  // Tronco
  { id: 'productividad', name: 'Productividad', desc: 'Producción x1.15 por nivel', emoji: '⚙️', max: Infinity, cost: exp(3, 1.35), branch: 'tronco', tier: 1 },
  { id: 'capital', name: 'Capital inicial', desc: 'Empiezas cada era con monedas extra', emoji: '💰', max: Infinity, cost: exp(2, 1.5), branch: 'tronco', tier: 1 },
  // Magnate
  { id: 'arquitecto', name: 'Arquitecto', desc: 'Edificios 4% más baratos por nivel', emoji: '📐', max: 15, cost: exp(5, 1.6), branch: 'magnate', tier: 1 },
  { id: 'gerente', name: 'Gerente eterno', desc: '+1 h de tope offline por nivel', emoji: '🌙', max: 10, cost: exp(3, 1.4), branch: 'magnate', tier: 1 },
  {
    id: 'turnoNoche',
    name: 'Turno de noche',
    desc: '+10% de eficiencia offline por nivel',
    emoji: '🦉',
    max: 5,
    cost: exp(6, 1.6),
    branch: 'magnate',
    tier: 2,
    group: 'magnate2',
  },
  {
    id: 'hitosMayores',
    name: 'Hitos mayores',
    desc: 'Cada hito de edificio da x2.2 en vez de x2',
    emoji: '🏗️',
    max: 1,
    cost: flat(40),
    branch: 'magnate',
    tier: 2,
    group: 'magnate2',
  },
  {
    id: 'nuncaDuerme',
    name: 'Ciudad que nunca duerme',
    desc: 'Offline al 100% de eficiencia y con el doble de horas',
    emoji: '👑',
    max: 1,
    cost: flat(25),
    branch: 'magnate',
    tier: 3,
    group: KEYSTONE_GROUP,
  },
  // Activo
  { id: 'dedos', name: 'Dedos legendarios', desc: 'Toques x2 por nivel', emoji: '👆', max: Infinity, cost: exp(2, 1.45), branch: 'activo', tier: 1 },
  { id: 'suerte', name: 'Trébol', desc: '+1% de probabilidad de crítico', emoji: '🍀', max: 16, cost: exp(3, 1.5), branch: 'activo', tier: 1 },
  { id: 'asistente', name: 'Asistente del alcalde', desc: '+2 toques automáticos por segundo', emoji: '🤖', max: 25, cost: exp(4, 1.45), branch: 'activo', tier: 1 },
  {
    id: 'golpeCritico',
    name: 'Golpe crítico',
    desc: 'Los críticos valen x20 en vez de x10',
    emoji: '💥',
    max: 1,
    cost: flat(20),
    branch: 'activo',
    tier: 2,
    group: 'activo2',
  },
  {
    id: 'fiestero',
    name: 'Fiestero',
    desc: 'Las fiestas dan toques x10 (en vez de x7) y duran el doble',
    emoji: '🎉',
    max: 1,
    cost: flat(15),
    branch: 'activo',
    tier: 2,
    group: 'activo2',
  },
  {
    id: 'toqueMaestro',
    name: 'Toque maestro',
    desc: 'Cada toque suma además el 5% de tu producción por segundo',
    emoji: '✋',
    max: 1,
    cost: flat(25),
    branch: 'activo',
    tier: 3,
    group: KEYSTONE_GROUP,
  },
  // Jugador
  { id: 'taquilla', name: 'Taquilla eterna', desc: '+1 ticket máximo', emoji: '🎟️', max: 5, cost: exp(10, 2), branch: 'jugador', tier: 1 },
  { id: 'cielo', name: 'Cielo festivo', desc: 'Globos, decretos e incidentes 12% más frecuentes', emoji: '🎈', max: 5, cost: exp(6, 1.8), branch: 'jugador', tier: 1 },
  {
    id: 'profesional',
    name: 'Profesional',
    desc: '+25% de monedas en los arcade por nivel',
    emoji: '🕹️',
    max: 8,
    cost: exp(5, 1.5),
    branch: 'jugador',
    tier: 2,
    group: 'jugador2',
  },
  {
    id: 'maraton',
    name: 'Maratón',
    desc: 'Los boosts de minijuegos duran +20% por nivel',
    emoji: '⏱️',
    max: 5,
    cost: exp(5, 1.5),
    branch: 'jugador',
    tier: 2,
    group: 'jugador2',
  },
  {
    id: 'paseVip',
    name: 'Pase VIP',
    desc: 'Una partida de arcade gratis (sin ticket) cada hora',
    emoji: '🏆',
    max: 1,
    cost: flat(25),
    branch: 'jugador',
    tier: 3,
    group: KEYSTONE_GROUP,
  },
];

export const LEGACY_BY_ID = new Map(LEGACY_TREE.map((n) => [n.id, n]));

function level(s: GameState, id: string): number {
  return s.legacy[id] ?? 0;
}

export function hasNode(s: GameState, id: string): boolean {
  return level(s, id) > 0;
}

/** Estrellas gastadas en un nodo hasta su nivel actual. */
export function spentOn(node: LegacyNode, lvl: number): number {
  let n = 0;
  for (let l = 0; l < lvl; l++) n += node.cost(l);
  return n;
}

/** Estrellas invertidas en una rama (todas sus mejoras). */
export function branchInvested(s: GameState, branch: Branch): number {
  let n = 0;
  for (const node of LEGACY_TREE) if (node.branch === branch) n += spentOn(node, level(s, node.id));
  return n;
}

export function tierOpen(s: GameState, branch: Branch, tier: 1 | 2 | 3): boolean {
  return tier === 1 || branch === 'tronco' || branchInvested(s, branch) >= TIER_STARS[tier];
}

/** Piedra angular activa (como mucho una). */
export function keystone(s: GameState): LegacyNode | null {
  return LEGACY_TREE.find((n) => n.group === KEYSTONE_GROUP && hasNode(s, n.id)) ?? null;
}

/** El nodo del mismo grupo que ya se eligió (y que bloquea a este), si lo hay. */
export function rivalChosen(s: GameState, node: LegacyNode): LegacyNode | null {
  if (!node.group) return null;
  return LEGACY_TREE.find((n) => n.group === node.group && n.id !== node.id && hasNode(s, n.id)) ?? null;
}

/** Por qué no se puede subir un nodo (null: se puede, si alcanzan las estrellas). */
export function legacyBlock(s: GameState, id: string): string | null {
  const node = LEGACY_BY_ID.get(id);
  if (!node) return 'No existe';
  if (level(s, id) >= node.max) return 'Al máximo';
  if (!tierOpen(s, node.branch, node.tier)) {
    const need = TIER_STARS[node.tier as 2 | 3];
    return `Invierte ${need} ⭐ en esta rama (llevas ${branchInvested(s, node.branch)})`;
  }
  const rival = rivalChosen(s, node);
  if (rival) return node.group === KEYSTONE_GROUP ? `Ya tienes la piedra angular ${rival.emoji} ${rival.name}` : `Elegiste ${rival.emoji} ${rival.name}`;
  return null;
}

export function legacyCost(s: GameState, id: string): number {
  const node = LEGACY_BY_ID.get(id);
  return node ? node.cost(level(s, id)) : Infinity;
}

/** Mejoras de legado que se pueden comprar ahora mismo (para los avisos). */
export function affordableLegacy(s: GameState): number {
  const avail = s.stars - s.starsSpent;
  return LEGACY_TREE.filter((n) => !legacyBlock(s, n.id) && n.cost(level(s, n.id)) <= avail).length;
}

/** Reorganizar: gratis una vez por era, si no, cuesta gemas. */
export function respecCost(s: GameState): number {
  return s.respecFree ? 0 : RESPEC_GEMS;
}

// ---------- Efectos de los nodos nuevos ----------

export function milestoneFactor(s: GameState): number {
  return hasNode(s, 'hitosMayores') ? 2.2 : 2;
}

export function critMultiplier(s: GameState): number {
  return hasNode(s, 'golpeCritico') ? 20 : 10;
}

/** Multiplicador de toques de las fiestas (decreto Festival y premio de la rueda). */
export function festivalMult(s: GameState): number {
  return hasNode(s, 'fiestero') ? 10 : 7;
}

export function festivalDuration(s: GameState, ms: number): number {
  return hasNode(s, 'fiestero') ? ms * 2 : ms;
}

/** Parte de la producción por segundo que suma cada toque por el Toque maestro. */
export function masterTapPct(s: GameState): number {
  return hasNode(s, 'toqueMaestro') ? 0.05 : 0;
}

export function arcadeCoinsMult(s: GameState): number {
  return 1 + 0.25 * level(s, 'profesional');
}

export function arcadeBoostTime(s: GameState): number {
  return 1 + 0.2 * level(s, 'maraton');
}

export function vipReady(s: GameState, t: number): boolean {
  return hasNode(s, 'paseVip') && t - s.vipLast >= VIP_EVERY_MS;
}
