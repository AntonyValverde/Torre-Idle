import { reducedMotion, toScreenSpace, type View } from './stage';

// Efectos de los shooters: partículas, textos flotantes, sacudida de pantalla y destellos. Son solo
// visuales (no cambian la partida), así que viven en la vista y usan Math.random.

export const FONT = "'Baloo 2', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  shape: 'dot' | 'spark' | 'square' | 'ring';
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  max: number;
}

export interface BurstOpts {
  n?: number;
  colors?: string[];
  /** Velocidad máxima (unidades/s). */
  speed?: number;
  /** Vida (ms). */
  life?: number;
  size?: number;
  gravity?: number;
  drag?: number;
  shape?: Particle['shape'];
  /** Dirección media (rad) y apertura; sin ella sale en todas direcciones. */
  angle?: number;
  spread?: number;
}

const MAX_PARTICLES = 450;

export class Fx {
  parts: Particle[] = [];
  texts: FloatText[] = [];
  private shakeMs = 0;
  private shakeMag = 0;
  private flashMs = 0;
  private flashMax = 1;
  private flashColor = '#fff';
  private still = reducedMotion();

  burst(x: number, y: number, o: BurstOpts = {}) {
    const n = Math.min(o.n ?? 10, MAX_PARTICLES - this.parts.length);
    const colors = o.colors ?? ['#ffe066', '#ffffff'];
    const sp = o.speed ?? 90;
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread ?? 1) : Math.random() * Math.PI * 2;
      const v = sp * (0.3 + Math.random() * 0.7);
      const life = (o.life ?? 450) * (0.6 + Math.random() * 0.4);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        max: life,
        size: (o.size ?? 2) * (0.6 + Math.random() * 0.6),
        color: colors[i % colors.length],
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 2.5,
        shape: o.shape ?? 'dot',
      });
    }
  }

  /** Onda que se expande (impactos grandes, explosiones). */
  ring(x: number, y: number, color: string, size = 14, life = 320) {
    if (this.parts.length >= MAX_PARTICLES) return;
    this.parts.push({ x, y, vx: 0, vy: 0, life, max: life, size, color, gravity: 0, drag: 0, shape: 'ring' });
  }

  text(x: number, y: number, text: string, color = '#ffe066', size = 9, life = 800) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life, max: life });
  }

  shake(mag: number, ms = 250) {
    if (this.still) return;
    if (mag >= this.shakeMag || this.shakeMs <= 0) {
      this.shakeMag = mag;
      this.shakeMs = ms;
    }
  }

  flash(color: string, ms = 160) {
    this.flashColor = color;
    this.flashMs = ms;
    this.flashMax = ms;
  }

  update(dt: number) {
    const s = dt / 1000;
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.gravity * s;
      const k = Math.max(0, 1 - p.drag * s);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 18 * s;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shakeMs = Math.max(0, this.shakeMs - dt);
    this.flashMs = Math.max(0, this.flashMs - dt);
  }

  /** Desplazamiento de la sacudida (aplícalo antes de dibujar el mundo). */
  offset(): { x: number; y: number } {
    if (this.shakeMs <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * Math.min(1, this.shakeMs / 120);
    return { x: (Math.random() - 0.5) * 2 * m, y: (Math.random() - 0.5) * 2 * m };
  }

  /** Partículas y textos, en unidades del juego. */
  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = p.shape === 'ring' ? a * 0.8 : Math.min(1, a * 1.4);
      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * a + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.15 - a), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      } else if (p.shape === 'square') {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const t of this.texts) {
      const a = t.life / t.max;
      const pop = a > 0.85 ? 1 + (a - 0.85) * 2.5 : 1;
      label(ctx, t.text, t.x, t.y, { size: t.size * pop, color: t.color, alpha: Math.min(1, a * 2.5) });
    }
  }

  /** Destello de pantalla completa (golpes recibidos, bombas). Va encima de todo. */
  drawFlash(ctx: CanvasRenderingContext2D, v: View) {
    if (this.flashMs <= 0) return;
    toScreenSpace(ctx, v);
    ctx.globalAlpha = 0.45 * (this.flashMs / this.flashMax);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, v.cw, v.ch);
    ctx.globalAlpha = 1;
  }
}

/** Texto con borde oscuro, legible sobre cualquier fondo. */
export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { size?: number; color?: string; align?: CanvasTextAlign; alpha?: number; weight?: number; stroke?: string } = {},
) {
  const size = o.size ?? 9;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.font = `${o.weight ?? 800} ${size}px ${FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, size * 0.28);
  ctx.strokeStyle = o.stroke ?? 'rgba(8, 6, 24, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = o.color ?? '#fff';
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Sprites: cada dibujo se pinta una vez en un canvas aparte y luego se copia (mucho más rápido que
// repetir los trazos de cada enemigo en cada fotograma).
// ---------------------------------------------------------------------------------------------

const sprites = new Map<string, HTMLCanvasElement>();

/**
 * Sprite de `w`×`h` unidades del juego, pintado con `paint` en un lienzo con origen en el centro.
 * `res` son píxeles por unidad (4 se ve nítido en móviles con pantalla densa).
 */
export function sprite(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void, res = 4): HTMLCanvasElement {
  const k = `${key}|${w}|${h}|${res}`;
  let c = sprites.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext('2d');
  if (g) {
    g.scale(res, res);
    g.translate(w / 2, h / 2);
    paint(g);
  }
  sprites.set(k, c);
  return c;
}

/** Copia un sprite centrado en (x, y), girado `rot` rad. */
export function drawSprite(ctx: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, y: number, w: number, h: number, rot = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else ctx.drawImage(spr, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 1;
}

/** Barra de vida pequeña sobre un enemigo (solo si está herido). */
export function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color = '#ff5a5f') {
  if (frac >= 1 || frac <= 0) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x - w / 2 - 0.5, y - 0.5, w + 1, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * frac, 2);
}

/** Círculo relleno (atajo). */
export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
