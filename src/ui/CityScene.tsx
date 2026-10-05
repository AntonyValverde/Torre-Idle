import { useEffect, useRef } from 'react';
import { CASINO_ERA } from '../game/casino';
import { cityLayout } from '../game/cities';
import { now } from '../game/clock';
import { FANS_GROUPS, activeDays, cupPhase } from '../game/cup';
import type { GameState } from '../game/state';
import { BUILDINGS, eraHue, isBoosted, isTapBoosted } from '../game/economy';
import { fmt } from '../game/format';
import { hasDeco } from '../game/pass';
import { useGame } from '../game/store';
import { mulberry32 } from '../minigames/rng';
import { celebrating } from './celebrate';
import { sfx, vibrate } from './haptics';
import { nightAt, seasonAt, weatherAt, type Season, type Weather } from './weather';

// ---------- Aspecto de cada edificio en la escena ----------

type Roof = 'peak' | 'flat' | 'awning' | 'chimney' | 'dome' | 'antenna' | 'bowl' | 'rocket' | 'saucer' | 'portal' | 'solar' | 'spire' | 'sphere';

interface Spec {
  w: number;
  h: number;
  hue: number;
  sat: number;
  light: number;
  roof: Roof;
}

// Mismo orden que BUILDINGS
const SPECS: Spec[] = [
  { w: 22, h: 20, hue: 25, sat: 45, light: 38, roof: 'peak' },
  { w: 28, h: 32, hue: 12, sat: 55, light: 52, roof: 'peak' },
  { w: 32, h: 40, hue: 170, sat: 45, light: 42, roof: 'awning' },
  { w: 40, h: 52, hue: 230, sat: 12, light: 45, roof: 'chimney' },
  { w: 38, h: 70, hue: 42, sat: 35, light: 62, roof: 'dome' },
  { w: 32, h: 125, hue: 215, sat: 55, light: 50, roof: 'antenna' },
  { w: 58, h: 46, hue: 140, sat: 35, light: 42, roof: 'bowl' },
  { w: 26, h: 140, hue: 220, sat: 15, light: 80, roof: 'rocket' },
  { w: 44, h: 112, hue: 268, sat: 50, light: 58, roof: 'saucer' },
  { w: 40, h: 132, hue: 285, sat: 60, light: 45, roof: 'portal' },
  { w: 36, h: 158, hue: 45, sat: 80, light: 55, roof: 'solar' },
  { w: 18, h: 205, hue: 200, sat: 20, light: 70, roof: 'spire' },
  { w: 50, h: 98, hue: 220, sat: 10, light: 78, roof: 'dome' },
  { w: 48, h: 148, hue: 30, sat: 90, light: 55, roof: 'sphere' },
  { w: 44, h: 182, hue: 250, sat: 55, light: 38, roof: 'spire' },
  { w: 40, h: 212, hue: 325, sat: 80, light: 58, roof: 'portal' },
];

interface Structure {
  x: number;
  w: number;
  h: number;
  spec: Spec;
  seed: number;
  back: boolean;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  gold: boolean;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  crit: boolean;
}

interface Car {
  x: number;
  lane: number;
  dir: number;
  speed: number;
  hue: number;
}

interface Walker {
  x: number;
  dir: number;
  speed: number;
  hue: number;
  phase: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  top: number;
  hue: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

/** Estallido de los fuegos artificiales del pase: las chispas se calculan a partir de su edad (sin asignar nada por frame). */
interface Burst {
  x: number;
  y: number;
  hue: number;
  age: number;
  life: number;
  vx: Float32Array;
  vy: Float32Array;
}

interface Drop {
  x: number;
  y: number;
  v: number;
  phase: number;
}

const XMAS_LIGHTS = ['#ff4d4d', '#3dff8a', '#ffd24a', '#5ab8ff'];

/** ¿Está la afición en la calle? Inscrito en la Copa de este fin de semana y con 3 días jugados entre semana. */
function fansOut(s: GameState): boolean {
  const info = cupPhase(s.lastTick);
  return info.phase !== 'signup' && s.cup.week === info.week && activeDays(s.cup, info.week) >= FANS_GROUPS;
}

// ---------- Cielo según la hora real ----------

const SKY: [number, string, string][] = [
  [0, '#070620', '#1d1850'],
  [5, '#0d0b2e', '#2c2168'],
  [6.5, '#3b2d7a', '#ff9e7a'],
  [8, '#4a70d6', '#a8c8ff'],
  [16.5, '#4166cc', '#9dbdff'],
  [18.5, '#3a2a7a', '#ff8a5c'],
  [20, '#1a1446', '#4a2f7a'],
  [24, '#070620', '#1d1850'],
];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
}

function skyAt(hour: number): [string, string] {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i];
    const [h1, t1, b1] = SKY[i + 1];
    if (hour >= h0 && hour <= h1) {
      const k = (hour - h0) / (h1 - h0);
      return [mix(t0, t1, k), mix(b0, b1, k)];
    }
  }
  return [SKY[0][1], SKY[0][2]];
}

/** Coloca los edificios alrededor del ayuntamiento: los más altos cerca del centro. */
function buildLayout(key: string, W: number, scale: number): Structure[] {
  // Una ciudad de otra versión del juego puede traer más tipos de edificio de los que sabemos dibujar
  const counts = key.split(',').map(Number).slice(0, SPECS.length);
  const items: { tier: number; seed: number }[] = [];
  counts.forEach((c, tier) => {
    for (let k = 0; k < c; k++) items.push({ tier, seed: tier * 7919 + k * 104729 + 17 });
  });
  items.sort((a, b) => b.tier - a.tier || a.seed - b.seed);

  const center = W / 2;
  const hallHalf = 48 * scale;
  const slots = {
    front: { left: center - hallHalf + 4 * scale, right: center + hallHalf - 4 * scale },
    back: { left: center - 8 * scale, right: center + 8 * scale },
  };
  const out: Structure[] = [];
  let side = 0;

  const tryPlace = (row: 'front' | 'back', goLeft: boolean, w: number, h: number, spec: Spec, seed: number) => {
    const slot = slots[row];
    if (goLeft) {
      if (slot.left - w < -w * 0.4) return false;
      out.push({ x: slot.left - w, w, h, spec, seed, back: row === 'back' });
      slot.left -= w * (row === 'back' ? 0.85 : 0.95);
    } else {
      if (slot.right + w > W + w * 0.4) return false;
      out.push({ x: slot.right, w, h, spec, seed, back: row === 'back' });
      slot.right += w * (row === 'back' ? 0.85 : 0.95);
    }
    return true;
  };

  for (const it of items) {
    const spec = SPECS[it.tier];
    const r = mulberry32(it.seed);
    const w = spec.w * scale * (0.85 + r() * 0.3);
    const h = spec.h * scale * (0.85 + r() * 0.3);
    const goLeft = side++ % 2 === 0;
    if (tryPlace('front', goLeft, w, h, spec, it.seed)) continue;
    if (tryPlace('front', !goLeft, w, h, spec, it.seed)) continue;
    if (tryPlace('back', goLeft, w * 0.85, h * 1.1, spec, it.seed)) continue;
    tryPlace('back', !goLeft, w * 0.85, h * 1.1, spec, it.seed);
  }
  // Primero la fila de atrás; en la de delante, de los bordes hacia el centro
  const back = out.filter((s) => s.back);
  const front = out.filter((s) => !s.back).sort((a, b) => Math.abs(b.x + b.w / 2 - center) - Math.abs(a.x + a.w / 2 - center));
  return [...back, ...front];
}

function drawStructure(ctx: CanvasRenderingContext2D, st: Structure, groundY: number, scale: number, night: number) {
  const { x, w, h, spec, seed, back } = st;
  const y = groundY - h;
  const dark = back ? -14 : 0;
  const L = spec.light + dark - night * 12;
  const body = ctx.createLinearGradient(x, y, x + w, y);
  body.addColorStop(0, `hsl(${spec.hue} ${spec.sat}% ${L + 6}%)`);
  body.addColorStop(1, `hsl(${spec.hue} ${spec.sat}% ${L - 8}%)`);
  ctx.fillStyle = body;

  const roofColor = `hsl(${spec.hue} ${spec.sat}% ${L - 16}%)`;
  const glow = `hsl(${spec.hue} 95% 70%)`;

  // Cuerpo
  if (spec.roof === 'bowl') {
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + w * 0.08, y);
    ctx.lineTo(x + w * 0.92, y);
    ctx.lineTo(x + w, groundY);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }

  // Techos y detalles
  ctx.fillStyle = roofColor;
  switch (spec.roof) {
    case 'peak':
      ctx.beginPath();
      ctx.moveTo(x - 3 * scale, y);
      ctx.lineTo(x + w / 2, y - h * 0.55);
      ctx.lineTo(x + w + 3 * scale, y);
      ctx.fill();
      break;
    case 'awning':
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : '#ff5a5a';
        ctx.fillRect(x + (w / 5) * i, groundY - 16 * scale, w / 5, 5 * scale);
      }
      break;
    case 'chimney':
      ctx.fillRect(x + w * 0.65, y - 16 * scale, 7 * scale, 16 * scale);
      ctx.fillRect(x + w * 0.2, y - 10 * scale, 6 * scale, 10 * scale);
      break;
    case 'dome':
      ctx.beginPath();
      ctx.arc(x + w / 2, y, w * 0.42, Math.PI, 0);
      ctx.fill();
      break;
    case 'antenna':
      ctx.fillRect(x + w / 2 - 1 * scale, y - 22 * scale, 2 * scale, 22 * scale);
      ctx.fillRect(x + w * 0.15, y - 4 * scale, w * 0.7, 4 * scale);
      break;
    case 'bowl':
      ctx.fillStyle = `rgba(255,255,230,${0.35 + night * 0.5})`;
      ctx.fillRect(x + w * 0.1, y - 14 * scale, 2 * scale, 14 * scale);
      ctx.fillRect(x + w * 0.88, y - 14 * scale, 2 * scale, 14 * scale);
      break;
    case 'rocket':
      ctx.fillStyle = '#e8ecf6';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y);
      ctx.lineTo(x + w / 2, y - 30 * scale);
      ctx.lineTo(x + w * 0.8, y);
      ctx.fill();
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(x + w * 0.35, y - 12 * scale, w * 0.3, 4 * scale);
      break;
    case 'saucer':
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y - 6 * scale, w * 0.75, 8 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,240,255,.8)';
      ctx.beginPath();
      ctx.arc(x + w / 2, y - 10 * scale, w * 0.25, Math.PI, 0);
      ctx.fill();
      break;
    case 'portal':
      ctx.strokeStyle = glow;
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.arc(x + w / 2, y - w * 0.4, w * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `hsla(${spec.hue} 95% 70% / .35)`;
      ctx.fill();
      break;
    case 'solar':
      ctx.fillStyle = '#23407a';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 * scale + i * (w / 2.4), y - 10 * scale, w / 2.8, 6 * scale);
      break;
    case 'spire':
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y);
      ctx.lineTo(x + w / 2, y - 40 * scale);
      ctx.lineTo(x + w * 0.7, y);
      ctx.fill();
      break;
    case 'sphere':
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + w / 2, y - w * 0.3, w * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flat':
      break;
  }

  // Ventanas
  const rand = mulberry32(seed * 31 + 7);
  const litRatio = 0.12 + night * 0.62;
  const ww = 3.5 * scale;
  const wh = 5 * scale;
  const cols = Math.max(1, Math.floor((w - 6 * scale) / (7 * scale)));
  const rows = Math.max(1, Math.floor((h - 14 * scale) / (9 * scale)));
  const gapX = (w - cols * ww) / (cols + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand() < litRatio;
      if (lit) ctx.fillStyle = `rgba(255,${210 + Math.floor(rand() * 40)},120,${0.55 + night * 0.45})`;
      else ctx.fillStyle = night > 0.5 ? 'rgba(10,10,40,.55)' : 'rgba(210,235,255,.35)';
      ctx.fillRect(x + gapX + c * (ww + gapX), y + 6 * scale + r * 9 * scale, ww, wh);
    }
  }
  if (back) {
    ctx.fillStyle = `rgba(10,8,40,${0.25 + night * 0.2})`;
    ctx.fillRect(x, y, w, h);
  }
}

// ---------- Componente ----------

/** Ciudad de otro jugador: se dibuja con sus edificios y su era, sin recaudar al tocar. */
export interface CityVisitView {
  layout: string;
  era: number;
  buildings: number;
  /** Copas ganadas: oro, plata, bronce y temporadas. */
  cups?: [number, number, number, number];
  /** Temporadas de Conquista ganadas. */
  conq?: number;
  /** Cosméticos del pase de temporada de esa ciudad. */
  decos?: string[];
}

/** Distancia máxima (px) entre tocar y soltar para que cuente como toque y no como desplazamiento. */
const TAP_SLOP = 10;

export function CityScene({ visit, paused = false }: { visit?: CityVisitView; paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visitRef = useRef(visit);
  const pausedRef = useRef(paused);
  // Reanuda el bucle de dibujo (lo asigna el efecto principal)
  const resumeRef = useRef<() => void>(() => {});
  useEffect(() => {
    visitRef.current = visit;
  });

  // Con una pantalla completa encima (minijuego, visita, Copa, panel) no se dibuja: ahorra batería
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) resumeRef.current();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cache = document.createElement('canvas');
    const cctx = cache.getContext('2d')!;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let scale = 1;
    let structures: Structure[] = [];
    let key = '';
    let cacheNight = -1;
    let cacheAt = 0;

    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.62, r: Math.random() * 1.3 + 0.3, tw: Math.random() * 6 }));
    // Hasta 7 nubes: con buen tiempo solo se dibujan las 3 primeras
    const clouds = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: 0.08 + (i % 4) * 0.08, s: 0.7 + Math.random() * 0.6, v: 0.004 + Math.random() * 0.006 }));
    const drops: Drop[] = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), v: 0.8 + Math.random() * 0.5, phase: Math.random() * 6 }));
    const walkers: Walker[] = [];
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    let flash = 0;
    let weather: Weather = 'clear';
    let season: Season = null;
    let weatherAtMs = -Infinity;
    const far = Array.from({ length: 26 }, (_, i) => ({ x: i / 26 + Math.random() * 0.02, w: 0.03 + Math.random() * 0.05, h: 0.15 + Math.random() * 0.22 }));
    const coins: Coin[] = [];
    const texts: FloatText[] = [];
    const cars: Car[] = [];
    const confetti: { x: number; y: number; v: number; hue: number; r: number }[] = [];
    let pulse = 0;
    let shake = 0;
    // Zepelín dorado (cosmético del pase): posición horizontal relativa, da la vuelta sin fin
    let zepX = Math.random();
    // Resto de cosméticos del pase: bandada, cometas y fuegos de cada noche
    const LANTERN_COLORS = ['#ff5a5a', '#ffb13d', '#ffe24a', '#4ddc8a', '#4ab8ff', '#ff6fd8', '#c38bff'];
    let birdT = Math.random() * 40;
    const kites = [350, 48, 200].map((hue, i) => ({ x: 0.2 + i * 0.3, y: 0.2 + (i % 2) * 0.07, hue, phase: i * 2.1 }));
    const decoBursts: Burst[] = [];
    const decoRocket = { alive: false, x: 0, y: 0, vy: 0, top: 0, hue: 0 };
    let decoFuse = 3 + Math.random() * 3;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      scale = Math.min(H / 300, W / 360);
      for (const c of [canvas, cache]) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      key = '';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const groundY = () => H - 30 * scale;

    function renderCache(night: number) {
      cctx.clearRect(0, 0, W, H);
      for (const st of structures) drawStructure(cctx, st, groundY(), scale, night);
      cacheNight = night;
      cacheAt = performance.now();
    }

    function drawHall(t: number, night: number, boosted: boolean, era: number) {
      const gy = groundY();
      const k = scale * (1 + pulse * 0.07);
      const cx = W / 2;
      // Aura
      const auraR = 90 * k;
      const aura = ctx.createRadialGradient(cx, gy - 50 * k, 5, cx, gy - 50 * k, auraR);
      const a = 0.25 + pulse * 0.35 + (boosted ? 0.15 + Math.sin(t / 300) * 0.08 : 0);
      aura.addColorStop(0, boosted ? `rgba(255,200,80,${a})` : `rgba(255,230,160,${a})`);
      aura.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(cx - auraR, gy - 50 * k - auraR, auraR * 2, auraR * 2);

      const stone = night > 0.5 ? '#cfc6e8' : '#f3ecdf';
      const shade = night > 0.5 ? '#9d93c4' : '#cfc2a8';
      // Escalones
      ctx.fillStyle = shade;
      ctx.fillRect(cx - 50 * k, gy - 6 * k, 100 * k, 6 * k);
      ctx.fillStyle = stone;
      ctx.fillRect(cx - 45 * k, gy - 11 * k, 90 * k, 5 * k);
      // Cuerpo y columnas
      ctx.fillStyle = shade;
      ctx.fillRect(cx - 40 * k, gy - 52 * k, 80 * k, 41 * k);
      ctx.fillStyle = `rgba(255,214,110,${0.35 + night * 0.6})`;
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 32 * k + i * 18 * k, gy - 44 * k, 10 * k, 28 * k);
      ctx.fillStyle = stone;
      for (let i = 0; i < 5; i++) ctx.fillRect(cx - 38 * k + i * 18 * k, gy - 52 * k, 6 * k, 41 * k);
      // Frontón
      ctx.fillStyle = stone;
      ctx.fillRect(cx - 44 * k, gy - 58 * k, 88 * k, 6 * k);
      ctx.beginPath();
      ctx.moveTo(cx - 46 * k, gy - 58 * k);
      ctx.lineTo(cx, gy - 80 * k);
      ctx.lineTo(cx + 46 * k, gy - 58 * k);
      ctx.fill();
      // Cúpula y bandera
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath();
      ctx.arc(cx, gy - 80 * k, 13 * k, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = shade;
      ctx.fillRect(cx - 1 * k, gy - 106 * k, 2 * k, 14 * k);
      const hue = eraHue(era);
      ctx.fillStyle = `hsl(${hue} 85% 60%)`;
      const wave = Math.sin(t / 250) * 2 * k;
      ctx.beginPath();
      ctx.moveTo(cx + 1 * k, gy - 106 * k);
      ctx.lineTo(cx + 15 * k, gy - 102 * k + wave);
      ctx.lineTo(cx + 1 * k, gy - 97 * k);
      ctx.fill();
    }

    // El clima se recalcula cada pocos segundos (con la hora de confianza: es el mismo para todos)
    function updateWeather(t: number) {
      if (t - weatherAtMs < 5000) return;
      weatherAtMs = t;
      const ms = now();
      weather = weatherAt(ms);
      season = seasonAt(ms);
    }

    /** Zepelín dorado que cruza el cielo despacio: una elipse, una aleta, una góndola y un brillo cálido de noche. */
    function drawZeppelin(t: number, dt: number, night: number) {
      zepX += dt * 0.014;
      if (zepX > 1.18) zepX = -0.18;
      const x = zepX * W;
      const y = H * 0.2 + Math.sin(t / 1800) * 4 * scale;
      const rx = 20 * scale;
      const ry = 7 * scale;
      if (night > 0.2) {
        const g = ctx.createRadialGradient(x, y, ry, x, y, rx * 1.8);
        g.addColorStop(0, `rgba(255,205,90,${0.22 * night})`);
        g.addColorStop(1, 'rgba(255,205,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rx * 1.8, y - rx * 1.8, rx * 3.6, rx * 3.6);
      }
      // Aleta trasera
      ctx.fillStyle = '#c98a1c';
      ctx.beginPath();
      ctx.moveTo(x - rx * 0.75, y);
      ctx.lineTo(x - rx * 1.15, y - ry * 1.3);
      ctx.lineTo(x - rx * 0.45, y - ry * 0.4);
      ctx.fill();
      // Cuerpo
      const body = ctx.createLinearGradient(x, y - ry, x, y + ry);
      body.addColorStop(0, '#ffe58a');
      body.addColorStop(0.55, '#f2b93b');
      body.addColorStop(1, '#b8771a');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // Góndola con ventanita encendida
      ctx.fillStyle = '#6b4512';
      ctx.fillRect(x - 4 * scale, y + ry - 1 * scale, 8 * scale, 3.5 * scale);
      ctx.fillStyle = `rgba(255,236,170,${0.5 + night * 0.5})`;
      ctx.fillRect(x - 1 * scale, y + ry, 2 * scale, 2 * scale);
    }

    // ---------- Cosméticos del pase de temporada (cada uno solo si la ciudad lo tiene activo) ----------

    /** Aurora boreal: tres cortinas verdes, violetas y turquesas que ondean despacio, solo de noche y detrás de las nubes. */
    function drawAurora(t: number, night: number) {
      const colors = ['110,255,180', '160,120,255', '90,220,255'];
      for (let i = 0; i < 3; i++) {
        const y0 = H * (0.05 + i * 0.055);
        const thick = (14 + i * 4) * scale;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + thick * 2.2);
        g.addColorStop(0, `rgba(${colors[i]},0)`);
        g.addColorStop(0.35, `rgba(${colors[i]},${0.17 * night})`);
        g.addColorStop(1, `rgba(${colors[i]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-10, y0);
        for (let x = 0; x <= W + 20; x += 16) ctx.lineTo(x, y0 + Math.sin(x / (70 + i * 15) + t / (1600 + i * 500)) * 9 * scale);
        for (let x = W + 20; x >= 0; x -= 16) ctx.lineTo(x, y0 + thick * 1.6 + Math.sin(x / (55 + i * 10) - t / (1900 + i * 400)) * 12 * scale);
        ctx.closePath();
        ctx.fill();
      }
    }

    /** Bandada: nueve pájaros en "V" suelta que cruzan el cielo cada 40 s, aleteando. */
    function drawBirds(t: number, dt: number, night: number) {
      birdT += dt;
      const p = (birdT % 40) / 40;
      const lx = W * (-0.15 + p * 1.3);
      const ly = H * 0.15 + Math.sin(t / 2300) * 10 * scale;
      ctx.strokeStyle = `rgba(30,24,60,${0.8 - night * 0.45})`;
      ctx.lineWidth = Math.max(1, 1.1 * scale);
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const row = Math.ceil(i / 2);
        const side = i % 2 ? -1 : 1;
        const x = lx - row * 9 * scale + Math.sin(t / 900 + i * 1.7) * 2 * scale;
        const y = ly + side * row * 5.5 * scale + Math.sin(t / 1100 + i) * 2 * scale;
        const flap = Math.sin(t / 110 + i * 0.9) * 2.2 * scale;
        ctx.moveTo(x - 3.2 * scale, y - flap);
        ctx.lineTo(x, y + 0.6 * scale);
        ctx.lineTo(x + 3.2 * scale, y - flap);
      }
      ctx.stroke();
    }

    /** Cometas: tres rombos de colores con cola ondulante que van a la deriva por lo alto; de noche apenas se ven. */
    function drawKites(t: number, night: number) {
      ctx.globalAlpha = 1 - night * 0.55;
      const w = 4.5 * scale;
      const h = 6.5 * scale;
      for (const k of kites) {
        const x = (k.x + Math.sin(t / 4200 + k.phase) * 0.045) * W;
        const y = (k.y + Math.sin(t / 1700 + k.phase * 2) * 0.02) * H;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.cos(t / 4200 + k.phase) * 0.35);
        ctx.fillStyle = `hsl(${k.hue} 85% 60%)`;
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.55);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h * 0.45);
        ctx.lineTo(-w, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(-0.4 * scale, -h * 0.55, 0.8 * scale, h);
        // Cola ondulante
        ctx.strokeStyle = `hsl(${k.hue} 70% 75%)`;
        ctx.lineWidth = Math.max(1, 0.8 * scale);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.45);
        for (let j = 1; j <= 5; j++) ctx.lineTo(Math.sin(t / 180 + k.phase + j * 1.1) * 2.5 * scale * (j / 5), h * 0.45 + j * 3.5 * scale);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /** Fuegos artificiales de cada noche: un cohete cada 4-7 s que estalla en un anillo de 20 chispas (como mucho 2 estallidos vivos). */
    function drawNightFireworks(dt: number, night: number) {
      const gy = groundY();
      const r = decoRocket;
      if (!r.alive && night > 0.4) {
        decoFuse -= dt;
        if (decoFuse <= 0 && decoBursts.length < 2) {
          decoFuse = 4 + Math.random() * 3;
          r.alive = true;
          r.x = W * (0.12 + Math.random() * 0.76);
          r.y = gy;
          r.vy = -(220 + Math.random() * 90) * scale;
          r.top = H * (0.12 + Math.random() * 0.22);
          r.hue = Math.floor(Math.random() * 360);
        }
      }
      if (r.alive) {
        r.y += r.vy * dt;
        ctx.fillStyle = `hsl(${r.hue} 90% 80%)`;
        ctx.fillRect(r.x - 1, r.y, 2 * scale, 6 * scale);
        if (r.y <= r.top) {
          r.alive = false;
          const n = 20;
          const vx = new Float32Array(n);
          const vy = new Float32Array(n);
          const v = (85 + Math.random() * 40) * scale;
          for (let k = 0; k < n; k++) {
            vx[k] = Math.cos((k / n) * Math.PI * 2) * v;
            vy[k] = Math.sin((k / n) * Math.PI * 2) * v;
          }
          decoBursts.push({ x: r.x, y: r.y, hue: r.hue, age: 0, life: 1.5, vx, vy });
        }
      }
      for (let i = decoBursts.length - 1; i >= 0; i--) {
        const b = decoBursts[i];
        b.age += dt;
        if (b.age >= b.life) {
          decoBursts.splice(i, 1);
          continue;
        }
        const k = b.age / b.life;
        if (b.age < 0.12) {
          // Destello del estallido
          ctx.globalAlpha = 1 - b.age / 0.12;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(b.x, b.y, 9 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        // Las chispas frenan al abrirse y caen por la gravedad; cada una deja una estela corta
        const drag = b.age * (1 - k * 0.45);
        const fall = 35 * scale * b.age * b.age;
        const back = Math.max(0, b.age - 0.07);
        const dragB = back * (1 - (back / b.life) * 0.45);
        const fallB = 35 * scale * back * back;
        const sz = (3 - k * 1.2) * scale;
        ctx.globalAlpha = (1 - k) * 0.45 * Math.min(1, night * 1.5);
        ctx.fillStyle = `hsl(${b.hue} 95% 80%)`;
        for (let j = 0; j < b.vx.length; j++) ctx.fillRect(b.x + b.vx[j] * dragB, b.y + b.vy[j] * dragB + fallB, sz, sz);
        ctx.globalAlpha = (1 - k) * Math.min(1, night * 1.5);
        ctx.fillStyle = `hsl(${b.hue} 95% ${65 + k * 20}%)`;
        for (let j = 0; j < b.vx.length; j++) ctx.fillRect(b.x + b.vx[j] * drag, b.y + b.vy[j] * drag + fall, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    /** Neón: perfil fino cian y magenta alternos en los bordes de cada edificio, con un halo suave; solo de noche. */
    function drawNeon(night: number) {
      const gy = groundY();
      structures.forEach((st, i) => {
        const y = gy - st.h;
        ctx.beginPath();
        if (st.spec.roof === 'bowl') {
          ctx.moveTo(st.x, gy);
          ctx.lineTo(st.x + st.w * 0.08, y);
          ctx.lineTo(st.x + st.w * 0.92, y);
          ctx.lineTo(st.x + st.w, gy);
        } else {
          ctx.moveTo(st.x, gy);
          ctx.lineTo(st.x, y);
          ctx.lineTo(st.x + st.w, y);
          ctx.lineTo(st.x + st.w, gy);
        }
        ctx.strokeStyle = i % 2 ? '#ff4fd8' : '#3df2ff';
        ctx.globalAlpha = (st.back ? 0.1 : 0.18) * night;
        ctx.lineWidth = 5 * scale;
        ctx.stroke();
        ctx.globalAlpha = (st.back ? 0.5 : 0.9) * night;
        ctx.lineWidth = Math.max(1, 1.1 * scale);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    /** Farolillos: una guirnalda en catenaria entre los edificios más cercanos al ayuntamiento, con siete farolillos que se mecen y brillan de noche. */
    function drawLanterns(t: number, night: number) {
      const gy = groundY();
      const cx = W / 2;
      let left: Structure | null = null;
      let right: Structure | null = null;
      for (const st of structures) {
        if (st.back) continue;
        if (st.x + st.w <= cx && (!left || st.x > left.x)) left = st;
        if (st.x >= cx && (!right || st.x < right.x)) right = st;
      }
      // Guirnalda nivelada a la altura del edificio más bajo de los dos (entre 60 y 110 px): se engancha en la
      // fachada del alto y, si el bajo no llega, en un poste sobre su tejado
      const hmin = Math.min(left ? left.h : Infinity, right ? right.h : Infinity);
      const y = gy - Math.max(Math.min(hmin, 110 * scale), 60 * scale);
      const anchor = (st: Structure | null, side: number) => {
        if (!st) return { x: side < 0 ? 4 * scale : W - 4 * scale, y, pole: 0 };
        return { x: side < 0 ? st.x + st.w - 2 * scale : st.x + 2 * scale, y, pole: Math.max(0, gy - st.h - y) };
      };
      const a = anchor(left, -1);
      const b = anchor(right, 1);
      const sag = 14 * scale;
      ctx.fillStyle = '#3a2f55';
      if (a.pole) ctx.fillRect(a.x - 0.6 * scale, a.y, 1.2 * scale, a.pole);
      if (b.pole) ctx.fillRect(b.x - 0.6 * scale, b.y, 1.2 * scale, b.pole);
      const at = (u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u + sag * 4 * u * (1 - u) });
      ctx.strokeStyle = `rgba(40,30,60,${0.7 - night * 0.3})`;
      ctx.lineWidth = Math.max(1, 0.7 * scale);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let u = 0.1; u <= 1.001; u += 0.1) {
        const p = at(u);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      const n = 7;
      const lw = 5 * scale;
      const lh = 6.5 * scale;
      for (let i = 0; i < n; i++) {
        const p = at((i + 1) / (n + 1));
        const x = p.x + Math.sin(t / 650 + i * 1.3) * 1.6 * scale;
        const y = p.y + 2.5 * scale;
        const col = LANTERN_COLORS[i % LANTERN_COLORS.length];
        if (night > 0.15) {
          ctx.globalAlpha = 0.22 * night;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y + lh / 2, lh * 1.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(40,30,60,.8)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x, y + lh / 2, lw / 2, lh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Luz interior, casquetes y borla
        ctx.fillStyle = `rgba(255,245,200,${0.15 + night * 0.5})`;
        ctx.fillRect(x - lw * 0.18, y + lh * 0.25, lw * 0.36, lh * 0.5);
        ctx.fillStyle = '#5a3a1e';
        ctx.fillRect(x - 1.2 * scale, y - 0.6 * scale, 2.4 * scale, 1.2 * scale);
        ctx.fillRect(x - 1.2 * scale, y + lh - 0.6 * scale, 2.4 * scale, 1.2 * scale);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(x - 0.5 * scale, y + lh + 0.6 * scale, 1 * scale, 2 * scale);
      }
    }

    /** Jardín floral: cuatro parterres con césped y florecitas de colores al pie de la escalinata del ayuntamiento. */
    function drawGarden(t: number, night: number) {
      const gy = groundY();
      const cx = W / 2;
      const s = scale;
      const hues = [350, 45, 300, 200, 20, 60];
      [-44, -24, 24, 44].forEach((off, p) => {
        const x = cx + off * s;
        const hw = 5 * s;
        ctx.fillStyle = night > 0.5 ? '#8f86b8' : '#d8cfb8';
        ctx.fillRect(x - hw - 0.8 * s, gy - 2.2 * s, hw * 2 + 1.6 * s, 2.2 * s);
        ctx.fillStyle = `hsl(125 45% ${34 - night * 10}%)`;
        ctx.beginPath();
        ctx.ellipse(x, gy - 2.2 * s, hw, 2.6 * s, 0, Math.PI, 0);
        ctx.fill();
        for (let i = 0; i < 6; i++) {
          const fx = x - hw * 0.8 + (i / 5) * hw * 1.6 + Math.sin(t / 900 + i + p) * 0.4 * s;
          const fy = gy - 3.2 * s - (i % 2) * 1.2 * s;
          ctx.fillStyle = `hsl(${hues[(i + p) % hues.length]} 85% ${65 - night * 15}%)`;
          ctx.fillRect(fx - 0.9 * s, fy - 0.9 * s, 1.8 * s, 1.8 * s);
        }
      });
    }

    /** Fuente de mármol en el centro de la plaza: pilón, columna, taza alta y un chorro con salpicaduras; de noche la baña una luz cálida. */
    function drawFountain(t: number, night: number) {
      const gy = groundY();
      const s = scale;
      const cx = W / 2;
      const marble = night > 0.5 ? '#c9c1e4' : '#f1ecf4';
      const marbleDark = night > 0.5 ? '#9a90c2' : '#cdc3d4';
      const water = night > 0.4 ? 'rgba(130,190,255,.85)' : 'rgba(80,165,255,.8)';
      if (night > 0.15) {
        ctx.fillStyle = `rgba(255,205,120,${0.22 * night})`;
        ctx.beginPath();
        ctx.arc(cx, gy - 9 * s, 24 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pilón con agua y una onda que se abre
      ctx.fillStyle = marbleDark;
      ctx.fillRect(cx - 17 * s, gy - 6 * s, 34 * s, 6 * s);
      ctx.fillStyle = marble;
      ctx.beginPath();
      ctx.ellipse(cx, gy - 6 * s, 17 * s, 3.2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.ellipse(cx, gy - 6 * s, 14.5 * s, 2.3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      const rip = (t / 1400) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - rip)})`;
      ctx.lineWidth = Math.max(1, 0.6 * s);
      ctx.beginPath();
      ctx.ellipse(cx, gy - 6 * s, (4 + rip * 9) * s, (0.7 + rip * 1.4) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Columna y taza alta
      ctx.fillStyle = marbleDark;
      ctx.fillRect(cx - 1.8 * s, gy - 15 * s, 3.6 * s, 9 * s);
      ctx.fillStyle = marble;
      ctx.beginPath();
      ctx.ellipse(cx, gy - 15 * s, 7 * s, 2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.ellipse(cx, gy - 15.2 * s, 5.5 * s, 1.3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // Chorro central y gotas que caen en arco
      const jet = (9 + Math.sin(t / 260) * 1.2) * s;
      ctx.fillStyle = 'rgba(200,230,255,.9)';
      ctx.fillRect(cx - 0.8 * s, gy - 15 * s - jet, 1.6 * s, jet);
      ctx.beginPath();
      ctx.arc(cx, gy - 15 * s - jet, 1.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(220,240,255,.85)';
      for (let i = 0; i < 8; i++) {
        const u = (t / 700 + i / 8) % 1;
        const dx = (i % 2 ? -1 : 1) * u * (5 + (i % 3)) * s;
        const dy = -u * 3 * s + u * u * 14 * s;
        ctx.fillRect(cx + dx - 0.6 * s, gy - 15 * s - jet + dy, 1.2 * s, 1.2 * s);
      }
    }

    /** Estatua dorada del alcalde sobre un pedestal, a la derecha de la escalinata, con el brazo en alto; de noche la baña una luz cálida. */
    function drawStatue(t: number, night: number) {
      const gy = groundY();
      const s = scale * 1.15;
      const x = W / 2 + 36 * scale;
      const base = gy - 7 * s;
      if (night > 0.15) {
        ctx.fillStyle = `rgba(255,200,110,${0.2 * night})`;
        ctx.beginPath();
        ctx.arc(x, base - 8 * s, 11 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pedestal de dos cuerpos
      ctx.fillStyle = night > 0.5 ? '#8f86b8' : '#d8cfb8';
      ctx.fillRect(x - 5 * s, gy - 2.5 * s, 10 * s, 2.5 * s);
      ctx.fillStyle = night > 0.5 ? '#b0a6d6' : '#efe7d3';
      ctx.fillRect(x - 3.5 * s, base, 7 * s, 4.5 * s);
      // Figura: piernas, cuerpo, cabeza y brazos (uno en alto con la antorcha)
      const gold = night > 0.5 ? '#d9a52a' : '#f2c13c';
      ctx.fillStyle = gold;
      ctx.fillRect(x - 1.8 * s, base - 5 * s, 1.4 * s, 5 * s);
      ctx.fillRect(x + 0.4 * s, base - 5 * s, 1.4 * s, 5 * s);
      ctx.fillRect(x - 2.4 * s, base - 11 * s, 4.8 * s, 6.2 * s);
      ctx.beginPath();
      ctx.arc(x, base - 12.8 * s, 1.9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1.5 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 2 * s, base - 10 * s);
      ctx.lineTo(x + 4.5 * s, base - 16 * s);
      ctx.moveTo(x - 2 * s, base - 10 * s);
      ctx.lineTo(x - 3.5 * s, base - 6 * s);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = `rgba(255,240,180,${0.35 + night * 0.4})`;
      ctx.fillRect(x - 1.6 * s, base - 10.4 * s, 1 * s, 4.5 * s);
      const flame = Math.sin(t / 150);
      ctx.fillStyle = `rgba(255,${200 + Math.floor(flame * 30)},90,${0.6 + night * 0.4})`;
      ctx.beginPath();
      ctx.arc(x + 4.6 * s, base - 17.2 * s, (1.4 + flame * 0.2) * s, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawFireworks(dt: number, launch: boolean) {
      const gy = groundY();
      if (launch && Math.random() < dt * 2.8) {
        rockets.push({
          x: W * (0.15 + Math.random() * 0.7),
          y: gy,
          vy: -(260 + Math.random() * 120) * scale,
          top: H * (0.12 + Math.random() * 0.25),
          hue: Math.floor(Math.random() * 360),
        });
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy * dt;
        ctx.fillStyle = `hsl(${r.hue} 90% 75%)`;
        ctx.fillRect(r.x - 1, r.y, 2 * scale, 5 * scale);
        if (r.y <= r.top) {
          for (let k = 0; k < 36; k++) {
            const a = (k / 36) * Math.PI * 2;
            const v = (60 + Math.random() * 70) * scale;
            sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 + Math.random() * 0.5, hue: r.hue + Math.random() * 40 });
          }
          rockets.splice(i, 1);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        p.vy += 90 * scale * dt;
        p.vx *= 1 - dt * 0.8;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.fillStyle = `hsl(${p.hue % 360} 95% 65%)`;
        ctx.fillRect(p.x, p.y, 2.2 * scale, 2.2 * scale);
      }
      ctx.globalAlpha = 1;
    }

    function drawChristmas(t: number, night: number) {
      const gy = groundY();
      // Guirnaldas de luces en los tejados de la fila de delante
      ctx.globalAlpha = 0.55 + night * 0.45;
      for (const st of structures) {
        if (st.back) continue;
        const y = gy - st.h - 1.5 * scale;
        let i = 0;
        for (let x = st.x + 3 * scale; x < st.x + st.w - 2 * scale; x += 7 * scale, i++) {
          ctx.fillStyle = XMAS_LIGHTS[(i + Math.floor(t / 450)) % XMAS_LIGHTS.length];
          ctx.fillRect(x, y, 2.2 * scale, 2.2 * scale);
        }
      }
      ctx.globalAlpha = 1;
      // Árbol junto al ayuntamiento
      const tx = W / 2 - 64 * scale;
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(tx - 2 * scale, gy - 8 * scale, 4 * scale, 8 * scale);
      ctx.fillStyle = '#1f7a3a';
      for (let k = 0; k < 3; k++) {
        const w = (16 - k * 4) * scale;
        const y0 = gy - (6 + k * 9) * scale;
        ctx.beginPath();
        ctx.moveTo(tx - w, y0);
        ctx.lineTo(tx, y0 - 14 * scale);
        ctx.lineTo(tx + w, y0);
        ctx.fill();
      }
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = XMAS_LIGHTS[(k + Math.floor(t / 600)) % XMAS_LIGHTS.length];
        ctx.fillRect(tx + Math.sin(k * 2.1) * 9 * scale * (1 - k / 8), gy - (8 + k * 4) * scale, 2 * scale, 2 * scale);
      }
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(tx, gy - 34 * scale, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    /** Vitrina de la Copa de Alcaldes junto al ayuntamiento: una copa por tipo ganado, con su número. */
    function drawTrophies(t: number, night: number, cups: [number, number, number]) {
      const kinds = ([
        ['#ffc93c', '#fff1a8', cups[0]],
        ['#c9d3e6', '#ffffff', cups[1]],
        ['#d98a4a', '#ffd2a8', cups[2]],
      ] as const).filter((k) => k[2] > 0);
      if (!kinds.length) return;
      const gy = groundY();
      // Un poco más grandes que la escala de los edificios para que se vean bien en el móvil
      const s = scale * 1.6;
      const x0 = W / 2 + 56 * scale;
      // Pedestal
      ctx.fillStyle = night > 0.5 ? '#8f86b8' : '#d8cfb8';
      ctx.fillRect(x0 - 3 * s, gy - 7 * s, kinds.length * 13 * s + 6 * s, 7 * s);
      kinds.forEach(([body, shine, n], i) => {
        const cx = x0 + 3.5 * s + i * 13 * s;
        const base = gy - 7 * s;
        // Brillo que late suavemente
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t / 500 + i);
        ctx.fillStyle = shine;
        ctx.beginPath();
        ctx.arc(cx, base - 9 * s, 8 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = body;
        ctx.fillRect(cx - 3 * s, base - 2 * s, 6 * s, 2 * s);
        ctx.fillRect(cx - 1 * s, base - 6 * s, 2 * s, 4 * s);
        ctx.beginPath();
        ctx.moveTo(cx - 5 * s, base - 15 * s);
        ctx.lineTo(cx + 5 * s, base - 15 * s);
        ctx.lineTo(cx + 2.5 * s, base - 6 * s);
        ctx.lineTo(cx - 2.5 * s, base - 6 * s);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = body;
        ctx.lineWidth = 1.2 * s;
        ctx.beginPath();
        ctx.arc(cx - 5 * s, base - 12 * s, 2.2 * s, Math.PI / 2, (Math.PI * 3) / 2);
        ctx.arc(cx + 5 * s, base - 12 * s, 2.2 * s, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        if (n > 1) {
          ctx.font = `800 ${Math.max(9, 8 * s)}px 'Baloo 2', system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(20,10,50,.8)';
          ctx.strokeText(`×${n}`, cx, base - 18 * s);
          ctx.fillStyle = '#fff';
          ctx.fillText(`×${n}`, cx, base - 18 * s);
        }
      });
    }

    /** Casino de la ciudad (desde la era 2), a la izquierda del ayuntamiento: de noche se enciende su neón. */
    function drawCasino(t: number, night: number) {
      const gy = groundY();
      // Algo más grande que la escala de los edificios para que el letrero se lea en el móvil
      const s = scale * 1.5;
      const w = 36 * s;
      const h = 24 * s;
      const x = W / 2 - 54 * scale - w;
      const glow = 0.35 + night * 0.65;
      // Halo del neón
      const halo = ctx.createRadialGradient(x + w / 2, gy - h - 6 * s, 2, x + w / 2, gy - h - 6 * s, 34 * s);
      halo.addColorStop(0, `rgba(255,79,216,${0.28 * glow})`);
      halo.addColorStop(1, 'rgba(255,79,216,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - 20 * s, gy - h - 40 * s, w + 40 * s, 60 * s);
      // Cuerpo, cornisa dorada y puerta iluminada
      ctx.fillStyle = night > 0.5 ? '#3a1452' : '#6b2a7a';
      ctx.fillRect(x, gy - h, w, h);
      ctx.fillStyle = '#e8b84a';
      ctx.fillRect(x - 2 * s, gy - h - 2 * s, w + 4 * s, 2.5 * s);
      ctx.fillStyle = `rgba(255,214,110,${0.5 + night * 0.5})`;
      ctx.fillRect(x + w / 2 - 5 * s, gy - 11 * s, 10 * s, 11 * s);
      ctx.fillStyle = night > 0.5 ? '#2a0d3a' : '#4a1a58';
      ctx.fillRect(x + w / 2 - 0.5 * s, gy - 11 * s, 1 * s, 11 * s);
      // Ventanas redondas con luz de colores
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = i ? `rgba(60,200,255,${0.4 + night * 0.5})` : `rgba(255,201,60,${0.4 + night * 0.5})`;
        ctx.beginPath();
        ctx.arc(x + (i ? w - 7 * s : 7 * s), gy - h / 2 - 2 * s, 3.2 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Letrero con bombillas que se encienden en cadena
      const sw = w + 6 * s;
      const sh = 9 * s;
      const sx = x - 3 * s;
      const sy = gy - h - 3 * s - sh;
      ctx.fillStyle = '#1c0a2a';
      ctx.fillRect(sx, sy, sw, sh);
      const bulbs = 12;
      const step = Math.floor(t / 180);
      for (let i = 0; i < bulbs; i++) {
        const on = (i + step) % 3 === 0;
        ctx.fillStyle = on ? '#fff4b0' : `rgba(255,200,80,${0.25 + night * 0.2})`;
        const bx = sx + (sw / (bulbs - 1)) * i;
        ctx.fillRect(bx - 0.8 * s, sy - 1.6 * s, 1.6 * s, 1.6 * s);
        ctx.fillRect(bx - 0.8 * s, sy + sh, 1.6 * s, 1.6 * s);
      }
      // Parpadeo ocasional del neón, como un letrero de verdad
      const flicker = Math.sin(t / 97) > 0.97 ? 0.4 : 1;
      ctx.font = `800 ${Math.max(8, 6.4 * s)}px 'Baloo 2', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff4fd8';
      ctx.shadowBlur = (4 + night * 10) * flicker;
      ctx.fillStyle = night > 0.3 ? `rgba(255,224,250,${flicker})` : '#ff8ae6';
      ctx.fillText('CASINO', sx + sw / 2, sy + sh / 2 + 0.5 * s);
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'alphabetic';
    }

    /** Estandartes de campeón de temporada colgados del frontón del ayuntamiento. */
    function drawSeasonBanners(t: number, n: number) {
      const gy = groundY();
      const k = scale * 1.3;
      const cx = W / 2;
      const count = Math.min(2, n);
      for (let i = 0; i < count; i++) {
        const x = cx + (i === 0 ? -30 : 23) * scale;
        const top = gy - 57 * scale;
        const sway = Math.sin(t / 600 + i) * 1.2 * k;
        ctx.fillStyle = '#c4202f';
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x + 7 * k, top);
        ctx.lineTo(x + 7 * k + sway, top + 22 * k);
        ctx.lineTo(x + 3.5 * k + sway, top + 18 * k);
        ctx.lineTo(x + sway, top + 22 * k);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.arc(x + 3.5 * k + sway * 0.5, top + 8 * k, 2 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      if (n > 2) {
        ctx.font = `800 ${Math.max(9, 8 * k)}px 'Baloo 2', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,10,50,.8)';
        ctx.strokeText(`🚩×${n}`, cx, gy - 116 * scale);
        ctx.fillStyle = '#fff';
        ctx.fillText(`🚩×${n}`, cx, gy - 116 * scale);
      }
    }

    /**
     * Estandartes azules de la Conquista, colgados en la fachada del ayuntamiento entre los rojos de la Copa.
     * `shift`: sube el contador si ya está el de la Copa.
     */
    function drawConquestBanners(t: number, n: number, shift: boolean) {
      const gy = groundY();
      const k = scale * 1.3;
      const cx = W / 2;
      const count = Math.min(2, n);
      for (let i = 0; i < count; i++) {
        const x = cx + (i === 0 ? 7 : -14) * scale;
        const top = gy - 57 * scale;
        const sway = Math.sin(t / 650 + i + 1) * 1.2 * k;
        ctx.fillStyle = '#2f6fe0';
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x + 7 * k, top);
        ctx.lineTo(x + 7 * k + sway, top + 22 * k);
        ctx.lineTo(x + 3.5 * k + sway, top + 18 * k);
        ctx.lineTo(x + sway, top + 22 * k);
        ctx.closePath();
        ctx.fill();
        // Espadas cruzadas
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 0.8 * k);
        const sx = x + 3.5 * k + sway * 0.5;
        const sy = top + 8 * k;
        ctx.beginPath();
        ctx.moveTo(sx - 2 * k, sy - 2 * k);
        ctx.lineTo(sx + 2 * k, sy + 2 * k);
        ctx.moveTo(sx + 2 * k, sy - 2 * k);
        ctx.lineTo(sx - 2 * k, sy + 2 * k);
        ctx.stroke();
      }
      if (n > 2) {
        const y = gy - (shift ? 130 : 116) * scale;
        ctx.font = `800 ${Math.max(9, 8 * k)}px 'Baloo 2', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,10,50,.8)';
        ctx.strokeText(`⚔️×${n}`, cx, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(`⚔️×${n}`, cx, y);
      }
    }

    function drawHalloween(night: number) {
      const gy = groundY();
      for (const fx of [0.1, 0.32, 0.68, 0.9]) {
        const x = fx * W;
        const r = 4 * scale;
        ctx.fillStyle = '#ff8a1e';
        ctx.beginPath();
        ctx.ellipse(x, gy - r, r * 1.2, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a7a2a';
        ctx.fillRect(x - 0.6 * scale, gy - r * 2 - 2 * scale, 1.4 * scale, 2.5 * scale);
        if (night > 0.3) {
          ctx.fillStyle = `rgba(255,230,120,${night})`;
          ctx.fillRect(x - 2 * scale, gy - r - 1 * scale, 1.4 * scale, 1.4 * scale);
          ctx.fillRect(x + 0.8 * scale, gy - r - 1 * scale, 1.4 * scale, 1.4 * scale);
        }
      }
    }

    /** Peatones por la acera; con lluvia llevan paraguas. */
    function drawWalkers(dt: number, want: number, t: number, flags: boolean) {
      while (walkers.length < want) {
        walkers.push({
          x: Math.random() * W,
          dir: Math.random() < 0.5 ? 1 : -1,
          speed: (10 + Math.random() * 12) * scale,
          hue: Math.floor(Math.random() * 360),
          phase: Math.random() * 6,
        });
      }
      if (walkers.length > want) walkers.length = want;
      const gy = groundY();
      const s = scale;
      const umbrella = weather === 'rain' || weather === 'storm';
      walkers.forEach((w, i) => {
        w.x += w.dir * w.speed * dt;
        if (w.x > W + 10) w.x = -10;
        if (w.x < -10) w.x = W + 10;
        const step = Math.sin(t / 140 + w.phase);
        ctx.strokeStyle = '#1a1530';
        ctx.lineWidth = 1.2 * s;
        ctx.beginPath();
        ctx.moveTo(w.x, gy - 4 * s);
        ctx.lineTo(w.x + step * 1.8 * s, gy);
        ctx.moveTo(w.x, gy - 4 * s);
        ctx.lineTo(w.x - step * 1.8 * s, gy);
        ctx.stroke();
        ctx.fillStyle = `hsl(${w.hue} 55% 55%)`;
        ctx.fillRect(w.x - 1.6 * s, gy - 9 * s, 3.2 * s, 5.2 * s);
        ctx.fillStyle = '#f1c9a0';
        ctx.beginPath();
        ctx.arc(w.x, gy - 10.6 * s, 1.7 * s, 0, Math.PI * 2);
        ctx.fill();
        if (umbrella) {
          ctx.fillStyle = `hsl(${(w.hue + 180) % 360} 70% 55%)`;
          ctx.beginPath();
          ctx.arc(w.x, gy - 13 * s, 5 * s, Math.PI, 0);
          ctx.fill();
          ctx.fillRect(w.x - 0.4 * s, gy - 13 * s, 0.8 * s, 4 * s);
        } else if (flags && i % 2 === 0) {
          // Afición de la Copa: banderín ondeando
          ctx.fillStyle = '#e8e2d0';
          ctx.fillRect(w.x + 1.6 * s, gy - 22 * s, 0.9 * s, 14 * s);
          ctx.fillStyle = i % 4 === 0 ? '#ffc93c' : `hsl(${eraHue(useGame.getState().s.era)} 85% 60%)`;
          const wave = Math.sin(t / 160 + w.phase) * 1.6 * s;
          ctx.beginPath();
          ctx.moveTo(w.x + 2.5 * s, gy - 22 * s);
          ctx.lineTo(w.x + 11 * s, gy - 19.5 * s + wave);
          ctx.lineTo(w.x + 2.5 * s, gy - 16.5 * s);
          ctx.fill();
        }
      });
    }

    function drawPrecipitation(dt: number) {
      if (weather === 'rain' || weather === 'storm') {
        const n = weather === 'storm' ? drops.length : 90;
        ctx.strokeStyle = 'rgba(190,210,255,.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = drops[i];
          d.y += d.v * dt * 1.6;
          d.x -= dt * 0.08;
          if (d.y > 1) {
            d.y -= 1.05;
            d.x = Math.random();
          }
          if (d.x < 0) d.x += 1;
          const x = d.x * W;
          const y = d.y * H;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 2 * scale, y + 9 * scale);
        }
        ctx.stroke();
      } else if (weather === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = 0; i < 80; i++) {
          const d = drops[i];
          d.y += d.v * dt * 0.12;
          if (d.y > 1) {
            d.y -= 1.05;
            d.x = Math.random();
          }
          ctx.fillRect((d.x + Math.sin(d.y * 12 + d.phase) * 0.01) * W, d.y * H, 2 * scale, 2 * scale);
        }
      }
    }

    function spawnCoins(x: number, y: number, n: number, gold: boolean) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        const v = (180 + Math.random() * 220) * scale;
        coins.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9 + Math.random() * 0.4, gold });
      }
    }

    // Se recauda al soltar, y solo si el dedo casi no se movió: deslizar para hacer scroll no cuenta como toque
    const downs = new Map<number, { x: number; y: number }>();
    const onDown = (e: PointerEvent) => {
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onCancel = (e: PointerEvent) => {
      downs.delete(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      const d = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
      onTap(d.x, d.y);
    };

    const onTap = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (visitRef.current) {
        // De visita no se recauda: solo se saluda
        texts.push({ x, y: y - 10, text: ['👋', '❤️', '✨', '🎉'][Math.floor(Math.random() * 4)], life: 1, crit: false });
        if (texts.length > 16) texts.shift();
        vibrate(5);
        return;
      }
      const { amount, crit } = useGame.getState().tap();
      spawnCoins(x, y, crit ? 14 : 4, crit);
      texts.push({ x, y: y - 10, text: `${crit ? '¡CRÍTICO! ' : '+'}${fmt(amount)}`, life: 1, crit });
      if (texts.length > 16) texts.shift();
      pulse = 1;
      if (crit) shake = 0.3;
      vibrate(crit ? 30 : 6);
      sfx(crit ? 'crit' : 'tap');
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onCancel);

    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      if (pausedRef.current) {
        // En pausa: se detiene el bucle hasta que se quite la pantalla de encima
        raf = 0;
        return;
      }
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const { s } = useGame.getState();
      const v = visitRef.current;
      const era = v ? v.era : s.era;
      // Cosmético activo en la ciudad que se ve: la visitada o la propia
      const on = (id: string) => (v ? !!v.decos?.includes(id) : hasDeco(s.pass, id));
      const date = new Date();
      const hour = date.getHours() + date.getMinutes() / 60;
      const night = nightAt(hour);
      const boosted = !v && isBoosted(s, s.lastTick);
      const festival = !v && isTapBoosted(s, s.lastTick);
      updateWeather(t);
      const wet = weather === 'rain' || weather === 'storm';
      const overcast = wet || weather === 'snow';

      const k = v ? v.layout : cityLayout(s.buildings);
      if (k !== key) {
        key = k;
        structures = buildLayout(k, W, scale);
        renderCache(night);
      } else if (Math.abs(night - cacheNight) > 0.05 || t - cacheAt > 6000) {
        renderCache(night);
      }

      // Tráfico según el tamaño de la ciudad
      const total = v ? v.buildings : BUILDINGS.reduce((n, b) => n + (s.buildings[b.id] ?? 0), 0);
      const wantCars = Math.min(8, Math.floor(Math.log2(total + 1)));
      while (cars.length < wantCars) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        cars.push({ x: Math.random() * W, lane: dir > 0 ? 1 : 0, dir, speed: (40 + Math.random() * 50) * scale, hue: Math.floor(Math.random() * 360) });
      }

      pulse = Math.max(0, pulse - dt * 5);
      shake = Math.max(0, shake - dt);

      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);

      // Cielo
      const [top, bottom] = skyAt(hour);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, top);
      sky.addColorStop(1, bottom);
      ctx.fillStyle = sky;
      ctx.fillRect(-10, -10, W + 20, H + 20);
      ctx.fillStyle = `hsla(${eraHue(era)} 70% 50% / .12)`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
      // Cielo cubierto según el clima
      const tint = weather === 'storm' ? 0.42 : weather === 'rain' ? 0.3 : weather === 'cloudy' ? 0.16 : weather === 'snow' ? 0.14 : 0;
      if (tint) {
        ctx.fillStyle = weather === 'snow' ? `rgba(205,215,240,${tint})` : `rgba(55,58,80,${tint})`;
        ctx.fillRect(-10, -10, W + 20, H + 20);
      }
      if (season === 'halloween') {
        ctx.fillStyle = 'rgba(120,40,160,.1)';
        ctx.fillRect(-10, -10, W + 20, H + 20);
      }

      // Estrellas (las tapan las nubes)
      const starsVisible = weather === 'clear' ? 1 : weather === 'cloudy' ? 0.4 : 0;
      if (night > 0.05 && starsVisible > 0) {
        for (const st of stars) {
          ctx.globalAlpha = night * starsVisible * (0.5 + 0.5 * Math.sin(t / 700 + st.tw));
          ctx.fillStyle = '#fff';
          ctx.fillRect(st.x * W, st.y * H, st.r, st.r);
        }
        ctx.globalAlpha = 1;
      }

      // Sol o luna (tapados con lluvia o nieve, a medias si está nublado)
      const dayPos = (hour - 6) / 14;
      ctx.globalAlpha = overcast ? 0 : weather === 'cloudy' ? 0.5 : 1;
      if (overcast) {
        // nada que dibujar
      } else if (dayPos > 0 && dayPos < 1 && night < 0.9) {
        const sx = W * (0.1 + dayPos * 0.8);
        const sy = H * (0.45 - Math.sin(dayPos * Math.PI) * 0.32);
        const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 40 * scale);
        g.addColorStop(0, 'rgba(255,240,180,1)');
        g.addColorStop(0.3, 'rgba(255,210,120,.8)');
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 40 * scale, sy - 40 * scale, 80 * scale, 80 * scale);
      } else {
        ctx.fillStyle = '#f4efd8';
        ctx.beginPath();
        ctx.arc(W * 0.82, H * 0.16, 12 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath();
        ctx.arc(W * 0.82 + 5 * scale, H * 0.16 - 3 * scale, 11 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Aurora cuando hay boost
      if (boosted) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = i ? 'rgba(255,94,168,.13)' : 'rgba(255,201,60,.16)';
          ctx.beginPath();
          ctx.moveTo(0, H * 0.1);
          for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * (0.12 + i * 0.07) + Math.sin(x / 60 + t / (900 + i * 300)) * 14 * scale);
          ctx.lineTo(W, 0);
          ctx.lineTo(0, 0);
          ctx.fill();
        }
      }

      // Aurora boreal del pase (detrás de las nubes)
      if (night > 0.05 && on('aurora')) drawAurora(t, night);

      // Nubes: más y más oscuras con mal tiempo
      const cloudCount = weather === 'clear' ? 3 : weather === 'cloudy' ? 5 : clouds.length;
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += c.v * dt * (weather === 'storm' ? 3 : 1);
        if (c.x > 1.2) c.x = -0.2;
        if (i >= cloudCount) continue;
        ctx.fillStyle = overcast
          ? `rgba(${weather === 'snow' ? '225,230,245' : '120,124,150'},${0.45 + (1 - night) * 0.25})`
          : `rgba(255,255,255,${0.1 + (1 - night) * 0.35})`;
        const cx = c.x * W;
        const cy = c.y * H;
        const r = 16 * scale * c.s;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.arc(cx + r, cy + 3 * scale, r * 0.8, 0, Math.PI * 2);
        ctx.arc(cx - r, cy + 4 * scale, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cosméticos del cielo (los propios o los de la ciudad visitada)
      if (on('birds')) drawBirds(t, dt, night);
      if (on('kites')) drawKites(t, night);
      if (on('zeppelin')) drawZeppelin(t, dt, night);

      // Silueta lejana
      const gy = groundY();
      ctx.fillStyle = `rgba(20,14,60,${0.35 + night * 0.25})`;
      for (const f of far) ctx.fillRect(f.x * W, gy - f.h * H, f.w * W, f.h * H);

      // Fuegos artificiales: al celebrar algo y la noche de Año Nuevo (detrás de los edificios)
      drawFireworks(dt, celebrating(t) || (season === 'newyear' && night > 0.4));
      if (on('fireworks')) drawNightFireworks(dt, night);

      // Edificios (cache) y ayuntamiento
      ctx.drawImage(cache, 0, 0, W, H);
      if (night > 0.05 && on('neon')) drawNeon(night);
      drawHall(t, night, boosted, era);
      if (era >= CASINO_ERA) drawCasino(t, night);
      const cups = v ? (v.cups ?? [0, 0, 0, 0]) : ([s.cup.gold, s.cup.silver, s.cup.bronze, s.cup.seasons] as const);
      drawTrophies(t, night, [cups[0], cups[1], cups[2]]);
      if (cups[3] > 0) drawSeasonBanners(t, cups[3]);
      const conq = v ? (v.conq ?? 0) : s.conquest.wins;
      if (conq > 0) drawConquestBanners(t, conq, cups[3] > 2);
      if (season === 'christmas' || season === 'newyear') drawChristmas(t, night);
      if (on('lanterns')) drawLanterns(t, night);

      // Luces de las antenas
      if (Math.floor(t / 700) % 2 === 0) {
        ctx.fillStyle = '#ff4d4d';
        for (const st of structures) {
          if (st.spec.roof === 'antenna' || st.spec.roof === 'spire') {
            const tip = st.spec.roof === 'antenna' ? 22 : 40;
            ctx.fillRect(st.x + st.w / 2 - 1.5 * scale, groundY() - st.h - tip * scale - 1.5 * scale, 3 * scale, 3 * scale);
          }
        }
      }

      // Cosméticos de la plaza, a ras de suelo (los peatones pasan por delante)
      if (on('garden')) drawGarden(t, night);
      if (on('fountain')) drawFountain(t, night);
      if (on('statue')) drawStatue(t, night);

      // Peatones: más cuanto más grande es la ciudad; pocos de noche y nadie en plena tormenta
      const people = Math.min(10, Math.floor(Math.log2(total + 1) * 1.2));
      // El fin de semana de la Copa, la afición sale a la calle (más gente y con banderines)
      const fans = !v && fansOut(s);
      const crowd = fans ? Math.min(14, people + 4) : people;
      // (la afición no se va a dormir: de noche también sale, salvo con tormenta)
      drawWalkers(dt, weather === 'storm' ? 1 : Math.round(crowd * (night > 0.7 && !fans ? 0.4 : 1)), t, fans);
      if (season === 'halloween') drawHalloween(night);
      if (weather === 'snow') {
        ctx.fillStyle = 'rgba(245,248,255,.9)';
        ctx.fillRect(-10, gy - 1.5 * scale, W + 20, 2 * scale);
      }

      // Calle
      ctx.fillStyle = wet ? '#232046' : '#1b1838';
      ctx.fillRect(-10, gy, W + 20, H - gy + 10);
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      for (let x = ((t / 40) % 24) - 24; x < W; x += 24) ctx.fillRect(x, gy + 14 * scale, 12 * scale, 1.5 * scale);
      for (const car of cars) {
        car.x += car.dir * car.speed * dt;
        if (car.x > W + 20) car.x = -20;
        if (car.x < -20) car.x = W + 20;
        const cy = gy + (car.lane ? 17 : 6) * scale;
        ctx.fillStyle = `hsl(${car.hue} 70% 55%)`;
        ctx.fillRect(car.x, cy, 14 * scale, 6 * scale);
        ctx.fillStyle = 'rgba(200,230,255,.8)';
        ctx.fillRect(car.x + (car.dir > 0 ? 8 : 2) * scale, cy - 3 * scale, 4 * scale, 3 * scale);
        if (night > 0.3) {
          ctx.fillStyle = `rgba(255,240,170,${night * 0.6})`;
          const hx = car.dir > 0 ? car.x + 14 * scale : car.x - 12 * scale;
          ctx.fillRect(hx, cy + 1 * scale, 12 * scale, 3 * scale);
        }
      }

      // Lluvia o nieve por delante de todo, y relámpagos en las tormentas
      drawPrecipitation(dt);
      if (weather === 'storm' && Math.random() < dt / 6) flash = 1;
      flash = Math.max(0, flash - dt * 3);
      if (flash > 0) {
        ctx.fillStyle = `rgba(235,240,255,${flash * 0.35})`;
        ctx.fillRect(-10, -10, W + 20, H + 20);
      }

      // Confeti durante el festival
      if (festival && Math.random() < 0.5) confetti.push({ x: Math.random() * W, y: -5, v: 40 + Math.random() * 60, hue: Math.random() * 360, r: Math.random() * 6 });
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.y += c.v * dt;
        c.r += dt * 4;
        ctx.fillStyle = `hsl(${c.hue} 90% 65%)`;
        ctx.fillRect(c.x + Math.sin(c.r) * 6, c.y, 4, 7);
        if (c.y > H) confetti.splice(i, 1);
      }

      // Monedas y textos
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.life -= dt;
        c.vy += 700 * scale * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.life <= 0) {
          coins.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(1, c.life * 2);
        const r = (c.gold ? 6 : 4.5) * scale;
        ctx.fillStyle = '#e8a318';
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd95a';
        ctx.beginPath();
        ctx.arc(c.x - r * 0.2, c.y - r * 0.2, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = 'center';
      for (let i = texts.length - 1; i >= 0; i--) {
        const tx = texts[i];
        tx.life -= dt * 1.1;
        tx.y -= 60 * dt;
        if (tx.life <= 0) {
          texts.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(1, tx.life * 1.8);
        ctx.font = `800 ${tx.crit ? 24 : 18}px 'Baloo 2', system-ui, sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,10,50,.7)';
        ctx.strokeText(tx.text, tx.x, tx.y);
        ctx.fillStyle = tx.crit ? '#ffd24a' : '#fff';
        ctx.fillText(tx.text, tx.x, tx.y);
      }
      ctx.globalAlpha = 1;

      if (!v && s.taps < 15) {
        ctx.font = `700 ${15 * Math.max(scale, 0.9)}px 'Baloo 2', system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(t / 250) * 0.3})`;
        ctx.fillText('👆 ¡Toca la ciudad para recaudar!', W / 2, gy - 125 * scale);
      }

      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    resumeRef.current = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      resumeRef.current = () => {};
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onCancel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="city-scene"
      aria-label={visit ? 'Ciudad de otro jugador' : 'Tu ciudad: toca para recaudar monedas'}
    />
  );
}
