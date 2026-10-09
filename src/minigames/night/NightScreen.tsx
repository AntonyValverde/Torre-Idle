import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { mulberry32 } from '../rng';
import { Fx, drawSprite, hpBar, label, sprite } from '../shooter/fx';
import type { UpgradeDef } from '../shooter/kit';
import { drawSticks, moveVec, releaseInput, useInput, useStage, type View } from '../shooter/stage';
import { Banner, HudBar, Meter, PauseCard, StartCard, UpgradePick, useHud } from '../shooter/ShooterUI';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  DAWN_BONUS,
  FIELD_H,
  FIELD_W,
  HURT_CD,
  PASSIVE_IDS,
  RUN_MS,
  UP_BY_ID,
  WEAPON,
  WEAPON_IDS,
  applyUpgrade,
  boss,
  maxHp,
  newNight,
  rollChoices,
  step,
  wl,
  xpNeed,
  type Enemy,
  type EnemyKind,
  type NightGame,
  type UpId,
} from './logic';
import './night.css';

const FIELD = { w: FIELD_W, h: FIELD_H };
const INTRO_MS = 3600;
/** La noche empieza a clarear a partir de aquí (ms). */
const DAWN_FROM = 255_000;

type Phase = 'intro' | 'play' | 'paused' | 'choice' | 'over';

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const summary = (g: NightGame): WarSummary => ({
  score: g.score,
  detail: `${g.won ? '🌅 ¡Llegaste al amanecer!' : `Aguantaste ${clock(g.t)}`} · ${g.kills} bichos · Nv ${g.lv}${g.bossDown ? ' · 👹 El Coco derrotado' : ''}`,
});

// ---------------------------------------------------------------------------------------------
// Dibujos (cada uno se pinta una vez en un sprite)
// ---------------------------------------------------------------------------------------------

const TILE = 160;

/** Adoquines de la plaza: filas desplazadas y piedras de tamaños distintos, sin costuras al repetir. */
function paintGround(c: CanvasRenderingContext2D) {
  c.translate(-TILE / 2, -TILE / 2);
  const r = mulberry32(21);
  c.fillStyle = '#1a1b2e';
  c.fillRect(0, 0, TILE, TILE);
  const pal = ['#3b3e5c', '#373a56', '#404362', '#34374f', '#3d3d5a'];
  const rowH = 10;
  for (let y = 0; y < TILE; y += rowH) {
    // Cada fila cubre justo un ancho de baldosa empezando en `start`; lo que se sale por la derecha
    // se repite por la izquierda, así no se nota la costura al repetir el sprite
    const start = r() * 14;
    let x = start;
    while (x < start + TILE - 0.01) {
      let w = 11 + r() * 9;
      if (start + TILE - x - w < 9) w = start + TILE - x;
      const fill = pal[Math.floor(r() * pal.length)];
      const moss = r() < 0.05;
      const xs = x + w > TILE ? [x, x - TILE] : [x];
      for (const sx of xs) {
        c.fillStyle = fill;
        c.beginPath();
        c.roundRect(sx + 0.9, y + 0.9, w - 1.8, rowH - 1.8, 3);
        c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.05)';
        c.fillRect(sx + 2, y + 1.3, w - 4, 1.2);
        if (moss) {
          c.fillStyle = 'rgba(70, 120, 90, 0.25)';
          c.beginPath();
          c.arc(sx + w * 0.3, y + rowH - 2, 2.2, 0, Math.PI * 2);
          c.fill();
        }
      }
      x += w;
    }
  }
  // Grietas sueltas
  c.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  c.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    let x = r() * TILE;
    let y = r() * TILE;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (r() - 0.5) * 12;
      y += (r() - 0.5) * 12;
      c.lineTo(x, y);
    }
    c.stroke();
  }
}

function paintFountain(c: CanvasRenderingContext2D) {
  c.fillStyle = '#3c4060';
  c.beginPath();
  c.ellipse(0, 4, 44, 30, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#4f5478';
  c.beginPath();
  c.ellipse(0, 0, 44, 30, 0, 0, Math.PI * 2);
  c.fill();
  const w = c.createRadialGradient(0, 0, 4, 0, 0, 38);
  w.addColorStop(0, '#5fa8d8');
  w.addColorStop(1, '#244d78');
  c.fillStyle = w;
  c.beginPath();
  c.ellipse(0, 0, 37, 24, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(200, 235, 255, 0.35)';
  c.lineWidth = 0.8;
  for (const k of [0.45, 0.7]) {
    c.beginPath();
    c.ellipse(0, 0, 37 * k, 24 * k, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = '#6b7096';
  c.beginPath();
  c.ellipse(0, -4, 7, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillRect(-3, -18, 6, 14);
  c.fillStyle = '#8b90b8';
  c.beginPath();
  c.ellipse(0, -18, 9, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#bfe6ff';
  c.beginPath();
  c.ellipse(0, -20, 4, 2.2, 0, 0, Math.PI * 2);
  c.fill();
}

function paintPlanter(c: CanvasRenderingContext2D) {
  c.fillStyle = '#4b3a36';
  c.beginPath();
  c.roundRect(-10, -6, 20, 14, 3);
  c.fill();
  c.fillStyle = '#5d4843';
  c.fillRect(-10, -6, 20, 3);
  const r = mulberry32(5);
  for (let i = 0; i < 7; i++) {
    c.fillStyle = i % 2 ? '#2f5b3e' : '#3a6f4a';
    c.beginPath();
    c.arc(-6 + r() * 12, -8 + r() * 5, 4 + r() * 2, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#ff8fab';
  for (let i = 0; i < 4; i++) c.fillRect(-6 + r() * 12, -11 + r() * 6, 1.6, 1.6);
}

function paintBench(c: CanvasRenderingContext2D) {
  c.fillStyle = '#20202e';
  c.fillRect(-13, 2, 2, 5);
  c.fillRect(11, 2, 2, 5);
  c.fillStyle = '#6b4a35';
  c.fillRect(-15, -6, 30, 3);
  c.fillRect(-15, -1.5, 30, 3);
  c.fillStyle = '#82593f';
  c.fillRect(-15, -6, 30, 1);
}

function paintLamp(c: CanvasRenderingContext2D) {
  // Base en (0, 24): el sprite se pinta con el pie en la posición de la farola
  c.fillStyle = '#121220';
  c.beginPath();
  c.ellipse(0, 24, 5, 2, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2b2b40';
  c.fillRect(-1.6, -14, 3.2, 38);
  c.fillStyle = '#3c3c58';
  c.fillRect(-1.6, -14, 1, 38);
  c.fillStyle = '#2b2b40';
  c.fillRect(-3.5, 18, 7, 5);
  c.fillRect(-5, -16, 10, 2.5);
  // Farol
  c.fillStyle = '#ffe39a';
  c.beginPath();
  c.moveTo(-4, -16);
  c.lineTo(4, -16);
  c.lineTo(3, -24);
  c.lineTo(-3, -24);
  c.closePath();
  c.fill();
  c.fillStyle = '#2b2b40';
  c.beginPath();
  c.moveTo(-5, -24);
  c.lineTo(5, -24);
  c.lineTo(0, -28);
  c.closePath();
  c.fill();
}

/** Brillo redondo (blanco: luz que se recorta en la oscuridad; color: halo aditivo). */
function paintGlow(color: string) {
  return (c: CanvasRenderingContext2D) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 32);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.55})`));
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    c.fillStyle = g;
    c.fillRect(-32, -32, 64, 64);
  };
}

const glow = (key: string, color: string) => sprite(`nt-glow-${key}`, 64, 64, paintGlow(color), 1);

function paintMayor(white: boolean) {
  return (c: CanvasRenderingContext2D) => {
    const col = (x: string) => (white ? '#ffffff' : x);
    // Piernas y zapatos
    c.fillStyle = col('#1d1b2e');
    c.fillRect(-5, 7, 4, 8);
    c.fillRect(1, 7, 4, 8);
    c.fillStyle = col('#0b0a14');
    c.beginPath();
    c.ellipse(-2.6, 15.4, 3.4, 1.8, 0, 0, Math.PI * 2);
    c.ellipse(3.6, 15.4, 3.4, 1.8, 0, 0, Math.PI * 2);
    c.fill();
    // Levita
    c.fillStyle = col('#2f4a96');
    c.beginPath();
    c.roundRect(-7.5, -4, 15, 14, 4);
    c.fill();
    c.fillStyle = col('#253a78');
    c.fillRect(-7.5, 6, 15, 4);
    c.fillStyle = col('#e9eefc');
    c.beginPath();
    c.moveTo(-2, -4);
    c.lineTo(2, -4);
    c.lineTo(0, 1);
    c.closePath();
    c.fill();
    // Banda de alcalde y medalla
    c.strokeStyle = col('#e63950');
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(-6, -3);
    c.lineTo(6, 8);
    c.stroke();
    c.fillStyle = col('#ffc23d');
    c.beginPath();
    c.arc(0.5, 3, 1.9, 0, Math.PI * 2);
    c.fill();
    // Brazo con el farol
    c.fillStyle = col('#2f4a96');
    c.beginPath();
    c.roundRect(5, -3, 4, 9, 2);
    c.fill();
    c.strokeStyle = col('#3a3a52');
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(8, 5);
    c.lineTo(10.5, 3);
    c.stroke();
    if (!white) {
      const g = c.createRadialGradient(11, 8, 0, 11, 8, 7);
      g.addColorStop(0, 'rgba(255, 220, 120, 0.9)');
      g.addColorStop(1, 'rgba(255, 220, 120, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(11, 8, 7, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = col('#3a3a52');
    c.fillRect(8.5, 3.5, 5, 1.4);
    c.fillStyle = col('#ffe39a');
    c.fillRect(9, 5, 4, 5.5);
    c.fillStyle = col('#3a3a52');
    c.fillRect(8.5, 10.5, 5, 1.2);
    // Cabeza
    c.fillStyle = col('#f1c27d');
    c.beginPath();
    c.arc(0.5, -9.5, 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col('#e0a86a');
    c.beginPath();
    c.arc(6, -9, 1.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col('#2a1a12');
    c.beginPath();
    c.arc(1, -10.5, 0.95, 0, Math.PI * 2);
    c.arc(4.3, -10.5, 0.95, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col('#5a3a22');
    c.beginPath();
    c.ellipse(2.8, -7, 3.6, 1.3, 0, 0, Math.PI * 2);
    c.fill();
    // Chistera
    c.fillStyle = col('#14121f');
    c.beginPath();
    c.roundRect(-7, -16, 15, 2.6, 1.2);
    c.fill();
    c.fillRect(-4.5, -26, 10, 11);
    c.fillStyle = col('#ffc23d');
    c.fillRect(-4.5, -18, 10, 2);
    c.fillStyle = col('rgba(255,255,255,0.12)');
    c.fillRect(-4, -26, 2, 8);
  };
}

const ENEMY_SIZE: Record<EnemyKind, [number, number]> = {
  rat: [22, 14],
  bat: [26, 16],
  ghost: [20, 24],
  gargoyle: [36, 34],
  coco: [66, 72],
};

/** Dibujo base mirando a la derecha. `frame` cambia el aleteo del murciélago. */
function paintEnemy(kind: EnemyKind, white: boolean, frame: number) {
  return (c: CanvasRenderingContext2D) => {
    const col = (x: string) => (white ? '#ffffff' : x);
    switch (kind) {
      case 'rat': {
        c.strokeStyle = col('#e89aa8');
        c.lineWidth = 1.3;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-6, 2);
        c.quadraticCurveTo(-12, 6, -10.5, -2);
        c.stroke();
        c.fillStyle = col('#9a7f6e');
        c.beginPath();
        c.ellipse(-0.5, 1, 7.5, 4.6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#7a6253');
        c.beginPath();
        c.ellipse(-1.5, -0.3, 5.6, 3, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#ac9180');
        c.beginPath();
        c.ellipse(6, 1.6, 4, 3.1, 0.15, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#ff9fb2');
        c.beginPath();
        c.arc(9.8, 2.2, 1, 0, Math.PI * 2);
        c.arc(4, -2.2, 1.8, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#ff2d3d');
        c.beginPath();
        c.arc(7, 0.6, 1.05, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#4a3a32');
        c.fillRect(-4, 5, 2, 1.6);
        c.fillRect(3, 5, 2, 1.6);
        break;
      }
      case 'bat': {
        const up = frame === 0;
        c.fillStyle = col('#8a4cc7');
        for (const s of [-1, 1]) {
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(s * 12, up ? -7 : 3);
          c.lineTo(s * 10, up ? -1 : 6);
          c.lineTo(s * 7, up ? -2 : 3.5);
          c.lineTo(s * 4.5, 2);
          c.closePath();
          c.fill();
        }
        c.fillStyle = col('#5b2a8a');
        c.beginPath();
        c.ellipse(0, 1, 3.6, 4.4, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(-3, -2);
        c.lineTo(-2.4, -6);
        c.lineTo(-0.8, -3);
        c.moveTo(3, -2);
        c.lineTo(2.4, -6);
        c.lineTo(0.8, -3);
        c.fill();
        c.fillStyle = col('#ffe066');
        c.beginPath();
        c.arc(-1.4, -0.2, 0.9, 0, Math.PI * 2);
        c.arc(1.4, -0.2, 0.9, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'ghost': {
        c.fillStyle = col('#eaf1ff');
        c.beginPath();
        c.arc(0, -3, 8.5, Math.PI, 0);
        c.lineTo(8.5, 8);
        for (let i = 0; i < 4; i++) {
          const x0 = 8.5 - (i * 17) / 4;
          c.quadraticCurveTo(x0 - 17 / 8, 12, x0 - 17 / 4, 8);
        }
        c.closePath();
        c.fill();
        c.fillStyle = col('#b9c7f5');
        c.beginPath();
        c.ellipse(-2, 5, 5, 3, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#1b1640');
        c.beginPath();
        c.ellipse(-0.5, -4, 1.7, 2.4, 0, 0, Math.PI * 2);
        c.ellipse(4.2, -4, 1.7, 2.4, 0, 0, Math.PI * 2);
        c.ellipse(2, 1.6, 1.6, 2, 0, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'gargoyle': {
        // Alas de piedra detrás
        c.fillStyle = col('#5d6377');
        c.beginPath();
        c.moveTo(-4, -2);
        c.lineTo(-17, -12);
        c.lineTo(-14, -4);
        c.lineTo(-17, 2);
        c.lineTo(-5, 4);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(2, -4);
        c.lineTo(10, -15);
        c.lineTo(9, -6);
        c.closePath();
        c.fill();
        c.fillStyle = col('#9097ad');
        c.beginPath();
        c.ellipse(-1, 5, 10, 9, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#a7aec4');
        c.beginPath();
        c.arc(5, -5, 6.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#5d6377');
        c.beginPath();
        c.moveTo(1, -9);
        c.lineTo(-1, -16);
        c.lineTo(4, -10);
        c.moveTo(7, -10);
        c.lineTo(9, -17);
        c.lineTo(10, -9);
        c.fill();
        c.strokeStyle = col('#6b7086');
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(-6, 2);
        c.lineTo(-3, 6);
        c.lineTo(-5, 10);
        c.moveTo(2, 8);
        c.lineTo(4, 11);
        c.stroke();
        c.fillStyle = col('#ff8c1a');
        c.beginPath();
        c.arc(4, -6, 1.5, 0, Math.PI * 2);
        c.arc(8.5, -6, 1.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#ffffff');
        c.beginPath();
        c.moveTo(5, -1.5);
        c.lineTo(6, 1);
        c.lineTo(7, -1.5);
        c.moveTo(8, -1.5);
        c.lineTo(9, 1);
        c.lineTo(10, -1.5);
        c.fill();
        c.fillStyle = col('#4b5063');
        c.fillRect(-8, 12.5, 5, 2.5);
        c.fillRect(3, 12.5, 5, 2.5);
        break;
      }
      case 'coco': {
        if (!white) {
          const a = c.createRadialGradient(0, 0, 6, 0, 0, 33);
          a.addColorStop(0, 'rgba(160, 60, 255, 0.45)');
          a.addColorStop(1, 'rgba(160, 60, 255, 0)');
          c.fillStyle = a;
          c.fillRect(-33, -36, 66, 72);
        }
        // Capa raída
        const g = c.createLinearGradient(0, -20, 0, 30);
        g.addColorStop(0, white ? '#fff' : '#43275f');
        g.addColorStop(1, white ? '#fff' : '#1c1030');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(-12, -16);
        c.quadraticCurveTo(-24, 8, -24, 28);
        const n = 7;
        for (let i = 0; i < n; i++) {
          const x0 = -24 + (i * 48) / n;
          c.lineTo(x0 + 48 / n / 2, 22 + (i % 2) * 4);
          c.lineTo(x0 + 48 / n, 30 - (i % 3));
        }
        c.quadraticCurveTo(24, 8, 12, -16);
        c.closePath();
        c.fill();
        c.strokeStyle = col('rgba(199, 125, 255, 0.7)');
        c.lineWidth = 1;
        c.stroke();
        // Capucha
        c.fillStyle = col('#35204d');
        c.beginPath();
        c.arc(0, -16, 15, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = col('#06030c');
        c.beginPath();
        c.ellipse(0, -13, 10, 9.5, 0, 0, Math.PI * 2);
        c.fill();
        // Ojos y sonrisa
        c.fillStyle = col('#ff2d55');
        c.beginPath();
        c.ellipse(-4.5, -15, 2.6, 1.8, 0.25, 0, Math.PI * 2);
        c.ellipse(4.5, -15, 2.6, 1.8, -0.25, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col('#ffd1dc');
        c.beginPath();
        c.arc(-4.5, -15, 0.8, 0, Math.PI * 2);
        c.arc(4.5, -15, 0.8, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = col('#ff2d55');
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-5, -9);
        c.quadraticCurveTo(0, -6, 5, -9);
        c.stroke();
        // Garras
        c.strokeStyle = col('#b7c9a8');
        c.lineWidth = 1.6;
        c.lineCap = 'round';
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            c.beginPath();
            c.moveTo(s * 19, 4 + k * 2);
            c.lineTo(s * (25 + k), 9 + k * 3);
            c.stroke();
          }
        }
        break;
      }
    }
  };
}

const KINDS: EnemyKind[] = ['rat', 'bat', 'ghost', 'gargoyle', 'coco'];
/** Caché por índice: se piden cientos de sprites por fotograma y así no se crean textos ni funciones. */
const enemySprites: (HTMLCanvasElement | undefined)[] = [];

function enemySprite(kind: EnemyKind, white: boolean, left: boolean, frame = 0): HTMLCanvasElement {
  const i = KINDS.indexOf(kind) * 8 + (white ? 4 : 0) + (left ? 2 : 0) + frame;
  let spr = enemySprites[i];
  if (!spr) {
    const [w, h] = ENEMY_SIZE[kind];
    const paint = paintEnemy(kind, white, frame);
    spr = sprite(`nt-${kind}-${white ? 'w' : 'c'}-${left ? 'l' : 'r'}-${frame}`, w, h, (c) => {
      if (left) c.scale(-1, 1);
      paint(c);
    });
    enemySprites[i] = spr;
  }
  return spr;
}

function mayorSprite(white: boolean, left: boolean): HTMLCanvasElement {
  const paint = paintMayor(white);
  return sprite(`nt-mayor-${white ? 'w' : 'c'}-${left ? 'l' : 'r'}`, 30, 44, (c) => {
    if (left) c.scale(-1, 1);
    paint(c);
  });
}

function paintShadow(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 10, 0, Math.PI * 2);
  c.fill();
}

const GEM_COLORS = [
  ['#4fc3ff', '#c8efff', '#1e78b4'],
  ['#3ddc97', '#c9ffe6', '#1a8a5b'],
  ['#ff5a7a', '#ffd0db', '#a8203f'],
];

function paintGem(tier: number) {
  return (c: CanvasRenderingContext2D) => {
    const [main, hi, dark] = GEM_COLORS[tier];
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(4, 0);
    c.lineTo(0, 5.5);
    c.lineTo(-4, 0);
    c.closePath();
    c.fill();
    c.fillStyle = main;
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(4, 0);
    c.lineTo(0, 3.5);
    c.lineTo(-4, 0);
    c.closePath();
    c.fill();
    c.fillStyle = hi;
    c.beginPath();
    c.moveTo(0, -4);
    c.lineTo(-2.4, -0.2);
    c.lineTo(-0.4, -0.2);
    c.closePath();
    c.fill();
  };
}

const gemTier = (v: number) => (v >= 10 ? 2 : v >= 2 ? 1 : 0);

function paintFood(c: CanvasRenderingContext2D) {
  c.fillStyle = '#f2e6d0';
  c.beginPath();
  c.roundRect(2, -1.4, 7, 2.8, 1.4);
  c.fill();
  c.beginPath();
  c.arc(9, -1.6, 1.8, 0, Math.PI * 2);
  c.arc(9, 1.6, 1.8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#c9762e';
  c.beginPath();
  c.ellipse(-2.5, 0, 6.5, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e8984a';
  c.beginPath();
  c.ellipse(-3.5, -1.4, 4, 2.6, -0.3, 0, Math.PI * 2);
  c.fill();
}

function paintMagnet(c: CanvasRenderingContext2D) {
  c.lineCap = 'butt';
  c.strokeStyle = '#e63950';
  c.lineWidth = 3.6;
  c.beginPath();
  c.arc(0, -0.5, 4.6, Math.PI, 0, true);
  c.stroke();
  c.strokeStyle = '#ff5a7a';
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, -0.5, 5.6, Math.PI * 1.05, Math.PI * 1.4, false);
  c.stroke();
  c.fillStyle = '#e63950';
  c.fillRect(-6.4, -1, 3.6, 3);
  c.fillRect(2.8, -1, 3.6, 3);
  c.fillStyle = '#dfe6f2';
  c.fillRect(-6.4, 2, 3.6, 2.6);
  c.fillRect(2.8, 2, 3.6, 2.6);
}

function paintBolt(c: CanvasRenderingContext2D) {
  const g = c.createLinearGradient(-10, 0, 6, 0);
  g.addColorStop(0, 'rgba(255, 200, 80, 0)');
  g.addColorStop(0.6, 'rgba(255, 220, 120, 0.7)');
  g.addColorStop(1, 'rgba(255, 250, 220, 1)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(-2, 0, 9, 2.8, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fffbe8';
  c.beginPath();
  c.arc(4, 0, 2.2, 0, Math.PI * 2);
  c.fill();
}

function paintBroom(c: CanvasRenderingContext2D) {
  c.fillStyle = '#8a5a35';
  c.fillRect(-12, -0.9, 15, 1.8);
  c.fillStyle = '#e8c56a';
  c.beginPath();
  c.moveTo(3, -1.6);
  c.lineTo(12, -4.5);
  c.lineTo(12, 4.5);
  c.lineTo(3, 1.6);
  c.closePath();
  c.fill();
  c.strokeStyle = '#b8933f';
  c.lineWidth = 0.6;
  c.beginPath();
  for (const y of [-2.5, 0, 2.5]) {
    c.moveTo(5, y * 0.5);
    c.lineTo(12, y);
  }
  c.stroke();
  c.fillStyle = '#c0392b';
  c.fillRect(2.4, -2, 1.6, 4);
}

function paintPetardo(c: CanvasRenderingContext2D) {
  c.fillStyle = '#d62839';
  c.beginPath();
  c.roundRect(-2.4, -5, 4.8, 10, 1.2);
  c.fill();
  c.fillStyle = '#ffe066';
  c.fillRect(-2.4, -1, 4.8, 1.6);
  c.strokeStyle = '#3a2a1a';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(0, -5);
  c.quadraticCurveTo(2, -7, 1, -8.5);
  c.stroke();
}

function paintFlask(c: CanvasRenderingContext2D) {
  c.fillStyle = '#7ad7ff';
  c.beginPath();
  c.arc(0, 1.5, 3.8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#cdeeff';
  c.fillRect(-1.3, -4.5, 2.6, 3.5);
  c.fillStyle = '#8a5a35';
  c.fillRect(-1.5, -5.5, 3, 1.4);
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillRect(-2, 0, 1, 2);
}

function paintPuddle(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 32);
  g.addColorStop(0, 'rgba(140, 220, 255, 0.55)');
  g.addColorStop(0.75, 'rgba(70, 160, 255, 0.4)');
  g.addColorStop(0.92, 'rgba(180, 235, 255, 0.65)');
  g.addColorStop(1, 'rgba(180, 235, 255, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 32, 0, Math.PI * 2);
  c.fill();
}

const KILL_COLORS: Record<EnemyKind, string[]> = {
  rat: ['#9a7f6e', '#ff9fb2', '#ffffff'],
  bat: ['#8a4cc7', '#ffe066', '#c9a2ff'],
  ghost: ['#eaf1ff', '#b9c7f5', '#ffffff'],
  gargoyle: ['#9097ad', '#ff8c1a', '#ffffff', '#5d6377'],
  coco: ['#c77dff', '#ff2d55', '#ffffff', '#43275f'],
};

const ICON: Record<'gargoyle' | 'coco', string> = { gargoyle: '🗿', coco: '👹' };

/** Farolas y adornos fijos de la plaza: se sacan de un hash de la celda, así no hay que guardarlos. */
const DECOR_CELL = 280;

function cellHash(i: number, j: number): number {
  let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

interface Decor {
  lamp: { x: number; y: number } | null;
  prop: { x: number; y: number; kind: 'planter' | 'bench' } | null;
}

function decorAt(i: number, j: number): Decor {
  // La fuente ocupa el centro de la plaza
  if (i === 0 && j === 0) return { lamp: null, prop: null };
  const h = cellHash(i, j);
  const x0 = i * DECOR_CELL;
  const y0 = j * DECOR_CELL;
  const lamp = h % 100 < 50 ? { x: x0 + 40 + ((h >>> 7) % 200), y: y0 + 40 + ((h >>> 15) % 200) } : null;
  const pk = (h >>> 23) % 10;
  const prop = pk < 6 ? { x: x0 + 20 + ((h >>> 3) % 240), y: y0 + 20 + ((h >>> 11) % 240), kind: (pk < 3 ? 'planter' : 'bench') as 'planter' | 'bench' } : null;
  return { lamp, prop };
}

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

/** Efectos de corta vida que el Fx común no tiene: luces que se apagan y el abanico del silbato. */
interface Glow {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
}

interface Cone {
  x: number;
  y: number;
  a: number;
  range: number;
  spread: number;
  life: number;
}

export function NightGameView({ onOver, onScore }: WarViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<NightGame>(null as unknown as NightGame);
  if (!game.current) {
    game.current = newNight();
    // Solo en desarrollo: deja tocar la partida desde la consola (capturas y pruebas a mano)
    if (import.meta.env.DEV) (window as unknown as { __night?: NightGame }).__night = game.current;
  }
  const fx = useRef(new Fx());
  const [phase, setPhaseState] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>('intro');
  const introEnd = useRef(performance.now() + INTRO_MS);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'boss'; id: number } | null>(null);
  const [choices, setChoices] = useState<{ list: UpgradeDef<UpId>[]; id: number } | null>(null);
  const cam = useRef({ x: game.current.x, y: game.current.y });
  const dark = useRef<HTMLCanvasElement | null>(null);
  const glows = useRef<Glow[]>([]);
  const cones = useRef<Cone[]>([]);
  const hurtGlow = useRef(0);
  const lvFlash = useRef(0);
  const throttle = useRef({ kill: 0, gem: 0, gemN: 0, boom: 0, num: 0, bolt: 0 });
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  const input = useInput(canvas, 'stick');
  const [hud, pushHud] = useHud({ score: 0, time: 0, kills: 0, lv: 1, xp: 0, need: xpNeed(1), boss: -1, kit: 'farol:1' });

  // Temporizadores con limpieza al desmontar (sonidos encadenados y el final de partida)
  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      if (p !== 'play') releaseInput(input.current);
    },
    [input],
  );

  const say = (text: string, tone: 'good' | 'bad' | 'boss' = 'good') => setBanner({ text, tone, id: performance.now() });

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1800);
    return () => clearTimeout(t);
  }, [banner]);

  const start = useCallback(() => {
    if (phaseRef.current === 'intro') setPhase('play');
  }, [setPhase]);

  const pause = useCallback(() => {
    if (phaseRef.current === 'play') setPhase('paused');
  }, [setPhase]);

  const openChoice = useCallback(() => {
    setChoices({ list: rollChoices(game.current, Math.random), id: performance.now() });
    setPhase('choice');
  }, [setPhase]);

  const pick = (d: UpgradeDef<UpId>) => {
    const g = game.current;
    if (phaseRef.current !== 'choice') return;
    applyUpgrade(g, d.id);
    const f = fx.current;
    f.burst(g.x, g.y - 8, { n: 16, colors: ['#ffe066', '#fff', '#4fc3ff'], speed: 110, shape: 'spark' });
    cb.current.onScore(summary(g));
    if (g.pending > 0) openChoice();
    else {
      setChoices(null);
      setPhase('play');
    }
  };

  const onStep = (dt: number) => {
    const g = game.current;
    const inp = input.current;
    const prevScore = g.score;
    const ev = step(g, dt, moveVec(inp), Math.random);
    const f = fx.current;
    const now = performance.now();
    const th = throttle.current;

    for (const k of ev.kills) {
      const big = k.kind === 'gargoyle' || k.kind === 'coco';
      f.burst(k.x, k.y, { n: k.kind === 'coco' ? 70 : big ? 30 : 6, colors: KILL_COLORS[k.kind], speed: k.kind === 'coco' ? 200 : big ? 140 : 70, life: big ? 700 : 380, size: big ? 2.6 : 1.8 });
      if (big) {
        f.ring(k.x, k.y, '#ffe9a8', k.kind === 'coco' ? 90 : 36, 500);
        f.text(k.x, k.y - 14, `+${k.pts}`, '#ffe066', k.kind === 'coco' ? 15 : 12, 1100);
        f.shake(k.kind === 'coco' ? 9 : 3, k.kind === 'coco' ? 700 : 220);
        tone(k.kind === 'coco' ? 60 : 110, k.kind === 'coco' ? 0.7 : 0.25, 'sawtooth', 0.07);
        vibrate(k.kind === 'coco' ? [50, 30, 90] : 25);
        glows.current.push({ x: k.x, y: k.y, r: k.kind === 'coco' ? 160 : 70, life: 600, max: 600 });
      } else if (now - th.kill > 55) {
        th.kill = now;
        tone(300 + Math.random() * 120, 0.04, 'triangle', 0.028);
      }
    }
    // Números de daño: como mucho uno cada 70 ms (el golpe más gordo)
    if (ev.hits.length && now - th.num > 70) {
      th.num = now;
      let best = ev.hits[0];
      for (const h of ev.hits) if (h.dmg > best.dmg) best = h;
      const n = Math.round(best.dmg);
      f.text(best.x + (Math.random() - 0.5) * 6, best.y - 2, String(n), n >= 25 ? '#ffe066' : '#ffffff', n >= 25 ? 9 : 7, 520);
    }
    if (ev.bolts && now - th.bolt > 140) {
      th.bolt = now;
      tone(1320 + Math.random() * 200, 0.025, 'sine', 0.012);
    }
    for (const p of ev.pulses) {
      f.ring(p.x, p.y, '#ffe9a8', p.r, 420);
      f.ring(p.x, p.y, '#ffc23d', p.r * 0.75, 320);
      glows.current.push({ x: p.x, y: p.y, r: p.r * 1.6, life: 300, max: 300 });
      tone(1046, 0.22, 'sine', 0.035);
      later(60, () => tone(1568, 0.18, 'sine', 0.02));
    }
    for (const w of ev.whistles) {
      cones.current.push({ ...w, life: 260 });
      tone(2093, 0.1, 'square', 0.012);
    }
    for (const b of ev.booms) {
      f.burst(b.x, b.y, { n: 14, colors: ['#ffb938', '#ff5a3a', '#fff3b0'], speed: 150, life: 420, size: 2.2, shape: 'spark' });
      f.ring(b.x, b.y, '#ffb938', b.r * 1.1, 320);
      glows.current.push({ x: b.x, y: b.y, r: b.r * 2.6, life: 260, max: 260 });
      if (now - th.boom > 90) {
        th.boom = now;
        tone(80 + Math.random() * 30, 0.12, 'square', 0.035);
      }
    }
    for (const s of ev.splashes) {
      f.burst(s.x, s.y, { n: 10, colors: ['#bfe9ff', '#7ad7ff', '#ffffff'], speed: 80, life: 380, size: 1.6 });
      tone(700, 0.06, 'sine', 0.02);
    }
    if (ev.xp) {
      if (now - th.gem > 45) {
        th.gemN = now - th.gem < 400 ? Math.min(th.gemN + 1, 14) : 0;
        th.gem = now;
        tone(1046 * 2 ** (th.gemN / 12), 0.035, 'sine', 0.022);
      }
    }
    if (ev.hurt) {
      hurtGlow.current = 1;
      f.burst(g.x, g.y - 6, { n: 6, colors: ['#ff4d6d', '#fff'], speed: 70, life: 300, size: 1.6 });
      tone(150, 0.08, 'sawtooth', 0.04);
      vibrate(18);
    }
    if (ev.food) {
      sfx('buy');
      f.text(g.x, g.y - 30, '+30 ❤️', '#7dffb0', 10, 1000);
      f.burst(g.x, g.y, { n: 12, colors: ['#7dffb0', '#fff'], speed: 70, shape: 'spark' });
    }
    if (ev.magnet) {
      sfx('crit');
      f.text(g.x, g.y - 30, '¡Imán!', '#ff8a9a', 10, 1000);
      f.ring(g.x, g.y, '#ff8a9a', 120, 500);
    }
    if (ev.announce) say(ev.announce.text, ev.announce.tone);
    if (ev.eliteIn) {
      tone(98, 0.45, 'sawtooth', 0.05);
      vibrate([25, 40, 25]);
    }
    if (ev.bossIn) {
      tone(65, 0.9, 'sawtooth', 0.07);
      f.shake(5, 500);
      vibrate([40, 60, 40, 60, 80]);
    }
    if (ev.bossWarn) tone(260, 0.12, 'square', 0.03);
    if (ev.bossCharge) {
      tone(90, 0.3, 'sawtooth', 0.05);
      f.shake(3, 250);
    }
    if (ev.bossSummon) tone(500, 0.15, 'triangle', 0.03);
    if (ev.bossDown) say('💥 ¡Derrotaste a El Coco!', 'boss');
    if (g.score !== prevScore) cb.current.onScore(summary(g));

    if (ev.lost) {
      f.shake(10, 700);
      f.burst(g.x, g.y - 8, { n: 50, colors: ['#ffc23d', '#e63950', '#fff', '#2f4a96'], speed: 180, life: 900, size: 2.6 });
      tone(70, 0.8, 'sawtooth', 0.08);
      vibrate([80, 50, 160]);
      say('💀 ¡Te atraparon!', 'bad');
      setPhase('over');
      later(1600, () => cb.current.onOver(summary(g)));
      return;
    }
    if (ev.dawn) {
      for (const b of ev.burn) f.burst(b.x, b.y, { n: 4, colors: ['#ffd27a', '#c9c9d6', '#ffffff'], speed: 50, life: 900, size: 2.4, gravity: -40 });
      f.flash('#ffd27a', 600);
      f.text(g.x, g.y - 34, `+${DAWN_BONUS} ☀️`, '#ffe066', 14, 1600);
      say('🌅 ¡Amanece!', 'good');
      sfx('win');
      vibrate([30, 40, 30, 40, 120]);
      cb.current.onScore(summary(g));
      setPhase('over');
      later(2000, () => cb.current.onOver(summary(g)));
      return;
    }
    if (ev.levelUp) {
      lvFlash.current = 1;
      f.flash('#ffe066', 220);
      f.ring(g.x, g.y, '#ffe066', 60, 500);
      [523, 659, 784, 1046].forEach((fr, i) => later(i * 70, () => tone(fr, 0.09, 'triangle', 0.05)));
      vibrate(20);
      openChoice();
    }
  };

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const live = ph !== 'paused';
    if (live) {
      fx.current.update(frame);
      for (const gl of glows.current) gl.life -= frame;
      glows.current = glows.current.filter((gl) => gl.life > 0);
      for (const c of cones.current) c.life -= frame;
      cones.current = cones.current.filter((c) => c.life > 0);
      hurtGlow.current = Math.max(0, hurtGlow.current - frame / 400);
      lvFlash.current = Math.max(0, lvFlash.current - frame / 600);
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    // La cámara sigue al alcalde con un poco de suavidad
    const k = 1 - Math.exp(-frame * 0.012);
    cam.current.x += (g.x - cam.current.x) * k;
    cam.current.y += (g.y - cam.current.y) * k;
    g.halfW = v.cw / 2 / v.scale;
    g.halfH = v.ch / 2 / v.scale;
    if (!dark.current) dark.current = document.createElement('canvas');
    drawWorld(ctx, v, g, fx.current, cam.current, dark.current, glows.current, cones.current, hurtGlow.current, lvFlash.current);
    if (ph === 'play' || ph === 'intro') drawSticks(ctx, v, input.current, [{ x: v.cw / 2, y: v.ch - 110 }]);
    fx.current.drawFlash(ctx, v);
    const b = boss(g);
    pushHud({
      score: g.score,
      time: Math.floor(g.t / 1000),
      kills: g.kills,
      lv: g.lv,
      xp: Math.floor(g.xp),
      need: xpNeed(g.lv),
      boss: b ? Math.max(0, b.hp / b.max) : -1,
      kit: kitKey(g),
    });
  };

  useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;
  const late = hud.time * 1000 >= DAWN_FROM;

  return (
    <div className="sh-wrap nt-wrap">
      <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Ronda nocturna, ${clock(hud.time * 1000)}. Nivel ${hud.lv}, ${hud.kills} bichos.`} />
      <HudBar
        items={[
          { icon: '🏆', value: hud.score, label: 'Puntos' },
          { icon: late ? '🌄' : '🌙', value: clock(hud.time * 1000), label: 'Tiempo', hot: hud.boss >= 0 },
          { icon: '💀', value: hud.kills, label: 'Bichos' },
        ]}
        onPause={phase === 'play' ? pause : undefined}
      >
        <div className="nt-xp">
          <Meter value={hud.xp} max={hud.need} color="linear-gradient(90deg, #4fc3ff, #a78bfa)" label="Experiencia" text={`Nv ${hud.lv}`} />
        </div>
        {hud.boss >= 0 && (
          <div className="nt-boss">
            <Meter value={hud.boss} max={1} color="linear-gradient(90deg, #7b2ff7, #ff2d55)" label="Vida de El Coco" text="👹 EL COCO" />
          </div>
        )}
        {/* En partida solo las armas (caben en una fila); las pasivas se ven en la pausa */}
        <Kit kit={hud.kit} weaponsOnly />
      </HudBar>
      {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
      {phase === 'intro' && (
        <StartCard
          title="🌙 Ronda nocturna"
          left={introLeft}
          total={INTRO_MS}
          onSkip={start}
          lines={[
            { icon: '👆', text: 'Mueve al alcalde con el pulgar (o con WASD / flechas).' },
            { icon: '🏮', text: 'Tus armas disparan solas: tú solo esquiva.' },
            { icon: '💎', text: 'Recoge gemas para subir de nivel y elegir mejoras.' },
            { icon: '🌅', text: 'Aguanta hasta que amanezca (5:00).' },
          ]}
        />
      )}
      {phase === 'choice' && choices && (
        <UpgradePick
          key={choices.id}
          title={`¡Nivel ${g.lv - g.pending + 1}!`}
          subtitle={g.pending > 1 ? `Elige una mejora · te quedan ${g.pending}` : 'Elige una mejora'}
          choices={choices.list}
          levels={g.levels}
          onPick={pick}
        />
      )}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            {clock(g.t)} de 5:00 · Nv {g.lv} · {g.kills} bichos · {g.score} puntos
          </p>
          <Kit kit={kitKey(g)} big />
        </PauseCard>
      )}
    </div>
  );
}

/** Armas y pasivas que llevas, como texto estable para el marcador ("farol:2|botas:1"). */
function kitKey(g: NightGame): string {
  const out: string[] = [];
  for (const id of [...WEAPON_IDS, ...PASSIVE_IDS]) {
    const lv = wl(g, id);
    if (lv > 0) out.push(`${id}:${lv}`);
  }
  return out.join('|');
}

function Kit({ kit, big, weaponsOnly }: { kit: string; big?: boolean; weaponsOnly?: boolean }) {
  const items = kit ? kit.split('|').map((s) => s.split(':') as [UpId, string]) : [];
  const shown = weaponsOnly ? items.filter(([id]) => UP_BY_ID[id].weapon) : items;
  if (!shown.length) return null;
  return (
    <div className={`nt-kit${big ? ' big' : ''}`}>
      {shown.map(([id, lv]) => {
        const d = UP_BY_ID[id];
        return (
          <span key={id} className={`nt-chip${d.weapon ? ' weapon' : ''}${Number(lv) >= d.max ? ' max' : ''}`} title={d.name} aria-label={`${d.name} nivel ${lv}`}>
            <i aria-hidden="true">{d.emoji}</i>
            <b>{Number(lv) >= d.max ? 'MÁX' : lv}</b>
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pintar el mundo
// ---------------------------------------------------------------------------------------------

function drawWorld(
  ctx: CanvasRenderingContext2D,
  v: View,
  g: NightGame,
  f: Fx,
  cam: { x: number; y: number },
  dark: HTMLCanvasElement,
  glows: Glow[],
  cones: Cone[],
  hurt: number,
  lvFlash: number,
) {
  const t = g.t;
  const now = performance.now();
  const sh = f.offset();
  const sc = v.scale;
  const cx = cam.x - sh.x;
  const cy = cam.y - sh.y;
  const hw = v.cw / 2 / sc;
  const hh = v.ch / 2 / sc;
  const x0 = cx - hw;
  const y0 = cy - hh;
  const x1 = cx + hw;
  const y1 = cy + hh;
  const world = () => ctx.setTransform(v.dpr * sc, 0, 0, v.dpr * sc, v.dpr * (v.cw / 2 - cx * sc), v.dpr * (v.ch / 2 - cy * sc));
  // Mundo → px CSS (para la capa de oscuridad y los avisos de borde)
  const sx = (x: number) => v.cw / 2 + (x - cx) * sc;
  const sy = (y: number) => v.ch / 2 + (y - cy) * sc;

  world();
  // Suelo
  const ground = sprite('nt-ground', TILE, TILE, paintGround, 3);
  for (let ty = Math.floor(y0 / TILE) * TILE; ty < y1; ty += TILE) for (let tx = Math.floor(x0 / TILE) * TILE; tx < x1; tx += TILE) ctx.drawImage(ground, tx, ty, TILE + 0.5, TILE + 0.5);

  // Adornos fijos y farolas que se ven
  const lamps: { x: number; y: number }[] = [];
  const ci0 = Math.floor((x0 - 40) / DECOR_CELL);
  const ci1 = Math.floor((x1 + 40) / DECOR_CELL);
  const cj0 = Math.floor((y0 - 40) / DECOR_CELL);
  const cj1 = Math.floor((y1 + 60) / DECOR_CELL);
  for (let j = cj0; j <= cj1; j++) {
    for (let i = ci0; i <= ci1; i++) {
      const d = decorAt(i, j);
      if (d.prop) {
        if (d.prop.kind === 'planter') drawSprite(ctx, sprite('nt-planter', 24, 24, paintPlanter), d.prop.x, d.prop.y, 24, 24);
        else drawSprite(ctx, sprite('nt-bench', 32, 16, paintBench), d.prop.x, d.prop.y, 32, 16);
      }
      if (d.lamp) lamps.push(d.lamp);
    }
  }
  if (Math.abs(cx) < hw + 60 && Math.abs(cy) < hh + 60) drawSprite(ctx, sprite('nt-fountain', 92, 66, paintFountain, 3), 0, 0, 92, 66);

  // Charcos de agua bendita (en el suelo, antes de la oscuridad)
  const pud = sprite('nt-puddle', 64, 64, paintPuddle, 1);
  for (const p of g.puddles) {
    const a = Math.min(1, p.life / 400, (p.max - p.life) / 150 + 0.3);
    const wob = 1 + Math.sin(now / 160 + p.x) * 0.04;
    drawSprite(ctx, pud, p.x, p.y, p.r * 2.1 * wob, p.r * 1.7 * wob, 0, a);
  }

  // Oscuridad: una capa a baja resolución con agujeros de luz (alcalde, farolas, explosiones…)
  const dawnK = g.won ? 1 : Math.max(0, (t - DAWN_FROM) / (RUN_MS - DAWN_FROM));
  const night = g.won ? 0.2 : 0.8 * (1 - dawnK * 0.75);
  const DS = 4;
  const dw = Math.max(1, Math.ceil(v.cw / DS));
  const dh = Math.max(1, Math.ceil(v.ch / DS));
  if (dark.width !== dw || dark.height !== dh) {
    dark.width = dw;
    dark.height = dh;
  }
  const d = dark.getContext('2d');
  if (d) {
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, dw, dh);
    d.fillStyle = `rgba(5, 6, 22, ${night})`;
    d.fillRect(0, 0, dw, dh);
    d.globalCompositeOperation = 'destination-out';
    const light = glow('cut', 'rgba(255, 255, 255, 1)');
    const hole = (x: number, y: number, r: number, a = 1) => {
      const R = (r * sc) / DS;
      d.globalAlpha = a;
      d.drawImage(light, sx(x) / DS - R, sy(y) / DS - R, R * 2, R * 2);
    };
    const flick = 1 + Math.sin(now / 90) * 0.02 + Math.sin(now / 37) * 0.015;
    hole(g.x, g.y - 6, 150 * flick);
    hole(g.x, g.y - 6, 70);
    for (const l of lamps) hole(l.x, l.y + 6, 92);
    hole(0, 0, 70, 0.7);
    for (const p of g.puddles) hole(p.x, p.y, p.r * 1.8, 0.8);
    for (const gl of glows) hole(gl.x, gl.y, gl.r, gl.life / gl.max);
    for (const b of g.bolts) hole(b.x, b.y, 26, 0.6);
    d.globalAlpha = 1;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(dark, 0, 0, v.cw, v.ch);
  }

  // Luz cálida de las farolas (aditiva) y la fuente
  world();
  ctx.globalCompositeOperation = 'lighter';
  const warm = glow('warm', 'rgba(255, 190, 90, 0.32)');
  for (const l of lamps) ctx.drawImage(warm, l.x - 80, l.y + 4 - 60, 160, 120);
  // El farol que lleva el alcalde
  if (g.phase === 'play' || g.won) ctx.drawImage(glow('lantern', 'rgba(255, 200, 110, 0.16)'), g.x - 110, g.y - 110, 220, 220);
  ctx.drawImage(glow('blue', 'rgba(90, 170, 255, 0.18)'), -60, -45, 120, 90);
  ctx.globalCompositeOperation = 'source-over';

  // Farolas
  const lampSpr = sprite('nt-lamp', 14, 56, paintLamp, 3);
  for (const l of lamps) drawSprite(ctx, lampSpr, l.x, l.y - 24, 14, 56);

  // Avisos de petardos y frascos: círculo donde van a caer
  for (const th of g.throws) {
    if (th.t < 0) continue;
    const k = th.t / th.dur;
    ctx.strokeStyle = th.kind === 'petardo' ? `rgba(255, 90, 58, ${0.25 + k * 0.5})` : `rgba(122, 215, 255, ${0.2 + k * 0.4})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(th.x, th.y, th.r * (1.25 - k * 0.25), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Gemas (con destellos y estelas cuando vuelan hacia ti) y premios
  const gemSpr = [0, 1, 2].map((i) => sprite(`nt-gem-${i}`, 10, 12, paintGem(i)));
  for (let i = 0; i < g.gems.length; i++) {
    const gm = g.gems[i];
    if (gm.x < x0 - 10 || gm.x > x1 + 10 || gm.y < y0 - 10 || gm.y > y1 + 10) continue;
    const tier = gemTier(gm.v);
    const s = tier === 2 ? 1.5 : tier === 1 ? 1.2 : 1;
    if (gm.pulled && gm.sp > 60) {
      const n = Math.hypot(g.x - gm.x, g.y - gm.y) || 1;
      ctx.strokeStyle = GEM_COLORS[tier][0];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gm.x, gm.y);
      ctx.lineTo(gm.x - ((g.x - gm.x) / n) * Math.min(14, gm.sp / 25), gm.y - ((g.y - gm.y) / n) * Math.min(14, gm.sp / 25));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const bob = gm.pulled ? 0 : Math.sin(now / 300 + i) * 1.2;
    drawSprite(ctx, gemSpr[tier], gm.x, gm.y + bob, 10 * s, 12 * s);
    // Destello que va saltando de gema en gema
    if ((i * 7 + Math.floor(now / 110)) % 29 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(gm.x - 0.5 - 3, gm.y + bob - 2 - 0.5, 6, 1);
      ctx.fillRect(gm.x - 0.5, gm.y + bob - 2 - 3.5, 1, 6);
    }
  }
  for (const it of g.items) {
    const bob = Math.sin(now / 260 + it.x) * 1.5;
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow(it.kind, it.kind === 'food' ? 'rgba(125, 255, 176, 0.5)' : 'rgba(255, 110, 140, 0.5)'), it.x - 14 - pulse * 3, it.y - 14 - pulse * 3, 28 + pulse * 6, 28 + pulse * 6);
    ctx.globalCompositeOperation = 'source-over';
    if (it.kind === 'food') drawSprite(ctx, sprite('nt-food', 22, 14, paintFood), it.x, it.y + bob, 22, 14);
    else drawSprite(ctx, sprite('nt-magnet', 16, 14, paintMagnet), it.x, it.y + bob, 16, 14);
  }

  // Sombras de todos de una vez
  const shadow = sprite('nt-shadow', 20, 20, paintShadow, 2);
  for (const e of g.enemies) {
    if (e.kind === 'ghost' || e.kind === 'bat' || e.x < x0 - 40 || e.x > x1 + 40 || e.y < y0 - 40 || e.y > y1 + 40) continue;
    const w = ENEMY_SIZE[e.kind][0];
    ctx.drawImage(shadow, e.x - w * 0.45, e.y + e.r * 0.6 - w * 0.15, w * 0.9, w * 0.3);
  }

  // El Coco: aviso de embestida (franja roja) por debajo de todo
  const b = boss(g);
  if (b && b.mode === 1) {
    const k = Math.min(1, b.modeT / 950);
    const len = 200;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.ay, b.ax));
    ctx.fillStyle = `rgba(255, 45, 85, ${0.12 + 0.18 * k + 0.08 * Math.sin(now / 50)})`;
    ctx.fillRect(0, -b.r, len, b.r * 2);
    ctx.fillStyle = 'rgba(255, 45, 85, 0.5)';
    ctx.fillRect(0, -b.r, len * k, 2);
    ctx.fillRect(0, b.r - 2, len * k, 2);
    ctx.restore();
  }

  // Bichos
  for (const e of g.enemies) {
    if (e.x < x0 - 40 || e.x > x1 + 40 || e.y < y0 - 40 || e.y > y1 + 40) continue;
    drawEnemy(ctx, e, now);
  }

  // Alcalde
  const dead = g.phase === 'over' && !g.won;
  // Derribado: el alcalde queda tumbado en el suelo
  if (dead) drawSprite(ctx, mayorSprite(false, g.left), g.x, g.y - 2, 27, 39.6, g.left ? Math.PI / 2 : -Math.PI / 2, 0.75);
  else {
    ctx.drawImage(shadow, g.x - 9, g.y + 6, 18, 6);
    const bob = g.moving ? Math.abs(Math.sin(now / 95)) * 1.6 : Math.sin(now / 500) * 0.4;
    const py = g.y - 10 - bob;
    drawSprite(ctx, mayorSprite(false, g.left), g.x, py, 27, 39.6);
    if (g.hurtCd > HURT_CD - 140) drawSprite(ctx, mayorSprite(true, g.left), g.x, py, 27, 39.6, 0, 0.8);
    // Vida bajo los pies
    const frac = g.hp / maxHp(g);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(g.x - 13, g.y + 11, 26, 4);
    ctx.fillStyle = frac > 0.5 ? '#3ddc97' : frac > 0.25 ? '#ffc23d' : '#ff4d6d';
    ctx.fillRect(g.x - 12.5, g.y + 11.5, 25 * frac, 3);
  }

  // Escobas
  const lvE = wl(g, 'escoba');
  if (lvE > 0 && !dead) {
    const n = WEAPON.escoba.n[lvE - 1];
    const R = WEAPON.escoba.r[lvE - 1];
    ctx.strokeStyle = 'rgba(232, 197, 106, 0.12)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(g.x, g.y, R, 0, Math.PI * 2);
    ctx.stroke();
    const br = sprite('nt-broom', 26, 10, paintBroom);
    for (let i = 0; i < n; i++) {
      const a = g.orbit + (i / n) * Math.PI * 2;
      drawSprite(ctx, br, g.x + Math.cos(a) * R, g.y + Math.sin(a) * R, 26, 10, a + Math.PI / 2 + 0.5);
    }
  }

  // Abanico del silbato
  for (const c of cones) {
    const k = c.life / 260;
    ctx.fillStyle = `rgba(180, 230, 255, ${0.28 * k})`;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, c.range * (1.1 - k * 0.3), c.a - c.spread, c.a + c.spread);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(220, 245, 255, ${0.6 * k})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.range * (1.1 - k * 0.3), c.a - c.spread, c.a + c.spread);
    ctx.stroke();
  }

  // Petardos y frascos en el aire
  for (const th of g.throws) {
    if (th.t < 0) continue;
    const k = th.t / th.dur;
    const x = th.sx + (th.x - th.sx) * k;
    const y = th.sy + (th.y - th.sy) * k - Math.sin(k * Math.PI) * 34;
    if (th.kind === 'petardo') {
      drawSprite(ctx, sprite('nt-petardo', 8, 18, paintPetardo), x, y, 8, 18, k * 9);
      ctx.fillStyle = Math.random() < 0.5 ? '#fff3b0' : '#ffb938';
      ctx.fillRect(x - 1 + Math.cos(k * 9 - 1.6) * 8, y - 1 + Math.sin(k * 9 - 1.6) * 8, 2, 2);
    } else drawSprite(ctx, sprite('nt-flask', 10, 14, paintFlask), x, y, 10, 14, k * 7);
  }

  // Rayos del farol (aditivos)
  ctx.globalCompositeOperation = 'lighter';
  const bolt = sprite('nt-bolt', 22, 8, paintBolt);
  for (const bl of g.bolts) drawSprite(ctx, bolt, bl.x, bl.y, 22, 8, Math.atan2(bl.vy, bl.vx));
  if (lvFlash > 0 && !dead) ctx.drawImage(glow('lv', 'rgba(255, 230, 120, 0.8)'), g.x - 50, g.y - 60, 100, 100);
  ctx.globalCompositeOperation = 'source-over';

  f.draw(ctx);

  // ---- Pantalla: avisos de bichos gordos fuera de vista, viñetas y amanecer ----
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  for (const e of g.enemies) {
    if (e.kind !== 'gargoyle' && e.kind !== 'coco') continue;
    const ex = sx(e.x);
    const ey = sy(e.y);
    const m = 26;
    const top = 120;
    // Solo si no se ve nada de él
    const half = (ENEMY_SIZE[e.kind][0] / 2) * sc;
    if (ex > -half && ex < v.cw + half && ey > -half && ey < v.ch + half) continue;
    const px = Math.max(m, Math.min(v.cw - m, ex));
    const py = Math.max(top, Math.min(v.ch - m, ey));
    const a = Math.atan2(ey - py, ex - px);
    ctx.fillStyle = e.kind === 'coco' ? 'rgba(255, 45, 85, 0.9)' : 'rgba(255, 140, 26, 0.9)';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * 20, py + Math.sin(a) * 20);
    ctx.lineTo(px + Math.cos(a + 2.4) * 12, py + Math.sin(a + 2.4) * 12);
    ctx.lineTo(px + Math.cos(a - 2.4) * 12, py + Math.sin(a - 2.4) * 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(10, 8, 30, 0.75)';
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `14px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ICON[e.kind], px, py + 1);
  }

  // Viñeta roja al recibir mordiscos, y latiendo con poca vida
  const low = g.phase === 'play' && g.hp / maxHp(g) < 0.3;
  const red = Math.max(hurt * 0.4, low ? 0.22 + 0.1 * Math.sin(now / 220) : 0);
  if (red > 0.01) {
    const r = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.3, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.72);
    r.addColorStop(0, 'rgba(255, 30, 60, 0)');
    r.addColorStop(1, `rgba(255, 30, 60, ${red})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
  // El cielo se tiñe de naranja al final de la noche
  if (g.won) {
    ctx.fillStyle = 'rgba(255, 190, 120, 0.12)';
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
  if (dawnK > 0) {
    const s = ctx.createLinearGradient(0, 0, 0, v.ch);
    s.addColorStop(0, `rgba(255, 150, 90, ${0.28 * dawnK})`);
    s.addColorStop(0.6, `rgba(255, 200, 120, ${0.08 * dawnK})`);
    s.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, now: number) {
  const [w, h] = ENEMY_SIZE[e.kind];
  const frame = e.kind === 'bat' ? Math.floor((now + e.phase * 300) / 110) % 2 : 0;
  let alpha = 1;
  let y = e.y;
  if (e.kind === 'ghost') {
    alpha = 0.6 + 0.3 * Math.sin(e.age / 260 + e.phase);
    y += Math.sin(e.age / 300 + e.phase) * 2;
  } else if (e.kind === 'bat') y -= 4;
  // Aparece poco a poco al nacer
  if (e.age < 250) alpha *= e.age / 250;
  if (e.kind === 'coco') {
    const pulse = 1 + Math.sin(now / 200) * 0.03;
    drawSprite(ctx, enemySprite('coco', false, e.left), e.x, y - 10, w * pulse, h * pulse, 0, alpha);
    if (e.mode === 2) {
      // Estela al embestir
      drawSprite(ctx, enemySprite('coco', false, e.left), e.x - e.ax * 14, y - 10 - e.ay * 14, w, h, 0, 0.3);
    }
    if (e.flash > 0) drawSprite(ctx, enemySprite('coco', true, e.left), e.x, y - 10, w * pulse, h * pulse, 0, 0.6);
    if (e.mode === 1) label(ctx, '!', e.x, y - 50, { size: 18, color: '#ff2d55' });
    return;
  }
  const squash = e.kind === 'rat' ? 1 + Math.sin(e.age / 70 + e.phase) * 0.06 : 1;
  drawSprite(ctx, enemySprite(e.kind, false, e.left, frame), e.x, y, w, h * squash, 0, alpha);
  if (e.flash > 0) drawSprite(ctx, enemySprite(e.kind, true, e.left, frame), e.x, y, w, h * squash, 0, 0.85);
  if (e.kind === 'gargoyle') {
    hpBar(ctx, e.x, y - h / 2 - 3, 26, e.hp / e.max, '#ff8c1a');
  }
}

export function NightScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="night" label="Puntos de ronda" view={(p) => <NightGameView {...p} />} onClose={onClose} />;
}
