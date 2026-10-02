// Cohete: el multiplicador sube desde x1 hasta que el cohete explota. Hay que cobrar antes.
// El punto de explosión se decide al despegar: P(llegar a x m) = 0,96 / m, así que cobrar en
// cualquier multiplicador devuelve ≈ 96% a la larga. Un 4% de los cohetes explota al despegar.

export const ROCKET_EDGE = 0.96;
export const ROCKET_MAX = 100;
/** El multiplicador se duplica cada 6 segundos. */
const K = Math.LN2 / 6000;

export interface RocketRun {
  bet: number;
  /** Multiplicador en el que explota. */
  crash: number;
  /** Momento del despegue (hora de confianza). */
  start: number;
  /** Cobro automático (0 = sin cobro automático). */
  auto: number;
}

export function crashPoint(rand: () => number): number {
  const u = rand();
  const m = Math.floor((100 * ROCKET_EDGE) / (1 - u)) / 100;
  return Math.max(1, Math.min(ROCKET_MAX, m));
}

/** Multiplicador tras `ms` de vuelo (sin redondear). */
export function rocketMult(ms: number): number {
  return Math.exp(K * Math.max(0, ms));
}

/** Milisegundos hasta llegar a un multiplicador. */
export function msToMult(m: number): number {
  return Math.log(Math.max(1, m)) / K;
}

/** Multiplicador a cobrar en el instante t; null si el cohete ya explotó. */
export function cashMultAt(run: RocketRun, t: number): number | null {
  const m = Math.floor(rocketMult(t - run.start) * 100) / 100;
  if (run.auto > 1 && run.auto < run.crash && m >= run.auto) return run.auto;
  return m < run.crash ? m : null;
}

/** El vuelo ya terminó solo (por explosión o por cobro automático) en el instante t. */
export function rocketOver(run: RocketRun, t: number): boolean {
  const end = run.auto > 1 && run.auto < run.crash ? run.auto : run.crash;
  return rocketMult(t - run.start) >= end;
}

/** Lo que se cobra al terminar el vuelo solo: el cobro automático si llegó, o nada. */
export function rocketAutoPay(run: RocketRun): number {
  return run.auto > 1 && run.auto < run.crash ? Math.floor(run.bet * run.auto) : 0;
}
