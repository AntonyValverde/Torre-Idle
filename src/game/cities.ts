import { BUILDINGS, totalBuildings } from './economy';
import type { GameState } from './state';

// Ciudad pública: lo justo para dibujar la ciudad de otro jugador cuando la visitas.

export interface CitySnapshot {
  name: string;
  era: number;
  /** Tamaño de cada tipo de edificio en la escena (0–4), en el orden de BUILDINGS. */
  layout: string;
  buildings: number;
  earned: number;
  stars: number;
}

/**
 * Cuántos edificios de cada tipo se dibujan: 0 si no hay, y luego 1–4 según la cantidad
 * (1, 2–3, 4–7, 8 o más). Es lo único que necesita la escena.
 */
export function cityLayout(buildings: Record<string, number>): string {
  return BUILDINGS.map((b) => {
    const n = buildings[b.id] ?? 0;
    return n ? Math.min(4, 1 + Math.floor(Math.log2(n))) : 0;
  }).join(',');
}

export function citySnapshot(s: GameState): CitySnapshot {
  return {
    name: s.name,
    era: Math.max(1, Math.floor(s.era)),
    layout: cityLayout(s.buildings),
    buildings: Math.floor(totalBuildings(s)),
    earned: Math.floor(s.allTimeEarned),
    stars: Math.floor(s.stars),
  };
}

/** Valida una ciudad leída de la nube (puede venir de una versión vieja del juego). */
export function parseLayout(v: unknown): string | null {
  return typeof v === 'string' && /^[0-4](,[0-4]){0,31}$/.test(v) ? v : null;
}

/** Enlace para compartir la ciudad: al abrirlo, el juego muestra esa ciudad. */
export function cityLink(uid: string, origin = location.origin): string {
  return `${origin}/?ciudad=${encodeURIComponent(uid)}`;
}

/** UID de la ciudad que pide el enlace con el que se abrió el juego, si lo hay. */
export function cityFromUrl(search = location.search): string | null {
  const uid = new URLSearchParams(search).get('ciudad');
  return uid && /^[A-Za-z0-9]{10,64}$/.test(uid) ? uid : null;
}
