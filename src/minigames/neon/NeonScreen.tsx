import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { Fx, drawSprite, label, sprite } from '../shooter/fx';
import { aimVec, drawSticks, moveVec, releaseInput, screenToWorld, toScreenSpace, toWorldSpace, useInput, useStage, type View } from '../shooter/stage';
import { Banner, Hearts, Meter, PauseCard, StartCard, UpgradePick, useHud, type HowToLine } from '../shooter/ShooterUI';
import { WarScreen, type WarViewProps } from '../war/WarScreen';
import {
  ARENA_H,
  ARENA_W,
  BLAST_MS,
  BOSS_SPAWN_MS,
  MULT_MAX,
  POWERS,
  POWER_KINDS,
  SPAWN_MS,
  START_LIVES,
  boss,
  choose,
  multNeed,
  newNeon,
  step,
  summary,
  type Enemy,
  type EnemyKind,
  type NeonGame,
  type PowerKind,
  type UpId,
} from './logic';
import './neon.css';

/** Margen alrededor de la arena para que el brillo del borde no se corte. */
const PAD = 6;
const FIELD = { w: ARENA_W + PAD * 2, h: ARENA_H + PAD * 2 };
const INTRO_MS = 4200;
const OVER_DELAY = 1500;

type Phase = 'intro' | 'play' | 'paused' | 'choice' | 'over';

// ---------------------------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------------------------

const COLOR: Record<EnemyKind, string> = {
  wanderer: '#c06bff',
  chaser: '#3d9bff',
  splitter: '#ff4fd1',
  mini: '#ff4fd1',
  dodger: '#ffd23a',
  snake: '#ff8a2a',
  boss: '#ff3355',
};

const KILL_COLORS: Record<EnemyKind, string[]> = {
  wanderer: ['#c06bff', '#e6c2ff', '#ffffff'],
  chaser: ['#3d9bff', '#a8d4ff', '#ffffff'],
  splitter: ['#ff4fd1', '#ffb3ee', '#ffffff'],
  mini: ['#ff4fd1', '#ffffff'],
  dodger: ['#ffd23a', '#fff1b0', '#ffffff'],
  snake: ['#ff8a2a', '#ffc08a', '#ffffff', '#ff5a1a'],
  boss: ['#ff3355', '#ffd23a', '#ffffff', '#ff8acb', '#5af2ff'],
};

/** Color de los puntos según el multiplicador (blanco → verde → cian → rosa → oro). */
const MULT_COLOR = ['#ffffff', '#ffffff', '#9dff5c', '#9dff5c', '#5af2ff', '#5af2ff', '#ff6bf0', '#ff6bf0', '#ffd23a', '#ffd23a', '#ff9a3d'];
const multColor = (m: number) => MULT_COLOR[Math.min(MULT_COLOR.length - 1, m)];

const SHIP = '#7af6ff';
const GEOM = '#8dff3a';

// ---------------------------------------------------------------------------------------------
// Dibujos (se pintan una vez en el caché de sprites; el brillo va dentro del sprite)
// ---------------------------------------------------------------------------------------------

type PathFn = (c: CanvasRenderingContext2D) => void;

/** Trazo de neón: varias pasadas cada vez más finas y un núcleo casi blanco. */
function neon(c: CanvasRenderingContext2D, path: PathFn, color: string, w = 1.5, fill?: string) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (fill) {
    c.fillStyle = fill;
    path(c);
    c.fill();
  }
  c.strokeStyle = color;
  for (const [lw, a] of [
    [w * 5, 0.08],
    [w * 3, 0.18],
    [w * 1.8, 0.45],
    [w, 1],
  ]) {
    c.globalAlpha = a;
    c.lineWidth = lw;
    path(c);
    c.stroke();
  }
  c.globalAlpha = 0.75;
  c.strokeStyle = '#ffffff';
  c.lineWidth = w * 0.4;
  path(c);
  c.stroke();
  c.globalAlpha = 1;
}

/** Halo suave (va debajo de la figura). */
function halo(c: CanvasRenderingContext2D, r: number, color: string, a = 0.22) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = a;
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
}

function poly(pts: number[]): PathFn {
  return (c) => {
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
  };
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const ENEMY_SPR: Record<EnemyKind, number> = { wanderer: 36, chaser: 36, splitter: 38, mini: 22, dodger: 36, snake: 34, boss: 92 };

function paintEnemy(kind: EnemyKind, white: boolean): PathFn {
  return (c) => {
    const col = white ? '#ffffff' : COLOR[kind];
    const fill = rgba(white ? '#ffffff' : COLOR[kind], white ? 0.55 : 0.16);
    if (!white) halo(c, ENEMY_SPR[kind] / 2, COLOR[kind], 0.18);
    switch (kind) {
      case 'wanderer':
        // Molinillo de cuatro aspas
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          neon(c, poly([0, 0, Math.cos(a) * 11, Math.sin(a) * 11, Math.cos(a + 0.8) * 7.5, Math.sin(a + 0.8) * 7.5]), col, 1.3, fill);
        }
        break;
      case 'chaser':
        neon(c, poly([0, -12, 9, 0, 0, 12, -9, 0]), col, 1.6, fill);
        neon(c, poly([0, -5, 3.6, 0, 0, 5, -3.6, 0]), col, 1);
        break;
      case 'splitter':
        neon(c, poly([-9, -9, 9, -9, 9, 9, -9, 9]), col, 1.6, fill);
        neon(c, poly([0, -7, 7, 0, 0, 7, -7, 0]), col, 1.1);
        break;
      case 'mini':
        neon(c, poly([-5, -5, 5, -5, 5, 5, -5, 5]), col, 1.3, fill);
        break;
      case 'dodger':
        neon(c, poly([-9, -9, 9, -9, 9, 9, -9, 9]), col, 1.5, fill);
        neon(
          c,
          (p) => {
            p.beginPath();
            p.moveTo(-9, -9);
            p.lineTo(9, 9);
            p.moveTo(9, -9);
            p.lineTo(-9, 9);
          },
          col,
          1,
        );
        neon(c, poly([-3.5, -3.5, 3.5, -3.5, 3.5, 3.5, -3.5, 3.5]), col, 1, white ? undefined : '#000');
        break;
      case 'snake':
        // Cabeza en flecha (mira a la derecha; se gira con el rumbo)
        neon(c, poly([12, 0, -6, 9, -2, 0, -6, -9]), col, 1.7, fill);
        if (!white) {
          c.fillStyle = '#fff';
          c.beginPath();
          c.arc(4, 0, 1.6, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'boss': {
        const hex = (r: number) => {
          const p: number[] = [];
          for (let i = 0; i < 6; i++) p.push(Math.cos((i * Math.PI) / 3) * r, Math.sin((i * Math.PI) / 3) * r);
          return poly(p);
        };
        neon(c, hex(30), col, 2.4, rgba(white ? '#ffffff' : '#ff3355', white ? 0.5 : 0.12));
        neon(c, hex(23), col, 1);
        // Púas
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + Math.PI / 6;
          neon(c, poly([Math.cos(a) * 26, Math.sin(a) * 26, Math.cos(a) * 38, Math.sin(a) * 38]), col, 1.4);
        }
        break;
      }
    }
  };
}

function enemySprite(kind: EnemyKind, white: boolean) {
  const s = ENEMY_SPR[kind];
  return sprite(`ne-${kind}-${white ? 'w' : 'c'}`, s, s, paintEnemy(kind, white), kind === 'boss' ? 3 : 4);
}

/** Núcleo interior del jefe (gira al revés que el casco). */
function paintCore(c: CanvasRenderingContext2D) {
  halo(c, 18, '#ffd23a', 0.35);
  neon(c, poly([0, -13, 11.3, 6.5, -11.3, 6.5]), '#ffd23a', 1.6, 'rgba(255, 210, 58, 0.15)');
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(0, 0, 3.4, 0, Math.PI * 2);
  c.fill();
}

function paintSeg(c: CanvasRenderingContext2D) {
  halo(c, 8, COLOR.snake, 0.25);
  neon(
    c,
    (p) => {
      p.beginPath();
      p.arc(0, 0, 4, 0, Math.PI * 2);
    },
    '#ff6a1a',
    1.2,
    'rgba(255, 106, 26, 0.25)',
  );
}

function paintShip(c: CanvasRenderingContext2D) {
  halo(c, 18, SHIP, 0.25);
  // Garra que mira a la derecha
  neon(c, poly([13, 0, -8, 10, -3, 3, -3, -3, -8, -10]), SHIP, 1.7, 'rgba(122, 246, 255, 0.15)');
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(1, 0, 2, 0, Math.PI * 2);
  c.fill();
}

function paintBullet(c: CanvasRenderingContext2D) {
  neon(
    c,
    (p) => {
      p.beginPath();
      p.moveTo(-4.5, 0);
      p.lineTo(4.5, 0);
    },
    '#fff1a0',
    1.6,
  );
}

function paintEshot(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 8);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#ffc2d6');
  g.addColorStop(0.55, '#ff3d6e');
  g.addColorStop(1, 'rgba(255, 61, 110, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 8, 0, Math.PI * 2);
  c.fill();
}

function paintGeom(c: CanvasRenderingContext2D) {
  halo(c, 7, GEOM, 0.4);
  neon(c, poly([0, -4.5, 2.6, 0, 0, 4.5, -2.6, 0]), GEOM, 1, 'rgba(141, 255, 58, 0.5)');
}

function paintOrb(kind: PowerKind) {
  return (c: CanvasRenderingContext2D) => {
    const col = POWERS[kind].color;
    halo(c, 17, col, 0.35);
    neon(
      c,
      (p) => {
        p.beginPath();
        p.arc(0, 0, 11, 0, Math.PI * 2);
      },
      col,
      1.5,
      'rgba(5, 4, 20, 0.75)',
    );
    c.font = `12px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(POWERS[kind].emoji, 0, 1);
  };
}

// ---------------------------------------------------------------------------------------------
// Rejilla que se deforma con las explosiones (muelles baratos en una malla gruesa)
// ---------------------------------------------------------------------------------------------

const CELL = 20;
const GC = ARENA_W / CELL + 1;
const GR = ARENA_H / CELL + 1;

class Grid {
  dx = new Float32Array(GC * GR);
  dy = new Float32Array(GC * GR);
  vx = new Float32Array(GC * GR);
  vy = new Float32Array(GC * GR);
  energy = 0;

  /** Empuja los puntos de alrededor hacia fuera (o hacia dentro si `force` < 0). */
  kick(x: number, y: number, radius: number, force: number) {
    const c0 = Math.max(1, Math.floor((x - radius) / CELL));
    const c1 = Math.min(GC - 2, Math.ceil((x + radius) / CELL));
    const r0 = Math.max(1, Math.floor((y - radius) / CELL));
    const r1 = Math.min(GR - 2, Math.ceil((y + radius) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * GC + c;
        const px = c * CELL + this.dx[i] - x;
        const py = r * CELL + this.dy[i] - y;
        const d = Math.hypot(px, py);
        if (d >= radius || d < 0.01) continue;
        const k = (1 - d / radius) ** 2 * force;
        this.vx[i] += (px / d) * k;
        this.vy[i] += (py / d) * k;
      }
    }
    this.energy = 1;
  }

  update(ms: number) {
    if (this.energy <= 0) return;
    // Pasos cortos para que el muelle no se vuelva inestable con fotogramas largos
    let left = Math.min(ms, 50) / 1000;
    let moving = 0;
    while (left > 0) {
      const s = Math.min(left, 1 / 60);
      left -= s;
      moving = 0;
      for (let i = 0; i < this.dx.length; i++) {
        const ax = -70 * this.dx[i] - 7 * this.vx[i];
        const ay = -70 * this.dy[i] - 7 * this.vy[i];
        this.vx[i] += ax * s;
        this.vy[i] += ay * s;
        this.dx[i] += this.vx[i] * s;
        this.dy[i] += this.vy[i] * s;
        moving += Math.abs(this.dx[i]) + Math.abs(this.vx[i]) * 0.05;
      }
    }
    // Quieta del todo: deja de calcular hasta el siguiente golpe
    if (moving < 0.5) {
      this.dx.fill(0);
      this.dy.fill(0);
      this.vx.fill(0);
      this.vy.fill(0);
      this.energy = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const X = (r: number, c: number) => c * CELL + this.dx[r * GC + c];
    const Y = (r: number, c: number) => r * CELL + this.dy[r * GC + c];
    const lines = (major: boolean) => {
      ctx.beginPath();
      for (let r = 0; r < GR; r++) {
        if ((r % 4 === 0) !== major) continue;
        ctx.moveTo(X(r, 0), Y(r, 0));
        for (let c = 1; c < GC; c++) ctx.lineTo(X(r, c), Y(r, c));
      }
      for (let c = 0; c < GC; c++) {
        if ((c % 4 === 0) !== major) continue;
        ctx.moveTo(X(0, c), Y(0, c));
        for (let r = 1; r < GR; r++) ctx.lineTo(X(r, c), Y(r, c));
      }
      ctx.stroke();
    };
    const pulse = 0.04 * Math.sin(t / 1400);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(70, 90, 255, ${0.2 + pulse})`;
    lines(false);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(110, 120, 255, ${0.34 + pulse})`;
    lines(true);
  }
}

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

const fine = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

const HOWTO: HowToLine[] = [
  { icon: '👈', text: 'Pulgar izquierdo: mueve la nave.' },
  { icon: '👉', text: 'Pulgar derecho: apunta y dispara sin parar.' },
  { icon: '💚', text: 'Recoge los fragmentos verdes: suben el multiplicador (morir lo reinicia).' },
  { icon: '💣', text: 'Bomba para emergencias: limpia toda la arena.' },
  ...(fine ? [{ icon: '⌨️', text: 'Teclado: WASD mueve, ratón o flechas disparan, Espacio = bomba.' }] : []),
];

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function NeonGameView({ onOver, onScore }: WarViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<NeonGame>(null as unknown as NeonGame);
  if (!game.current) game.current = newNeon();
  const fx = useRef(new Fx());
  const grid = useRef(new Grid());
  const [phase, setPhaseState] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>('intro');
  const introEnd = useRef(performance.now() + INTRO_MS);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'boss'; id: number } | null>(null);
  const [, setTick] = useState(0);
  const bombReq = useRef(false);
  const spaceLatch = useRef(false);
  const sound = useRef({ shot: 0, kill: 0, geom: 0, geomN: 0, spawn: 0 });
  const timers = useRef<number[]>([]);
  const overSent = useRef(false);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => clearTimeout(t));
  }, []);
  const input = useInput(canvas, 'twin');
  // Solo en desarrollo: deja tocar la partida desde la consola (capturas de jefe, mejoras…)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __neon?: NeonGame }).__neon = game.current;
  }, []);
  const [hud, pushHud] = useHud({ score: 0, mult: 1, bank: 0, lives: START_LIVES, bombs: 2, pow: '', boss: -1 });

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      if (p !== 'play') releaseInput(input.current);
      // Al volver a jugar, Espacio tiene que soltarse antes de contar como bomba
      else spaceLatch.current = true;
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

  const pause = useCallback(() => {
    if (phaseRef.current === 'play') setPhase('paused');
  }, [setPhase]);

  // Escape o P pausan en el ordenador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && phaseRef.current === 'play') {
        e.preventDefault();
        pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pause]);

  const onStep = (dt: number) => {
    const g = game.current;
    const v = view.current;
    const inp = input.current;
    const mv = moveVec(inp);
    let aim = aimVec(inp);
    if (!aim && inp.mouse.down) {
      // Ratón: dispara hacia el puntero mientras se mantiene pulsado
      const w = screenToWorld(v, inp.mouse.x, inp.mouse.y);
      const dx = w.x - PAD - g.x;
      const dy = w.y - PAD - g.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) aim = { x: dx / d, y: dy / d };
    }
    const space = inp.keys.has('Space');
    const bomb = bombReq.current || (space && !spaceLatch.current);
    spaceLatch.current = space;
    bombReq.current = false;

    const prevScore = g.score;
    const ev = step(g, dt, { mx: mv.x, my: mv.y, aim, bomb }, Math.random);
    const f = fx.current;
    const gr = grid.current;
    const now = performance.now();
    const snd = sound.current;

    if (ev.shots && now - snd.shot > 95) {
      snd.shot = now;
      tone(1300 + Math.random() * 200, 0.018, 'square', 0.008);
    }
    for (const s of ev.sparks) f.burst(s.x, s.y, { n: 3, colors: ['#ffffff', '#fff1a0'], speed: 90, life: 180, size: 1.3, shape: 'spark' });
    for (const s of ev.absorbed) f.burst(s.x, s.y, { n: 3, colors: ['#ff8a2a', '#ffffff'], speed: 70, life: 160, size: 1.2, shape: 'spark' });
    for (const s of ev.walls) f.burst(s.x, s.y, { n: 2, colors: ['#8aa0ff', '#ffffff'], speed: 60, life: 160, size: 1.1, shape: 'spark' });
    for (const k of ev.kills) {
      const big = k.kind === 'boss' || k.kind === 'snake';
      const colors = KILL_COLORS[k.kind];
      if (k.kind === 'boss') {
        f.burst(k.x, k.y, { n: 110, colors, speed: 260, life: 1100, size: 2.4, shape: 'spark', drag: 1.4 });
        f.ring(k.x, k.y, '#ffffff', 120, 700);
        f.ring(k.x, k.y, '#ff3355', 80, 500);
        gr.kick(k.x, k.y, 220, 900);
        f.shake(10, 650);
        f.flash('#ff3355', 260);
      } else {
        f.burst(k.x, k.y, { n: big ? 30 : k.kind === 'mini' ? 8 : 16, colors, speed: big ? 190 : 150, life: big ? 650 : 480, size: 1.7, shape: 'spark', drag: 2 });
        f.ring(k.x, k.y, colors[0], big ? 34 : 20, big ? 420 : 300);
        gr.kick(k.x, k.y, big ? 80 : 46, big ? 260 : 140);
        if (big) f.shake(3, 180);
      }
      if (k.pts > 0) f.text(k.x, k.y - 6, `+${k.pts}`, k.bomb ? '#ffffff' : multColor(k.mult), k.kind === 'boss' ? 16 : k.pts >= 3 || big ? 11 : 8.5, k.kind === 'boss' ? 1300 : 750);
      if (now - snd.kill > 45) {
        snd.kill = now;
        tone(big ? 160 : 260 + Math.random() * 220, big ? 0.16 : 0.06, big ? 'sawtooth' : 'triangle', big ? 0.05 : 0.03);
      }
      if (big) vibrate(k.kind === 'boss' ? [40, 30, 90] : 18);
    }
    for (const c of ev.cleared) f.burst(c.x, c.y, { n: 6, colors: [COLOR[c.kind], '#ffffff'], speed: 90, life: 300, size: 1.3, shape: 'spark' });
    if (ev.geoms) {
      // Escala que sube mientras recoges seguido
      snd.geomN = now - snd.geom < 500 ? Math.min(snd.geomN + ev.geoms, 18) : 0;
      if (now - snd.geom > 35) tone(1000 * 2 ** (snd.geomN / 12), 0.03, 'sine', 0.025);
      snd.geom = now;
    }
    if (ev.multUp) {
      sfx('crit');
      f.text(g.x, g.y - 18, `×${g.mult}`, multColor(g.mult), 14, 900);
      f.ring(g.x, g.y, multColor(g.mult), 30, 380);
      if (g.mult === 5 || g.mult === MULT_MAX) say(g.mult === MULT_MAX ? '✨ ¡Multiplicador ×10!' : '✨ ¡Multiplicador ×5!');
    }
    if (ev.power) {
      sfx('buy');
      const p = POWERS[ev.power];
      f.text(g.x, g.y - 20, `${p.emoji} ${p.name}`, p.color, 11, 1100);
      f.ring(g.x, g.y, p.color, 36, 420);
      vibrate(15);
    }
    if (ev.powerOut) tone(300, 0.08, 'triangle', 0.03);
    if (ev.spawned && now - snd.spawn > 350) {
      snd.spawn = now;
      tone(150, 0.07, 'sine', 0.035);
    }
    if (ev.dodges && Math.random() < 0.3) tone(700, 0.03, 'sine', 0.015);
    if (ev.bomb) {
      f.flash('#ffffff', 300);
      f.shake(9, 500);
      gr.kick(ev.bomb.x, ev.bomb.y, 420, 1300);
      tone(55, 0.9, 'sawtooth', 0.09);
      tone(110, 0.5, 'square', 0.04);
      vibrate([30, 40, 110]);
    }
    if (ev.died) {
      const d = ev.died;
      f.burst(d.x, d.y, { n: 70, colors: [SHIP, '#ffffff', '#5a8dff'], speed: 240, life: 900, size: 2, shape: 'spark', drag: 1.6 });
      f.ring(d.x, d.y, SHIP, 140, 600);
      f.flash('#ff2d55', 300);
      f.shake(8, 450);
      gr.kick(d.x, d.y, 180, 800);
      tone(90, 0.6, 'sawtooth', 0.08);
      vibrate([60, 40, 90]);
      if (!ev.lost) say(g.lives === 1 ? '💥 ¡Última vida!' : '💥 ¡Te dieron!', 'bad');
    }
    if (ev.bossIn) {
      say('⚠️ ¡Llega un Núcleo!', 'boss');
      tone(70, 0.8, 'sawtooth', 0.06);
      vibrate([30, 60, 30]);
    }
    if (ev.bossWarn) tone(330, 0.08, 'square', 0.025);
    if (ev.bossShot) {
      const b = boss(g);
      if (b) gr.kick(b.x, b.y, 90, -220);
    }
    if (ev.bossDown) say('💥 ¡Núcleo destruido! +1 💣', 'boss');
    if (g.score !== prevScore) cb.current.onScore(summary(g));
    if (ev.lost) {
      say('💀 Fin de la partida', 'bad');
      setPhase('over');
      if (!overSent.current) {
        overSent.current = true;
        later(() => cb.current.onOver(summary(g)), OVER_DELAY);
      }
      return;
    }
    if (ev.pick && g.offer) {
      sfx('win');
      setPhase('choice');
    }
  };

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const live = ph === 'play' || ph === 'over' || ph === 'intro';
    if (live) {
      fx.current.update(frame);
      grid.current.update(frame);
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    drawWorld(ctx, v, g, fx.current, grid.current);
    if (ph === 'play' || ph === 'intro') {
      const ghost = [
        { x: v.cw * 0.22, y: v.ch - 120 },
        { x: v.cw * 0.78, y: v.ch - 120 },
      ];
      drawSticks(ctx, v, input.current, ghost);
      if (!input.current.touched) {
        toScreenSpace(ctx, v);
        label(ctx, 'MOVER', ghost[0].x, ghost[0].y - 62, { size: 12, color: 'rgba(255,255,255,0.55)' });
        label(ctx, 'APUNTAR Y DISPARAR', ghost[1].x, ghost[1].y - 62, { size: 12, color: 'rgba(255,194,61,0.7)' });
      }
    }
    fx.current.drawFlash(ctx, v);
    const b = boss(g);
    pushHud({
      score: g.score,
      mult: g.mult,
      bank: g.mult >= MULT_MAX ? 1 : Math.round((g.bank / multNeed(g.mult)) * 20) / 20,
      lives: g.lives,
      bombs: g.bombs,
      pow: POWER_KINDS.filter((k) => g.pow[k] > 0)
        .map((k) => `${k}:${Math.ceil(g.pow[k] / 1000)}`)
        .join(','),
      boss: b && b.spawn <= 0 ? Math.max(0, b.hp / b.max) : -1,
    });
  };

  const view = useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;
  const tier = hud.mult >= 8 ? 'gold' : hud.mult >= 6 ? 'pink' : hud.mult >= 4 ? 'cyan' : hud.mult >= 2 ? 'green' : '';
  const pows = hud.pow
    ? hud.pow.split(',').map((s) => {
        const [k, n] = s.split(':');
        return { k: k as PowerKind, n: Number(n) };
      })
    : [];

  return (
    <div className="sh-wrap ne-wrap">
      <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Arena de neón: ${hud.score} puntos, multiplicador ×${hud.mult}, ${hud.lives} vidas.`} />
      <div className="sh-hud">
        <div className="sh-hud-row ne-top">
          <span className="sh-pill" aria-label={`Puntos: ${hud.score}`}>
            <i aria-hidden="true">🏆</i>
            <b>{hud.score}</b>
          </span>
          <span className={`ne-mult ${tier}`} aria-label={`Multiplicador ×${hud.mult}`}>
            <b key={hud.mult}>×{hud.mult}</b>
            <span className="ne-mult-bar" aria-hidden="true">
              <i style={{ width: `${hud.bank * 100}%` }} />
            </span>
          </span>
          {hud.lives <= START_LIVES ? (
            <Hearts hp={hud.lives} max={START_LIVES} />
          ) : (
            // Con vidas extra no caben los corazones: se cuentan
            <span className="sh-pill ne-lives" aria-label={`Vidas: ${hud.lives}`}>
              <i aria-hidden="true">❤️</i>
              <b>{hud.lives}</b>
            </span>
          )}
          <button
            className="sh-pause-btn"
            disabled={phase !== 'play'}
            aria-label="Pausa"
            // Al tocar (no al soltar): con el otro pulgar aún en un joystick el navegador no siempre genera el clic
            onPointerDown={(e) => {
              e.preventDefault();
              pause();
            }}
            onClick={(e) => {
              if (e.detail === 0) pause();
            }}
          >
            ⏸
          </button>
          <button
            className={`ne-bomb${hud.bombs > 0 ? ' ready' : ''}`}
            disabled={hud.bombs <= 0 || phase !== 'play'}
            aria-label={`Bomba: te quedan ${hud.bombs}`}
            onPointerDown={(e) => {
              e.preventDefault();
              if (phaseRef.current === 'play') bombReq.current = true;
            }}
            onClick={(e) => {
              // Con teclado (Enter) no hay pointerdown
              if (e.detail === 0 && phaseRef.current === 'play') bombReq.current = true;
            }}
          >
            <span aria-hidden="true">💣</span>
            <small>{hud.bombs}</small>
          </button>
        </div>
        {pows.length > 0 && (
          <div className="sh-hud-row">
            {pows.map((p) => (
              <span key={p.k} className={`ne-chip${p.n <= 3 ? ' ending' : ''}`} style={{ borderColor: POWERS[p.k].color, color: POWERS[p.k].color }} aria-label={`${POWERS[p.k].name}: ${p.n} s`}>
                <span aria-hidden="true">{POWERS[p.k].emoji}</span>
                {POWERS[p.k].name} {p.n}
              </span>
            ))}
          </div>
        )}
        {hud.boss >= 0 && <Meter value={hud.boss} max={1} color="linear-gradient(90deg, #ff3355, #ffd23a)" label="Vida del Núcleo" text="NÚCLEO" />}
      </div>
      {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
      {phase === 'intro' && <StartCard title="💠 Arena de neón" left={introLeft} total={INTRO_MS} onSkip={start} lines={HOWTO} />}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            {fmtTime(g.t)} · {g.score} puntos · ×{g.mult}
          </p>
        </PauseCard>
      )}
      {phase === 'choice' && g.offer && (
        <UpgradePick<UpId>
          key={g.picks}
          title="⬆️ ¡Mejora!"
          subtitle={`${g.score} puntos. Elige una mejora para toda la partida.`}
          choices={g.offer}
          levels={g.lv}
          onPick={(d) => {
            choose(g, d.id, Math.random);
            if (g.offer) setTick((n) => n + 1);
            else setPhase('play');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pintar el mundo
// ---------------------------------------------------------------------------------------------

function drawWorld(ctx: CanvasRenderingContext2D, v: View, g: NeonGame, f: Fx, grid: Grid) {
  toScreenSpace(ctx, v);
  ctx.fillStyle = '#04030c';
  ctx.fillRect(0, 0, v.cw, v.ch);
  toWorldSpace(ctx, v);
  const sh = f.offset();
  ctx.translate(sh.x + PAD, sh.y + PAD);
  const t = g.t;

  // Rejilla y borde
  ctx.globalCompositeOperation = 'lighter';
  grid.draw(ctx, performance.now());
  ctx.lineJoin = 'round';
  for (const [lw, a] of [
    [7, 0.08],
    [3.5, 0.2],
    [1.6, 0.9],
  ]) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = `rgba(90, 160, 255, ${a})`;
    ctx.strokeRect(0, 0, ARENA_W, ARENA_H);
  }

  // Fragmentos y potenciadores
  const gs = sprite('ne-geom', 14, 14, paintGeom);
  for (const p of g.geoms) {
    if (p.life < 1800 && Math.floor(p.life / 120) % 2 === 0) continue;
    drawSprite(ctx, gs, p.x, p.y, 14, 14, t / 300 + p.x);
  }
  for (const o of g.orbs) {
    if (o.life < 2500 && Math.floor(o.life / 140) % 2 === 0) continue;
    const s = 34 * (1 + Math.sin(t / 160) * 0.08);
    drawSprite(ctx, sprite(`ne-orb-${o.kind}`, 34, 34, paintOrb(o.kind)), o.x, o.y, s, s);
  }

  // Enemigos
  for (const e of g.enemies) drawEnemy(ctx, e, t);

  // Balas enemigas
  const es = sprite('ne-eshot', 18, 18, paintEshot);
  for (const b of g.eshots) drawSprite(ctx, es, b.x, b.y, 18, 18);

  // Balas propias (giradas con setTransform: sin save/restore por bala)
  const bs = sprite('ne-bullet', 16, 8, paintBullet);
  const m = ctx.getTransform();
  for (const b of g.shots) {
    const a = Math.atan2(b.vy, b.vx);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.setTransform(m.a * c, m.a * s, -m.a * s, m.a * c, m.e + m.a * b.x, m.f + m.a * b.y);
    ctx.drawImage(bs, -8, -4, 16, 8);
  }
  ctx.setTransform(m);

  // Nave
  if (g.phase === 'play' && g.respawn <= 0) {
    const blink = g.inv > 0 && Math.floor(g.inv / 80) % 2 === 0;
    drawSprite(ctx, sprite('ne-ship', 40, 40, paintShip), g.x, g.y, 40, 40, g.ang, blink ? 0.35 : 1);
    if (g.inv > 0) {
      ctx.globalAlpha = Math.min(1, g.inv / 400) * (0.35 + 0.2 * Math.sin(t / 70));
      ctx.strokeStyle = SHIP;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Estela del motor
    if (Math.random() < 0.6) f.burst(g.x - Math.cos(g.ang) * 8, g.y - Math.sin(g.ang) * 8, { n: 1, colors: ['#5af2ff', '#ffb35a'], speed: 30, life: 220, size: 1.2 });
  } else if (g.phase === 'play' && g.respawn > 0) {
    // Vuelve a aparecer: un anillo que se cierra sobre el punto
    const k = g.respawn / 650;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = SHIP;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(g.x, g.y, 6 + k * 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Onda de la bomba
  if (g.blast) {
    const k = g.blast.age / BLAST_MS;
    for (const [lw, a, col] of [
      [26, 0.12, '#5af2ff'],
      [10, 0.3, '#ffffff'],
      [3, 0.9, '#ffffff'],
    ] as const) {
      ctx.globalAlpha = a * (1 - k * 0.7);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(g.blast.x, g.blast.y, g.blast.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Partículas con mezcla aditiva y textos normales (legibles)
  const texts = f.texts;
  f.texts = [];
  f.draw(ctx);
  f.texts = texts;
  ctx.globalCompositeOperation = 'source-over';
  const parts = f.parts;
  f.parts = [];
  f.draw(ctx);
  f.parts = parts;

  // Aviso del jefe que llega
  for (const e of g.enemies) {
    if (e.kind === 'boss' && e.spawn > 0 && Math.floor(e.spawn / 150) % 2 === 0) label(ctx, '⚠', e.x, e.y, { size: 22, color: '#ff3355' });
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Viñeta roja con la última vida
  if (g.lives === 1 && g.phase === 'play') {
    toScreenSpace(ctx, v);
    const a = 0.2 + 0.1 * Math.sin(t / 250);
    const r = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.38, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.75);
    r.addColorStop(0, 'rgba(255, 30, 60, 0)');
    r.addColorStop(1, `rgba(255, 30, 60, ${a})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number) {
  const s = ENEMY_SPR[e.kind];
  if (e.spawn > 0) {
    // Aviso: la silueta se condensa y parpadea; aún no hace daño
    const total = e.kind === 'boss' ? BOSS_SPAWN_MS : SPAWN_MS;
    const p = 1 - e.spawn / total;
    const k = 1 + (1 - p) * 0.9;
    const blink = Math.floor(e.spawn / 70) % 2 === 0 ? 1 : 0.55;
    drawSprite(ctx, enemySprite(e.kind, false), e.x, e.y, s * k, s * k, (1 - p) * 2, (0.15 + p * 0.5) * blink);
    ctx.globalAlpha = 0.5 * p;
    ctx.strokeStyle = COLOR[e.kind];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * (1 + (1 - p) * 2.5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  let rot = 0;
  let w = s;
  let h = s;
  switch (e.kind) {
    case 'wanderer':
      rot = t / 180 + e.id;
      break;
    case 'chaser': {
      // Late como un corazón
      const p = Math.sin(t / 110 + e.id);
      w = s * (1 + p * 0.12);
      h = s * (1 - p * 0.12);
      break;
    }
    case 'splitter':
      rot = t / 400 + e.id;
      break;
    case 'mini':
      rot = t / 120 + e.id;
      break;
    case 'dodger':
      rot = e.dodge > 0 ? (e.dodge / 170) * Math.PI * 0.5 : 0;
      break;
    case 'snake': {
      const seg = sprite('ne-seg', 16, 16, paintSeg);
      for (let i = e.segs.length - 1; i >= 0; i--) {
        const sg = e.segs[i];
        const k = 1 - i / (e.segs.length + 3);
        drawSprite(ctx, seg, sg.x, sg.y, 16 * k, 16 * k, 0, 0.5 + 0.5 * k);
      }
      rot = e.a;
      break;
    }
    case 'boss': {
      if (e.warn > 0) {
        // Carga el ataque: anillo que late
        const a = 0.4 + 0.4 * Math.sin(t / 45);
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ff3355';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 46 + (e.warn / 700) * 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawSprite(ctx, enemySprite('boss', false), e.x, e.y, s, s, e.a);
      drawSprite(ctx, sprite('ne-core', 40, 40, paintCore), e.x, e.y, 40, 40, -e.a * 2.2);
      if (e.flash > 0) drawSprite(ctx, enemySprite('boss', true), e.x, e.y, s, s, e.a, 0.6);
      return;
    }
  }
  drawSprite(ctx, enemySprite(e.kind, false), e.x, e.y, w, h, rot);
  if (e.flash > 0) drawSprite(ctx, enemySprite(e.kind, true), e.x, e.y, w, h, rot, 0.9);
}

export function NeonScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="neon" label="Puntos en la arena" view={(p) => <NeonGameView {...p} />} onClose={onClose} />;
}
