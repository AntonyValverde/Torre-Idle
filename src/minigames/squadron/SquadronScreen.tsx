import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { mulberry32 } from '../rng';
import { Fx, disc, drawSprite, hpBar, label, sprite } from '../shooter/fx';
import { moveVec, releaseInput, takeDrag, toWorldSpace, useInput, useStage, type View } from '../shooter/stage';
import { Banner, Hearts, HudBar, Meter, PauseCard, ShopPanel, StartCard, useHud } from '../shooter/ShooterUI';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  FIELD_H,
  FIELD_W,
  KEY_SPEED,
  POWER_MAX,
  SHOP,
  boss,
  buy,
  isBossWave,
  leaveHangar,
  maxHp,
  newSquadron,
  shopCost,
  step,
  type Enemy,
  type EnemyKind,
  type ShopId,
  type SquadronGame,
} from './logic';

const FIELD = { w: FIELD_W, h: FIELD_H };
const INTRO_MS = 3200;
/** El avión se mueve un poco más que el dedo: así no hace falta cruzar la pantalla entera. */
const DRAG_GAIN = 1.25;

type Phase = 'intro' | 'play' | 'paused' | 'hangar' | 'over';

const summary = (g: SquadronGame): WarSummary => ({
  score: g.score,
  detail: `Oleada ${g.wave} · ${g.kills} ${g.kills === 1 ? 'derribo' : 'derribos'}${g.bosses ? ` · ${g.bosses} ${g.bosses === 1 ? 'dirigible' : 'dirigibles'}` : ''}`,
});

// ---------------------------------------------------------------------------------------------
// Dibujos
// ---------------------------------------------------------------------------------------------

const CITY_H = 720;

/** Ciudad vista desde arriba, de noche: se repite en vertical para el scroll. */
function paintCity(c: CanvasRenderingContext2D, w: number, h: number) {
  c.translate(-w / 2, -h / 2);
  const r = mulberry32(7);
  c.fillStyle = '#161a33';
  c.fillRect(0, 0, w, h);
  const cell = 120;
  for (let gy = 0; gy < h; gy += cell) {
    for (let gx = 0; gx < w; gx += cell) {
      const x0 = gx + 9;
      const y0 = gy + 9;
      const s = cell - 18;
      if (r() < 0.14) {
        // Parque
        c.fillStyle = '#1b3a32';
        c.fillRect(x0, y0, s, s);
        for (let i = 0; i < 9; i++) {
          c.fillStyle = r() < 0.5 ? '#21503f' : '#1d4537';
          c.beginPath();
          c.arc(x0 + 10 + r() * (s - 20), y0 + 10 + r() * (s - 20), 6 + r() * 6, 0, Math.PI * 2);
          c.fill();
        }
        continue;
      }
      c.fillStyle = '#1d2140';
      c.fillRect(x0, y0, s, s);
      // Edificios de la manzana
      const cols = r() < 0.5 ? 2 : 3;
      const bw = s / cols;
      for (let i = 0; i < cols; i++) {
        let y = y0;
        while (y < y0 + s - 10) {
          const bh = Math.min(y0 + s - y, 22 + r() * 36);
          const pal = ['#2b3358', '#33305a', '#283a4f', '#3a2f4f', '#30395e'];
          c.fillStyle = pal[Math.floor(r() * pal.length)];
          c.fillRect(x0 + i * bw + 2, y + 2, bw - 4, bh - 4);
          c.fillStyle = 'rgba(255,255,255,0.06)';
          c.fillRect(x0 + i * bw + 2, y + 2, bw - 4, 3);
          // Luces de azotea
          if (r() < 0.6) {
            c.fillStyle = r() < 0.3 ? '#ff6b6b' : '#ffd76a';
            c.fillRect(x0 + i * bw + 5 + r() * (bw - 12), y + 5 + r() * (bh - 12), 2, 2);
          }
          if (r() < 0.4) {
            c.fillStyle = 'rgba(0,0,0,0.25)';
            c.fillRect(x0 + i * bw + 6, y + bh / 2 - 3, 8, 6);
          }
          y += bh;
        }
      }
    }
  }
  // Calles con farolas
  c.fillStyle = '#10132a';
  for (let x = 0; x <= w; x += cell) c.fillRect(x - 9, 0, 18, h);
  for (let y = 0; y <= h; y += cell) c.fillRect(0, y - 9, w, 18);
  c.fillStyle = 'rgba(255, 210, 120, 0.55)';
  for (let x = 0; x <= w; x += cell)
    for (let y = 20; y < h; y += 40) {
      c.fillRect(x - 7, y, 1.5, 1.5);
      c.fillRect(x + 5.5, y + 20, 1.5, 1.5);
    }
}

const CLOUD_H = 900;

function paintClouds(c: CanvasRenderingContext2D, w: number, h: number) {
  c.translate(-w / 2, -h / 2);
  const r = mulberry32(11);
  for (let i = 0; i < 9; i++) {
    const cx = r() * w;
    const cy = r() * h;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 70 + r() * 50);
    g.addColorStop(0, 'rgba(200, 210, 255, 0.16)');
    g.addColorStop(1, 'rgba(200, 210, 255, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy, 120, 60, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function paintPlayer(c: CanvasRenderingContext2D) {
  // Mira hacia arriba
  c.fillStyle = '#c99a2e';
  c.beginPath();
  c.moveTo(0, -4);
  c.lineTo(16, 5);
  c.lineTo(16, 9);
  c.lineTo(0, 6);
  c.lineTo(-16, 9);
  c.lineTo(-16, 5);
  c.closePath();
  c.fill();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.moveTo(0, -5);
  c.lineTo(15, 4);
  c.lineTo(15, 6);
  c.lineTo(0, 3);
  c.lineTo(-15, 6);
  c.lineTo(-15, 4);
  c.closePath();
  c.fill();
  // Cola
  c.fillStyle = '#c99a2e';
  c.beginPath();
  c.moveTo(0, 9);
  c.lineTo(7, 15);
  c.lineTo(-7, 15);
  c.closePath();
  c.fill();
  // Fuselaje
  const g = c.createLinearGradient(-4, 0, 4, 0);
  g.addColorStop(0, '#d9dcef');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(1, '#aeb3d0');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, 1, 4, 15, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#3d7bff';
  c.beginPath();
  c.ellipse(0, -5, 2.2, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fillRect(-0.8, -8, 1.2, 2.5);
}

function paintWing(c: CanvasRenderingContext2D) {
  c.fillStyle = '#7ad7ff';
  c.beginPath();
  c.moveTo(0, -7);
  c.lineTo(8, 3);
  c.lineTo(0, 1);
  c.lineTo(-8, 3);
  c.closePath();
  c.fill();
  c.fillStyle = '#e8f6ff';
  c.beginPath();
  c.ellipse(0, 0, 2, 6, 0, 0, Math.PI * 2);
  c.fill();
}

const ENEMY_SIZE: Record<EnemyKind, [number, number]> = {
  scout: [24, 22],
  diver: [22, 26],
  fighter: [32, 30],
  bomber: [50, 42],
  boss: [118, 66],
};

function paintEnemy(kind: EnemyKind, white: boolean) {
  return (c: CanvasRenderingContext2D) => {
    const col = (x: string) => (white ? '#ffffff' : x);
    // Miran hacia abajo
    switch (kind) {
      case 'scout':
        c.fillStyle = col('#ff4d6d');
        c.beginPath();
        c.moveTo(0, 10);
        c.lineTo(11, -8);
        c.lineTo(0, -3);
        c.lineTo(-11, -8);
        c.closePath();
        c.fill();
        c.fillStyle = col('#ffb3c1');
        c.beginPath();
        c.arc(0, 0, 3, 0, Math.PI * 2);
        c.fill();
        break;
      case 'diver':
        c.fillStyle = col('#ff8a3d');
        c.beginPath();
        c.moveTo(0, 12);
        c.lineTo(8, -4);
        c.lineTo(4, -12);
        c.lineTo(0, -6);
        c.lineTo(-4, -12);
        c.lineTo(-8, -4);
        c.closePath();
        c.fill();
        c.fillStyle = col('#ffe066');
        c.fillRect(-1.5, -2, 3, 8);
        break;
      case 'fighter':
        c.fillStyle = col('#b0243f');
        c.beginPath();
        c.moveTo(-15, -3);
        c.lineTo(15, -3);
        c.lineTo(15, 2);
        c.lineTo(-15, 2);
        c.closePath();
        c.fill();
        c.fillStyle = col('#e63950');
        c.beginPath();
        c.ellipse(0, 0, 4.5, 14, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#b0243f');
        c.beginPath();
        c.moveTo(0, -10);
        c.lineTo(7, -14);
        c.lineTo(-7, -14);
        c.closePath();
        c.fill();
        c.fillStyle = col('#2a0d18');
        c.beginPath();
        c.ellipse(0, 5, 2, 3.5, 0, 0, Math.PI * 2);
        c.fill();
        break;
      case 'bomber':
        c.fillStyle = col('#5b3a8a');
        c.beginPath();
        c.moveTo(-24, -6);
        c.lineTo(24, -6);
        c.lineTo(20, 4);
        c.lineTo(-20, 4);
        c.closePath();
        c.fill();
        c.fillStyle = col('#7c52b8');
        c.beginPath();
        c.ellipse(0, 0, 7, 20, 0, 0, Math.PI * 2);
        c.fill();
        for (const x of [-16, -8, 8, 16]) {
          c.fillStyle = col('#3b2560');
          c.beginPath();
          c.ellipse(x, 2, 2.8, 5, 0, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = col('#5b3a8a');
        c.fillRect(-9, -20, 18, 4);
        c.fillStyle = col('#ffd76a');
        c.beginPath();
        c.arc(0, 12, 2.6, 0, Math.PI * 2);
        c.fill();
        break;
      case 'boss': {
        const g = c.createLinearGradient(0, -26, 0, 26);
        g.addColorStop(0, white ? '#fff' : '#8a8fb8');
        g.addColorStop(0.5, white ? '#fff' : '#5c608a');
        g.addColorStop(1, white ? '#fff' : '#383b5c');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(0, -2, 56, 24, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = col('rgba(255,255,255,0.18)');
        c.lineWidth = 1.2;
        for (const x of [-30, -10, 10, 30]) {
          c.beginPath();
          c.ellipse(x * 0.95, -2, 4, 22, 0, 0, Math.PI * 2);
          c.stroke();
        }
        // Aletas
        c.fillStyle = col('#b0243f');
        c.beginPath();
        c.moveTo(-50, -4);
        c.lineTo(-58, -24);
        c.lineTo(-40, -10);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(-50, 0);
        c.lineTo(-58, 18);
        c.lineTo(-40, 6);
        c.closePath();
        c.fill();
        // Góndola con cañones
        c.fillStyle = col('#2a2c44');
        c.fillRect(-20, 16, 40, 12);
        c.fillStyle = col('#ffd76a');
        for (const x of [-14, -6, 2, 10]) c.fillRect(x, 19, 4, 4);
        c.fillStyle = col('#b0243f');
        c.fillRect(-26, 22, 52, 3);
        break;
      }
    }
  };
}

function enemySprite(kind: EnemyKind, white: boolean) {
  const [w, h] = ENEMY_SIZE[kind];
  return sprite(`sq-${kind}-${white ? 'w' : 'c'}`, w, h, paintEnemy(kind, white), kind === 'boss' ? 3 : 4);
}

/** Bala propia: cápsula blanca con halo de color (va con mezcla aditiva). */
function paintShot(color: string) {
  return (c: CanvasRenderingContext2D) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.globalAlpha = 0.55;
    c.beginPath();
    c.ellipse(0, 0, 5, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(0, 0, 2.2, 7, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(0, -1, 1.1, 5, 0, 0, Math.PI * 2);
    c.fill();
  };
}

function paintEnemyShot(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#ffd1e0');
  g.addColorStop(0.6, '#ff3d7f');
  g.addColorStop(1, 'rgba(255, 61, 127, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 6, 0, Math.PI * 2);
  c.fill();
}

function paintCoin(c: CanvasRenderingContext2D) {
  c.fillStyle = '#b8860b';
  c.beginPath();
  c.arc(0, 0.6, 5.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffc23d';
  c.beginPath();
  c.arc(0, 0, 5.5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#fff1b8';
  c.lineWidth = 0.9;
  c.beginPath();
  c.arc(0, 0, 3.6, 0, Math.PI * 2);
  c.stroke();
}

function paintStar(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 12);
  g.addColorStop(0, 'rgba(255, 230, 120, 0.7)');
  g.addColorStop(1, 'rgba(255, 230, 120, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 12, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffe066';
  c.strokeStyle = '#b8860b';
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3.4 : 7.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  c.stroke();
}

function paintHeart(c: CanvasRenderingContext2D) {
  c.fillStyle = '#ff4d6d';
  c.strokeStyle = '#fff';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(0, 6);
  c.bezierCurveTo(-9, 0, -6, -8, 0, -3);
  c.bezierCurveTo(6, -8, 9, 0, 0, 6);
  c.fill();
  c.stroke();
}

const KILL_COLORS: Record<EnemyKind, string[]> = {
  scout: ['#ff4d6d', '#ffb3c1', '#ffe066'],
  diver: ['#ff8a3d', '#ffe066'],
  fighter: ['#e63950', '#ffb938', '#ffffff'],
  bomber: ['#7c52b8', '#ffb938', '#ffffff', '#ff5a3a'],
  boss: ['#ffb938', '#ff5a3a', '#ffffff', '#8a8fb8'],
};

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

export function SquadronGameView({ onOver, onScore }: WarViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<SquadronGame>(null as unknown as SquadronGame);
  if (!game.current) game.current = newSquadron(Math.random);
  const fx = useRef(new Fx());
  const [phase, setPhaseState] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>('intro');
  const introEnd = useRef(performance.now() + INTRO_MS);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'boss'; id: number } | null>(null);
  const [, setShopTick] = useState(0);
  const scroll = useRef(0);
  const coinCombo = useRef({ n: 0, until: 0 });
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  const input = useInput(canvas, 'drag');
  const [hud, pushHud] = useHud({ score: 0, wave: 1, coins: 0, hp: 3, max: 3, power: 1, boss: -1 });

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      if (p !== 'play') releaseInput(input.current);
    },
    [input],
  );

  const say = (text: string, tone: 'good' | 'bad' | 'boss' = 'good') => setBanner({ text, tone, id: performance.now() });

  // Solo en desarrollo: la partida a mano desde la consola (para probar el hangar o el jefe)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __shooter?: SquadronGame }).__shooter = game.current;
  }, []);

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

  const onStep = (dt: number) => {
    const g = game.current;
    const v = view.current;
    const inp = input.current;
    const drag = takeDrag(inp);
    const k = moveVec(inp);
    const move = {
      x: (drag.x / v.scale) * DRAG_GAIN + k.x * KEY_SPEED * (dt / 1000),
      y: (drag.y / v.scale) * DRAG_GAIN + k.y * KEY_SPEED * (dt / 1000),
    };
    const prevScore = g.score;
    const ev = step(g, dt, move, Math.random);
    const f = fx.current;
    for (const s of ev.sparks) f.burst(s.x, s.y, { n: 3, colors: ['#fff', '#ffe066'], speed: 70, life: 200, size: 1.4, shape: 'spark' });
    for (const p of ev.kills) {
      const big = p.kind === 'bomber' || p.kind === 'boss';
      f.burst(p.x, p.y, { n: p.kind === 'boss' ? 70 : big ? 34 : 14, colors: KILL_COLORS[p.kind], speed: p.kind === 'boss' ? 220 : big ? 150 : 110, life: big ? 700 : 450, size: big ? 3 : 2.2 });
      f.ring(p.x, p.y, '#ffe9a8', p.kind === 'boss' ? 90 : big ? 40 : 18, big ? 500 : 300);
      f.text(p.x, p.y - 8, `+${p.pts}`, '#ffe066', big ? 13 : 9);
      if (big) {
        f.shake(p.kind === 'boss' ? 9 : 4, p.kind === 'boss' ? 600 : 250);
        tone(p.kind === 'boss' ? 70 : 130, p.kind === 'boss' ? 0.6 : 0.25, 'sawtooth', 0.07);
        vibrate(p.kind === 'boss' ? [40, 30, 80] : 25);
      } else tone(520 + Math.random() * 160, 0.05, 'triangle', 0.035);
    }
    if (ev.coins) {
      const now = performance.now();
      const c = coinCombo.current;
      c.n = now < c.until ? Math.min(c.n + 1, 14) : 0;
      c.until = now + 450;
      tone(880 * 2 ** (c.n / 12), 0.035, 'sine', 0.03);
    }
    if (ev.star) {
      sfx('crit');
      f.text(g.x, g.y - 26, g.power >= POWER_MAX ? '¡Arma al máximo! +5' : `¡Arma nivel ${g.power}!`, '#ffe066', 11, 1100);
      f.burst(g.x, g.y, { n: 18, colors: ['#ffe066', '#fff'], speed: 120, shape: 'spark' });
    }
    if (ev.heart) {
      sfx('buy');
      f.text(g.x, g.y - 26, '+1 ❤️', '#ff8a9a', 11, 1000);
    }
    if (ev.hurt) {
      f.flash('#ff2d55', 260);
      f.shake(7, 350);
      f.burst(g.x, g.y, { n: 22, colors: ['#ff4d6d', '#fff', '#ffb938'], speed: 140 });
      tone(110, 0.3, 'sawtooth', 0.07);
      vibrate([60, 40, 60]);
    }
    if (ev.bossIn) {
      say('⚠️ ¡Dirigible a la vista!', 'boss');
      tone(80, 0.7, 'sawtooth', 0.06);
      vibrate([30, 60, 30]);
    }
    if (ev.bossWarn) tone(320, 0.07, 'square', 0.025);
    if (ev.bossDown) say('💥 ¡Dirigible derribado!', 'boss');
    if (ev.waveClear) {
      if (!ev.bossDown) say(`✅ ¡Oleada ${g.wave} superada!`);
      tone(660, 0.1, 'triangle', 0.05);
      setTimeout(() => tone(990, 0.12, 'triangle', 0.05), 110);
    }
    if (ev.waveStart) say(isBossWave(ev.waveStart) ? `Oleada ${ev.waveStart}: ¡jefe!` : `Oleada ${ev.waveStart}`, isBossWave(ev.waveStart) ? 'boss' : 'good');
    if (ev.hangar) {
      sfx('win');
      setPhase('hangar');
    }
    if (g.score !== prevScore) cb.current.onScore(summary(g));
    if (ev.lost) {
      f.shake(10, 700);
      f.burst(g.x, g.y, { n: 60, colors: ['#ffc23d', '#ff5a3a', '#fff', '#666'], speed: 200, life: 900, size: 3 });
      tone(70, 0.8, 'sawtooth', 0.08);
      vibrate([80, 50, 160]);
      say('💥 ¡Derribado!', 'bad');
      setPhase('over');
      setTimeout(() => cb.current.onOver(summary(g)), 1600);
    }
  };

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const live = ph !== 'paused' && ph !== 'hangar';
    if (live) {
      fx.current.update(frame);
      scroll.current += frame * (ph === 'over' ? 0.015 : 0.045);
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    drawWorld(ctx, v, g, fx.current, scroll.current);
    fx.current.drawFlash(ctx, v);
    const b = boss(g);
    pushHud({ score: g.score, wave: g.wave, coins: g.coins, hp: g.hp, max: maxHp(g), power: g.power, boss: b ? b.hp / b.max : -1 });
  };

  const view = useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;

  return (
    <div className="sh-wrap">
      <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Escuadrilla, oleada ${hud.wave}. ${hud.hp} vidas.`} />
      <HudBar
        items={[
          { icon: '🏆', value: hud.score, label: 'Puntos' },
          { icon: '🌊', value: hud.wave, label: 'Oleada' },
          { icon: '🪙', value: hud.coins, label: 'Monedas' },
        ]}
        onPause={phase === 'play' ? pause : undefined}
      >
        <div className="sh-hud-row">
          <Hearts hp={hud.hp} max={hud.max} />
          <span className="sq-power" aria-label={`Arma nivel ${hud.power} de ${POWER_MAX}`}>
            {Array.from({ length: POWER_MAX }, (_, i) => (
              <i key={i} className={i < hud.power ? 'on' : ''} aria-hidden="true">
                ★
              </i>
            ))}
          </span>
        </div>
        {hud.boss >= 0 && <Meter value={hud.boss} max={1} color="linear-gradient(90deg, #ff5a3a, #ffb938)" label="Vida del dirigible" text="DIRIGIBLE" />}
      </HudBar>
      {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
      {phase === 'intro' && (
        <StartCard
          title="Escuadrilla"
          left={introLeft}
          total={INTRO_MS}
          onSkip={start}
          lines={[
            { icon: '👆', text: 'Arrastra en cualquier parte: el avión se mueve contigo. Disparas solo.' },
            { icon: '🪙', text: 'Recoge monedas y gástalas en el hangar cada dos oleadas.' },
            { icon: '⭐', text: 'Las estrellas mejoran tu arma. ¡Esquiva las balas rosas!' },
          ]}
        />
      )}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            Oleada {g.wave} · {g.score} {g.score === 1 ? 'punto' : 'puntos'} · {g.coins} 🪙
          </p>
        </PauseCard>
      )}
      {phase === 'hangar' && (
        <ShopPanel
          title="🛠️ Hangar"
          subtitle={`Oleada ${g.wave} superada. Mejora el avión antes de despegar.`}
          money={g.coins}
          items={SHOP.map((d) => ({
            id: d.id,
            emoji: d.emoji,
            name: d.name,
            desc: d.id === 'repair' ? (g.hp < maxHp(g) ? d.desc(1) : 'Ya tienes todas las vidas') : d.desc(g.lv[d.id] + 1),
            level: g.lv[d.id],
            max: d.max || undefined,
            cost: shopCost(g, d.id),
          }))}
          onBuy={(id) => {
            if (buy(g, id as ShopId)) setShopTick((n) => n + 1);
          }}
          doneText={`🛫 Despegar · Oleada ${g.wave + 1}${isBossWave(g.wave + 1) ? ' (jefe)' : ''}`}
          onDone={() => {
            const w = leaveHangar(g, Math.random);
            say(isBossWave(w) ? `Oleada ${w}: ¡jefe!` : `Oleada ${w}`, isBossWave(w) ? 'boss' : 'good');
            setPhase('play');
          }}
        />
      )}
    </div>
  );
}

function drawWorld(ctx: CanvasRenderingContext2D, v: View, g: SquadronGame, f: Fx, scroll: number) {
  toWorldSpace(ctx, v);
  const sh = f.offset();
  ctx.translate(sh.x, sh.y);
  const t = g.t;

  // Fondo: ciudad (se repite en horizontal si sobra pantalla) y nubes más rápidas encima
  const city = sprite('sq-city', FIELD_W, CITY_H, (c) => paintCity(c, FIELD_W, CITY_H), 2);
  const clouds = sprite('sq-clouds', FIELD_W, CLOUD_H, (c) => paintClouds(c, FIELD_W, CLOUD_H), 1.5);
  const cy = scroll % CITY_H;
  const ky = (scroll * 2.2) % CLOUD_H;
  for (let x = Math.floor(v.x0 / FIELD_W) * FIELD_W; x < v.x1; x += FIELD_W) {
    for (let y = cy - CITY_H; y < v.y1; y += CITY_H) if (y + CITY_H > v.y0) ctx.drawImage(city, x, y, FIELD_W, CITY_H);
    for (let y = ky - CLOUD_H; y < v.y1; y += CLOUD_H) if (y + CLOUD_H > v.y0) ctx.drawImage(clouds, x, y, FIELD_W, CLOUD_H);
  }
  const sky = ctx.createLinearGradient(0, v.y0, 0, v.y1);
  sky.addColorStop(0, 'rgba(8, 6, 30, 0.7)');
  sky.addColorStop(0.5, 'rgba(8, 6, 30, 0.42)');
  sky.addColorStop(1, 'rgba(8, 6, 30, 0.55)');
  ctx.fillStyle = sky;
  ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

  // Monedas y premios (debajo de los aviones)
  for (const p of g.pickups) {
    if (p.kind === 'coin') {
      const spin = Math.abs(Math.cos(t / 160 + p.x * 0.1));
      drawSprite(ctx, sprite('sq-coin', 12, 13, paintCoin), p.x, p.y, 12 * Math.max(0.25, spin), 13);
    } else if (p.kind === 'star') {
      const s = 1 + Math.sin(t / 140) * 0.12;
      drawSprite(ctx, sprite('sq-star', 26, 26, paintStar), p.x, p.y, 26 * s, 26 * s, t / 600);
    } else drawSprite(ctx, sprite('sq-heart', 20, 16, paintHeart), p.x, p.y, 20, 16);
  }

  // Sombras de los aviones sobre la ciudad
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (const e of g.enemies) {
    const [w] = ENEMY_SIZE[e.kind];
    ctx.beginPath();
    ctx.ellipse(e.x + 10, e.y + 16, w * 0.35, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemigos
  for (const e of g.enemies) drawEnemy(ctx, e, t);

  // Disparos propios (con brillo aditivo). Al caer el avión se dejan de pintar: el mundo se para
  ctx.globalCompositeOperation = 'lighter';
  for (const s of g.phase === 'over' ? [] : g.shots) {
    if (s.kind === 'missile') {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2);
      ctx.fillStyle = '#ff9a3c';
      ctx.fillRect(-1.6, 4, 3.2, 5 + Math.random() * 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1.6, -5, 3.2, 9);
      ctx.restore();
      if (Math.random() < 0.5) f.burst(s.x, s.y, { n: 1, colors: ['rgba(200,200,220,0.5)'], speed: 10, life: 350, size: 2.4, drag: 4 });
    } else {
      const spr = s.kind === 'wing' ? sprite('sq-shot-w', 10, 22, paintShot('#7ad7ff')) : sprite('sq-shot', 10, 22, paintShot('#ffd23d'));
      drawSprite(ctx, spr, s.x, s.y, 10, 22, s.vx ? Math.atan2(s.vx, -s.vy) : 0);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Avión y escoltas
  if (g.phase !== 'over') {
    const blink = g.inv > 0 && Math.floor(g.inv / 90) % 2 === 0;
    const alpha = blink ? 0.3 : 1;
    // Llama del motor
    const fl = 5 + Math.random() * 5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(g.x - 3, g.y + 14);
    ctx.lineTo(g.x + 3, g.y + 14);
    ctx.lineTo(g.x, g.y + 14 + fl);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    drawSprite(ctx, sprite('sq-player', 34, 32, paintPlayer), g.x, g.y, 34, 32, 0, alpha);
    if (g.lv.wing > 0) for (const dx of [-26, 26]) drawSprite(ctx, sprite('sq-wing', 18, 16, paintWing), g.x + dx, g.y + 6 + Math.sin(t / 300 + dx) * 2, 18, 16, 0, alpha);
    // Escudo de invulnerabilidad
    if (g.inv > 0) {
      ctx.strokeStyle = `rgba(122, 215, 255, ${0.25 + 0.25 * Math.sin(t / 60)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Hueco real del avión: un punto, para saber qué esquivar
    disc(ctx, g.x, g.y + 1, 2.2, 'rgba(255,255,255,0.9)');
  }

  // Balas enemigas encima de todo para que se vean bien
  const eb = sprite('sq-eshot', 12, 12, paintEnemyShot);
  if (g.phase !== 'over') for (const b of g.eshots) drawSprite(ctx, eb, b.x, b.y, b.r * 3, b.r * 3);

  f.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Viñeta roja con una sola vida
  if (g.hp === 1 && g.phase === 'play') {
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const a = 0.22 + 0.12 * Math.sin(t / 250);
    const r = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.35, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.75);
    r.addColorStop(0, 'rgba(255, 30, 60, 0)');
    r.addColorStop(1, `rgba(255, 30, 60, ${a})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number) {
  const [w, h] = ENEMY_SIZE[e.kind];
  const rot = e.move === 'dive' && (e.vx || e.vy) ? Math.atan2(e.vy, e.vx) - Math.PI / 2 : e.move === 'cross' ? Math.sign(e.vx) * -0.35 : 0;
  if (e.kind === 'boss') {
    // Aviso del siguiente patrón: brillo rojo que late
    if (e.warn > 0) {
      const a = 0.35 + 0.35 * Math.sin(t / 40);
      const glow = ctx.createRadialGradient(e.x, e.y, 10, e.x, e.y, 80);
      glow.addColorStop(0, `rgba(255, 60, 60, ${a})`);
      glow.addColorStop(1, 'rgba(255, 60, 60, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 80, 0, Math.PI * 2);
      ctx.fill();
    }
    drawSprite(ctx, enemySprite('boss', false), e.x, e.y, w, h);
    // Hélices
    ctx.fillStyle = 'rgba(230, 230, 255, 0.6)';
    const p = Math.abs(Math.sin(t / 30)) * 9 + 2;
    for (const x of [-34, 34]) ctx.fillRect(e.x + x - p / 2, e.y + 22, p, 2);
    if (e.flash > 0) drawSprite(ctx, enemySprite('boss', true), e.x, e.y, w, h, 0, 0.7);
    if (e.warn > 0) label(ctx, '!', e.x, e.y - 34, { size: 18, color: '#ff5a5f' });
    return;
  }
  drawSprite(ctx, enemySprite(e.kind, false), e.x, e.y, w, h, rot);
  if (e.flash > 0) drawSprite(ctx, enemySprite(e.kind, true), e.x, e.y, w, h, rot, 0.85);
  if (e.kind === 'bomber' || e.kind === 'fighter') hpBar(ctx, e.x, e.y - h / 2 - 4, w * 0.7, e.hp / e.max);
}

export function SquadronScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="squadron" label="Puntos de vuelo" view={(p) => <SquadronGameView {...p} />} onClose={onClose} />;
}
