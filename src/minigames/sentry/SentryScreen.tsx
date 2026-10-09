import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt } from '../../game/format';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { mulberry32 } from '../rng';
import { Fx, disc, drawSprite, hpBar, sprite } from '../shooter/fx';
import { toScreenSpace, toWorldSpace, useStage, type View } from '../shooter/stage';
import { Banner, Meter, PauseCard, StartCard, useHud } from '../shooter/ShooterUI';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  FIELD_H,
  FIELD_W,
  RAYO_MS,
  TX,
  TY,
  UPGRADES,
  boss,
  buy,
  interestCap,
  isBossWave,
  maxHp,
  newSentry,
  range,
  rayo,
  rayoReady,
  step,
  upCost,
  waveProgress,
  type Enemy,
  type EnemyKind,
  type Levels,
  type SentryEvents,
  type SentryGame,
  type Tab,
  type UpId,
} from './logic';
import './sentry.css';

const FIELD = { w: FIELD_W, h: FIELD_H };
const INTRO_MS = 3600;
/** Por debajo de esta fracción de vida, la torre avisa. */
const LOW_HP = 0.3;

type Phase = 'intro' | 'play' | 'paused' | 'over';
type Tone = 'good' | 'bad' | 'boss';

const TABS: { id: Tab; label: string }[] = [
  { id: 'atk', label: '⚔️ Ataque' },
  { id: 'def', label: '🛡️ Defensa' },
  { id: 'eco', label: '🪙 Economía' },
];

const summary = (g: SentryGame): WarSummary => ({
  score: g.score,
  detail: `Oleada ${g.wave} · ${g.kills} bajas${g.bosses ? ` · ${g.bosses} ${g.bosses === 1 ? 'jefe' : 'jefes'}` : ''}`,
});

/** Estilo de la torre y del suelo según la era de la ciudad: piedra, ladrillo, hormigón, futuro. */
function eraTier(era: number): number {
  return era <= 2 ? 0 : era <= 4 ? 1 : era <= 6 ? 2 : 3;
}

// ---------------------------------------------------------------------------------------------
// Dibujos (cada uno se pinta una vez en un sprite)
// ---------------------------------------------------------------------------------------------

function poly(c: CanvasRenderingContext2D, n: number, r: number, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
}

const GROUND_PAD = 110;
const GROUND_W = FIELD_W + GROUND_PAD * 2;
const GROUND_H = FIELD_H + GROUND_PAD * 2;

const GROUND_BG = ['#17291f', '#231e1a', '#181a21', '#0b0d26'];

/** Suelo alrededor de la torre: hierba, empedrado, asfalto o rejilla de neón según la era. */
function paintGround(tier: number) {
  return (c: CanvasRenderingContext2D) => {
    const w = GROUND_W;
    const h = GROUND_H;
    c.translate(-w / 2, -h / 2);
    const r = mulberry32(17 + tier);
    const cx = w / 2;
    const cy = h / 2;
    c.fillStyle = GROUND_BG[tier];
    c.fillRect(0, 0, w, h);
    if (tier <= 1) {
      const blobs = tier === 0 ? ['#1c3324', '#14251b', '#21402c', '#1a2f22'] : ['#2a241e', '#1e1915', '#2f2820', '#262019'];
      for (let i = 0; i < 260; i++) {
        c.globalAlpha = 0.5 + r() * 0.5;
        c.fillStyle = blobs[i % blobs.length];
        c.beginPath();
        c.ellipse(r() * w, r() * h, 6 + r() * 20, 4 + r() * 14, r() * 3, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      // Matas o piedras sueltas
      c.strokeStyle = tier === 0 ? 'rgba(70, 120, 80, 0.45)' : 'rgba(80, 70, 58, 0.5)';
      c.lineWidth = 0.8;
      c.lineCap = 'round';
      for (let i = 0; i < 140; i++) {
        const x = r() * w;
        const y = r() * h;
        c.beginPath();
        for (let k = -1; k <= 1; k++) {
          c.moveTo(x + k * 1.2, y);
          c.lineTo(x + k * 2.2 + (r() - 0.5), y - 2.5 - r() * 1.5);
        }
        c.stroke();
      }
      for (let i = 0; i < 26; i++) {
        c.fillStyle = tier === 0 ? (r() < 0.5 ? '#c9b458' : '#c46a8a') : '#4a4239';
        const s = tier === 0 ? 1.4 : 2 + r() * 3;
        c.beginPath();
        c.ellipse(r() * w, r() * h, s, s * 0.8, 0, 0, Math.PI * 2);
        c.fill();
      }
      // Plaza empedrada alrededor de la torre
      const pr = tier === 0 ? 36 : 44;
      c.fillStyle = tier === 0 ? '#38342d' : '#3a2f28';
      c.beginPath();
      c.arc(cx, cy, pr, 0, Math.PI * 2);
      c.fill();
      for (let ring = 22; ring < pr; ring += 6) {
        const n = Math.floor((ring * Math.PI * 2) / 7);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring;
          c.fillStyle = r() < 0.5 ? (tier === 0 ? '#4a453c' : '#4d3d33') : tier === 0 ? '#423d35' : '#45362d';
          c.beginPath();
          c.ellipse(cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, 3, 2.3, a, 0, Math.PI * 2);
          c.fill();
        }
      }
    } else if (tier === 2) {
      // Manzanas de ciudad vistas desde arriba y calles con marcas
      const cell = 80;
      for (let gy = -cell / 2; gy < h; gy += cell)
        for (let gx = -cell / 2; gx < w; gx += cell) {
          c.fillStyle = r() < 0.5 ? '#1e212a' : '#20232d';
          c.fillRect(gx + 9, gy + 9, cell - 18, cell - 18);
          c.fillStyle = 'rgba(255,255,255,0.03)';
          c.fillRect(gx + 9, gy + 9, cell - 18, 3);
          if (r() < 0.5) {
            c.fillStyle = r() < 0.3 ? 'rgba(255,107,107,0.5)' : 'rgba(255,215,106,0.45)';
            c.fillRect(gx + 14 + r() * (cell - 32), gy + 14 + r() * (cell - 32), 2, 2);
          }
        }
      c.strokeStyle = 'rgba(255, 220, 120, 0.12)';
      c.setLineDash([6, 8]);
      c.lineWidth = 1;
      for (let x = cell / 2; x < w; x += cell) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
      }
      for (let y = cell / 2; y < h; y += cell) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      c.setLineDash([]);
      c.fillStyle = '#2a2e39';
      c.beginPath();
      c.arc(cx, cy, 40, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255, 194, 61, 0.35)';
      c.lineWidth = 2;
      c.setLineDash([5, 5]);
      c.beginPath();
      c.arc(cx, cy, 34, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    } else {
      // Rejilla de neón
      for (let x = 0; x <= w; x += 30) {
        c.fillStyle = x % 120 === 0 ? 'rgba(61, 245, 255, 0.12)' : 'rgba(61, 245, 255, 0.05)';
        c.fillRect(x, 0, 1, h);
      }
      for (let y = 0; y <= h; y += 30) {
        c.fillStyle = y % 120 === 0 ? 'rgba(61, 245, 255, 0.12)' : 'rgba(61, 245, 255, 0.05)';
        c.fillRect(0, y, w, 1);
      }
      for (let i = 0; i < 40; i++) {
        c.fillStyle = r() < 0.5 ? 'rgba(255, 61, 200, 0.5)' : 'rgba(61, 245, 255, 0.5)';
        c.fillRect(Math.round((r() * w) / 30) * 30 - 1, Math.round((r() * h) / 30) * 30 - 1, 3, 3);
      }
      c.strokeStyle = 'rgba(61, 245, 255, 0.3)';
      c.lineWidth = 1.5;
      c.save();
      c.translate(cx, cy);
      poly(c, 6, 40);
      c.stroke();
      poly(c, 6, 30);
      c.stroke();
      c.restore();
    }
    // Viñeta: los bordes más oscuros, el centro más claro
    const v = c.createRadialGradient(cx, cy, 60, cx, cy, Math.max(w, h) * 0.6);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = v;
    c.fillRect(0, 0, w, h);
  };
}

const BASE_SIZE = 50;

/** Base de la torre vista desde arriba. */
function paintBase(tier: number) {
  return (c: CanvasRenderingContext2D) => {
    if (tier <= 1) {
      const stone = tier === 0 ? ['#8b867d', '#7b766d', '#6c675f'] : ['#a64b3b', '#943f31', '#b5584a'];
      const dark = tier === 0 ? '#2b2824' : '#3a1712';
      c.fillStyle = dark;
      c.beginPath();
      c.arc(0, 0, 22, 0, Math.PI * 2);
      c.fill();
      // Anillo de muro con sus piedras o ladrillos
      const n = tier === 0 ? 14 : 20;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + 0.03;
        const a1 = ((i + 1) / n) * Math.PI * 2 - 0.03;
        c.fillStyle = stone[i % 3];
        c.beginPath();
        c.arc(0, 0, 20.5, a0, a1);
        c.arc(0, 0, 14.5, a1, a0, true);
        c.closePath();
        c.fill();
      }
      if (tier === 1) {
        c.strokeStyle = 'rgba(230, 205, 170, 0.45)';
        c.lineWidth = 0.6;
        c.beginPath();
        c.arc(0, 0, 17.5, 0, Math.PI * 2);
        c.stroke();
      }
      // Almenas
      for (let i = 0; i < 8; i++) {
        c.save();
        c.rotate((i / 8) * Math.PI * 2 + Math.PI / 8);
        c.fillStyle = dark;
        c.fillRect(15.5, -4, 7, 8);
        c.fillStyle = tier === 0 ? '#a29c91' : '#c4624f';
        c.fillRect(16, -3.5, 6, 7);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(16, -3.5, 6, 1.5);
        c.restore();
      }
      // Suelo de tablas
      c.fillStyle = tier === 0 ? '#5a4632' : '#4a3a35';
      c.beginPath();
      c.arc(0, 0, 14.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 0.6;
      for (let x = -12; x <= 12; x += 4) {
        const hh = Math.sqrt(Math.max(0, 14.5 * 14.5 - x * x));
        c.beginPath();
        c.moveTo(x, -hh);
        c.lineTo(x, hh);
        c.stroke();
      }
    } else if (tier === 2) {
      c.fillStyle = '#2a2f3a';
      poly(c, 8, 23, Math.PI / 8);
      c.fill();
      c.fillStyle = '#8d96a8';
      poly(c, 8, 21, Math.PI / 8);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.15)';
      poly(c, 8, 21, Math.PI / 8);
      c.save();
      c.clip();
      c.fillRect(-25, -25, 50, 12);
      c.restore();
      // Anillo de franjas de aviso
      for (let i = 0; i < 24; i++) {
        c.fillStyle = i % 2 ? '#1d1f26' : '#ffc23d';
        const a0 = (i / 24) * Math.PI * 2;
        const a1 = ((i + 1) / 24) * Math.PI * 2;
        c.beginPath();
        c.arc(0, 0, 17, a0, a1);
        c.arc(0, 0, 14.5, a1, a0, true);
        c.closePath();
        c.fill();
      }
      c.fillStyle = '#5f6778';
      c.beginPath();
      c.arc(0, 0, 14.5, 0, Math.PI * 2);
      c.fill();
      // Mástil de la antena (la luz se pinta aparte para que parpadee)
      c.fillStyle = '#c9d1e0';
      c.fillRect(14, -17, 3, 3);
      c.strokeStyle = '#c9d1e0';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(15.5, -15.5);
      c.lineTo(20, -20);
      c.stroke();
    } else {
      c.fillStyle = '#3df5ff';
      poly(c, 6, 23.5, Math.PI / 6);
      c.fill();
      c.fillStyle = '#1b2147';
      poly(c, 6, 22, Math.PI / 6);
      c.fill();
      c.fillStyle = '#262e66';
      poly(c, 6, 16, Math.PI / 6);
      c.fill();
      c.strokeStyle = 'rgba(61, 245, 255, 0.75)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(0, 0, 13, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        c.fillStyle = i % 2 ? '#ff3dc8' : '#3df5ff';
        c.beginPath();
        c.arc(Math.cos(a) * 19, Math.sin(a) * 19, 1.6, 0, Math.PI * 2);
        c.fill();
      }
    }
  };
}

const TURRET_SIZE = 44;

/** Cañón mirando hacia +x (se gira hacia el blanco). */
function paintTurret(tier: number) {
  return (c: CanvasRenderingContext2D) => {
    if (tier === 0) {
      // Ballesta de madera
      c.strokeStyle = '#3a2410';
      c.lineWidth = 2.6;
      c.beginPath();
      c.arc(-2, 0, 10, -1.15, 1.15);
      c.stroke();
      c.strokeStyle = '#8a5a2b';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(-2, 0, 10, -1.15, 1.15);
      c.stroke();
      c.strokeStyle = 'rgba(240, 230, 200, 0.8)';
      c.lineWidth = 0.6;
      c.beginPath();
      c.moveTo(-2 + Math.cos(-1.15) * 10, Math.sin(-1.15) * 10);
      c.lineTo(-5, 0);
      c.lineTo(-2 + Math.cos(1.15) * 10, Math.sin(1.15) * 10);
      c.stroke();
      c.fillStyle = '#3a2410';
      c.fillRect(-8, -2.6, 25, 5.2);
      c.fillStyle = '#b07a42';
      c.fillRect(-7.5, -2, 24, 4);
      c.fillStyle = '#d8d8e0';
      c.beginPath();
      c.moveTo(20, 0);
      c.lineTo(16, -2.6);
      c.lineTo(16, 2.6);
      c.closePath();
      c.fill();
      c.fillStyle = '#6b4320';
      c.beginPath();
      c.arc(0, 0, 4.5, 0, Math.PI * 2);
      c.fill();
    } else if (tier === 1) {
      // Cañón de hierro
      c.fillStyle = '#15151b';
      c.beginPath();
      c.arc(0, 0, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#3d3d48';
      c.beginPath();
      c.arc(0, 0, 8, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#15151b';
      c.fillRect(0, -4, 19, 8);
      c.fillStyle = '#2f2f39';
      c.fillRect(0, -3.2, 18.5, 6.4);
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillRect(1, -2.6, 17, 1.4);
      c.fillStyle = '#4a4a56';
      c.fillRect(16, -4.4, 4, 8.8);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.beginPath();
      c.arc(-2, -2.5, 3.5, 0, Math.PI * 2);
      c.fill();
    } else if (tier === 2) {
      // Torreta doble
      c.fillStyle = '#20242e';
      c.fillRect(1, -6, 18, 4.6);
      c.fillRect(1, 1.4, 18, 4.6);
      c.fillStyle = '#4b5366';
      c.fillRect(2, -5.3, 16.5, 3.2);
      c.fillRect(2, 2.1, 16.5, 3.2);
      c.fillStyle = '#2a2f3a';
      c.beginPath();
      c.roundRect(-9, -9, 16, 18, 4);
      c.fill();
      c.fillStyle = '#c9d1e0';
      c.beginPath();
      c.roundRect(-8, -8, 14, 16, 3.5);
      c.fill();
      c.fillStyle = '#3d7bff';
      c.fillRect(-6, -1.4, 10, 2.8);
    } else {
      // Emisor láser
      c.fillStyle = '#3df5ff';
      c.beginPath();
      c.arc(0, 0, 9.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2a326e';
      c.beginPath();
      c.arc(0, 0, 8.5, 0, Math.PI * 2);
      c.fill();
      const g = c.createLinearGradient(0, 0, 20, 0);
      g.addColorStop(0, '#3df5ff');
      g.addColorStop(1, '#ffffff');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-2, 0);
      c.lineTo(6, -4.5);
      c.lineTo(20, 0);
      c.lineTo(6, 4.5);
      c.closePath();
      c.fill();
      c.fillStyle = '#ff3dc8';
      c.beginPath();
      c.arc(-3, 0, 2.4, 0, Math.PI * 2);
      c.fill();
    }
  };
}

const ENEMY_SIZE: Record<EnemyKind, number> = { basic: 20, fast: 20, tank: 32, ranged: 24, boss: 62 };

const ENEMY_COLORS: Record<EnemyKind, string[]> = {
  basic: ['#ff4d6d', '#ff8fa3', '#ffffff'],
  fast: ['#ffb938', '#ffe066', '#ffffff'],
  tank: ['#9b6be0', '#d9c6ff', '#5a2fa0'],
  ranged: ['#2fd4e8', '#e6fdff', '#0f7f8f'],
  boss: ['#ff2d6f', '#ffd23d', '#ffffff', '#7a0f35'],
};

/** Enemigos (mirando hacia +x): forma propia y color propio para leerlos de un vistazo. */
function paintEnemy(kind: EnemyKind, white: boolean) {
  return (c: CanvasRenderingContext2D) => {
    const W = '#ffffff';
    const col = (x: string) => (white ? W : x);
    c.lineJoin = 'round';
    switch (kind) {
      case 'basic':
        c.fillStyle = col('#4a0d1c');
        c.beginPath();
        c.roundRect(-8, -8, 16, 16, 4);
        c.fill();
        c.fillStyle = col('#ff4d6d');
        c.beginPath();
        c.roundRect(-6.6, -6.6, 13.2, 13.2, 3);
        c.fill();
        if (!white) {
          c.fillStyle = '#ff8fa3';
          c.fillRect(-5, -5, 6, 2);
          c.fillStyle = '#2a0610';
          c.beginPath();
          c.arc(2, 0, 2.4, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'fast':
        c.fillStyle = col('#4a2a00');
        c.beginPath();
        c.moveTo(9.5, 0);
        c.lineTo(-7.5, -8);
        c.lineTo(-3.5, 0);
        c.lineTo(-7.5, 8);
        c.closePath();
        c.fill();
        c.fillStyle = col('#ffb938');
        c.beginPath();
        c.moveTo(7.5, 0);
        c.lineTo(-6, -6.2);
        c.lineTo(-2.5, 0);
        c.lineTo(-6, 6.2);
        c.closePath();
        c.fill();
        if (!white) {
          c.fillStyle = '#fff3c4';
          c.beginPath();
          c.moveTo(5, 0);
          c.lineTo(-1, -2);
          c.lineTo(-1, 2);
          c.closePath();
          c.fill();
        }
        break;
      case 'tank':
        c.fillStyle = col('#24104a');
        poly(c, 6, 14);
        c.fill();
        c.fillStyle = col('#9b6be0');
        poly(c, 6, 12.2);
        c.fill();
        if (!white) {
          c.fillStyle = '#6a3fb0';
          poly(c, 6, 7.5);
          c.fill();
          // Placa del frente
          c.fillStyle = '#d9c6ff';
          c.fillRect(8, -5, 3, 10);
          c.fillStyle = '#e9ddff';
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            c.beginPath();
            c.arc(Math.cos(a) * 9.6, Math.sin(a) * 9.6, 1.1, 0, Math.PI * 2);
            c.fill();
          }
        }
        break;
      case 'ranged':
        c.fillStyle = col('#053a44');
        c.fillRect(5, -2.2, 9, 4.4);
        c.beginPath();
        c.moveTo(11, 0);
        c.lineTo(0, -10);
        c.lineTo(-10, 0);
        c.lineTo(0, 10);
        c.closePath();
        c.fill();
        c.fillStyle = col('#2fd4e8');
        c.beginPath();
        c.moveTo(9, 0);
        c.lineTo(0, -8.2);
        c.lineTo(-8.2, 0);
        c.lineTo(0, 8.2);
        c.closePath();
        c.fill();
        if (!white) {
          c.fillStyle = '#0f7f8f';
          c.fillRect(6, -1.3, 7, 2.6);
          c.fillStyle = '#e6fdff';
          c.beginPath();
          c.arc(0, 0, 3, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'boss': {
        const star = (R: number, r: number) => {
          c.beginPath();
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            const k = i % 2 ? r : R;
            c.lineTo(Math.cos(a) * k, Math.sin(a) * k);
          }
          c.closePath();
        };
        c.fillStyle = col('#3a0216');
        star(29, 21);
        c.fill();
        c.fillStyle = col('#e0245e');
        star(26.5, 19);
        c.fill();
        if (!white) {
          c.fillStyle = '#7a0f35';
          c.beginPath();
          c.arc(0, 0, 14, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#ff6b9a';
          c.beginPath();
          c.arc(-4, -6, 4, 0, Math.PI * 2);
          c.fill();
          // Ojo
          c.fillStyle = '#ffd23d';
          c.beginPath();
          c.ellipse(4, 0, 7, 5.2, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#1a0008';
          c.beginPath();
          c.ellipse(6, 0, 2.4, 4, 0, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
    }
  };
}

function enemySprite(kind: EnemyKind, white: boolean) {
  const s = ENEMY_SIZE[kind];
  return sprite(`se-${kind}-${white ? 'w' : 'c'}`, s, s, paintEnemy(kind, white), kind === 'boss' ? 3 : 4);
}

function paintShadow(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 10, 0, Math.PI * 2);
  c.fill();
}

function paintGlow(color: string) {
  return (c: CanvasRenderingContext2D) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 10, 0, Math.PI * 2);
    c.fill();
  };
}

/** Escombros de la torre caída. */
function paintRubble(c: CanvasRenderingContext2D) {
  const r = mulberry32(5);
  c.fillStyle = 'rgba(15, 12, 20, 0.6)';
  c.beginPath();
  c.arc(0, 0, 17, 0, Math.PI * 2);
  c.fill();
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 20;
    const s = 2 + r() * 4;
    c.fillStyle = ['#4a4650', '#5d5864', '#3a3640', '#6e6874'][i % 4];
    c.save();
    c.translate(Math.cos(a) * d, Math.sin(a) * d);
    c.rotate(r() * 3);
    poly(c, 3 + Math.floor(r() * 3), s);
    c.fill();
    c.restore();
  }
}

function paintMuzzle(color: string) {
  return (c: CanvasRenderingContext2D) => {
    c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const k = i % 2 ? 3 : i === 0 ? 10 : 6;
      c.lineTo(Math.cos(a) * k, Math.sin(a) * k);
    }
    c.closePath();
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(0, 0, 2.6, 0, Math.PI * 2);
    c.fill();
  };
}

const SHOT_COLOR = ['#ffe066', '#ffd08a', '#9fd8ff', '#3df5ff'];

// ---------------------------------------------------------------------------------------------
// Panel de mejoras (React): solo se repinta cuando cambian las monedas, los niveles o la pestaña
// ---------------------------------------------------------------------------------------------

const HINTS: Partial<Record<Tab, (wave: number) => string>> = {
  def: () => '🌵 Las espinas hieren a quien toca la torre: si lo matan, el golpe no te llega.',
  eco: (wave) => `🏦 El interés y la prima se cobran al acabar cada oleada (interés máx. ${fmt(interestCap(wave))} 🪙).`,
};

const UpgradePanel = memo(function UpgradePanel({
  tab,
  coins,
  lvKey,
  lv,
  wave,
  pop,
  off,
  onTab,
  onBuy,
}: {
  tab: Tab;
  coins: number;
  /** Cambia cuando cambia algún nivel (para el memo). */
  lvKey: string;
  lv: Levels;
  wave: number;
  pop: { id: UpId; n: number; ok: boolean } | null;
  /** Partida acabada: el panel se apaga. */
  off: boolean;
  onTab: (t: Tab) => void;
  onBuy: (id: UpId) => boolean;
}) {
  void lvKey;
  const g = { lv };
  const canIn = (t: Tab) => UPGRADES.some((d) => d.tab === t && (upCost(g, d.id) ?? Infinity) <= coins);
  const items = UPGRADES.filter((d) => d.tab === tab);
  const hint = HINTS[tab];
  return (
    <div className={`se-panel${off ? ' off' : ''}`} aria-disabled={off}>
      <div className="se-head">
        <span className="se-coins" aria-label={`Monedas: ${Math.floor(coins)}`}>
          🪙 {fmt(coins)}
        </span>
        <div className="se-tabs" role="tablist" aria-label="Mejoras">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`se-tab${tab === t.id ? ' on' : ''}`} onClick={() => onTab(t.id)}>
              {t.label}
              {tab !== t.id && canIn(t.id) && <i aria-label="hay mejoras que puedes pagar" />}
            </button>
          ))}
        </div>
      </div>
      <div className="se-grid" role="tabpanel">
        {items.map((d, i) => {
          const level = lv[d.id];
          const cost = upCost(g, d.id);
          const maxed = cost === null;
          const poor = !maxed && coins < cost;
          const now = d.show(d.value(level));
          const next = maxed ? null : d.show(d.value(level + 1));
          // Dos clases iguales que se alternan: así la animación vuelve a empezar sin desmontar el botón
          const anim = pop && pop.id === d.id ? ` ${pop.ok ? 'pop' : 'no'}${pop.n % 2}` : '';
          return (
            <UpgradeCard
              key={d.id}
              className={`se-up${maxed ? ' max' : poor ? ' poor' : ' can'}${anim}`}
              label={`${d.name}: ${now}${next ? `, siguiente ${next}, cuesta ${Math.floor(cost!)} monedas` : ', al máximo'}. Tecla ${i + 1}`}
              disabled={maxed}
              onBuy={() => onBuy(d.id)}
            >
              <span className="se-up-name">
                {d.emoji} {d.name}
              </span>
              <span className="se-up-row">
                <span className="se-up-val">
                  {next ? (
                    <>
                      {now} → <b>{next}</b>
                    </>
                  ) : (
                    now
                  )}
                </span>
                <span className="se-up-cost">{maxed ? 'MÁX' : `🪙 ${fmt(cost)}`}</span>
              </span>
            </UpgradeCard>
          );
        })}
        {hint && <p className="se-hint">{hint(wave)}</p>}
      </div>
    </div>
  );
});

/** Botón de mejora: un toque compra uno; mantener pulsado sigue comprando mientras haya monedas. */
function UpgradeCard({ className, label, disabled, onBuy, children }: { className: string; label: string; disabled: boolean; onBuy: () => boolean; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const buyRef = useRef(onBuy);
  useEffect(() => {
    buyRef.current = onBuy;
  });
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = () => {
    repeated.current = false;
    stop();
    const loop = (wait: number) => {
      timer.current = setTimeout(() => {
        repeated.current = true;
        if (buyRef.current()) loop(Math.max(70, wait * 0.8));
        else stop();
      }, wait);
    };
    loop(420);
  };
  return (
    <button
      className={className}
      aria-label={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // Si ya compró manteniendo pulsado, el clic del final no cuenta
        if (repeated.current) repeated.current = false;
        else onBuy();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

interface Bolt {
  x: number;
  y: number;
}

export function SentryGameView({ onOver, onScore }: WarViewProps) {
  const era = useGame((st) => st.s.era);
  const tier = eraTier(era);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<SentryGame>(null as unknown as SentryGame);
  if (!game.current) game.current = newSentry(Math.random);
  // Solo en desarrollo: deja tocar la partida desde la consola (capturas automáticas)
  if (import.meta.env.DEV) (window as unknown as { __sentry?: SentryGame }).__sentry = game.current;
  const fx = useRef(new Fx());
  const [phase, setPhaseState] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>('intro');
  const introEnd = useRef(performance.now() + INTRO_MS);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: Tone; id: number } | null>(null);
  const [tab, setTab] = useState<Tab>('atk');
  const [speed, setSpeedState] = useState(1);
  const speedRef = useRef(1);
  const [pop, setPop] = useState<{ id: UpId; n: number; ok: boolean } | null>(null);
  const [lvKey, setLvKey] = useState('');
  const look = useRef({ aim: -Math.PI / 2, muzzle: 0, recoil: 0, hurt: 0, smoke: 0, bolts: [] as Bolt[], boltMs: 0, lowWarned: 0 });
  const sound = useRef({ shot: 0, kill: 0, crit: 0, hurt: 0 });
  const overTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  // Avisos y notas retrasadas: se cancelan si se cierra el juego
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      if (overTimer.current) clearTimeout(overTimer.current);
      set.forEach(clearTimeout);
    };
  }, []);
  const [hud, pushHud] = useHud({ score: 0, wave: 1, prog: 0, left: 20, coins: 0, hp: '100', max: '100', hpFrac: 1, rayo: 0, rayoFrac: 0, boss: -1, low: false });

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const say = useCallback((text: string, tone: Tone = 'good') => setBanner({ text, tone, id: performance.now() }), []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [banner]);

  const start = useCallback(() => {
    if (phaseRef.current !== 'intro') return;
    setPhase('play');
    say('Oleada 1');
  }, [setPhase, say]);

  const pause = useCallback(() => {
    if (phaseRef.current === 'play') setPhase('paused');
  }, [setPhase]);

  /** Convierte lo que pasó en la partida en efectos, sonidos y avisos. */
  const feedback = (ev: SentryEvents) => {
    const g = game.current;
    const f = fx.current;
    const lk = look.current;
    const now = performance.now();
    const snd = sound.current;
    if (ev.fired) {
      lk.muzzle = 70;
      lk.recoil = 60;
      if (now - snd.shot > 85) {
        snd.shot = now;
        tone(tier === 3 ? 900 + Math.random() * 80 : 210 + Math.random() * 40, 0.035, tier === 3 ? 'sine' : 'square', 0.014);
      }
    }
    for (const h of ev.hits) {
      f.burst(h.x, h.y, { n: h.crit ? 6 : 2, colors: h.crit ? ['#ff7a3d', '#ffe066', '#fff'] : ['#fff', SHOT_COLOR[tier]], speed: h.crit ? 110 : 60, life: 220, size: 1.3, shape: 'spark' });
      if (h.crit) {
        f.text(h.x, h.y - 10, `${fmt(h.dmg)}!`, '#ff9a3c', 9.5, 650);
        if (now - snd.crit > 160) {
          snd.crit = now;
          tone(1250 + Math.random() * 200, 0.04, 'square', 0.02);
        }
      }
    }
    for (const k of ev.kills) {
      const big = k.kind === 'tank' || k.kind === 'boss';
      const colors = k.how === 'thorns' ? ['#3ddc97', '#c6ffd9', ...ENEMY_COLORS[k.kind]] : k.how === 'rayo' ? ['#9fd8ff', '#ffffff', ...ENEMY_COLORS[k.kind]] : ENEMY_COLORS[k.kind];
      f.burst(k.x, k.y, { n: k.kind === 'boss' ? 70 : big ? 26 : 12, colors, speed: k.kind === 'boss' ? 200 : big ? 130 : 95, life: big ? 650 : 420, size: big ? 2.8 : 2, shape: k.kind === 'tank' ? 'square' : 'dot' });
      f.ring(k.x, k.y, k.how === 'thorns' ? '#3ddc97' : '#ffe9a8', k.kind === 'boss' ? 80 : big ? 30 : 14, big ? 450 : 260);
      // Las monedas van con decimales por dentro, pero en pantalla se ven enteras
      f.text(k.x, k.y - 6, `+${fmt(Math.max(1, Math.round(k.cash)))}`, '#ffc23d', big ? 9 : 7, 700);
      if (now - snd.kill > 55) {
        snd.kill = now;
        tone(big ? 140 : 480 + Math.random() * 180, big ? 0.18 : 0.05, big ? 'sawtooth' : 'triangle', big ? 0.05 : 0.03);
      }
      if (k.kind === 'tank') f.shake(2.5, 160);
    }
    for (const p of ev.impacts) {
      f.burst(p.x, p.y, { n: 10, colors: p.kind === 'ranged' ? ['#2fd4e8', '#fff'] : ['#ff9a3c', '#fff', ...ENEMY_COLORS[p.kind].slice(0, 1)], speed: 90, life: 320, size: 1.8 });
    }
    for (const s of ev.enemyShots) f.burst(s.x, s.y, { n: 4, colors: ['#2fd4e8', '#e6fdff'], speed: 50, life: 200, size: 1.4 });
    if (ev.hurt > 0) {
      lk.hurt = 180;
      f.shake(ev.hurt >= maxHp(g) * 0.1 ? 4 : 2, 180);
      f.text(TX + (Math.random() - 0.5) * 14, TY - 30, `-${fmt(Math.ceil(ev.hurt))}`, '#ff6b81', 8.5, 650);
      if (now - snd.hurt > 220) {
        snd.hurt = now;
        tone(120, 0.12, 'sawtooth', 0.045);
        vibrate(18);
      }
      if (g.hp > 0 && g.hp / maxHp(g) < LOW_HP && now - lk.lowWarned > 9000) {
        lk.lowWarned = now;
        say('⚠️ ¡La torre se cae!', 'bad');
        tone(330, 0.12, 'square', 0.04);
        later(() => tone(330, 0.12, 'square', 0.04), 220);
        vibrate([40, 60, 40]);
      }
    }
    if (ev.waveClear) {
      const got = ev.waveClear.interest + ev.waveClear.bonus;
      if (got >= 1) f.text(TX, TY - 40, `+${fmt(Math.round(got))} 🪙`, '#ffc23d', 11, 1300);
      tone(660, 0.08, 'triangle', 0.045);
      later(() => tone(990, 0.1, 'triangle', 0.045), 100);
    }
    if (ev.waveStart) {
      const w = ev.waveStart;
      if (isBossWave(w)) say(`Oleada ${w} · ¡jefe!`, 'boss');
      else say(`Oleada ${w}`);
    }
    if (ev.bossIn) {
      tone(70, 0.8, 'sawtooth', 0.06);
      vibrate([30, 60, 30]);
      later(() => say('👹 ¡Llega el jefe!', 'boss'), 900);
    }
    if (ev.bossDown) {
      say('💥 ¡Jefe derrotado! +25', 'boss');
      f.shake(9, 600);
      f.flash('#ffd23d', 260);
      sfx('win');
      vibrate([40, 30, 80]);
    }
    if (ev.lost) {
      f.shake(12, 800);
      f.flash('#ff2d55', 400);
      f.burst(TX, TY, { n: 90, colors: ['#ffc23d', '#ff5a3a', '#fff', '#777', '#555'], speed: 220, life: 1100, size: 3.2 });
      f.burst(TX, TY, { n: 30, colors: ['#666', '#888'], speed: 60, life: 1600, size: 4, gravity: -30, drag: 1 });
      f.ring(TX, TY, '#ffb938', 90, 700);
      tone(60, 0.9, 'sawtooth', 0.08);
      vibrate([80, 50, 160]);
      say('💥 ¡La torre ha caído!', 'bad');
      setPhase('over');
      if (!overTimer.current) overTimer.current = setTimeout(() => cb.current.onOver(summary(g)), 1600);
    }
  };

  const feedbackRef = useRef(feedback);
  useEffect(() => {
    feedbackRef.current = feedback;
  });

  const onStep = (dt: number) => {
    const g = game.current;
    // ×2: dos pasos de partida por cada paso real
    for (let i = 0; i < speedRef.current && g.phase === 'play'; i++) {
      const prev = g.score;
      const ev = step(g, dt, Math.random);
      feedback(ev);
      if (g.score !== prev) cb.current.onScore(summary(g));
    }
  };

  const fireRayo = useCallback(() => {
    const g = game.current;
    if (phaseRef.current !== 'play' || !rayoReady(g)) {
      if (phaseRef.current === 'play') sfx('error');
      return;
    }
    const lk = look.current;
    lk.bolts = g.enemies.slice(0, 40).map((e) => ({ x: e.x, y: e.y }));
    lk.boltMs = 380;
    const prev = g.score;
    const ev = rayo(g);
    const f = fx.current;
    f.flash('#bfe6ff', 220);
    f.shake(6, 350);
    f.ring(TX, TY, '#9fd8ff', 220, 500);
    tone(90, 0.45, 'sawtooth', 0.06);
    tone(1500, 0.08, 'square', 0.03);
    vibrate([30, 20, 60]);
    feedbackRef.current(ev);
    if (g.score !== prev) cb.current.onScore(summary(g));
  }, []);

  const toggleSpeed = useCallback(() => {
    const s = speedRef.current === 1 ? 2 : 1;
    speedRef.current = s;
    setSpeedState(s);
    sfx('tap');
  }, []);

  const doBuy = useCallback(
    (id: UpId): boolean => {
      const g = game.current;
      if (phaseRef.current === 'over') return false;
      const ok = buy(g, id);
      setPop((p) => ({ id, n: (p?.n ?? 0) + 1, ok }));
      if (!ok) {
        sfx('error');
        return false;
      }
      setLvKey(JSON.stringify(g.lv));
      const d = UPGRADES.find((x) => x.id === id)!;
      tone(520 + Math.min(16, g.lv[id]) * 30, 0.06, 'triangle', 0.05);
      later(() => tone(780 + Math.min(16, g.lv[id]) * 30, 0.07, 'triangle', 0.045), 60);
      const f = fx.current;
      const color = d.tab === 'atk' ? '#ff9a3c' : d.tab === 'def' ? '#3ddc97' : '#ffc23d';
      f.ring(TX, TY, color, id === 'range' ? range(g) : 34, 420);
      f.burst(TX, TY, { n: 10, colors: [color, '#fff'], speed: 80, life: 380, size: 1.6, shape: 'spark' });
      f.text(TX, TY - 30, `${d.emoji} ${d.show(d.value(g.lv[id]))}`, color, 8, 800);
      return true;
    },
    [later],
  );

  // Teclado: 1-6 compra en la pestaña abierta, ←/→ cambian de pestaña, Espacio o R lanza el rayo,
  // X cambia la velocidad y P o Esc pausa
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'play' || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      const list = UPGRADES.filter((d) => d.tab === tabRef.current);
      if (n >= 1 && n <= list.length) {
        e.preventDefault();
        doBuy(list[n - 1].id);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') {
        e.preventDefault();
        const i = TABS.findIndex((t) => t.id === tabRef.current);
        const d = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1;
        setTab(TABS[(i + d + TABS.length) % TABS.length].id);
      } else if (e.code === 'Space' || e.code === 'KeyR') {
        e.preventDefault();
        // Que el espacio no pulse además el último botón tocado
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        fireRayo();
      } else if (e.code === 'KeyX') {
        e.preventDefault();
        toggleSpeed();
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doBuy, fireRayo, toggleSpeed, pause]);

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const lk = look.current;
    if (ph !== 'paused') {
      const fdt = frame * (ph === 'play' ? speedRef.current : 1);
      fx.current.update(fdt);
      lk.muzzle = Math.max(0, lk.muzzle - fdt);
      lk.recoil = Math.max(0, lk.recoil - fdt);
      lk.hurt = Math.max(0, lk.hurt - fdt);
      lk.boltMs = Math.max(0, lk.boltMs - frame);
      // El cañón gira suave hacia su blanco
      let d = g.aim - lk.aim;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      lk.aim += d * Math.min(1, frame * 0.025);
      // Humo cuando la torre está tocada
      if (ph === 'play' && g.hp / maxHp(g) < 0.5) {
        lk.smoke -= frame;
        if (lk.smoke <= 0) {
          lk.smoke = g.hp / maxHp(g) < LOW_HP ? 90 : 220;
          fx.current.burst(TX + (Math.random() - 0.5) * 16, TY + (Math.random() - 0.5) * 16, { n: 1, colors: ['rgba(90,90,100,0.7)'], speed: 14, life: 1100, size: 4.5, gravity: -24, drag: 0.6 });
        }
      }
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    drawWorld(ctx, v, g, fx.current, lk, tier, ph);
    fx.current.drawFlash(ctx, v);
    const b = boss(g);
    const mx = maxHp(g);
    pushHud({
      score: g.score,
      wave: g.wave,
      prog: Math.round(waveProgress(g) * 100) / 100,
      left: Math.ceil((1 - waveProgress(g)) * 20),
      coins: Math.floor(g.coins),
      // Con algo de vida nunca se enseña 0, y nunca más que el máximo
      hp: fmt(g.hp > 0 ? Math.max(1, Math.floor(Math.min(g.hp, mx))) : 0),
      max: fmt(mx),
      hpFrac: Math.round((g.hp / mx) * 200) / 200,
      rayo: Math.ceil(g.rayoT / 1000),
      rayoFrac: Math.round((g.rayoT / RAYO_MS) * 50) / 50,
      boss: b ? Math.round((b.hp / b.max) * 200) / 200 : -1,
      low: g.hp / mx < LOW_HP && g.phase === 'play',
    });
  };

  useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;
  const rayoOn = hud.rayo <= 0 && phase === 'play';

  return (
    <div className="sh-wrap se-wrap">
      <div className="se-top">
        <span className="sh-pill" aria-label={`Puntos: ${hud.score}`}>
          <i aria-hidden="true">🏆</i>
          <b>{hud.score}</b>
        </span>
        <span className="sh-pill se-wave" aria-label={`Oleada ${hud.wave}, siguiente en ${hud.left} segundos`}>
          <i aria-hidden="true">🌊</i>
          <b>Oleada {hud.wave}</b>
          <span className="se-wave-bar" style={{ width: `${hud.prog * 100}%` }} />
        </span>
        <div className={`se-hp${hud.low ? ' low' : ''}`}>
          <Meter
            value={hud.hpFrac}
            max={1}
            color={hud.hpFrac < LOW_HP ? 'linear-gradient(90deg, #ff2d55, #ff6b81)' : 'linear-gradient(90deg, #2fbf71, #6ee7a8)'}
            label="Vida de la torre"
            text={`❤️ ${hud.hp} / ${hud.max}`}
          />
        </div>
        <button className="sh-pause-btn" onClick={pause} disabled={phase !== 'play'} aria-label="Pausa">
          ⏸
        </button>
      </div>
      <div className="se-stage">
        <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Torre vigía, oleada ${hud.wave}. Vida ${hud.hp} de ${hud.max}.`} />
        {hud.boss >= 0 && (
          <div className="se-boss">
            <Meter value={hud.boss} max={1} color="linear-gradient(90deg, #ff2d6f, #ffb938)" label="Vida del jefe" text="👹 JEFE" />
          </div>
        )}
        {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
        <button className={`se-speed${speed === 2 ? ' on' : ''}`} onClick={toggleSpeed} aria-label={`Velocidad ×${speed}. Tecla X`} aria-pressed={speed === 2}>
          ⏩ ×{speed}
        </button>
        <button
          className={`sh-action se-rayo${rayoOn ? ' ready' : ''}`}
          style={{ ['--cd' as string]: `${hud.rayoFrac * 100}%` }}
          onClick={fireRayo}
          disabled={phase !== 'play'}
          aria-label={rayoOn ? 'Rayo listo: golpea a todos los enemigos. Espacio' : `Rayo en ${hud.rayo} segundos`}
        >
          <span aria-hidden="true">
            ⚡<em>RAYO</em>
          </span>
          {!rayoOn && hud.rayo > 0 && <small>{hud.rayo}</small>}
        </button>
      </div>
      <UpgradePanel tab={tab} coins={hud.coins} lvKey={lvKey} lv={g.lv} wave={hud.wave} pop={pop} off={phase === 'over'} onTab={setTab} onBuy={doBuy} />
      {phase === 'intro' && (
        <StartCard
          title="🗼 Torre vigía"
          left={introLeft}
          total={INTRO_MS}
          onSkip={start}
          lines={[
            { icon: '🗼', text: 'La torre dispara sola al enemigo más cercano dentro de su alcance.' },
            { icon: '🪙', text: 'Cada baja da monedas: gástalas en mejoras cuando quieras, sin pausa.' },
            { icon: '⚡', text: 'Si te rodean, usa el Rayo: golpea a todos. Cada 10 oleadas llega un jefe.' },
          ]}
        />
      )}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            Oleada {g.wave} · {g.kills} bajas · {g.score} puntos
          </p>
        </PauseCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pintar el campo
// ---------------------------------------------------------------------------------------------

function drawWorld(
  ctx: CanvasRenderingContext2D,
  v: View,
  g: SentryGame,
  f: Fx,
  lk: { aim: number; muzzle: number; recoil: number; hurt: number; bolts: Bolt[]; boltMs: number },
  tier: number,
  ph: Phase,
) {
  toScreenSpace(ctx, v);
  ctx.fillStyle = GROUND_BG[tier];
  ctx.fillRect(0, 0, v.cw, v.ch);
  toWorldSpace(ctx, v);
  const sh = f.offset();
  ctx.translate(sh.x, sh.y);
  const t = g.t;
  const now = performance.now();

  drawSprite(ctx, sprite(`se-ground-${tier}`, GROUND_W, GROUND_H, paintGround(tier), 2), TX, TY, GROUND_W, GROUND_H);

  // Alcance: un anillo discreto que gira despacio
  const R = range(g);
  const fill = ctx.createRadialGradient(TX, TY, R * 0.2, TX, TY, R);
  fill.addColorStop(0, 'rgba(255, 194, 61, 0)');
  fill.addColorStop(1, 'rgba(255, 194, 61, 0.07)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(TX, TY, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 226, 150, 0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = -now / 90;
  ctx.stroke();
  ctx.setLineDash([]);

  // Sombras
  const shadow = sprite('se-shadow', 20, 20, paintShadow);
  for (const e of g.enemies) {
    const s = ENEMY_SIZE[e.kind] * 1.05;
    ctx.drawImage(shadow, e.x - s / 2 + 2, e.y - s / 2 + 4, s, s);
  }
  ctx.drawImage(shadow, TX - 30 + 3, TY - 30 + 6, 60, 60);

  // Enemigos
  for (const e of g.enemies) drawEnemy(ctx, e, t);

  // Balas enemigas (lentas y brillantes: se ven venir)
  const eglow = sprite('se-eglow', 20, 20, paintGlow('#2fd4e8'));
  for (const b of g.ebullets) {
    const p = 1 + Math.sin(now / 70) * 0.15;
    drawSprite(ctx, eglow, b.x, b.y, 13 * p, 13 * p);
  }

  // Torre
  const base = sprite(`se-base-${tier}`, BASE_SIZE, BASE_SIZE, paintBase(tier));
  const dead = ph === 'over';
  drawSprite(ctx, base, TX, TY, BASE_SIZE, BASE_SIZE, 0, dead ? 0.35 : 1);
  if (dead) drawSprite(ctx, sprite('se-rubble', BASE_SIZE, BASE_SIZE, paintRubble), TX, TY, BASE_SIZE, BASE_SIZE);
  if (tier === 2) disc(ctx, TX + 20, TY - 20, 1.8, Math.floor(now / 500) % 2 ? '#ff3b3b' : 'rgba(255,59,59,0.25)');
  if (!dead) {
    const rec = lk.recoil > 0 ? (lk.recoil / 60) * 2.5 : 0;
    const ca = Math.cos(lk.aim);
    const sa = Math.sin(lk.aim);
    drawSprite(ctx, sprite(`se-turret-${tier}`, TURRET_SIZE, TURRET_SIZE, paintTurret(tier)), TX - ca * rec, TY - sa * rec, TURRET_SIZE, TURRET_SIZE, lk.aim);
    if (lk.muzzle > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const m = sprite(`se-muzzle-${tier}`, 22, 22, paintMuzzle(tier === 3 ? '#3df5ff' : '#ffd25a'));
      const k = 0.7 + (lk.muzzle / 70) * 0.6;
      drawSprite(ctx, m, TX + ca * 21, TY + sa * 21, 18 * k, 18 * k, lk.aim, lk.muzzle / 70);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (lk.hurt > 0) {
    ctx.globalAlpha = (lk.hurt / 180) * 0.55;
    ctx.fillStyle = '#ff2d55';
    ctx.beginPath();
    ctx.arc(TX, TY, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Aviso de poca vida: un anillo rojo que late
  if (!dead && g.hp / maxHp(g) < LOW_HP) {
    ctx.strokeStyle = `rgba(255, 60, 80, ${0.35 + 0.3 * Math.sin(now / 130)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(TX, TY, 27 + Math.sin(now / 130) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Balas de la torre: estela aditiva (los críticos más gordos y naranjas)
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of g.bullets) {
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const len = b.crit ? 15 : 11;
    const x0 = b.x - (dx / d) * len;
    const y0 = b.y - (dy / d) * len;
    ctx.strokeStyle = b.crit ? 'rgba(255, 106, 61, 0.55)' : tier === 3 ? 'rgba(61, 245, 255, 0.45)' : 'rgba(255, 210, 90, 0.4)';
    ctx.lineWidth = b.crit ? 4.5 : 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = b.crit ? '#ffd0a0' : '#ffffff';
    ctx.lineWidth = b.crit ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.moveTo(b.x - (dx / d) * len * 0.5, b.y - (dy / d) * len * 0.5);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Rayo: zigzag desde la torre hasta cada enemigo
  if (lk.boltMs > 0) {
    const a = lk.boltMs / 380;
    for (const p of lk.bolts) {
      for (const [w, col] of [
        [4, `rgba(120, 200, 255, ${0.5 * a})`],
        [1.4, `rgba(255, 255, 255, ${a})`],
      ] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(TX, TY);
        const n = 6;
        for (let i = 1; i < n; i++) {
          const k = i / n;
          ctx.lineTo(TX + (p.x - TX) * k + (Math.random() - 0.5) * 14, TY + (p.y - TY) * k + (Math.random() - 0.5) * 14);
        }
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  f.draw(ctx);

  // Viñeta roja con poca vida
  if (g.phase === 'play' && g.hp / maxHp(g) < LOW_HP) {
    toScreenSpace(ctx, v);
    const al = 0.2 + 0.12 * Math.sin(now / 250);
    const r = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.35, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.75);
    r.addColorStop(0, 'rgba(255, 30, 60, 0)');
    r.addColorStop(1, `rgba(255, 30, 60, ${al})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number) {
  const s = ENEMY_SIZE[e.kind];
  const face = Math.atan2(TY - e.y, TX - e.x);
  // El básico gira sobre sí mismo; el resto mira a la torre
  const rot = e.kind === 'basic' ? e.age / 400 + e.id : e.kind === 'boss' ? face + Math.sin(e.age / 500) * 0.15 : face;
  const pulse = e.kind === 'boss' ? 1 + Math.sin(t / 180) * 0.04 : e.stuck ? 1 + Math.max(0, Math.sin(t / 60)) * 0.06 : 1;
  const size = s * pulse;
  drawSprite(ctx, enemySprite(e.kind, false), e.x, e.y, size, size, rot);
  if (e.flash > 0) drawSprite(ctx, enemySprite(e.kind, true), e.x, e.y, size, size, rot, Math.min(0.9, e.flash / 80));
  if (e.stun > 0) {
    ctx.strokeStyle = 'rgba(160, 225, 255, 0.8)';
    ctx.lineWidth = 1;
    const a = t / 90;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 3, a, a + 1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 3, a + Math.PI, a + Math.PI + 1.4);
    ctx.stroke();
  }
  if (e.kind !== 'boss') hpBar(ctx, e.x, e.y - s / 2 - 3, e.kind === 'tank' ? 24 : 15, e.hp / e.max, e.kind === 'tank' ? '#c9a2ff' : '#ff5a5f');
}

export function SentryScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="sentry" label="Puntos de vigía" view={(p) => <SentryGameView {...p} />} onClose={onClose} />;
}
