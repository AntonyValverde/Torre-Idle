import { hashString, mulberry32 } from '../minigames/rng';
import { productionPerSec } from './economy';
import type { GameState } from './state';

// Bolsa de la ciudad. El precio de cada empresa es una función determinista del tiempo:
// suma de ondas de distintos periodos (de minutos a días) más un pequeño ruido por minuto.
// Así todos los jugadores ven el mismo mercado a la vez, se mueve aunque nadie juegue,
// y el precio siempre vuelve hacia su media (no se puede crecer sin límite).

export interface StockDef {
  id: string;
  name: string;
  emoji: string;
  /** Volatilidad: amplitud máxima del logaritmo del precio (0.5 ≈ entre x0.6 y x1.6). */
  vol: number;
  base: number;
  desc: string;
}

export const STOCKS: StockDef[] = [
  { id: 'BNC', name: 'Banco Central', emoji: '🏦', vol: 0.35, base: 100, desc: 'Estable y aburrido. Riesgo bajo.' },
  { id: 'FAB', name: 'Fábricas Unidas', emoji: '🏭', vol: 0.55, base: 80, desc: 'Sube y baja con la producción.' },
  { id: 'PRT', name: 'Portal Inc.', emoji: '🌀', vol: 0.75, base: 150, desc: 'Tecnología dimensional. Riesgo medio.' },
  { id: 'COH', name: 'Cohetes Galácticos', emoji: '🚀', vol: 0.95, base: 60, desc: 'Muy volátil. O a la luna o al suelo.' },
  { id: 'OVN', name: 'OVNI Corp', emoji: '🛸', vol: 1.15, base: 40, desc: 'Especulación pura. Solo para valientes.' },
];

export const STOCK_BY_ID = new Map(STOCKS.map((s) => [s.id, s]));

/** Comisión por operación (compra o venta): evita comprar y vender sin parar por el ruido. */
export const STOCK_FEE = 0.03;

// Las ondas cortas son pequeñas (menos que la comisión de ida y vuelta): no se puede
// ganar comprando y vendiendo cada pocos minutos. Las oportunidades reales duran horas o días.
const PERIODS_MIN = [7, 23, 71, 240, 900, 3100];
const WEIGHTS = [0.012, 0.02, 0.06, 0.16, 0.3, 0.4];

/** Máximo que se puede tener invertido: 2 horas de tu producción (mínimo 10K). */
export function stockInvestCap(s: GameState, t: number): number {
  return Math.max(10_000, productionPerSec(s, t, false) * 7200);
}

export function investedTotal(s: GameState): number {
  let n = 0;
  for (const h of Object.values(s.stocks)) n += h.c;
  return n;
}

interface Wave {
  amp: number;
  period: number;
  phase: number;
}

const waveCache = new Map<string, { waves: Wave[]; seed: number }>();

function wavesFor(def: StockDef) {
  let w = waveCache.get(def.id);
  if (!w) {
    const seed = hashString('bolsa:' + def.id);
    const rand = mulberry32(seed);
    // Periodos ligeramente distintos por empresa para que no se muevan todas igual
    const waves = PERIODS_MIN.map((p, k) => ({
      amp: def.vol * WEIGHTS[k],
      period: p * (0.8 + rand() * 0.4),
      phase: rand() * Math.PI * 2,
    }));
    w = { waves, seed };
    waveCache.set(def.id, w);
  }
  return w;
}

function jitter(seed: number, minute: number): number {
  return mulberry32((seed ^ Math.imul(minute, 2654435761)) >>> 0)() - 0.5;
}

/** Precio de una empresa en el instante `ms` (hora de confianza). */
export function stockPrice(def: StockDef, ms: number): number {
  const { waves, seed } = wavesFor(def);
  const tMin = ms / 60_000;
  let log = 0;
  for (const w of waves) log += w.amp * Math.sin((2 * Math.PI * tMin) / w.period + w.phase);
  // Ruido interpolado entre minutos para que la línea sea continua
  const m = Math.floor(tMin);
  const f = tMin - m;
  const n = jitter(seed, m) * (1 - f) + jitter(seed, m + 1) * f;
  log += n * def.vol * 0.02;
  return def.base * Math.exp(log);
}

export function priceHistory(def: StockDef, endMs: number, spanMs: number, points: number): { t: number; p: number }[] {
  const out: { t: number; p: number }[] = [];
  for (let i = 0; i < points; i++) {
    const t = endMs - spanMs + (spanMs * i) / (points - 1);
    out.push({ t, p: stockPrice(def, t) });
  }
  return out;
}

/** Unidades que se obtienen al invertir `coins` (ya descontada la comisión). */
export function unitsFor(coins: number, price: number): number {
  return (coins * (1 - STOCK_FEE)) / price;
}

/** Monedas que se reciben al vender `units` (ya descontada la comisión). */
export function saleValue(units: number, price: number): number {
  return units * price * (1 - STOCK_FEE);
}
