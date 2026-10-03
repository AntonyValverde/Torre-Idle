import { hashString, mulberry32 } from '../minigames/rng';

// Mapa del mundo: todas las ciudades públicas sobre unos continentes fijos. El mapa y la posición de
// cada ciudad salen de semillas (la de cada ciudad, de su UID): todos los móviles ven lo mismo y una
// ciudad siempre está en el mismo sitio, aunque aparezcan otras.

/** Tamaño del mapa en unidades del dibujo (vertical, para que llene la pantalla del móvil). */
export const WORLD_W = 800;
export const WORLD_H = 1100;

/** Una ciudad sin actividad en tantos días se dibuja apagada. */
export const DORMANT_MS = 7 * 86_400_000;

export interface LandBlob {
  x: number;
  y: number;
  r: number;
}

/** Centros de los continentes: cada uno es un racimo de círculos alrededor de su centro. */
const CONTINENTS = [
  { x: 250, y: 260, size: 150, n: 7 },
  { x: 560, y: 420, size: 140, n: 6 },
  { x: 300, y: 690, size: 160, n: 8 },
  { x: 600, y: 860, size: 120, n: 5 },
];

function makeLand(): LandBlob[] {
  const rand = mulberry32(hashString('infinite-city:mundo'));
  const blobs: LandBlob[] = [];
  for (const c of CONTINENTS) {
    blobs.push({ x: c.x, y: c.y, r: c.size * 0.75 });
    for (let i = 0; i < c.n; i++) {
      const a = rand() * Math.PI * 2;
      const d = c.size * (0.35 + rand() * 0.55);
      blobs.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, r: c.size * (0.3 + rand() * 0.3) });
    }
  }
  // Islas pequeñas sueltas
  for (let i = 0; i < 9; i++) blobs.push({ x: 60 + rand() * (WORLD_W - 120), y: 60 + rand() * (WORLD_H - 120), r: 18 + rand() * 22 });
  return blobs;
}

export const LAND: LandBlob[] = makeLand();

/** ¿El punto está en tierra, con al menos `margin` de costa alrededor? */
export function onLand(x: number, y: number, margin = 0): boolean {
  return LAND.some((b) => Math.hypot(x - b.x, y - b.y) <= b.r - margin);
}

/** Posición fija de una ciudad en el mapa (siempre en tierra y dentro del mapa). */
export function cityPosition(uid: string): { x: number; y: number } {
  const rand = mulberry32(hashString('mundo:' + uid));
  for (let i = 0; i < 400; i++) {
    const x = 30 + rand() * (WORLD_W - 60);
    const y = 30 + rand() * (WORLD_H - 60);
    if (onLand(x, y, 14)) return { x: Math.round(x), y: Math.round(y) };
  }
  const c = CONTINENTS[hashString(uid) % CONTINENTS.length];
  return { x: c.x, y: c.y };
}

/** Adornos del mapa (árboles y montañas), siempre en los mismos sitios. */
export function landDecor(count = 40): { x: number; y: number; kind: 'tree' | 'mountain' }[] {
  const rand = mulberry32(hashString('mundo:adornos'));
  const out: { x: number; y: number; kind: 'tree' | 'mountain' }[] = [];
  for (let i = 0; i < 2000 && out.length < count; i++) {
    const x = rand() * WORLD_W;
    const y = rand() * WORLD_H;
    if (onLand(x, y, 20)) out.push({ x, y, kind: rand() < 0.3 ? 'mountain' : 'tree' });
  }
  return out;
}

/** Radio del marcador de una ciudad (en píxeles de pantalla): crece con la era. */
export function markerRadius(era: number): number {
  return 6 + Math.min(8, Math.max(0, Math.floor(era) - 1));
}

export function isDormant(updatedAt: number | null | undefined, t: number): boolean {
  return !!updatedAt && t - updatedAt > DORMANT_MS;
}

export interface Cluster<T> {
  x: number;
  y: number;
  items: T[];
}

/**
 * Agrupa los puntos que quedan a menos de `radius` (en unidades del mapa) del primero de un grupo, para
 * que muchas ciudades juntas no se tapen. Los marcados con `alone` (tu ciudad) nunca se agrupan.
 * El grupo se dibuja en la media de sus puntos.
 */
export function clusterPoints<T extends { x: number; y: number; alone?: boolean }>(points: T[], radius: number): Cluster<T>[] {
  const out: (Cluster<T> & { ax: number; ay: number })[] = [];
  for (const p of points) {
    const near = p.alone ? null : out.find((c) => !c.items[0].alone && Math.hypot(c.ax - p.x, c.ay - p.y) < radius);
    if (near) near.items.push(p);
    else out.push({ x: p.x, y: p.y, ax: p.x, ay: p.y, items: [p] });
  }
  return out.map(({ items }) => ({ items, x: items.reduce((n, p) => n + p.x, 0) / items.length, y: items.reduce((n, p) => n + p.y, 0) / items.length }));
}

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Como mucho se acerca hasta ver esta anchura del mapa, y como poco se ve el mapa entero. */
export const MIN_VIEW_W = 160;

/** Ajusta una vista a los límites: ni más zoom del permitido ni salirse del mapa. `aspect` = alto / ancho. */
export function clampView(v: View, aspect: number): View {
  const maxW = Math.max(WORLD_W, WORLD_H / aspect);
  const w = Math.min(maxW, Math.max(MIN_VIEW_W, v.w));
  const h = w * aspect;
  // Si la vista es más grande que el mapa, el mapa queda centrado
  const x = w >= WORLD_W ? (WORLD_W - w) / 2 : Math.min(WORLD_W - w, Math.max(0, v.x));
  const y = h >= WORLD_H ? (WORLD_H - h) / 2 : Math.min(WORLD_H - h, Math.max(0, v.y));
  return { x, y, w, h };
}

/** Acerca o aleja la vista `factor` veces (>1 acerca) dejando quieto el punto (cx, cy) del mapa. */
export function zoomView(v: View, factor: number, cx: number, cy: number, aspect: number): View {
  const w = v.w / factor;
  const k = w / v.w;
  return clampView({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: w * aspect }, aspect);
}
