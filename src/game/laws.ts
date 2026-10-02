import { hashString, mulberry32 } from '../minigames/rng';
import type { GameState } from './state';

// Leyes de era: al refundar (desde la era 2) el alcalde elige una ley entre tres. Cada ley tiene una
// ventaja y una desventaja, y rige hasta la siguiente refundación. Las tres opciones salen del número
// de era, así que todos los que están en la misma era eligen entre las mismas.

/** Efectos de una ley. Los multiplicadores valen 1 si la ley no los toca; los sumandos, 0. */
export interface LawEffects {
  /** Producción pasiva. */
  prod?: number;
  /** Valor de cada toque. */
  tap?: number;
  /** Probabilidad de crítico (se suma). */
  crit?: number;
  /** Coste de los edificios. */
  buildCost?: number;
  /** Coste de las mejoras con monedas. */
  upgradeCost?: number;
  /** Tiempo entre globos, decretos e incidentes (menos = más seguido). */
  events?: number;
  /** Eficiencia de las ganancias offline. */
  offlineEff?: number;
  /** Horas extra de tope offline (se suman). */
  offlineHours?: number;
  /** Monedas de los minijuegos arcade. */
  arcadeCoins?: number;
  /** Tiempo de recarga de los tickets (menos = más rápido). */
  ticketRegen?: number;
  /** Bono diario de fichas del casino. */
  casinoBonus?: number;
  /** Precio en monedas de las fichas del casino. */
  chipPrice?: number;
}

type MultKey = Exclude<keyof LawEffects, 'crit' | 'offlineHours'>;
type AddKey = 'crit' | 'offlineHours';

export interface LawDef {
  id: string;
  emoji: string;
  name: string;
  pro: string;
  con: string;
  fx: LawEffects;
}

export const LAWS: LawDef[] = [
  { id: 'industrial', emoji: '🏭', name: 'Ciudad industrial', pro: 'Producción x1.75', con: 'Toques ÷2', fx: { prod: 1.75, tap: 0.5 } },
  {
    id: 'activa',
    emoji: '👆',
    name: 'Ciudad activa',
    pro: 'Toques x5 y +5% de críticos',
    con: 'Ganancias offline a la mitad',
    fx: { tap: 5, crit: 0.05, offlineEff: 0.5 },
  },
  {
    id: 'turistica',
    emoji: '🎈',
    name: 'Ciudad turística',
    pro: 'Globos, decretos e incidentes el doble de seguido',
    con: 'Edificios 15% más caros',
    fx: { events: 0.5, buildCost: 1.15 },
  },
  {
    id: 'tecnologica',
    emoji: '🔬',
    name: 'Ciudad tecnológica',
    pro: 'Mejoras 75% más baratas',
    con: 'Producción x0.85',
    fx: { upgradeCost: 0.25, prod: 0.85 },
  },
  {
    id: 'ludica',
    emoji: '🎮',
    name: 'Ciudad lúdica',
    pro: 'Monedas de los arcade x2',
    con: 'Edificios 15% más caros',
    fx: { arcadeCoins: 2, buildCost: 1.15 },
  },
  {
    id: 'nocturna',
    emoji: '🌙',
    name: 'Ciudad nocturna',
    pro: 'Offline: +50% de eficiencia (hasta el 100%) y +4 h de tope',
    con: 'Toques ÷2',
    fx: { offlineEff: 1.5, offlineHours: 4, tap: 0.5 },
  },
  {
    id: 'constructora',
    emoji: '🏗️',
    name: 'Ciudad constructora',
    pro: 'Edificios 25% más baratos',
    con: 'Mejoras el doble de caras',
    fx: { buildCost: 0.75, upgradeCost: 2 },
  },
  {
    id: 'feria',
    emoji: '🎟️',
    name: 'Ciudad de feria',
    pro: 'Tickets se recargan el doble de rápido',
    con: 'Producción x0.9',
    fx: { ticketRegen: 0.5, prod: 0.9 },
  },
  {
    id: 'azar',
    emoji: '🎰',
    name: 'Ciudad del azar',
    pro: 'Casino: bono diario x3 y fichas 30% más baratas',
    con: 'Edificios 10% más caros',
    fx: { casinoBonus: 3, chipPrice: 0.7, buildCost: 1.1 },
  },
];

export const LAW_BY_ID = new Map(LAWS.map((l) => [l.id, l]));

/** Era desde la que se eligen leyes (la primera se elige al refundar por primera vez). */
export const LAW_FROM_ERA = 2;

/** Las tres leyes que se pueden elegir en una era: las mismas para todos. */
export function lawOptions(era: number): LawDef[] {
  const rand = mulberry32(hashString('leyes:' + era));
  const pool = LAWS.slice();
  const out: LawDef[] = [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export function currentLaw(s: GameState): LawDef | null {
  return (s.law && LAW_BY_ID.get(s.law)) || null;
}

/** Hay que elegir la ley de esta era. */
export function lawPending(s: GameState): boolean {
  return s.era >= LAW_FROM_ERA && !currentLaw(s);
}

export function lawMult(s: GameState, key: MultKey): number {
  return currentLaw(s)?.fx[key] ?? 1;
}

export function lawAdd(s: GameState, key: AddKey): number {
  return currentLaw(s)?.fx[key] ?? 0;
}
