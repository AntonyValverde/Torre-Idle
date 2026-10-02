import { fmt } from './format';
import { lawAdd, lawMult } from './laws';
import type { Boost, GameState } from './state';

// =====================================================================
// Edificios
// =====================================================================

export interface BuildingDef {
  id: string;
  name: string;
  emoji: string;
  baseCost: number;
  baseProd: number;
  /** Era mínima para poder construirlo. */
  era: number;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'choza', name: 'Choza', emoji: '🛖', baseCost: 15, baseProd: 0.1, era: 1 },
  { id: 'casa', name: 'Casa', emoji: '🏠', baseCost: 100, baseProd: 1, era: 1 },
  { id: 'tienda', name: 'Tienda', emoji: '🏪', baseCost: 1_100, baseProd: 8, era: 1 },
  { id: 'fabrica', name: 'Fábrica', emoji: '🏭', baseCost: 12_000, baseProd: 47, era: 1 },
  { id: 'banco', name: 'Banco', emoji: '🏦', baseCost: 130_000, baseProd: 260, era: 1 },
  { id: 'rascacielos', name: 'Rascacielos', emoji: '🏙️', baseCost: 1.4e6, baseProd: 1_400, era: 1 },
  { id: 'estadio', name: 'Estadio', emoji: '🏟️', baseCost: 2e7, baseProd: 7_800, era: 1 },
  { id: 'puerto', name: 'Puerto espacial', emoji: '🚀', baseCost: 3.3e8, baseProd: 44_000, era: 1 },
  { id: 'flotante', name: 'Ciudad flotante', emoji: '🛸', baseCost: 5.1e9, baseProd: 260_000, era: 1 },
  { id: 'portal', name: 'Portal dimensional', emoji: '🌀', baseCost: 7.5e10, baseProd: 1.6e6, era: 1 },
  { id: 'solar', name: 'Planta solar orbital', emoji: '☀️', baseCost: 1e12, baseProd: 1e7, era: 2 },
  { id: 'ascensor', name: 'Ascensor espacial', emoji: '🗼', baseCost: 1.4e13, baseProd: 6.5e7, era: 3 },
  { id: 'lunar', name: 'Colonia lunar', emoji: '🌙', baseCost: 1.7e14, baseProd: 4.3e8, era: 4 },
  { id: 'dyson', name: 'Esfera Dyson', emoji: '🌞', baseCost: 2.1e15, baseProd: 2.9e9, era: 5 },
  { id: 'nexo', name: 'Nexo galáctico', emoji: '🌌', baseCost: 2.6e16, baseProd: 2.1e10, era: 6 },
  { id: 'realidad', name: 'Motor de realidad', emoji: '♾️', baseCost: 3.1e17, baseProd: 1.5e11, era: 8 },
];

export const COST_GROWTH = 1.15;
export const OFFLINE_EFFICIENCY = 0.5;

/** Coste de comprar `amount` unidades teniendo ya `owned` (suma geométrica). */
export function buildingCost(def: BuildingDef, owned: number, amount = 1, discount = 1): number {
  const g = COST_GROWTH;
  return ((def.baseCost * g ** owned * (g ** amount - 1)) / (g - 1)) * discount;
}

export function maxAffordable(def: BuildingDef, owned: number, coins: number, discount = 1): number {
  const g = COST_GROWTH;
  const n = Math.floor(Math.log(((coins / discount) * (g - 1)) / (def.baseCost * g ** owned) + 1) / Math.log(g));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function costDiscount(s: GameState): number {
  return 0.96 ** legacyLevel(s, 'arquitecto') * lawMult(s, 'buildCost');
}

// ---------- Hitos: cada edificio duplica su producción al llegar a ciertas cantidades, para siempre ----------

const MILESTONES = [25, 50, 100, 150, 200, 250, 300, 400, 500];

export function milestoneCount(owned: number): number {
  let c = 0;
  for (const m of MILESTONES) if (owned >= m) c++;
  if (owned >= 600) c += Math.floor((owned - 500) / 100);
  return c;
}

export function nextMilestone(owned: number): number {
  for (const m of MILESTONES) if (owned < m) return m;
  return (Math.floor(owned / 100) + 1) * 100;
}

export function prevMilestone(owned: number): number {
  let p = 0;
  for (const m of MILESTONES) if (owned >= m) p = m;
  if (owned >= 600) p = Math.floor(owned / 100) * 100;
  return p;
}

// =====================================================================
// Eras
// =====================================================================

const ERA_NAMES = [
  'Aldea',
  'Pueblo',
  'Ciudad',
  'Metrópolis',
  'Megalópolis',
  'Ciudad orbital',
  'Colonia lunar',
  'Imperio solar',
  'Federación galáctica',
  'Multiverso',
];
const ERA_HUES = [262, 205, 168, 28, 330, 190, 46, 355, 285, 125];

export function eraName(era: number): string {
  return era <= ERA_NAMES.length ? ERA_NAMES[era - 1] : `Multiverso ${era - ERA_NAMES.length + 1}`;
}

export function eraHue(era: number): number {
  return ERA_HUES[(era - 1) % ERA_HUES.length];
}

// =====================================================================
// Mejoras (se pagan con monedas)
// =====================================================================

export type UpgradeEffect = { type: 'building'; building: string } | { type: 'tapMult' } | { type: 'tapPct' };

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  cost: number;
  effect: UpgradeEffect;
  unlocked: (s: GameState) => boolean;
}

const TIERS = [10, 25, 50, 100, 150, 200, 300];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export const UPGRADES: UpgradeDef[] = [
  ...BUILDINGS.flatMap((b) =>
    TIERS.map((req, i) => ({
      id: `${b.id}-${i}`,
      name: `${b.name} ${ROMAN[i]}`,
      desc: `${b.name}: producción x2 (requiere ${req})`,
      emoji: b.emoji,
      cost: buildingCost(b, req - 1) * 4,
      effect: { type: 'building', building: b.id } as UpgradeEffect,
      unlocked: (s: GameState) => (s.buildings[b.id] ?? 0) >= req,
    })),
  ),
  // Mejoras de toque: 24 niveles alternando x2 y +1% de la producción
  ...Array.from({ length: 24 }, (_, i) => {
    const type = i % 3 === 2 ? 'tapPct' : 'tapMult';
    const cost = 100 * 25 ** i;
    return {
      id: `tap-${i}`,
      name: type === 'tapMult' ? `Dedos de oro ${i + 1}` : `Toque inteligente ${i + 1}`,
      desc: type === 'tapMult' ? 'Toques x2' : 'Cada toque suma +1% de tu producción/s',
      emoji: type === 'tapMult' ? '👆' : '✨',
      cost,
      effect: { type } as UpgradeEffect,
      unlocked: (s: GameState) => s.totalEarned >= cost * 0.3,
    };
  }),
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

/** Coste real de una mejora (la ley de la era puede abaratarla o encarecerla). */
export function upgradeCost(s: GameState, u: UpgradeDef): number {
  return u.cost * lawMult(s, 'upgradeCost');
}

// =====================================================================
// Edificios raros (se consiguen en Fusión)
// =====================================================================

export interface RareDef {
  id: string;
  name: string;
  emoji: string;
  tile: number;
  bonus: number;
}

export const RARE: RareDef[] = [
  { id: 'estatua', name: 'Estatua dorada', emoji: '🗽', tile: 256, bonus: 0.1 },
  { id: 'monumento', name: 'Gran monumento', emoji: '🏛️', tile: 512, bonus: 0.25 },
  { id: 'maravilla', name: 'Maravilla', emoji: '🌆', tile: 1024, bonus: 0.5 },
  { id: 'leyenda', name: 'Torre legendaria', emoji: '👑', tile: 2048, bonus: 1 },
  { id: 'cosmos', name: 'Coloso cósmico', emoji: '🌠', tile: 4096, bonus: 2 },
];

// =====================================================================
// Tienda de gemas (mejoras permanentes)
// =====================================================================

export interface ShopItemDef {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  max: number;
  cost: (level: number) => number;
}

export const GEM_SHOP: ShopItemDef[] = [
  { id: 'prod', name: 'Inversión', desc: '+25% de producción permanente', emoji: '📈', max: Infinity, cost: (l) => 5 + l * 5 },
  { id: 'offline', name: 'Gerente nocturno', desc: '+1h de ganancias offline', emoji: '🌙', max: 22, cost: (l) => 8 + l * 8 },
  { id: 'tickets', name: 'Taquilla', desc: '+1 ticket máximo', emoji: '🎟️', max: 5, cost: (l) => 12 + l * 12 },
  { id: 'regen', name: 'Máquina de tickets', desc: 'Tickets se recargan 10% más rápido', emoji: '⏱️', max: 5, cost: (l) => 10 + l * 10 },
  { id: 'offlineEff', name: 'Turno de noche', desc: '+10% de eficiencia offline', emoji: '🦉', max: 5, cost: (l) => 15 + l * 15 },
];

export function gemLevel(s: GameState, id: string): number {
  return s.gemLevels[id] ?? 0;
}

// =====================================================================
// Legado: estrellas y árbol de legado (sobreviven a las refundaciones)
// =====================================================================

export const STAR_DIVISOR = 1e9;
export const STAR_BONUS = 0.03;

/** Estrellas totales que corresponden a lo ganado desde siempre (raíz cúbica: cada vez cuesta más). */
export function starsPotential(allTimeEarned: number): number {
  return Math.floor(Math.cbrt(Math.max(0, allTimeEarned) / STAR_DIVISOR));
}

export function pendingStars(s: GameState): number {
  return Math.max(0, starsPotential(s.allTimeEarned) - s.stars);
}

/** Monedas totales necesarias para tener `stars` estrellas. */
export function earnedForStars(stars: number): number {
  return stars ** 3 * STAR_DIVISOR;
}

export function availableStars(s: GameState): number {
  return s.stars - s.starsSpent;
}

export const LEGACY: ShopItemDef[] = [
  { id: 'productividad', name: 'Productividad', desc: 'Producción x1.15 por nivel', emoji: '⚙️', max: Infinity, cost: (l) => Math.ceil(3 * 1.35 ** l) },
  { id: 'capital', name: 'Capital inicial', desc: 'Empiezas cada era con monedas extra', emoji: '💰', max: Infinity, cost: (l) => Math.ceil(2 * 1.5 ** l) },
  { id: 'dedos', name: 'Dedos legendarios', desc: 'Toques x2 por nivel', emoji: '👆', max: Infinity, cost: (l) => Math.ceil(2 * 1.45 ** l) },
  { id: 'arquitecto', name: 'Arquitecto', desc: 'Edificios 4% más baratos por nivel', emoji: '📐', max: 15, cost: (l) => Math.ceil(5 * 1.6 ** l) },
  { id: 'asistente', name: 'Asistente del alcalde', desc: '+2 toques automáticos por segundo', emoji: '🤖', max: 25, cost: (l) => Math.ceil(4 * 1.45 ** l) },
  { id: 'suerte', name: 'Trébol', desc: '+1% de probabilidad de crítico', emoji: '🍀', max: 16, cost: (l) => Math.ceil(3 * 1.5 ** l) },
  { id: 'cielo', name: 'Cielo festivo', desc: 'Globos y decretos 12% más frecuentes', emoji: '🎈', max: 5, cost: (l) => Math.ceil(6 * 1.8 ** l) },
  { id: 'taquilla', name: 'Taquilla eterna', desc: '+1 ticket máximo', emoji: '🎟️', max: 5, cost: (l) => Math.ceil(10 * 2 ** l) },
];

export function legacyLevel(s: GameState, id: string): number {
  return s.legacy[id] ?? 0;
}

export function startingCapital(s: GameState): number {
  const l = legacyLevel(s, 'capital');
  return l === 0 ? 0 : 100 * 10 ** l;
}

// =====================================================================
// Logros infinitos: cada categoría tiene niveles sin fin
// =====================================================================

export interface AchievementDef {
  id: string;
  name: string;
  emoji: string;
  threshold: (k: number) => number;
  stat: (s: GameState) => number;
  desc: (value: number) => string;
}

function fromList(list: number[], after: (k: number) => number) {
  return (k: number) => (k < list.length ? list[k] : after(k - list.length));
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'earn',
    name: 'Magnate',
    emoji: '💰',
    threshold: (k) => 10 ** (3 + 3 * k),
    stat: (s) => s.allTimeEarned,
    desc: (v) => `Gana ${fmt(v)} monedas en total`,
  },
  {
    id: 'build',
    name: 'Constructor',
    emoji: '🏗️',
    threshold: fromList([10, 25, 50, 100, 200, 300, 500, 750, 1000], (k) => 1500 + 500 * k),
    stat: (s) => totalBuildings(s),
    desc: (v) => `Ten ${fmt(v)} edificios a la vez`,
  },
  {
    id: 'tap',
    name: 'Dedos rápidos',
    emoji: '👆',
    threshold: (k) => 100 * 5 ** k,
    stat: (s) => s.taps,
    desc: (v) => `Toca ${fmt(v)} veces`,
  },
  {
    id: 'stack',
    name: 'Arquitecto vertical',
    emoji: '🏗️',
    threshold: fromList([5, 10, 15, 20, 30, 40, 50, 75], (k) => 100 + 50 * k),
    stat: (s) => s.stackBest,
    desc: (v) => `Apila ${v} pisos en Stack Tower`,
  },
  {
    id: 'merge',
    name: 'Alquimista',
    emoji: '🧱',
    threshold: (k) => 64 * 2 ** k,
    stat: (s) => s.mergeBestTile,
    desc: (v) => `Consigue la ficha ${v} en Fusión`,
  },
  {
    id: 'streak',
    name: 'Constancia',
    emoji: '🔥',
    threshold: fromList([3, 7, 14, 30, 60, 100, 150, 200], (k) => 365 * (k + 1)),
    stat: (s) => s.daily.bestStreak,
    desc: (v) => `Racha de ${v} días en el Apagón`,
  },
  {
    id: 'thief',
    name: 'Sheriff',
    emoji: '🦹',
    threshold: fromList([20, 40, 60, 80, 100, 130, 160, 200], (k) => 250 + 50 * k),
    stat: (s) => s.thiefBest,
    desc: (v) => `Consigue ${v} puntos en Atrapa al ladrón`,
  },
  {
    id: 'traffic',
    name: 'Agente de tráfico',
    emoji: '🚦',
    threshold: fromList([10, 25, 50, 75, 100, 150, 200, 300], (k) => 400 + 100 * k),
    stat: (s) => s.trafficBest,
    desc: (v) => `Haz cruzar ${v} coches en Semáforo`,
  },
  {
    id: 'memory',
    name: 'Memoria de elefante',
    emoji: '🧠',
    threshold: fromList([3, 5, 8, 10, 12, 15, 18, 21], (k) => 25 + 3 * k),
    stat: (s) => s.memoryBest,
    desc: (v) => `Supera ${v} rondas en Memoria de ventanas`,
  },
  {
    id: 'roads',
    name: 'Urbanista',
    emoji: '🛣️',
    threshold: fromList([3, 7, 14, 30, 60, 100, 150, 200], (k) => 365 * (k + 1)),
    stat: (s) => s.roads.bestStreak,
    desc: (v) => `Racha de ${v} días en Conecta las calles`,
  },
  {
    id: 'parks',
    name: 'Paisajista',
    emoji: '🌳',
    threshold: fromList([3, 7, 14, 30, 60, 100, 150, 200], (k) => 365 * (k + 1)),
    stat: (s) => s.parks.bestStreak,
    desc: (v) => `Racha de ${v} días en el Plan verde`,
  },
  {
    id: 'fire',
    name: 'Jefe de bomberos',
    emoji: '🚒',
    threshold: fromList([30, 60, 100, 150, 200, 300, 400, 500], (k) => 650 + 150 * k),
    stat: (s) => s.fireBest,
    desc: (v) => `Consigue ${v} puntos en Bomberos`,
  },
  {
    id: 'metro',
    name: 'Ingeniero del metro',
    emoji: '🚇',
    threshold: fromList([10, 25, 50, 75, 100, 150, 200, 300], (k) => 400 + 100 * k),
    stat: (s) => s.metroBest,
    desc: (v) => `Lleva a ${v} viajeros en Metro`,
  },
  {
    id: 'missions',
    name: 'Funcionario ejemplar',
    emoji: '📋',
    threshold: fromList([5, 15, 30, 60, 100, 200, 350, 500], (k) => 750 + 250 * k),
    stat: (s) => s.missionsDone,
    desc: (v) => `Completa ${fmt(v)} misiones`,
  },
  {
    id: 'league',
    name: 'Campeón de liga',
    emoji: '🏆',
    // 2 = Plata, 3 = Oro, 4 = Diamante (índice en DIVISIONS + 1); son los únicos niveles
    threshold: (k) => (k < 3 ? k + 2 : Infinity),
    stat: (s) => s.league.best + 1,
    desc: (v) => (Number.isFinite(v) ? `Termina una semana en la liga ${['Plata', 'Oro', 'Diamante'][v - 2]}` : '¡Llegaste a Diamante!'),
  },
  {
    id: 'trader',
    name: 'Lobo de la bolsa',
    emoji: '📈',
    threshold: (k) => 10 ** (3 + 3 * k),
    stat: (s) => s.stockProfit,
    desc: (v) => `Gana ${fmt(v)} monedas en la bolsa`,
  },
  {
    id: 'wheel',
    name: 'Afortunado',
    emoji: '🎡',
    threshold: (k) => 5 * 3 ** k,
    stat: (s) => s.wheelSpins,
    desc: (v) => `Gira la rueda ${fmt(v)} veces`,
  },
  {
    id: 'balloon',
    name: 'Cazaglobos',
    emoji: '🎈',
    threshold: (k) => 5 * 3 ** k,
    stat: (s) => s.balloons,
    desc: (v) => `Atrapa ${fmt(v)} globos dorados`,
  },
  {
    id: 'era',
    name: 'Refundador',
    emoji: '🌅',
    threshold: (k) => k + 2,
    stat: (s) => s.era,
    desc: (v) => `Llega a la era ${v}`,
  },
  {
    id: 'stars',
    name: 'Leyenda',
    emoji: '⭐',
    threshold: (k) => 10 * 3 ** k,
    stat: (s) => s.stars,
    desc: (v) => `Consigue ${fmt(v)} estrellas de legado`,
  },
];

export const ACHIEVEMENT_BONUS = 0.02;

export function achievementReached(def: AchievementDef, s: GameState): number {
  const v = def.stat(s);
  let k = 0;
  while (k < 400 && def.threshold(k) <= v) k++;
  return k;
}

export function achievementClaimed(s: GameState, id: string): number {
  return s.achievements[id] ?? 0;
}

export function achievementGems(k: number): number {
  return Math.min(10, 1 + Math.floor(k / 2));
}

export function claimableAchievements(s: GameState): number {
  let n = 0;
  for (const a of ACHIEVEMENTS) n += Math.max(0, achievementReached(a, s) - achievementClaimed(s, a.id));
  return n;
}

export function totalAchievements(s: GameState): number {
  let n = 0;
  for (const a of ACHIEVEMENTS) n += achievementClaimed(s, a.id);
  return n;
}

// =====================================================================
// Cálculos derivados
// =====================================================================

function countUpgrades(s: GameState, pred: (e: UpgradeEffect) => boolean): number {
  let n = 0;
  for (const id of s.upgrades) {
    const u = UPGRADE_BY_ID.get(id);
    if (u && pred(u.effect)) n++;
  }
  return n;
}

export function totalBuildings(s: GameState): number {
  let n = 0;
  for (const b of BUILDINGS) n += s.buildings[b.id] ?? 0;
  return n;
}

export function buildingMultiplier(s: GameState, buildingId: string): number {
  const upgrades = countUpgrades(s, (e) => e.type === 'building' && e.building === buildingId);
  return 2 ** (upgrades + milestoneCount(s.buildings[buildingId] ?? 0));
}

export function buildingProduction(s: GameState, def: BuildingDef): number {
  return def.baseProd * (s.buildings[def.id] ?? 0) * buildingMultiplier(s, def.id);
}

/** Todos los multiplicadores permanentes juntos (sin boosts temporales). */
export function globalMultiplier(s: GameState): number {
  let m = 1 + 0.25 * gemLevel(s, 'prod');
  for (const r of RARE) if (s.rare.includes(r.id)) m *= 1 + r.bonus;
  m *= 1 + STAR_BONUS * s.stars;
  m *= 1 + ACHIEVEMENT_BONUS * totalAchievements(s);
  m *= 1.15 ** legacyLevel(s, 'productividad');
  return m;
}

export function boostMultiplier(s: GameState, t: number): number {
  let m = 1;
  for (const b of s.boosts) if (t < b.u) m *= b.m;
  return m;
}

export function boostRemainingMs(s: GameState, t: number): number {
  let r = 0;
  for (const b of s.boosts) if (t < b.u) r = Math.max(r, b.u - t);
  return r;
}

export function isBoosted(s: GameState, t: number): boolean {
  return boostMultiplier(s, t) > 1;
}

/** Añade un boost. La misma fuente no se multiplica consigo misma: toma el mayor y alarga la duración. */
export function addBoost(s: GameState, t: number, k: string, m: number, seconds: number, capSeconds = 1800): Boost[] {
  const active = s.boosts.filter((b) => b.u > t);
  const existing = active.find((b) => b.k === k);
  const others = active.filter((b) => b !== existing);
  const start = existing ? existing.u : t;
  return [
    ...others,
    { k, m: existing ? Math.max(existing.m, m) : m, u: Math.min(start + seconds * 1000, t + capSeconds * 1000) },
  ];
}

export function isTapBoosted(s: GameState, t: number): boolean {
  return t < s.tapBoostUntil && s.tapBoostMult > 1;
}

export function productionPerSec(s: GameState, t: number, withBoost = true): number {
  let base = 0;
  for (const b of BUILDINGS) base += buildingProduction(s, b);
  const boost = withBoost ? boostMultiplier(s, t) : 1;
  return base * globalMultiplier(s) * boost * lawMult(s, 'prod');
}

export function tapValue(s: GameState, t: number): number {
  const mult = 2 ** (countUpgrades(s, (e) => e.type === 'tapMult') + legacyLevel(s, 'dedos'));
  const pct = 0.01 * countUpgrades(s, (e) => e.type === 'tapPct');
  const boost = boostMultiplier(s, t);
  const fest = isTapBoosted(s, t) ? s.tapBoostMult : 1;
  return (mult * globalMultiplier(s) * boost + productionPerSec(s, t) * pct) * fest * lawMult(s, 'tap');
}

export function critChance(s: GameState): number {
  return 0.04 + 0.01 * legacyLevel(s, 'suerte') + lawAdd(s, 'crit');
}

export function autoTapsPerSec(s: GameState): number {
  return 2 * legacyLevel(s, 'asistente');
}

/** Factor (<1) que acorta el tiempo entre globos dorados y decretos. */
export function eventFrequency(s: GameState): number {
  return 0.88 ** legacyLevel(s, 'cielo') * lawMult(s, 'events');
}

export function maxTickets(s: GameState): number {
  return 5 + gemLevel(s, 'tickets') + legacyLevel(s, 'taquilla');
}

export function ticketRegenMs(s: GameState): number {
  return 20 * 60_000 * 0.9 ** gemLevel(s, 'regen') * lawMult(s, 'ticketRegen');
}

export function offlineCapSeconds(s: GameState): number {
  return (2 + gemLevel(s, 'offline') + lawAdd(s, 'offlineHours')) * 3600;
}

export function offlineEfficiency(s: GameState): number {
  // Nunca más del 100%: cerrar la app no debe rendir más que jugar
  return Math.min(1, (OFFLINE_EFFICIENCY + 0.1 * gemLevel(s, 'offlineEff')) * lawMult(s, 'offlineEff'));
}

/** Recarga tickets según el tiempo transcurrido. */
export function regenTickets(s: GameState, t: number): Pick<GameState, 'tickets' | 'ticketTime'> {
  const max = maxTickets(s);
  if (s.tickets >= max) return { tickets: s.tickets, ticketTime: t };
  const regen = ticketRegenMs(s);
  const n = Math.floor((t - s.ticketTime) / regen);
  // Nunca se mueve hacia atrás (si el reloj retrocede, simplemente no se recarga nada)
  if (n <= 0) return { tickets: s.tickets, ticketTime: s.ticketTime };
  const tickets = Math.min(max, s.tickets + n);
  return { tickets, ticketTime: tickets >= max ? t : s.ticketTime + n * regen };
}

export function isBuildingEraLocked(s: GameState, index: number): boolean {
  return BUILDINGS[index].era > s.era;
}

export function isBuildingVisible(s: GameState, index: number): boolean {
  const b = BUILDINGS[index];
  if (isBuildingEraLocked(s, index)) return false;
  if ((s.buildings[b.id] ?? 0) > 0 || index === 0) return true;
  const prev = BUILDINGS[index - 1];
  return (s.buildings[prev.id] ?? 0) > 0 || s.totalEarned >= b.baseCost * 0.5;
}

export function availableUpgrades(s: GameState): UpgradeDef[] {
  const owned = new Set(s.upgrades);
  return UPGRADES.filter((u) => !owned.has(u.id) && u.unlocked(s)).sort((a, b) => a.cost - b.cost);
}

export function affordableShopItems(items: ShopItemDef[], level: (id: string) => number, budget: number) {
  return items.filter((i) => level(i.id) < i.max && budget >= i.cost(level(i.id))).length;
}
