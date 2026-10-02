// Incidentes en la ciudad: de vez en cuando pasa algo en la escena (un incendio, un ladrón, un atasco…).
// Tocarlo abre el minijuego que lo resuelve gratis y con premio extra; si se ignora, la ciudad
// produce un poco menos durante un rato.

export type IncidentKind = 'fire' | 'thief' | 'traffic' | 'metro';

export interface IncidentDef {
  kind: IncidentKind;
  emoji: string;
  title: string;
  /** Lo que pasa si nadie lo atiende. */
  missed: string;
}

export const INCIDENTS: Record<IncidentKind, IncidentDef> = {
  fire: { kind: 'fire', emoji: '🔥', title: '¡Incendio!', missed: 'El incendio se apagó solo, pero dejó daños' },
  thief: { kind: 'thief', emoji: '🦹', title: '¡Un ladrón!', missed: 'El ladrón escapó y los vecinos están nerviosos' },
  traffic: { kind: 'traffic', emoji: '🚦', title: '¡Atasco!', missed: 'El atasco paralizó la ciudad un rato' },
  metro: { kind: 'metro', emoji: '🚇', title: '¡Hora punta!', missed: 'El metro colapsó en hora punta' },
};

export const INCIDENT_KINDS = Object.keys(INCIDENTS) as IncidentKind[];

/** Tiempo para atenderlo antes de que cause daños. */
export const INCIDENT_LIFE_MS = 90_000;
/** Multiplicador de las monedas del minijuego si se juega para resolver un incidente. */
export const INCIDENT_BONUS = 1.5;
/** Si se ignora: producción x0.85 durante 2 minutos (como un boost negativo). */
export const INCIDENT_PENALTY = { mult: 0.85, seconds: 120 };
/** Clave del boost de la penalización (fuente propia: se alarga en vez de acumularse). */
export const INCIDENT_PENALTY_KEY = 'incidente';

/** Milisegundos hasta el próximo incidente: entre 6 y 10 minutos, más seguido con "Cielo festivo". */
export function nextIncidentDelay(rand: () => number, frequency: number): number {
  return (360_000 + rand() * 240_000) * frequency;
}

export interface Incident {
  kind: IncidentKind;
  /** Posición horizontal en la escena (% del ancho). */
  x: number;
  expires: number;
}

/** Un incidente nuevo, distinto del anterior para que no se repita seguido. */
export function newIncident(t: number, rand: () => number, last: IncidentKind | null = null): Incident {
  const pool = INCIDENT_KINDS.filter((k) => k !== last);
  return { kind: pool[Math.floor(rand() * pool.length)], x: 18 + rand() * 64, expires: t + INCIDENT_LIFE_MS };
}
