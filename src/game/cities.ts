import { BUILDINGS, totalBuildings } from './economy';
import { PASS_DECOS } from './pass';
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
  /** Copas ganadas: "oro,plata,bronce,temporadas". */
  cups: string;
  /** Regalos recibidos de otros alcaldes (❤️). Solo se envía si hay alguno. */
  gifts?: number;
  /** Temporadas de Conquista ganadas (banderas azules). Solo se envía si hay alguna. */
  conq?: number;
  /** Cosméticos del pase de temporada ("zeppelin,aurora"). Solo se envía si hay alguno. */
  deco?: string;
}

const DECO_RE = /^[a-z]{3,12}(,[a-z]{3,12}){0,3}$/;

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
    cups: [s.cup.gold, s.cup.silver, s.cup.bronze, s.cup.seasons].map((n) => Math.min(99999, Math.floor(n))).join(','),
    ...(s.social.received > 0 ? { gifts: Math.min(10_000_000, Math.floor(s.social.received)) } : {}),
    ...(s.conquest.wins > 0 ? { conq: Math.min(10_000, Math.floor(s.conquest.wins)) } : {}),
    ...(s.pass.decos.length ? { deco: s.pass.decos.slice(0, 4).join(',') } : {}),
  };
}

/** Cosméticos de una ciudad leída de la nube: solo los que existen en esta versión del juego. */
export function parseDecos(v: unknown): string[] {
  if (typeof v !== 'string' || !DECO_RE.test(v)) return [];
  return v.split(',').filter((d) => d in PASS_DECOS);
}

/** Copas de una ciudad leída de la nube: oro, plata, bronce y temporadas (las versiones viejas no las tienen). */
export function parseCups(v: unknown): [number, number, number, number] {
  if (typeof v !== 'string' || !/^[0-9]{1,5}(,[0-9]{1,5}){2,3}$/.test(v)) return [0, 0, 0, 0];
  const [g, s, b, t = 0] = v.split(',').map(Number);
  return [g, s, b, t];
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
