import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { mulberry32 } from '../rng';
import { Fx, drawSprite, label, sprite } from '../shooter/fx';
import { releaseInput, takeTaps, toWorldSpace, useInput, useStage, type View } from '../shooter/stage';
import { Banner, HudBar, Meter, PauseCard, ShopPanel, StartCard, useHud } from '../shooter/ShooterUI';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  BALLOON_R,
  BARREL,
  LAUNCHES,
  MAYOR_R,
  PERFECT_ANGLE,
  PERFECT_POWER,
  PIVOT_X,
  PIVOT_Y,
  SHOP,
  SHOP_MAX,
  buy,
  distance,
  fuelMax,
  leaveLanding,
  muzzle,
  newCannon,
  nextLaunch,
  score,
  shopCost,
  step,
  type CannonGame,
  type LaunchResult,
  type ShopId,
} from './logic';
import './cannon.css';

const FIELD_W = 360;
const FIELD_H = 640;
const FIELD = { w: FIELD_W, h: FIELD_H };
const INTRO_MS = 4200;
/** Dónde queda el alcalde en pantalla (x) y la línea del suelo con la cámara abajo (y), en unidades del campo. */
const ANCHOR_X = 120;
const GROUND_SY = FIELD_H - 92;
/** Zoom (unidades por metro): de cerca al apuntar y alejándose en vuelo. */
const Z_AIM = 4.5;
const Z_MAX = 4;
const Z_MIN = 2;
/** Píxeles por metro de los sprites del mundo. */
const RES = 10;
/** Espera tras pararse antes de enseñar el resultado (ms). */
const LAND_MS = 900;
const OVER_MS = 1600;

type Phase = 'intro' | 'play' | 'paused' | 'result' | 'shop' | 'over';

const summary = (g: CannonGame): WarSummary => ({
  score: score(g),
  detail: `Mejor intento: ${score(g)} m · ${g.launches.reduce((n, r) => n + r.earned, 0)} 🪙`,
});

interface Cam {
  x: number;
  y: number;
  z: number;
  /** Adelanto suavizado (unidades del campo) para ver lo que viene. */
  lead: number;
}

interface Hat {
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
}

/** Del mundo (m) al campo (unidades). */
const sx = (c: Cam, x: number) => ANCHOR_X + (x - c.x) * c.z;
const sy = (c: Cam, y: number) => GROUND_SY - (y - c.y) * c.z;

/** Transformación para dibujar en metros: el punto (x, y) del mundo se pinta en (x, -y). */
function worldSpace(ctx: CanvasRenderingContext2D, v: View, c: Cam, sh: { x: number; y: number }) {
  const k = v.dpr * v.scale;
  ctx.setTransform(k * c.z, 0, 0, k * c.z, v.dpr * v.ox + k * (ANCHOR_X - c.x * c.z + sh.x), v.dpr * v.oy + k * (GROUND_SY + c.y * c.z + sh.y));
}

// ---------------------------------------------------------------------------------------------
// Dibujos (los del mundo en metros, con el origen en el centro del sprite)
// ---------------------------------------------------------------------------------------------

function paintMayor(mode: 'fly' | 'dizzy' | 'aim') {
  const dizzy = mode === 'dizzy';
  return (c: CanvasRenderingContext2D) => {
    if (mode !== 'aim') paintLimbs(c);
    paintBody(c, dizzy);
  };
}

function paintLimbs(c: CanvasRenderingContext2D) {
  {
    // Brazos en alto (vuela de cabeza, como un superhéroe)
    c.strokeStyle = '#24305a';
    c.lineCap = 'round';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-2.6, -1.6);
    c.lineTo(-4.5, -4.4);
    c.moveTo(2.6, -1.6);
    c.lineTo(4.5, -4.4);
    c.stroke();
    c.fillStyle = '#ffffff';
    for (const x of [-4.6, 4.6]) {
      c.beginPath();
      c.arc(x, -4.6, 0.95, 0, Math.PI * 2);
      c.fill();
    }
    // Piernas y zapatos
    c.strokeStyle = '#1b2244';
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(-1.3, 2.8);
    c.lineTo(-1.6, 4.4);
    c.moveTo(1.3, 2.8);
    c.lineTo(1.6, 4.4);
    c.stroke();
    c.fillStyle = '#111';
    c.beginPath();
    c.ellipse(-1.9, 4.7, 1.1, 0.6, 0, 0, Math.PI * 2);
    c.ellipse(1.9, 4.7, 1.1, 0.6, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function paintBody(c: CanvasRenderingContext2D, dizzy: boolean) {
  {
    // Cuerpo redondo con traje
    const g = c.createRadialGradient(-1.2, -1.4, 0.5, 0, 0, 3.8);
    g.addColorStop(0, '#4a5c9e');
    g.addColorStop(1, '#25305e');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, 3.6, 3.5, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#141a38';
    c.lineWidth = 0.3;
    c.stroke();
    // Camisa y corbata
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(-1.2, -3.3);
    c.lineTo(1.2, -3.3);
    c.lineTo(0, -0.4);
    c.closePath();
    c.fill();
    c.fillStyle = '#e8283c';
    c.beginPath();
    c.moveTo(0, -3.1);
    c.lineTo(0.55, -2.5);
    c.lineTo(0.35, 0.4);
    c.lineTo(0, 1);
    c.lineTo(-0.35, 0.4);
    c.lineTo(-0.55, -2.5);
    c.closePath();
    c.fill();
    // Banda de alcalde
    c.save();
    c.beginPath();
    c.ellipse(0, 0, 3.6, 3.5, 0, 0, Math.PI * 2);
    c.clip();
    c.rotate(-0.75);
    c.fillStyle = '#ffc23d';
    c.fillRect(-5, 0.4, 10, 1.3);
    c.fillStyle = '#e8283c';
    c.fillRect(-5, 0.75, 10, 0.55);
    c.restore();
    // Botones dorados
    c.fillStyle = '#ffd76a';
    for (const y of [1.7, 2.6]) {
      c.beginPath();
      c.arc(-0.9, y, 0.25, 0, Math.PI * 2);
      c.fill();
    }
    // Cabeza
    c.fillStyle = '#ffd3ad';
    c.beginPath();
    c.arc(0, -5.2, 2.15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ff9f9f';
    c.globalAlpha = 0.6;
    c.beginPath();
    c.arc(-1.3, -4.6, 0.5, 0, Math.PI * 2);
    c.arc(1.3, -4.6, 0.5, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    // Ojos
    if (dizzy) {
      c.strokeStyle = '#1b1b2a';
      c.lineWidth = 0.32;
      for (const x of [-0.8, 0.8]) {
        c.beginPath();
        c.moveTo(x - 0.4, -6.0);
        c.lineTo(x + 0.4, -5.3);
        c.moveTo(x + 0.4, -6.0);
        c.lineTo(x - 0.4, -5.3);
        c.stroke();
      }
    } else {
      c.fillStyle = '#fff';
      for (const x of [-0.8, 0.8]) {
        c.beginPath();
        c.ellipse(x, -5.6, 0.55, 0.65, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#1b1b2a';
      for (const x of [-0.65, 0.95]) {
        c.beginPath();
        c.arc(x, -5.55, 0.3, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Bigote y boca
    c.fillStyle = '#5b3a24';
    c.beginPath();
    c.ellipse(-0.7, -4.45, 0.85, 0.42, 0.25, 0, Math.PI * 2);
    c.ellipse(0.7, -4.45, 0.85, 0.42, -0.25, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#7a1f2b';
    c.beginPath();
    if (dizzy) c.ellipse(0, -3.75, 0.45, 0.22, 0, 0, Math.PI * 2);
    else c.ellipse(0, -3.75, 0.55, 0.45, 0, 0, Math.PI);
    c.fill();
  }
}

function paintHat(c: CanvasRenderingContext2D) {
  // Chistera; el ala queda abajo (y = 1.6)
  c.fillStyle = '#16161f';
  c.beginPath();
  c.ellipse(0, 1.5, 2.6, 0.55, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#20202c';
  c.fillRect(-1.55, -1.9, 3.1, 3.4);
  c.fillStyle = '#e8283c';
  c.fillRect(-1.55, 0.55, 3.1, 0.65);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(-1.2, -1.7, 0.45, 2.2);
  c.fillStyle = '#2e2e3e';
  c.beginPath();
  c.ellipse(0, -1.9, 1.55, 0.35, 0, 0, Math.PI * 2);
  c.fill();
}

function paintBarrel(c: CanvasRenderingContext2D) {
  // Mira a la derecha; el eje del cañón está en x = -6 (centro del sprite en x = 0)
  c.translate(-6, 0);
  const g = c.createLinearGradient(0, -3.6, 0, 3.6);
  g.addColorStop(0, '#ff7a85');
  g.addColorStop(0.35, '#e8283c');
  g.addColorStop(1, '#8e1424');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-2.5, -2.9);
  c.lineTo(14, -3.4);
  c.lineTo(14, 3.4);
  c.lineTo(-2.5, 2.9);
  c.closePath();
  c.fill();
  // Aros dorados
  c.fillStyle = '#ffc23d';
  for (const x of [1.5, 6, 10.5]) c.fillRect(x, -3.2, 0.9, 6.4);
  // Estrellas
  c.fillStyle = '#fff3c4';
  for (const [x, y] of [
    [3.8, 0],
    [8.3, 0],
  ]) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.55 : 1.35;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  }
  // Boca
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.ellipse(14, 0, 1.1, 3.9, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2a0d14';
  c.beginPath();
  c.ellipse(14.2, 0, 0.6, 2.9, 0, 0, Math.PI * 2);
  c.fill();
  // Culata
  c.fillStyle = '#b81d30';
  c.beginPath();
  c.arc(-2.5, 0, 2.9, Math.PI / 2, (Math.PI * 3) / 2);
  c.fill();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.arc(-5.2, 0, 0.9, 0, Math.PI * 2);
  c.fill();
}

function paintStand(c: CanvasRenderingContext2D) {
  // Tambor de circo bajo el cañón: de y = -4 (eje) a y = 4 (suelo)
  const g = c.createLinearGradient(-6, 0, 6, 0);
  g.addColorStop(0, '#2b5fd9');
  g.addColorStop(0.5, '#5a8cff');
  g.addColorStop(1, '#1f45a8');
  c.fillStyle = g;
  c.fillRect(-6, -1.5, 12, 5.5);
  c.fillStyle = '#ffc23d';
  c.fillRect(-6.3, -2, 12.6, 1);
  c.fillRect(-6.3, 3.4, 12.6, 1);
  c.strokeStyle = '#fff';
  c.lineWidth = 0.35;
  c.beginPath();
  for (let x = -6; x < 6; x += 2) {
    c.moveTo(x, -1);
    c.lineTo(x + 2, 3.4);
    c.moveTo(x + 2, -1);
    c.lineTo(x, 3.4);
  }
  c.stroke();
  // Rueda del eje
  c.fillStyle = '#7a4a22';
  c.beginPath();
  c.arc(0, -4, 2.6, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#ffc23d';
  c.lineWidth = 0.5;
  c.stroke();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.arc(0, -4, 0.8, 0, Math.PI * 2);
  c.fill();
}

function paintCoin(c: CanvasRenderingContext2D) {
  c.fillStyle = '#b8860b';
  c.beginPath();
  c.arc(0, 0.25, 2.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.arc(0, 0, 2.3, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#fff1b8';
  c.lineWidth = 0.35;
  c.beginPath();
  c.arc(0, 0, 1.5, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillRect(-0.9, -1.5, 0.5, 1.2);
}

const BALLOON_COLORS = ['#ff4d6d', '#4dabff', '#ffd23d', '#5ee08a'];

function paintBalloon(hue: number) {
  return (c: CanvasRenderingContext2D) => {
    const col = BALLOON_COLORS[hue];
    const g = c.createRadialGradient(-1.4, -2, 0.4, 0, -0.5, 5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, col);
    g.addColorStop(1, col);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, -0.6, 4, 4.6, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 0.3;
    c.stroke();
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(0, 3.8);
    c.lineTo(0.9, 5);
    c.lineTo(-0.9, 5);
    c.closePath();
    c.fill();
  };
}

function paintBird(up: boolean) {
  return (c: CanvasRenderingContext2D) => {
    // Mira a la izquierda (vuela hacia el alcalde)
    c.fillStyle = '#2a2238';
    c.beginPath();
    c.ellipse(0, 0.4, 2.8, 1.7, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(-2.4, -0.6, 1.3, 0, Math.PI * 2);
    c.fill();
    // Cola
    c.beginPath();
    c.moveTo(2.4, 0);
    c.lineTo(4.4, -1);
    c.lineTo(4.4, 1.4);
    c.closePath();
    c.fill();
    // Ala
    c.fillStyle = '#3e3352';
    c.beginPath();
    c.moveTo(-0.8, 0);
    if (up) {
      c.lineTo(1.2, -3.6);
      c.lineTo(2.2, -3.2);
    } else {
      c.lineTo(1.4, 3.2);
      c.lineTo(2.4, 2.6);
    }
    c.lineTo(1.6, 0.4);
    c.closePath();
    c.fill();
    // Pico y ojo
    c.fillStyle = '#ff9f1c';
    c.beginPath();
    c.moveTo(-3.5, -0.9);
    c.lineTo(-4.9, -0.4);
    c.lineTo(-3.5, -0.1);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(-2.6, -1, 0.45, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(-2.75, -1, 0.22, 0, Math.PI * 2);
    c.fill();
  };
}

function paintTramp(c: CanvasRenderingContext2D) {
  // 14 × 4 m; la lona arriba (y = -1), patas hasta el suelo (y = 2)
  c.strokeStyle = '#1f45a8';
  c.lineWidth = 0.6;
  c.beginPath();
  for (const x of [-5.5, -2, 2, 5.5]) {
    c.moveTo(x, -0.6);
    c.lineTo(x + (x < 0 ? -0.6 : 0.6), 2);
  }
  c.stroke();
  c.fillStyle = '#2b5fd9';
  c.fillRect(-6.6, -1.2, 13.2, 1.2);
  c.fillStyle = '#ffffff';
  for (let x = -6.6; x < 6.6; x += 2.2) c.fillRect(x, -1.2, 1.1, 1.2);
  c.fillStyle = '#e8283c';
  c.fillRect(-6.6, -1.6, 13.2, 0.5);
}

function paintTent(c: CanvasRenderingContext2D) {
  // Carpa de 24 × 20 m, base en y = 10
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? '#ffffff' : '#e8283c';
    c.fillRect(-10 + i * (20 / 6), 1, 20 / 6 + 0.05, 9);
  }
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(-10, 1, 20, 9);
  c.fillStyle = '#3a1020';
  c.beginPath();
  c.moveTo(-2, 10);
  c.lineTo(0, 3.5);
  c.lineTo(2, 10);
  c.closePath();
  c.fill();
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? '#fff4e0' : '#ff4d5e';
    c.beginPath();
    c.moveTo(0, -7.5);
    c.lineTo(-11.5 + i * (23 / 6), 1.4);
    c.lineTo(-11.5 + (i + 1) * (23 / 6), 1.4);
    c.closePath();
    c.fill();
  }
  c.fillStyle = '#ffc23d';
  c.fillRect(-11.6, 1, 23.2, 0.9);
  c.strokeStyle = '#3a1020';
  c.lineWidth = 0.35;
  c.beginPath();
  c.moveTo(0, -7.5);
  c.lineTo(0, -10);
  c.stroke();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.moveTo(0, -10);
  c.lineTo(2.6, -9.2);
  c.lineTo(0, -8.4);
  c.closePath();
  c.fill();
}

const WHEEL_R = 20;

function paintWheel(c: CanvasRenderingContext2D) {
  c.strokeStyle = '#ffd6f0';
  c.lineWidth = 0.7;
  c.beginPath();
  c.arc(0, 0, WHEEL_R, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 0.35;
  c.beginPath();
  c.arc(0, 0, WHEEL_R * 0.72, 0, Math.PI * 2);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R);
  }
  c.stroke();
  const cols = ['#ffe066', '#ff7ab6', '#7ad7ff', '#9cff8a'];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    c.fillStyle = cols[i % cols.length];
    c.beginPath();
    c.arc(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0.45, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#ffd6f0';
  c.beginPath();
  c.arc(0, 0, 1.6, 0, Math.PI * 2);
  c.fill();
}

// --- Fondo (unidades del campo) ---

const SKY_TILE = 720;

function paintSkyline(c: CanvasRenderingContext2D, w: number, h: number, seed: number, col: string, lit: string, tall: number) {
  c.translate(-w / 2, -h / 2);
  const r = mulberry32(seed);
  c.fillStyle = col;
  // Base maciza: tapa el hueco hasta el suelo cuando la cámara sube
  c.fillRect(0, h - 140, w, 140);
  for (let x = 0; x < w; ) {
    const bw = 18 + r() * 34;
    const bh = 20 + r() * tall;
    const top = h - 140 - bh;
    c.fillStyle = col;
    c.fillRect(x, top, bw, bh + 1);
    if (r() < 0.25) {
      // Antena o cúpula
      c.fillRect(x + bw / 2 - 1, top - 12, 2, 12);
    } else if (r() < 0.2) {
      c.beginPath();
      c.arc(x + bw / 2, top, bw / 2.4, Math.PI, 0);
      c.fill();
    }
    c.fillStyle = lit;
    for (let wy = top + 6; wy < h - 146; wy += 9) {
      for (let wx = x + 4; wx < x + bw - 5; wx += 7) if (r() < 0.32) c.fillRect(wx, wy, 3, 4);
    }
    x += bw + r() * 6;
  }
}

function paintClouds(c: CanvasRenderingContext2D, w: number, h: number) {
  c.translate(-w / 2, -h / 2);
  const r = mulberry32(21);
  for (let i = 0; i < 7; i++) {
    const cx = (i + r() * 0.6) * (w / 7);
    const cy = 30 + r() * (h - 80);
    const s = 0.7 + r() * 0.8;
    for (let k = 0; k < 5; k++) {
      const bx = cx + (k - 2) * 16 * s;
      const by = cy - Math.sin((k / 4) * Math.PI) * 10 * s;
      const rr = (13 + r() * 9) * s;
      c.fillStyle = 'rgba(255, 196, 214, 0.55)';
      c.beginPath();
      c.arc(bx, by + 4, rr, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255, 236, 240, 0.7)';
      c.beginPath();
      c.arc(bx - 2, by, rr * 0.85, 0, Math.PI * 2);
      c.fill();
    }
  }
}

const CONFETTI = ['#ff4d6d', '#ffc23d', '#4dabff', '#5ee08a', '#ff7ab6', '#ffffff'];

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

export function CannonGameView({ onOver, onScore }: WarViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<CannonGame>(null as unknown as CannonGame);
  if (!game.current) game.current = newCannon(Math.random);
  // Solo en desarrollo: deja tocar la partida desde las capturas automáticas
  if (import.meta.env.DEV) (window as unknown as { __cannon?: CannonGame }).__cannon = game.current;
  /** Partículas en metros (polvo, humo, confeti) y textos/ondas en pantalla. */
  const fxW = useRef(new Fx());
  const fxS = useRef(new Fx());
  // Récord de siempre al empezar (fijo: al acabar la feria el premio lo sube y la bandera no debe moverse)
  const recordNow = useGame((st) => st.s.cannonBest);
  const record = useRef(recordNow);
  const [phase, setPhaseState] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>('intro');
  const introEnd = useRef(performance.now() + INTRO_MS);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'boss'; id: number } | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [, setShopTick] = useState(0);
  const cam = useRef<Cam>({ x: 14, y: 0, z: Z_AIM, lead: 0 });
  const hat = useRef<Hat>({ on: true, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0 });
  const rot = useRef(0);
  const recoil = useRef(0);
  const lines = useRef<{ x: number; y: number; l: number }[]>([]);
  const trampHit = useRef(new Map<number, number>());
  const coinCombo = useRef({ n: 0, until: 0 });
  const lastHiss = useRef(0);
  const spaceWas = useRef(false);
  const flags = useRef({ best: false, record: false, rocketTip: false });
  const lastScore = useRef(-1);
  const timers = useRef<number[]>([]);
  const overSent = useRef(false);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => clearTimeout(id));
  }, []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const input = useInput(canvas, 'tap');
  const [hud, pushHud] = useHud({ attempt: 1, dist: 0, best: 0, fuel: 0, fuelMax: 0, alt: 0, lp: 'aim', hot: false });

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      releaseInput(input.current);
      spaceWas.current = false;
    },
    [input],
  );

  const say = (text: string, tone: 'good' | 'bad' | 'boss' = 'good') => setBanner({ text, tone, id: performance.now() });

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [banner]);

  const start = useCallback(() => {
    if (phaseRef.current === 'intro') setPhase('play');
  }, [setPhase]);

  // Espacio o Intro también empiezan desde la tarjeta de inicio
  useEffect(() => {
    if (phase !== 'intro') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start]);

  const pause = useCallback(() => {
    if (phaseRef.current === 'play') setPhase('paused');
  }, [setPhase]);

  /** Prepara la vista para un intento nuevo (cámara junto al cañón, chistera puesta). */
  const resetView = () => {
    cam.current = { x: 14, y: 0, z: Z_AIM, lead: 0 };
    hat.current.on = true;
    rot.current = 0;
    recoil.current = 0;
    trampHit.current.clear();
    flags.current.best = false;
  };

  const knockHat = (g: CannonGame, up: number) => {
    const h = hat.current;
    if (!h.on) return;
    const a = rot.current;
    // Sale de la cabeza: 8.4 m "hacia arriba" del sprite, girado con el cuerpo
    h.on = false;
    h.x = g.x + Math.sin(a) * 8.4;
    h.y = g.y + Math.cos(a) * 8.4;
    h.vx = g.vx * 0.45 + 4;
    h.vy = up;
    h.rot = a;
    h.vr = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
    tone(1500, 0.06, 'triangle', 0.03);
  };

  const onStep = (dt: number) => {
    const g = game.current;
    const inp = input.current;
    const taps = takeTaps(inp);
    const space = inp.keys.has('Space');
    const press = taps.length > 0 || (space && !spaceWas.current);
    spaceWas.current = space;
    const wasPhase = g.phase;
    const ev = step(g, dt, { press, hold: inp.held });
    const f = fxW.current;
    const fs = fxS.current;
    const c = cam.current;

    if (ev.locked) {
      sfx('tap');
      vibrate(12);
      const m = muzzle(g.angle);
      if (g.perfectA) {
        sfx('crit');
        fs.text(sx(c, m.x), sy(c, m.y) - 40, '¡Ángulo perfecto!', '#7dffa8', 13, 1000);
      }
    }
    if (ev.fired) {
      const m = muzzle(g.angle);
      const a = (g.angle * Math.PI) / 180;
      tone(55, 0.55, 'sawtooth', 0.09);
      tone(130, 0.22, 'square', 0.05);
      vibrate([30, 20, 70]);
      fs.shake(9, 420);
      fs.flash('#fff4d0', 140);
      recoil.current = 1;
      f.burst(m.x, -m.y, { n: 26, colors: ['rgba(235,230,240,0.85)', 'rgba(200,190,210,0.8)', 'rgba(255,214,150,0.9)'], speed: 26, life: 1100, size: 3.2, drag: 2.6, angle: -a, spread: 1.3 });
      f.burst(m.x, -m.y, { n: 46, colors: CONFETTI, speed: 42, life: 1700, size: 0.9, gravity: 14, drag: 1.6, angle: -a, spread: 1.6, shape: 'square' });
      fs.ring(sx(c, m.x), sy(c, m.y), '#ffe9a8', 50, 380);
      const both = g.perfectA && g.perfectP;
      if (both) fs.text(sx(c, m.x) + 20, sy(c, m.y) - 60, '¡Doble perfecto!', '#7dffa8', 16, 1300);
      else if (g.perfectP) fs.text(sx(c, m.x) + 20, sy(c, m.y) - 60, '¡Fuerza perfecta!', '#7dffa8', 14, 1100);
      else fs.text(sx(c, m.x) + 20, sy(c, m.y) - 60, '¡PUM!', '#ffe066', 16, 900);
      if (g.perfectP) sfx('crit');
    }
    if (ev.coins.length) {
      const now = performance.now();
      const cc = coinCombo.current;
      for (const k of ev.coins) {
        cc.n = now < cc.until ? Math.min(cc.n + 1, 18) : 0;
        cc.until = now + 600;
        f.burst(k.x, -k.y, { n: 5, colors: ['#ffe066', '#fff'], speed: 18, life: 300, size: 0.7, shape: 'spark' });
        fs.text(sx(c, k.x), sy(c, k.y) - 10, `+${k.value}`, '#ffe066', 9 + Math.min(4, k.value), 650);
      }
      tone(880 * 2 ** (cc.n / 12), 0.05, 'sine', 0.035);
    }
    for (const b of ev.balloons) {
      f.burst(b.x, -b.y, { n: 18, colors: [BALLOON_COLORS[b.hue], '#fff'], speed: 30, life: 450, size: 1, shape: 'square' });
      fs.ring(sx(c, b.x), sy(c, b.y), BALLOON_COLORS[b.hue], 26, 300);
      fs.text(sx(c, b.x), sy(c, b.y) - 18, '¡Pop! ⬆', '#ffffff', 12, 800);
      tone(950, 0.04, 'square', 0.05);
      tone(420, 0.12, 'triangle', 0.05);
      vibrate(15);
    }
    for (const b of ev.birds) {
      f.burst(b.x, -b.y, { n: 16, colors: ['#3e3352', '#ffffff', '#2a2238'], speed: 20, life: 900, size: 0.9, gravity: 6, drag: 2, shape: 'square' });
      fs.text(sx(c, b.x), sy(c, b.y) - 18, '¡Cuac! 🐦', '#ffb3c1', 12, 900);
      fs.shake(4, 220);
      tone(1250, 0.07, 'sawtooth', 0.04);
      later(() => tone(980, 0.08, 'sawtooth', 0.035), 70);
      vibrate(30);
      knockHat(g, 10);
    }
    for (const t of ev.tramps) {
      trampHit.current.set(Math.round(t.x / 10), performance.now());
      f.burst(g.x, 0, { n: 14, colors: ['#ffffff', '#7ad7ff'], speed: 26, life: 400, size: 0.8, angle: -Math.PI / 2, spread: 2, shape: 'spark' });
      fs.text(sx(c, g.x), sy(c, 6) - 20, '¡Boing!', '#7ad7ff', 15, 900);
      fs.shake(3, 200);
      tone(180, 0.1, 'sine', 0.06);
      later(() => tone(360, 0.1, 'sine', 0.06), 60);
      later(() => tone(720, 0.14, 'sine', 0.05), 120);
      vibrate(25);
      knockHat(g, 16);
    }
    for (const b of ev.bounces) {
      const k = Math.min(1, b.impact / 40);
      f.burst(b.x, 0, { n: 6 + Math.round(16 * k), colors: ['#d9b98a', '#b68a5a', '#efe0c0'], speed: 10 + 22 * k, life: 700, size: 1.4 + k, gravity: 10, drag: 2.4, angle: -Math.PI / 2, spread: 2.6 });
      if (b.impact > 8) {
        fs.shake(2 + 5 * k, 200);
        tone(70 + b.impact * 2, 0.12, 'triangle', 0.04 + 0.04 * k);
        vibrate(Math.round(10 + 30 * k));
      }
      if (b.impact > 22) knockHat(g, 12 + b.impact * 0.3);
    }
    if (ev.mud) {
      f.burst(ev.mud.x, -0.5, { n: 34, colors: ['#5b3a1f', '#7a5230', '#3e2614'], speed: 34, life: 900, size: 1.6, gravity: 30, drag: 1.2, angle: -Math.PI / 2, spread: 2.2 });
      fs.text(sx(c, ev.mud.x), sy(c, 8) - 20, '¡Plaf! Al barro', '#e0b07a', 15, 1300);
      fs.shake(5, 300);
      tone(90, 0.3, 'sawtooth', 0.06);
      vibrate([40, 30, 40]);
      knockHat(g, 8);
    }
    if (ev.burning) {
      // Llama y humo por los pies (el alcalde vuela de cabeza)
      const a = rot.current;
      const fx = g.x - Math.sin(a) * 5.5;
      const fy = g.y - Math.cos(a) * 5.5;
      const back = Math.atan2(Math.cos(a), -Math.sin(a));
      f.burst(fx, -fy, { n: 2, colors: ['#ffe066', '#ff9a3c', '#ff5a3a'], speed: 30, life: 260, size: 1.3, angle: back, spread: 0.5 });
      if (Math.random() < 0.4) f.burst(fx, -fy, { n: 1, colors: ['rgba(220,215,230,0.6)'], speed: 6, life: 700, size: 2.2, drag: 3 });
      const now = performance.now();
      if (now - lastHiss.current > 110) {
        lastHiss.current = now;
        tone(120 + Math.random() * 60, 0.09, 'sawtooth', 0.025);
      }
      flags.current.rocketTip = true;
    }
    if (ev.fuelOut) {
      fs.text(sx(c, g.x), sy(c, g.y) - 40, 'Sin combustible', '#ffb38a', 10, 900);
      tone(240, 0.12, 'triangle', 0.04);
    }
    if (ev.marker) tone(1320, 0.05, 'sine', 0.025);

    // Pasar la mejor marca de la feria y el récord de siempre
    if (g.phase === 'fly') {
      const d = distance(g);
      if (!flags.current.best && g.best > 0 && d > g.best) {
        flags.current.best = true;
        fs.text(sx(c, g.x), sy(c, g.y) - 46, '¡Superas tu mejor!', '#7dffa8', 13, 1200);
        tone(660, 0.08, 'triangle', 0.05);
        later(() => tone(990, 0.1, 'triangle', 0.05), 90);
      }
      if (!flags.current.record && record.current > 0 && d > record.current) {
        flags.current.record = true;
        say('🏆 ¡Récord!', 'boss');
        sfx('win');
        vibrate([30, 40, 30]);
        fs.flash('#ffe066', 220);
        f.burst(g.x, -g.y - 6, { n: 50, colors: CONFETTI, speed: 40, life: 1500, size: 1, gravity: 12, shape: 'square' });
      }
    }

    if (ev.landed) {
      const r = ev.landed;
      if (!ev.mud) tone(110, 0.2, 'triangle', 0.05);
      const last = r.attempt >= LAUNCHES;
      later(() => {
        if (phaseRef.current === 'play' || phaseRef.current === 'paused') {
          setResult(r);
          setPhase('result');
          sfx(r.best ? 'win' : 'buy');
        }
      }, LAND_MS);
      if (last) {
        later(() => {
          if (overSent.current) return;
          overSent.current = true;
          leaveLanding(g);
          cb.current.onOver(summary(g));
        }, LAND_MS + OVER_MS);
      }
    }
    if (wasPhase === 'fly' && g.phase !== 'fly') g.burning = false;
    const sc = score(g);
    if (sc !== lastScore.current) {
      lastScore.current = sc;
      cb.current.onScore(summary(g));
    }
  };

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const live = ph !== 'paused' && ph !== 'shop';
    if (live) {
      fxW.current.update(frame);
      fxS.current.update(frame);
      updateView(g, frame);
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    drawWorld(ctx, v, g, cam.current, fxW.current, fxS.current, {
      hat: hat.current,
      rot: rot.current,
      recoil: recoil.current,
      lines: lines.current,
      lineAng: Math.atan2(g.vy, Math.max(1, g.vx)),
      trampHit: trampHit.current,
      record: record.current,
      time: performance.now(),
    });
    fxS.current.drawFlash(ctx, v);
    pushHud({
      attempt: g.attempt,
      dist: g.phase === 'aim' || g.phase === 'power' ? 0 : distance(g),
      best: g.best,
      fuel: Math.ceil(g.fuel * 10) / 10,
      fuelMax: fuelMax(g.lv.rocket),
      alt: g.phase === 'fly' ? Math.max(0, Math.round(g.y - MAYOR_R)) : 0,
      lp: g.phase,
      hot: g.phase === 'fly' && g.best > 0 && distance(g) > g.best,
    });
  };

  /** Cámara, chistera, giro del alcalde y líneas de velocidad (solo vista). */
  const updateView = (g: CannonGame, frame: number) => {
    const s = Math.min(0.05, frame / 1000);
    const c = cam.current;
    const ease = (rate: number) => 1 - Math.exp(-rate * s);
    if (g.phase === 'aim' || g.phase === 'power') {
      c.x += (14 - c.x) * ease(6);
      c.z += (Z_AIM - c.z) * ease(6);
      c.y += (0 - c.y) * ease(6);
    } else {
      const sp = Math.hypot(g.vx, g.vy);
      const zt = Math.max(Z_MIN, Math.min(Z_MAX, 360 / (g.y + 20), 300 / (sp * 0.8 + 20)));
      c.z += (zt - c.z) * ease(g.phase === 'fly' ? 2.2 : 1.2);
      const leadT = g.phase === 'fly' ? Math.min(42, g.vx * 0.6) : 0;
      c.lead += (leadT - c.lead) * ease(2);
      c.x = g.x + c.lead / c.z;
      const yt = Math.max(0, g.y - 250 / c.z);
      c.y += (yt - c.y) * ease(5);
    }
    recoil.current = Math.max(0, recoil.current - s * 3);

    // Giro: de cabeza en el aire, rodando por el suelo, sentado al pararse
    if (g.phase === 'aim' || g.phase === 'power') rot.current = Math.PI / 2 - (g.angle * Math.PI) / 180;
    else if (g.phase === 'fly') {
      if (g.ground) rot.current += (g.vx * s) / MAYOR_R;
      else {
        const want = Math.atan2(g.vx, g.vy);
        let d = want - rot.current;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rot.current += d * ease(8);
      }
    } else {
      let d = 0 - rot.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rot.current += d * ease(5);
    }

    // Chistera suelta
    const h = hat.current;
    if (!h.on) {
      if (h.y > 1.6) {
        h.vy -= 15 * s;
        h.vx *= 1 - 0.6 * s;
        h.x += h.vx * s;
        h.y += h.vy * s;
        h.rot += h.vr * s;
        if (h.y <= 1.6) {
          h.y = 1.6;
          h.rot = 0;
        }
      }
    }

    // Líneas de velocidad (en unidades del campo)
    const sp = Math.hypot(g.vx, g.vy);
    const L = lines.current;
    if (g.phase === 'fly' && sp > 40) {
      while (L.length < 16) L.push({ x: Math.random() * FIELD_W * 1.4, y: 60 + Math.random() * (FIELD_H - 120), l: 20 + Math.random() * 40 });
    }
    const k = c.z * s;
    for (const ln of L) {
      ln.x -= g.vx * k * 1.6;
      ln.y += g.vy * k * 1.6;
      if (ln.x < -60 || ln.y < -40 || ln.y > FIELD_H + 40) {
        if (g.phase === 'fly' && sp > 40) {
          ln.x = FIELD_W + Math.random() * 120;
          ln.y = 60 + Math.random() * (FIELD_H - 120);
        } else ln.x = -999;
      }
    }
    if (g.phase !== 'fly' || sp <= 40) lines.current = L.filter((ln) => ln.x > -60);
  };

  const view = useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;
  const goShop = () => {
    if (leaveLanding(g) === 'shop') setPhase('shop');
  };
  const launchNext = () => {
    const n = nextLaunch(g, Math.random);
    resetView();
    say(n === LAUNCHES ? `Último intento (${n}/${LAUNCHES})` : `Intento ${n} de ${LAUNCHES}`, n === LAUNCHES ? 'boss' : 'good');
    setPhase('play');
  };
  void view;

  const lp = hud.lp;
  const hint =
    phase !== 'play'
      ? null
      : lp === 'aim'
        ? '👆 Toca para fijar el ángulo'
        : lp === 'power'
          ? '👆 ¡Toca para disparar!'
          : lp === 'fly' && hud.fuelMax > 0 && hud.fuel > 0 && !flags.current.rocketTip
            ? '👆 Mantén pulsado: 🚀 cohete'
            : null;

  return (
    <div className="sh-wrap cn-wrap">
      <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Alcalde bala, intento ${hud.attempt} de ${LAUNCHES}. Mejor: ${hud.best} metros.`} />
      <HudBar
        items={[
          { icon: '🎯', value: `${hud.attempt}/${LAUNCHES}`, label: 'Intento' },
          { icon: '📏', value: `${hud.dist} m`, label: 'Distancia', hot: hud.hot },
          { icon: '⭐', value: `${hud.best} m`, label: 'Mejor intento' },
        ]}
        onPause={phase === 'play' ? pause : undefined}
      >
        {(hud.fuelMax > 0 && (lp === 'aim' || lp === 'power' || lp === 'fly')) || hud.alt > 30 ? (
          <div className="sh-hud-row cn-hud-row2">
            {hud.fuelMax > 0 && (lp === 'aim' || lp === 'power' || lp === 'fly') && (
              <div className="cn-fuel">
                <Meter value={hud.fuel} max={hud.fuelMax} color="linear-gradient(90deg, #ff5a3a, #ffb938)" label="Cohete" text={`🚀 ${hud.fuel.toFixed(1).replace('.', ',')} s`} />
              </div>
            )}
            {hud.alt > 30 && (
              <span className="sh-pill cn-alt" aria-label={`Altura: ${hud.alt} metros`}>
                <i aria-hidden="true">⬆</i>
                <b>{hud.alt} m</b>
              </span>
            )}
          </div>
        ) : null}
      </HudBar>
      {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
      {hint && (
        <div className="cn-hint" key={hint} aria-live="polite">
          {hint}
        </div>
      )}
      {phase === 'intro' && (
        <StartCard
          title="🎪 Alcalde bala"
          left={introLeft}
          total={INTRO_MS}
          onSkip={start}
          lines={[
            { icon: '👆', text: 'Toca dos veces: una fija el ángulo y otra la fuerza. ¡En la zona verde es perfecto!' },
            { icon: '🚀', text: 'En el aire, mantén pulsado para usar el cohete (cuando lo compres).' },
            { icon: '🎈', text: 'Globos y camas elásticas te impulsan; pájaros y barro te frenan.' },
            { icon: '🛠️', text: 'Gasta lo ganado en el taller. 5 intentos: cuenta el más lejano.' },
          ]}
        />
      )}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            Intento {g.attempt}/{LAUNCHES} · Mejor {g.best} m · {g.money} 🪙
          </p>
        </PauseCard>
      )}
      {(phase === 'result' || phase === 'over') && result && <ResultCard r={result} launches={g.launches} record={record.current} onNext={goShop} />}
      {phase === 'shop' && (
        <ShopPanel
          title="🛠️ Taller"
          subtitle={`Mejor: ${g.best} m. Las mejoras solo duran esta feria.`}
          money={g.money}
          items={SHOP.map((d) => {
            const lv = g.lv[d.id];
            return { id: d.id, emoji: d.emoji, name: d.name, desc: lv >= SHOP_MAX ? 'Al máximo' : d.desc(lv + 1), level: lv, max: SHOP_MAX, cost: shopCost(g, d.id) };
          })}
          onBuy={(id) => {
            if (buy(g, id as ShopId)) setShopTick((n) => n + 1);
          }}
          doneText={`🎪 ¡Al cañón! · Intento ${g.attempt + 1}/${LAUNCHES}`}
          onDone={launchNext}
        />
      )}
    </div>
  );
}

/** Tarjeta tras cada intento: distancia, lo ganado y los intentos de la feria. */
function ResultCard({ r, launches, record, onNext }: { r: LaunchResult; launches: LaunchResult[]; record: number; onNext: () => void }) {
  const final = r.attempt >= LAUNCHES;
  const [armed, setArmed] = useState(false);
  const next = useRef(onNext);
  useEffect(() => {
    next.current = onNext;
  });
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 650);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!armed || final) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        next.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, final]);
  const top = Math.max(1, ...launches.map((l) => l.dist));
  const best = Math.max(...launches.map((l) => l.dist));
  return (
    <div className="sh-overlay sh-dim" role="dialog" aria-label={`Intento ${r.attempt}: ${r.dist} metros`} onClick={armed && !final ? onNext : undefined}>
      <div className={`sh-card cn-result${r.best ? ' best' : ''}`}>
        <small className="cn-result-kicker">{final ? '🏁 ¡Fin de la feria!' : `Intento ${r.attempt}/${LAUNCHES}`}</small>
        <div className="cn-result-dist">
          {r.dist}
          <span> m</span>
        </div>
        {r.best && r.attempt > 1 && <div className="cn-result-badge">⭐ ¡Mejor intento!</div>}
        {record > 0 && r.dist > record && <div className="cn-result-badge gold">🏆 ¡Récord!</div>}
        <ul className="cn-result-list">
          <li>
            <span>📏 Distancia</span>
            <b>+{r.distMoney} 🪙</b>
          </li>
          <li>
            <span>🪙 {r.coins} {r.coins === 1 ? 'moneda' : 'monedas'}</span>
            <b>+{r.coinMoney} 🪙</b>
          </li>
          {r.perfect > 0 && (
            <li>
              <span>✨ {r.perfect === 2 ? 'Doble perfecto' : 'Disparo perfecto'}</span>
              <b>+{r.perfect * 6} % velocidad</b>
            </li>
          )}
          {r.mud && (
            <li className="bad">
              <span>🟤 Acabaste en el barro</span>
            </li>
          )}
        </ul>
        <div className="cn-result-total">+{r.earned} 🪙</div>
        <div className="cn-bars" aria-label="Intentos de la feria">
          {Array.from({ length: LAUNCHES }, (_, i) => {
            const l = launches[i];
            return (
              <div key={i} className={`cn-bar${l ? '' : ' empty'}${l && l.dist === best ? ' top' : ''}${l === r ? ' now' : ''}`}>
                <i style={{ height: l ? `${Math.max(6, (l.dist / top) * 100)}%` : '6%' }} />
                <small>{l ? l.dist : '–'}</small>
              </div>
            );
          })}
        </div>
        {final ? (
          <p className="sh-sub">Cuenta tu mejor intento: {best} m</p>
        ) : (
          <button className="btn primary cn-result-btn" disabled={!armed} onClick={onNext}>
            🛠️ Al taller
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pintado del mundo
// ---------------------------------------------------------------------------------------------

interface Extra {
  hat: Hat;
  rot: number;
  recoil: number;
  lines: { x: number; y: number; l: number }[];
  lineAng: number;
  trampHit: Map<number, number>;
  record: number;
  time: number;
}

function drawWorld(ctx: CanvasRenderingContext2D, v: View, g: CannonGame, c: Cam, fw: Fx, fs: Fx, e: Extra) {
  const sh = fs.offset();
  const t = e.time;
  toWorldSpace(ctx, v);
  ctx.translate(sh.x, sh.y);
  const groundY = sy(c, 0);
  drawBackdrop(ctx, v, c, groundY, t);

  // --- Mundo en metros ---
  worldSpace(ctx, v, c, sh);
  const x0 = c.x - (ANCHOR_X - v.x0 + 20) / c.z;
  const x1 = c.x + (v.x1 - ANCHOR_X + 20) / c.z;
  const vis = (x: number, m = 0) => x > x0 - m && x < x1 + m;

  // Feria del principio (detrás de todo)
  if (x0 < 110) drawFair(ctx, t, vis);

  // Suelo: césped a franjas, tierra y marcas
  const bottom = (v.y1 - GROUND_SY) / c.z + c.y + 4;
  ctx.fillStyle = '#5b3d26';
  ctx.fillRect(x0 - 2, 0, x1 - x0 + 4, bottom);
  ctx.fillStyle = '#3f9a45';
  ctx.fillRect(x0 - 2, -0.2, x1 - x0 + 4, 3.4);
  ctx.fillStyle = '#4fb556';
  for (let k = Math.floor(x0 / 10); k * 10 < x1; k++) if (k % 2 === 0) ctx.fillRect(k * 10, -0.2, 10, 3.4);
  ctx.fillStyle = '#7fe08a';
  ctx.fillRect(x0 - 2, -0.35, x1 - x0 + 4, 0.45);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x0 - 2, 3.2, x1 - x0 + 4, 0.8);
  // Camino de la feria hasta el cañón
  if (x0 < 20) {
    ctx.fillStyle = '#c9a36a';
    ctx.fillRect(-40, -0.25, 52, 1);
  }
  // Rayitas cada 25 m
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let k = Math.max(1, Math.floor(x0 / 25)); k * 25 < x1; k++) if (k % 4) ctx.fillRect(k * 25 - 0.15, -0.3, 0.3, 1.2);

  // Barro
  for (const m of g.muds) {
    if (!vis(m.x, m.w)) continue;
    ctx.fillStyle = '#4a2f18';
    ctx.beginPath();
    ctx.ellipse(m.x + m.w / 2, 0.2, m.w / 2 + 1, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4526';
    ctx.beginPath();
    ctx.ellipse(m.x + m.w / 2, 0, m.w / 2, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 220, 170, 0.35)';
    ctx.beginPath();
    ctx.ellipse(m.x + m.w * 0.35, -0.15, m.w * 0.12, 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Burbujas
    const b = Math.sin(t / 300 + m.x) * 0.5 + 0.5;
    ctx.fillStyle = '#7d5530';
    ctx.beginPath();
    ctx.arc(m.x + m.w * 0.7, -0.3 - b * 0.4, 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  // Camas elásticas
  const tramp = sprite('cn-tramp', 14, 4, paintTramp, RES);
  for (const p of g.tramps) {
    if (!vis(p.x, 14)) continue;
    const hitAt = e.trampHit.get(Math.round((p.x + p.w / 2) / 10)) ?? e.trampHit.get(Math.round(p.x / 10)) ?? -1e9;
    const k = Math.max(0, 1 - (t - hitAt) / 400);
    const squash = 1 - Math.sin(k * Math.PI * 3) * k * 0.35;
    drawSprite(ctx, tramp, p.x + p.w / 2, -2 + (1 - squash) * 1.5, 14, 4 * squash, 0, p.used ? 0.7 : 1);
    if (!p.used) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t / 200 + p.x);
      ctx.fillStyle = '#7ad7ff';
      ctx.fillRect(p.x - 0.5, -4.4, p.w + 1, 0.4);
      ctx.globalAlpha = 1;
    }
  }

  // Carteles cada 100 m
  for (let k = Math.max(1, Math.floor(x0 / 100)); k * 100 < x1 + 10; k++) {
    const x = k * 100;
    ctx.fillStyle = '#f2ead8';
    ctx.fillRect(x - 0.35, -9, 0.7, 9);
    ctx.fillStyle = '#2b5fd9';
    ctx.fillRect(x - 5, -12.5, 10, 4);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.35;
    ctx.strokeRect(x - 4.7, -12.2, 9.4, 3.4);
  }

  // Banderas: mejor de la feria y récord
  if (g.best > 0) drawFlag(ctx, PIVOT_X + g.best, '#ffc23d', t);
  if (e.record > 0 && Math.abs(e.record - g.best) > 1) drawFlag(ctx, PIVOT_X + e.record, '#ff4d6d', t + 500);

  // Monedas
  const coin = sprite('cn-coin', 5, 5, paintCoin, RES);
  const cs = Math.max(1.15, 6 / (2.4 * c.z));
  for (const k of g.coins) {
    if (k.got || !vis(k.x, 4)) continue;
    const spin = Math.abs(Math.cos(t / 180 + k.x * 0.3));
    const s = (k.value > 1 ? 1.25 : 1) * cs;
    drawSprite(ctx, coin, k.x, -k.y, 5 * s * Math.max(0.2, spin), 5 * s);
  }

  // Globos con su cuerda
  for (const b of g.balloons) {
    if (b.popped || !vis(b.x, 8)) continue;
    const bob = Math.sin(t / 500 + b.x) * 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(b.x, -(b.y + bob) + BALLOON_R + 0.5);
    ctx.quadraticCurveTo(b.x + Math.sin(t / 300 + b.x) * 1.2, -(b.y + bob) + BALLOON_R + 4, b.x, -(b.y + bob) + BALLOON_R + 8);
    ctx.stroke();
    drawSprite(ctx, sprite(`cn-balloon-${b.hue}`, 9, 11, paintBalloon(b.hue), RES), b.x, -(b.y + bob), 9, 11);
  }

  // Pájaros
  for (const b of g.birds) {
    if (!vis(b.x, 8) || b.y < -5) continue;
    const up = Math.floor(t / 130 + b.phase * 3) % 2 === 0;
    drawSprite(ctx, sprite(`cn-bird-${up ? 'u' : 'd'}`, 10, 8, paintBird(up), RES), b.x, -b.y, 10, 8, b.hit ? t / 90 : 0, b.hit ? 0.8 : 1);
  }

  // Chistera en el suelo o volando
  const hatSpr = sprite('cn-hat', 5.4, 4.4, paintHat, RES);
  if (!e.hat.on && vis(e.hat.x, 6)) drawSprite(ctx, hatSpr, e.hat.x, -e.hat.y, 5.4, 4.4, e.hat.rot);

  // Cañón y alcalde
  const aiming = g.phase === 'aim' || g.phase === 'power';
  if (aiming) drawMayor(ctx, g, e, aiming, t);
  if (vis(0, 30)) drawCannon(ctx, g, e.recoil, t);
  if (!aiming) drawMayor(ctx, g, e, aiming, t);

  fw.draw(ctx);

  // --- Encima, en unidades del campo: textos, carteles, guías ---
  toWorldSpace(ctx, v);
  ctx.translate(sh.x, sh.y);
  for (let k = Math.max(1, Math.floor(x0 / 100)); k * 100 < x1 + 10; k++) {
    const px = sx(c, k * 100);
    const py = sy(c, 10.5);
    if (py < FIELD_H + 20) label(ctx, `${k * 100} m`, px, py, { size: Math.max(8, 2.6 * c.z), color: '#ffffff' });
  }
  if (g.best > 0) flagLabel(ctx, c, PIVOT_X + g.best, `Mejor ${g.best} m`, '#ffc23d');
  if (e.record > 0 && Math.abs(e.record - g.best) > 1) flagLabel(ctx, c, PIVOT_X + e.record, `Récord ${e.record} m`, '#ff8a9a', Math.abs(e.record - g.best) * c.z < 70 ? -16 : 0);

  // Pájaros fuera de pantalla por delante: aviso en el borde
  if (g.phase === 'fly') {
    for (const b of g.birds) {
      if (b.hit) continue;
      const px = sx(c, b.x);
      if (px < v.x1 || px > v.x1 + 260) continue;
      const py = Math.max(110, Math.min(FIELD_H - 40, sy(c, b.y)));
      // Pájaro por delante: su silueta en el borde, latiendo
      const pulse = 0.55 + 0.45 * Math.sin(t / 120);
      drawSprite(ctx, sprite('cn-bird-u', 10, 8, paintBird(true), RES), v.x1 - 22, py, 20, 16, 0, pulse);
      label(ctx, '!', v.x1 - 8, py - 2, { size: 13, color: '#ff8a9a', alpha: pulse });
    }
  }

  if (aiming) drawAimUI(ctx, v, g, c, t);
  drawSpeedLines(ctx, e.lines, e.lineAng);
  fs.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, v: View, c: Cam, groundY: number, t: number) {
  const W = v.x1 - v.x0;
  // Cielo de atardecer: más oscuro cuanto más alto
  const hi = Math.min(1, c.y / 400);
  const sky = ctx.createLinearGradient(0, v.y0, 0, groundY);
  sky.addColorStop(0, mix('#2a2468', '#0d0b2e', hi));
  sky.addColorStop(0.55, mix('#7a4aa0', '#3a2a7a', hi));
  sky.addColorStop(0.85, mix('#ff8a6a', '#b65a8a', hi));
  sky.addColorStop(1, mix('#ffc27a', '#ff8a6a', hi));
  ctx.fillStyle = sky;
  ctx.fillRect(v.x0, v.y0, W, Math.max(0, groundY - v.y0) + 2);
  if (groundY < v.y1) {
    ctx.fillStyle = '#ffc27a';
    ctx.fillRect(v.x0, groundY, W, v.y1 - groundY);
  }
  // Estrellas cuando se sube mucho
  if (hi > 0.15) {
    ctx.fillStyle = '#ffffff';
    const r = mulberry32(5);
    for (let i = 0; i < 46; i++) {
      const x = v.x0 + ((r() * W * 2 - c.x * 0.05) % W + W) % W;
      const y = v.y0 + r() * (FIELD_H * 0.7);
      ctx.globalAlpha = (hi - 0.15) * (0.4 + 0.6 * Math.abs(Math.sin(t / 700 + i)));
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    ctx.globalAlpha = 1;
  }
  // Sol que se pone
  const sunY = groundY - 70 + c.y * c.z * 0.15;
  const sunX = 250 - (c.x * 0.02) % 40;
  const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
  sun.addColorStop(0, 'rgba(255, 244, 200, 1)');
  sun.addColorStop(0.3, 'rgba(255, 210, 140, 0.9)');
  sun.addColorStop(0.32, 'rgba(255, 170, 110, 0.35)');
  sun.addColorStop(1, 'rgba(255, 140, 100, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(sunX - 90, sunY - 90, 180, 180);

  // Nubes (se repiten)
  const clouds = sprite('cn-clouds', SKY_TILE, 420, (k) => paintClouds(k, SKY_TILE, 420), 2);
  const cx = -((c.x * 0.9) % SKY_TILE);
  // La capa de nubes acaba un poco por encima del horizonte y se repite hacia arriba; baja menos que el suelo
  const cy = GROUND_SY + (groundY - GROUND_SY) * 0.4 - 120 - 420;
  for (let y = cy; y > v.y0 - 420; y -= 420) {
    if (y > v.y1) continue;
    for (let x = cx + Math.floor((v.x0 - cx) / SKY_TILE) * SKY_TILE; x < v.x1; x += SKY_TILE) ctx.drawImage(clouds, x, y, SKY_TILE, 420);
  }

  // Ciudad lejana y cercana
  const farY = GROUND_SY + (groundY - GROUND_SY) * 0.3;
  const nearY = GROUND_SY + (groundY - GROUND_SY) * 0.6;
  const far = sprite('cn-far', SKY_TILE, 300, (k) => paintSkyline(k, SKY_TILE, 300, 3, '#6a3f86', 'rgba(255, 220, 150, 0.35)', 95), 2);
  const near = sprite('cn-near', SKY_TILE, 300, (k) => paintSkyline(k, SKY_TILE, 300, 9, '#3a2453', 'rgba(255, 214, 120, 0.7)', 70), 2);
  for (const [spr, base, f] of [
    [far, farY, 0.25],
    [near, nearY, 0.6],
  ] as const) {
    const top = base - 160;
    if (top > v.y1) continue;
    const ox = -((c.x * f * 2) % SKY_TILE);
    for (let x = ox + Math.floor((v.x0 - ox) / SKY_TILE) * SKY_TILE; x < v.x1; x += SKY_TILE) ctx.drawImage(spr, x, top, SKY_TILE, 300);
  }
}

function drawFair(ctx: CanvasRenderingContext2D, t: number, vis: (x: number, m?: number) => boolean) {
  // Noria
  const wx = 46;
  const wy = 27;
  if (vis(wx, WHEEL_R + 4)) {
    ctx.strokeStyle = '#c9a3d9';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(wx - 13, 0);
    ctx.lineTo(wx, -wy);
    ctx.lineTo(wx + 13, 0);
    ctx.stroke();
    drawSprite(ctx, sprite('cn-wheel', 44, 44, paintWheel, 8), wx, -wy, 44, 44, t / 6000);
    const cols = ['#ff4d6d', '#4dabff', '#ffd23d', '#5ee08a'];
    for (let i = 0; i < 8; i++) {
      const a = t / 6000 + (i / 8) * Math.PI * 2;
      const gx = wx + Math.cos(a) * WHEEL_R;
      const gy = -wy + Math.sin(a) * WHEEL_R;
      ctx.fillStyle = cols[i % 4];
      ctx.beginPath();
      ctx.moveTo(gx - 1.6, gy + 0.6);
      ctx.lineTo(gx + 1.6, gy + 0.6);
      ctx.lineTo(gx + 1.2, gy + 3.4);
      ctx.lineTo(gx - 1.2, gy + 3.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Carpas
  const tent = sprite('cn-tent', 26, 22, paintTent, RES);
  for (const x of [-18, 82, 110]) if (vis(x, 14)) drawSprite(ctx, tent, x, -11, 26, 22);
  // Guirnalda de bombillas
  ctx.strokeStyle = 'rgba(40, 20, 50, 0.7)';
  ctx.lineWidth = 0.18;
  const poles = [-30, -6, 20, 68, 96, 124];
  ctx.fillStyle = '#5a3a2a';
  for (const p of poles) if (vis(p, 2)) ctx.fillRect(p - 0.3, -15, 0.6, 15);
  const cols = ['#ffe066', '#ff7ab6', '#7ad7ff', '#9cff8a'];
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i];
    const b = poles[i + 1];
    if (!vis(a, 30) && !vis(b, 30)) continue;
    ctx.beginPath();
    ctx.moveTo(a, -15);
    ctx.quadraticCurveTo((a + b) / 2, -9, b, -15);
    ctx.stroke();
    const n = Math.round((b - a) / 3);
    for (let k = 1; k < n; k++) {
      const u = k / n;
      const x = a + (b - a) * u;
      const y = -15 + 2 * u * (1 - u) * 6 * 2;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 250 + k + i);
      ctx.fillStyle = cols[(k + i) % 4];
      ctx.beginPath();
      ctx.arc(x, y + 0.6, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, color: string, t: number) {
  ctx.fillStyle = '#eee';
  ctx.fillRect(x - 0.25, -16, 0.5, 16);
  const w = Math.sin(t / 200) * 0.6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 0.25, -16);
  ctx.quadraticCurveTo(x + 3, -15.6 + w, x + 6, -14.5 + w);
  ctx.quadraticCurveTo(x + 3, -13 - w, x + 0.25, -12);
  ctx.closePath();
  ctx.fill();
}

function flagLabel(ctx: CanvasRenderingContext2D, c: Cam, x: number, text: string, color: string, dy = 0) {
  const px = sx(c, x);
  const py = sy(c, 18.5) + dy;
  if (px < -80 || px > FIELD_W + 80 || py > FIELD_H + 20) return;
  label(ctx, text, px, py, { size: 9, color });
}

function drawCannon(ctx: CanvasRenderingContext2D, g: CannonGame, recoil: number, t: number) {
  const a = (g.angle * Math.PI) / 180;
  const shake = g.phase === 'power' ? g.power * 0.25 * Math.sin(t / 25) : 0;
  ctx.save();
  ctx.translate(PIVOT_X - Math.cos(a) * recoil * 2, -PIVOT_Y + Math.sin(a) * recoil * 2 + shake);
  ctx.rotate(-a);
  ctx.drawImage(sprite('cn-barrel', 22, 8, paintBarrel, RES), -5, -4, 22, 8);
  ctx.restore();
  drawSprite(ctx, sprite('cn-stand', 13.4, 13, paintStand, RES), PIVOT_X, -PIVOT_Y + 4 - 0.5, 13.4, 13);
}

function drawMayor(ctx: CanvasRenderingContext2D, g: CannonGame, e: Extra, aiming: boolean, t: number) {
  let x = g.x;
  let y = g.y;
  const r = e.rot;
  if (aiming) {
    // Dentro del cañón: asoma la cabeza por la boca
    const a = (g.angle * Math.PI) / 180;
    x = PIVOT_X + Math.cos(a) * (BARREL - 3.2);
    y = PIVOT_Y + Math.sin(a) * (BARREL - 3.2);
  }
  const landed = g.phase === 'landed' || g.phase === 'shop' || g.phase === 'over';
  const gliding = !aiming && !landed && g.lv.glider > 0 && !g.ground && g.vy < 0;
  ctx.save();
  ctx.translate(x, -y);
  ctx.rotate(r);
  // Alas del planeador entre brazos y piernas
  if (gliding || (g.lv.glider > 0 && !aiming && !landed)) {
    const open = gliding ? 1 : 0.35;
    const span = (4.5 + g.lv.glider * 0.8) * open + 3;
    ctx.fillStyle = 'rgba(122, 215, 255, 0.55)';
    ctx.strokeStyle = '#d8f3ff';
    ctx.lineWidth = 0.25;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 4.4, -4.4);
      ctx.lineTo(s * span, 0.5);
      ctx.lineTo(s * 1.6, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  // Cohetes a los lados
  if (g.lv.rocket > 0 && !aiming) {
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#d6d9e8';
      ctx.fillRect(s * 4 - 0.8, -0.5, 1.6, 4);
      ctx.fillStyle = '#e8283c';
      ctx.fillRect(s * 4 - 0.8, 2.6, 1.6, 0.9);
      ctx.beginPath();
      ctx.moveTo(s * 4 - 0.8, -0.5);
      ctx.lineTo(s * 4, -2.2);
      ctx.lineTo(s * 4 + 0.8, -0.5);
      ctx.closePath();
      ctx.fill();
      if (g.burning) {
        const fl = 2.5 + Math.random() * 2.5;
        ctx.fillStyle = '#ffb938';
        ctx.beginPath();
        ctx.moveTo(s * 4 - 0.7, 3.5);
        ctx.lineTo(s * 4 + 0.7, 3.5);
        ctx.lineTo(s * 4, 3.5 + fl);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.moveTo(s * 4 - 0.35, 3.5);
        ctx.lineTo(s * 4 + 0.35, 3.5);
        ctx.lineTo(s * 4, 3.5 + fl * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // Muelles en los pies
  if (g.lv.springs > 0 && !aiming) {
    ctx.strokeStyle = '#c0c6dc';
    ctx.lineWidth = 0.3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) ctx.lineTo(s * 1.9 + (i % 2 ? 0.6 : -0.6), 5.2 + i * 0.35);
      ctx.stroke();
    }
  }
  const mode = aiming ? 'aim' : landed ? 'dizzy' : 'fly';
  ctx.drawImage(sprite(`cn-mayor-${mode}`, 11, 17, paintMayor(mode), RES), -5.5, -8.5, 11, 17);
  // Gafas del traje aerodinámico
  if (g.lv.suit > 0) {
    ctx.fillStyle = 'rgba(122, 215, 255, 0.85)';
    ctx.strokeStyle = '#2a2238';
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.ellipse(-0.8, -5.6, 0.75, 0.6, 0, 0, Math.PI * 2);
    ctx.ellipse(0.8, -5.6, 0.75, 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (e.hat.on) ctx.drawImage(sprite('cn-hat', 5.4, 4.4, paintHat, RES), 0.2 - 2.7, -8.6 - 2.2, 5.4, 4.4);
  ctx.restore();
  // Estrellitas de mareo al pararse
  if (landed) {
    for (let i = 0; i < 3; i++) {
      const a = t / 300 + (i * Math.PI * 2) / 3;
      label(ctx, '★', x + Math.cos(a) * 3, -y - 9 + Math.sin(a) * 0.9, { size: 2.2, color: '#ffe066' });
    }
  }
}

function drawAimUI(ctx: CanvasRenderingContext2D, v: View, g: CannonGame, c: Cam, t: number) {
  const px = sx(c, PIVOT_X);
  const py = sy(c, PIVOT_Y);
  const R = 30 * c.z;
  const rad = (d: number) => (-d * Math.PI) / 180;
  // Arco del ángulo con la zona perfecta
  ctx.lineCap = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(10, 8, 30, 0.45)';
  ctx.beginPath();
  ctx.arc(px, py, R, rad(ANGLE_MAX), rad(ANGLE_MIN));
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(px, py, R, rad(ANGLE_MAX), rad(ANGLE_MIN));
  ctx.stroke();
  ctx.strokeStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(px, py, R, rad(PERFECT_ANGLE[1]), rad(PERFECT_ANGLE[0]));
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Aguja
  const a = rad(g.angle);
  const locked = g.phase === 'power';
  const col = locked ? (g.perfectA ? '#7dffa8' : '#ffffff') : '#ffc23d';
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(a) * (BARREL + 2) * c.z, py + Math.sin(a) * (BARREL + 2) * c.z);
  ctx.lineTo(px + Math.cos(a) * (R + 10), py + Math.sin(a) * (R + 10));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(px + Math.cos(a) * R, py + Math.sin(a) * R, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,8,30,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  label(ctx, `${Math.round(g.angle)}°`, px + Math.cos(a) * (R + 26), py + Math.sin(a) * (R + 26), { size: 13, color: col });

  // Barra de fuerza
  if (g.phase === 'power') {
    const bx = Math.min(v.x1, FIELD_W) - 52;
    const top = 190;
    const h = 260;
    const w = 30;
    ctx.fillStyle = 'rgba(10, 8, 30, 0.6)';
    roundRect(ctx, bx - 5, top - 5, w + 10, h + 10, 12);
    ctx.fill();
    const fill = ctx.createLinearGradient(0, top + h, 0, top);
    fill.addColorStop(0, '#4dabff');
    fill.addColorStop(0.55, '#ffc23d');
    fill.addColorStop(1, '#ff4d6d');
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, bx, top, w, h, 8);
    ctx.fill();
    ctx.fillStyle = fill;
    const fh = h * g.power;
    roundRect(ctx, bx, top + h - fh, w, fh, 8);
    ctx.fill();
    // Zona perfecta
    const pz = h * (1 - PERFECT_POWER);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    roundRect(ctx, bx - 2, top - 2, w + 4, pz + 4, 9);
    ctx.stroke();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 120);
    label(ctx, '¡MAX!', bx + w / 2, top - 16, { size: 11, color: '#7dffa8' });
    ctx.globalAlpha = 1;
    // Marcador
    const my = top + h - fh;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(bx - 4, my);
    ctx.lineTo(bx - 14, my - 7);
    ctx.lineTo(bx - 14, my + 7);
    ctx.closePath();
    ctx.fill();
    label(ctx, 'FUERZA', bx + w / 2, top + h + 18, { size: 10, color: '#ffffff' });
  }
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, lines: { x: number; y: number; l: number }[], ang: number) {
  if (!lines.length) return;
  // En la dirección del vuelo
  const dx = Math.cos(ang);
  const dy = -Math.sin(ang);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const l of lines) {
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x + l.l * dx, l.y + l.l * dy);
  }
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Mezcla dos colores #rrggbb. */
function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function CannonScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="cannon" label="Metros del mejor intento" view={(p) => <CannonGameView {...p} />} onClose={onClose} />;
}
