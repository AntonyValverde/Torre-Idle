import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { mulberry32 } from '../rng';
import { Fx, disc, hpBar, label, sprite } from '../shooter/fx';
import { drawSticks, moveVec, releaseInput, toScreenSpace, toWorldSpace, useInput, useStage, type View } from '../shooter/stage';
import { Banner, Hearts, HudBar, Meter, PauseCard, ShopPanel, StartCard, UpgradePick, useHud } from '../shooter/ShooterUI';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import { SEWER_META, sewerMetaCost, type SewerMetaId } from './meta';
import {
  CELL,
  DOOR_X0,
  DOOR_X1,
  FIELD_H,
  FIELD_W,
  HALLAZGOS,
  ORBIT_R,
  RX0,
  RX1,
  RY0,
  RY1,
  SWEEP_R,
  TRANS_MS,
  boss,
  enterRoom,
  fireMs,
  maxHp,
  newSewer,
  pickHallazgo,
  step,
  type Enemy,
  type EnemyKind,
  type HallazgoId,
  type RoomMap,
  type SewerGame,
} from './logic';
import './sewer.css';

const FIELD = { w: FIELD_W, h: FIELD_H };
const INTRO_MS = 5200;

type Phase = 'taller' | 'intro' | 'play' | 'paused' | 'choice' | 'over';

const summary = (g: SewerGame): WarSummary => ({
  score: g.score,
  detail: `Sala ${g.room} · ${g.kills} bajas${g.bosses ? ` · ${g.bosses} ${g.bosses === 1 ? 'jefe' : 'jefes'}` : ''} · 🔩 ${g.scrap} de chatarra`,
});

const BOSS_NAME: Partial<Record<EnemyKind, string>> = { king: 'REY RATA', gator: 'COCODRILO GIGANTE' };

// ---------------------------------------------------------------------------------------------
// Dibujos (cada uno se pinta una vez en un sprite; `col` lo vuelve blanco para el destello)
// ---------------------------------------------------------------------------------------------

type Col = (c: string) => string;
const OUT = '#140c18';

function ell(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
}

/** Contorno oscuro: se pinta la silueta algo más grande debajo (así destacan sobre el suelo). */
function outlined(c: CanvasRenderingContext2D, white: boolean, draw: (col: Col) => void) {
  c.save();
  const o = white ? '#ffffff' : OUT;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    c.save();
    c.translate(dx * 1.1, dy * 1.1);
    draw(() => o);
    c.restore();
  }
  c.restore();
  draw(white ? () => '#ffffff' : (x) => x);
}

function paintRat(king: boolean, frame: number) {
  return (c: CanvasRenderingContext2D, white: boolean) => {
    const s = king ? 1.9 : 1;
    c.scale(s, s);
    outlined(c, white, (col) => {
      // Cola rosa
      c.strokeStyle = col('#e88a9a');
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-8, 2);
      c.quadraticCurveTo(-13, -4 + frame * 3, -12.5, 4);
      c.stroke();
      // Patas
      const lp = frame ? 1.5 : -1.5;
      ell(c, -4 + lp, 6, 2, 1.4, col('#d98b98'));
      ell(c, 5 - lp, 6, 2, 1.4, col('#d98b98'));
      // Cuerpo
      ell(c, -1, 1.5, 9, 5.5, col(king ? '#7d6a5c' : '#8f7d6e'));
      ell(c, -2, -0.5, 7, 3.2, col(king ? '#6a5749' : '#776657'));
      ell(c, 0, 4, 6, 2, col('#c9b6a4'));
      // Cabeza
      ell(c, 7, 0.5, 5, 4, col(king ? '#7d6a5c' : '#8f7d6e'));
      c.fillStyle = col(king ? '#7d6a5c' : '#8f7d6e');
      c.beginPath();
      c.moveTo(9, -2.5);
      c.lineTo(14, 1.2);
      c.lineTo(9, 3.5);
      c.closePath();
      c.fill();
      ell(c, 14, 1.2, 1.3, 1.1, col('#ff8fa3'));
      // Oreja
      ell(c, 5, -3.6, 2.4, 2.6, col('#8f7d6e'));
      ell(c, 5, -3.4, 1.4, 1.6, col('#f2a3b3'));
      if (king) {
        // Capa roja y corona
        c.fillStyle = col('#c0392b');
        c.beginPath();
        c.moveTo(-9, -1);
        c.quadraticCurveTo(-2, -6, 4, -3);
        c.lineTo(1, 6);
        c.quadraticCurveTo(-6, 7, -10, 4);
        c.closePath();
        c.fill();
        c.fillStyle = col('#f2f2f2');
        c.fillRect(-9, -2, 13, 1.4);
        c.fillStyle = col('#ffc23d');
        c.beginPath();
        c.moveTo(4, -5.5);
        c.lineTo(4.5, -10);
        c.lineTo(6.2, -7.4);
        c.lineTo(7.5, -10.8);
        c.lineTo(8.8, -7.4);
        c.lineTo(10.5, -10);
        c.lineTo(10.6, -5.5);
        c.closePath();
        c.fill();
        ell(c, 7.5, -7, 0.9, 0.9, col('#ff4d6d'));
      }
    });
    if (!white) {
      ell(c, 8.8, -0.6, 1.2, 1.2, '#ffffff');
      ell(c, 9.1, -0.6, 0.7, 0.8, king ? '#d01c1c' : '#14080c');
    }
  };
}

function paintBat(frame: number) {
  return (c: CanvasRenderingContext2D, white: boolean) => {
    outlined(c, white, (col) => {
      const up = frame === 0;
      c.fillStyle = col('#5b2fa0');
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.moveTo(sx * 3, -1);
        if (up) {
          c.quadraticCurveTo(sx * 10, -11, sx * 14, -6);
          c.lineTo(sx * 11, -3);
          c.lineTo(sx * 9, 0);
          c.lineTo(sx * 6, 1);
        } else {
          c.quadraticCurveTo(sx * 10, 0, sx * 14, 6);
          c.lineTo(sx * 10, 4);
          c.lineTo(sx * 8, 6);
          c.lineTo(sx * 5, 3);
        }
        c.closePath();
        c.fill();
      }
      ell(c, 0, 0.5, 4.6, 5.2, col('#8655d6'));
      c.fillStyle = col('#8655d6');
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.moveTo(sx * 1.2, -3.5);
        c.lineTo(sx * 3.5, -7.5);
        c.lineTo(sx * 3.8, -2.5);
        c.closePath();
        c.fill();
      }
    });
    if (!white) {
      ell(c, -1.7, -0.6, 1.2, 1.1, '#ffe066');
      ell(c, 1.7, -0.6, 1.2, 1.1, '#ffe066');
      c.fillStyle = '#fff';
      c.fillRect(-1.2, 2.4, 0.8, 1.2);
      c.fillRect(0.4, 2.4, 0.8, 1.2);
    }
  };
}

function paintSlug(c: CanvasRenderingContext2D, white: boolean) {
  outlined(c, white, (col) => {
    // Antenas
    c.strokeStyle = col('#9cc23a');
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(7, -2);
    c.lineTo(9, -8);
    c.moveTo(9, -1);
    c.lineTo(12.5, -6.5);
    c.stroke();
    ell(c, 9, -8.3, 1.6, 1.6, col('#d6f070'));
    ell(c, 12.6, -6.8, 1.6, 1.6, col('#d6f070'));
    ell(c, 0, 3, 12, 4, col('#8fb52c'));
    ell(c, -1, 1, 10, 5.5, col('#b5d94a'));
    ell(c, 8, 0.5, 4.5, 4, col('#b5d94a'));
  });
  if (!white) {
    ell(c, 9.1, -8.3, 0.8, 0.8, '#1a1020');
    ell(c, 12.7, -6.8, 0.8, 0.8, '#1a1020');
    ell(c, -4, 0, 1.8, 1.2, '#7d9c25');
    ell(c, 1, -1.5, 1.4, 1, '#7d9c25');
    ell(c, -1, -2.5, 5, 1.2, 'rgba(255,255,255,0.35)');
  }
}

function paintCroc(big: boolean) {
  return (c: CanvasRenderingContext2D, white: boolean) => {
    const s = big ? 1.95 : 1;
    c.scale(s, s);
    outlined(c, white, (col) => {
      const body = big ? '#2f8a3f' : '#3fa34d';
      const dark = big ? '#1f6a2c' : '#2d7a38';
      // Cola
      c.fillStyle = col(body);
      c.beginPath();
      c.moveTo(-8, -2);
      c.quadraticCurveTo(-16, -1, -19, 3);
      c.quadraticCurveTo(-14, 3, -8, 4);
      c.closePath();
      c.fill();
      // Patas
      ell(c, -5, 5, 2.4, 1.8, col(dark));
      ell(c, 5, 5, 2.4, 1.8, col(dark));
      // Cuerpo y lomo
      ell(c, -1, 1, 10, 4.6, col(body));
      ell(c, 0, 3.4, 8, 1.8, col(big ? '#ffd166' : '#a8d58a'));
      c.fillStyle = col(dark);
      for (let i = -7; i <= 5; i += 3) {
        c.beginPath();
        c.moveTo(i, -3.2);
        c.lineTo(i + 1.5, -5.6);
        c.lineTo(i + 3, -3.2);
        c.closePath();
        c.fill();
      }
      // Morro con dientes
      c.fillStyle = col(body);
      c.beginPath();
      c.moveTo(7, -3);
      c.lineTo(19, -0.5);
      c.lineTo(19, 1.6);
      c.lineTo(7, 4);
      c.closePath();
      c.fill();
      c.fillStyle = col('#ffffff');
      for (let x = 10; x < 19; x += 2.2) {
        c.beginPath();
        c.moveTo(x, 0.4);
        c.lineTo(x + 1, 2);
        c.lineTo(x + 2, 0.4);
        c.closePath();
        c.fill();
      }
      ell(c, 8, -3.4, 2.4, 2, col(body));
    });
    if (!white) {
      ell(c, 8.2, -3.8, 1.4, 1.3, '#ffe066');
      ell(c, 8.6, -3.8, 0.5, 1.1, '#140c18');
      ell(c, 18, -0.4, 0.6, 0.5, '#140c18');
    }
  };
}

function paintShroom(c: CanvasRenderingContext2D, white: boolean) {
  outlined(c, white, (col) => {
    // Pie con cara
    c.fillStyle = col('#efe3c8');
    c.beginPath();
    c.moveTo(-5, 0);
    c.quadraticCurveTo(-6.5, 9, -4, 11);
    c.lineTo(4, 11);
    c.quadraticCurveTo(6.5, 9, 5, 0);
    c.closePath();
    c.fill();
    // Sombrero
    c.fillStyle = col('#c2367a');
    c.beginPath();
    c.moveTo(-11.5, 2);
    c.quadraticCurveTo(-12, -11, 0, -11.5);
    c.quadraticCurveTo(12, -11, 11.5, 2);
    c.quadraticCurveTo(0, 4.5, -11.5, 2);
    c.closePath();
    c.fill();
  });
  if (!white) {
    ell(c, -5, -6, 2.2, 1.8, '#f6d9ff');
    ell(c, 3.5, -8, 1.8, 1.5, '#f6d9ff');
    ell(c, 6.5, -3, 1.6, 1.3, '#f6d9ff');
    ell(c, -1, -2.5, 1.3, 1.1, '#f6d9ff');
    ell(c, -2, 0.5, 9, 1.2, 'rgba(0,0,0,0.25)');
    // Cara enfadada
    c.strokeStyle = '#2a0f1c';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-3.6, 3.6);
    c.lineTo(-1, 4.6);
    c.moveTo(3.6, 3.6);
    c.lineTo(1, 4.6);
    c.stroke();
    ell(c, -2, 5.6, 0.8, 0.9, '#2a0f1c');
    ell(c, 2, 5.6, 0.8, 0.9, '#2a0f1c');
    ell(c, 0, 8.4, 1.6, 0.7, '#2a0f1c');
  }
}

const KIND_SIZE: Record<EnemyKind, [number, number]> = {
  rat: [30, 20],
  bat: [32, 22],
  slug: [30, 22],
  croc: [42, 22],
  shroom: [28, 30],
  king: [58, 44],
  gator: [80, 40],
};

function enemySprite(kind: EnemyKind, white: boolean, frame: number) {
  const [w, h] = KIND_SIZE[kind];
  const big = kind === 'king' || kind === 'gator';
  const paint =
    kind === 'rat' || kind === 'king'
      ? paintRat(kind === 'king', frame)
      : kind === 'bat'
        ? paintBat(frame)
        : kind === 'slug'
          ? paintSlug
          : kind === 'croc' || kind === 'gator'
            ? paintCroc(kind === 'gator')
            : paintShroom;
  const f = kind === 'rat' || kind === 'king' || kind === 'bat' ? frame : 0;
  return sprite(`sw-${kind}-${f}-${white ? 'w' : 'c'}`, w, h, (c) => paint(c, white), big ? 3 : 4);
}

function paintPlayer(c: CanvasRenderingContext2D) {
  outlined(c, false, (col) => {
    // Botas
    ell(c, -3.6, 11, 3, 2.2, col('#2b5fb8'));
    ell(c, 3.6, 11, 3, 2.2, col('#2b5fb8'));
    // Chubasquero
    c.fillStyle = col('#ffc23d');
    c.beginPath();
    c.moveTo(-6, -1);
    c.quadraticCurveTo(-8.5, 8, -7, 10);
    c.lineTo(7, 10);
    c.quadraticCurveTo(8.5, 8, 6, -1);
    c.closePath();
    c.fill();
    // Cara y casco
    ell(c, 0, -4, 6, 5.4, col('#f5c39c'));
    c.fillStyle = col('#ff9f1c');
    c.beginPath();
    c.ellipse(0, -6.5, 7.2, 5.6, 0, Math.PI, 0);
    c.fill();
    c.fillRect(-8, -7, 16, 2);
  });
  c.fillStyle = '#d9971a';
  c.fillRect(-0.6, 0, 1.2, 9);
  ell(c, -2.2, -3.2, 0.9, 1.1, '#2a1a12');
  ell(c, 2.2, -3.2, 0.9, 1.1, '#2a1a12');
  ell(c, 0, -0.9, 1.4, 0.6, '#c8826a');
  // Linterna del casco
  ell(c, 0, -9, 2.6, 2.2, '#5a4a2a');
  ell(c, 0, -9, 1.8, 1.5, '#fff6c8');
  ell(c, -3.5, 3, 1, 1, '#d9971a');
  ell(c, 3.5, 3, 1, 1, '#d9971a');
}

function paintScrap(c: CanvasRenderingContext2D) {
  c.fillStyle = OUT;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.lineTo(Math.cos(a) * 5.4, Math.sin(a) * 5.4);
  }
  c.closePath();
  c.fill();
  c.fillStyle = '#b9c4cc';
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.lineTo(Math.cos(a) * 4.4, Math.sin(a) * 4.4);
  }
  c.closePath();
  c.fill();
  c.fillStyle = '#e8eef2';
  c.fillRect(-3, -3.6, 4, 1.2);
  ell(c, 0, 0, 1.8, 1.8, '#3a4048');
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

function paintShot(color: string) {
  return (c: CanvasRenderingContext2D) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 7);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 7, 0, Math.PI * 2);
    c.fill();
  };
}

function paintSpore(c: CanvasRenderingContext2D) {
  ell(c, 0, 0, 6, 6, 'rgba(20, 8, 30, 0.85)');
  const g = c.createRadialGradient(-1.2, -1.2, 0, 0, 0, 5);
  g.addColorStop(0, '#f4ffd0');
  g.addColorStop(0.45, '#a6ff4d');
  g.addColorStop(1, '#4c9a1a');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 4.8, 0, Math.PI * 2);
  c.fill();
}

function paintShadow(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, 0, 10, 10, 0, 0, Math.PI * 2);
  c.fill();
}

function paintOrb(c: CanvasRenderingContext2D) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 9);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#7ad7ff');
  g.addColorStop(1, 'rgba(60, 140, 255, 0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 9, 0, Math.PI * 2);
  c.fill();
}

// ---------------------------------------------------------------------------------------------
// La sala: suelo, paredes, cajas y agua se pintan una vez por sala en un lienzo aparte
// ---------------------------------------------------------------------------------------------

const ROOM_RES = 2;

function bricks(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: () => number) {
  c.save();
  c.beginPath();
  c.rect(x0, y0, w, h);
  c.clip();
  c.fillStyle = '#231d25';
  c.fillRect(x0, y0, w, h);
  const bh = 7;
  const bw = 16;
  for (let y = y0, row = 0; y < y0 + h; y += bh, row++) {
    for (let x = x0 - (row % 2 ? bw / 2 : 0); x < x0 + w; x += bw) {
      const t = r();
      c.fillStyle = t < 0.33 ? '#4a3c44' : t < 0.66 ? '#43363e' : '#3d3138';
      c.fillRect(x + 0.6, y + 0.6, bw - 1.2, bh - 1.2);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(x + 0.6, y + 0.6, bw - 1.2, 1);
      if (r() < 0.08) {
        c.fillStyle = 'rgba(90, 140, 70, 0.35)';
        c.fillRect(x + 1, y + bh - 2.5, bw - 2, 2);
      }
    }
  }
  c.restore();
}

function paintCrate(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.fillStyle = '#3d2412';
  c.fillRect(x, y, s, s);
  c.fillStyle = '#8a5a2b';
  c.fillRect(x + 1, y + 1, s - 2, s - 2);
  c.fillStyle = '#a8723c';
  c.fillRect(x + 1, y + 1, s - 2, 3);
  c.strokeStyle = '#5e3a18';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(x + 3, y + 5);
  c.lineTo(x + s - 3, y + s - 3);
  c.moveTo(x + s - 3, y + 5);
  c.lineTo(x + 3, y + s - 3);
  c.stroke();
  c.strokeStyle = '#4a2e14';
  c.strokeRect(x + 2.5, y + 4.5, s - 5, s - 7);
  c.fillStyle = '#c9c2b5';
  for (const [px, py] of [
    [x + 3, y + 6],
    [x + s - 4, y + 6],
    [x + 3, y + s - 4],
    [x + s - 4, y + s - 4],
  ])
    c.fillRect(px, py, 1, 1);
}

function paintRoom(cv: HTMLCanvasElement, map: RoomMap) {
  cv.width = FIELD_W * ROOM_RES;
  cv.height = FIELD_H * ROOM_RES;
  const c = cv.getContext('2d');
  if (!c) return;
  c.setTransform(ROOM_RES, 0, 0, ROOM_RES, 0, 0);
  const r = mulberry32(map.seed);
  const boss = !!map.boss;

  // Techo con la tubería grande
  c.fillStyle = '#0d0c12';
  c.fillRect(0, 0, FIELD_W, 32);
  const pipe = c.createLinearGradient(0, 8, 0, 24);
  pipe.addColorStop(0, '#6b7783');
  pipe.addColorStop(0.45, '#4a5560');
  pipe.addColorStop(1, '#2a3038');
  c.fillStyle = pipe;
  c.fillRect(0, 9, FIELD_W, 14);
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(0, 11, FIELD_W, 2);
  for (let x = 20; x < FIELD_W; x += 70) {
    c.fillStyle = '#353c45';
    c.fillRect(x, 7, 8, 18);
    c.fillStyle = '#7d8893';
    c.fillRect(x + 1, 9, 1.5, 1.5);
    c.fillRect(x + 5.5, 21, 1.5, 1.5);
  }

  // Paredes de ladrillo
  bricks(c, 0, 32, FIELD_W, RY0 - 32, r);
  bricks(c, 0, RY0, RX0, RY1 - RY0, r);
  bricks(c, RX1, RY0, FIELD_W - RX1, RY1 - RY0, r);
  bricks(c, 0, RY1, FIELD_W, FIELD_H - RY1, r);
  // Remate del muro de arriba (da profundidad)
  c.fillStyle = '#17121a';
  c.fillRect(0, RY0 - 4, FIELD_W, 4);
  // Babas verdes que chorrean del muro
  for (let i = 0; i < 5; i++) {
    const x = RX0 + r() * (RX1 - RX0);
    if (x > DOOR_X0 - 14 && x < DOOR_X1 + 14) continue;
    c.fillStyle = 'rgba(120, 190, 70, 0.4)';
    c.fillRect(x, RY0 - 12, 3, 10 + r() * 6);
  }

  // Suelo de losas (una por casilla)
  for (let row = 0; row < (RY1 - RY0) / CELL; row++) {
    for (let col = 0; col < (RX1 - RX0) / CELL; col++) {
      const x = RX0 + col * CELL;
      const y = RY0 + row * CELL;
      const t = r();
      c.fillStyle = boss ? (t < 0.5 ? '#2e2a36' : '#2a2632') : t < 0.33 ? '#2b3a3c' : t < 0.66 ? '#283638' : '#2e3e40';
      c.fillRect(x, y, CELL, CELL);
      c.fillStyle = 'rgba(255,255,255,0.035)';
      c.fillRect(x + 1, y + 1, CELL - 2, 1);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(x, y + CELL - 1, CELL, 1);
      c.fillRect(x + CELL - 1, y, 1, CELL);
      if (r() < 0.12) {
        // Grieta
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        c.lineWidth = 0.6;
        c.beginPath();
        c.moveTo(x + r() * CELL, y + r() * CELL);
        c.lineTo(x + r() * CELL, y + r() * CELL);
        c.lineTo(x + r() * CELL, y + r() * CELL);
        c.stroke();
      }
      if (r() < 0.07) ell(c, x + r() * CELL, y + r() * CELL, 3 + r() * 4, 2 + r() * 2, 'rgba(70, 120, 60, 0.35)');
    }
  }
  if (boss) {
    // Alfombra del trono
    c.fillStyle = 'rgba(140, 30, 50, 0.35)';
    c.fillRect(FIELD_W / 2 - 30, RY0, 60, RY1 - RY0);
    c.fillStyle = 'rgba(255, 194, 61, 0.25)';
    c.fillRect(FIELD_W / 2 - 30, RY0, 2, RY1 - RY0);
    c.fillRect(FIELD_W / 2 + 28, RY0, 2, RY1 - RY0);
  }

  // Charcos
  for (const p of map.puddles) {
    ell(c, p.x, p.y, p.rx, p.ry, 'rgba(30, 80, 95, 0.55)');
    ell(c, p.x - p.rx * 0.3, p.y - p.ry * 0.3, p.rx * 0.45, p.ry * 0.25, 'rgba(160, 220, 235, 0.18)');
  }

  // Canales de agua
  for (const w of map.water) {
    const g = c.createLinearGradient(0, w.y, 0, w.y + w.h);
    g.addColorStop(0, '#0f3540');
    g.addColorStop(0.5, '#185066');
    g.addColorStop(1, '#0f3540');
    c.fillStyle = g;
    c.fillRect(w.x, w.y, w.w, w.h);
    c.fillStyle = '#4b5a5e';
    c.fillRect(w.x, w.y - 2, w.w, 2.5);
    c.fillRect(w.x, w.y + w.h - 0.5, w.w, 2.5);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(w.x, w.y - 2, w.w, 0.8);
  }

  // Rejillas
  for (const p of map.grates) {
    c.fillStyle = '#121016';
    c.fillRect(p.x - 8, p.y - 8, 16, 16);
    c.fillStyle = '#4c5560';
    c.fillRect(p.x - 9, p.y - 9, 18, 2);
    c.fillRect(p.x - 9, p.y + 7, 18, 2);
    c.fillRect(p.x - 9, p.y - 9, 2, 18);
    c.fillRect(p.x + 7, p.y - 9, 2, 18);
    for (let i = -4; i <= 4; i += 4) c.fillRect(p.x + i - 0.75, p.y - 7, 1.5, 14);
  }

  // Sombra de las paredes sobre el suelo
  const sh = (x: number, y: number, w: number, h: number, x1: number, y1: number, x2: number, y2: number) => {
    const g = c.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  };
  sh(RX0, RY0, RX1 - RX0, 16, 0, RY0, 0, RY0 + 16);
  sh(RX0, RY0, 10, RY1 - RY0, RX0, 0, RX0 + 10, 0);
  sh(RX1 - 10, RY0, 10, RY1 - RY0, RX1, 0, RX1 - 10, 0);

  // Cajas (con su sombra)
  for (const b of map.crates) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(b.x + 3, b.y + 4, b.w, b.h);
  }
  for (const b of map.crates) for (let y = b.y; y < b.y + b.h; y += CELL) for (let x = b.x; x < b.x + b.w; x += CELL) paintCrate(c, x, y, CELL);

  // Puerta de arriba: túnel oscuro (los barrotes se pintan en vivo)
  const t = c.createLinearGradient(0, 32, 0, RY0);
  t.addColorStop(0, '#000000');
  t.addColorStop(1, '#101418');
  c.fillStyle = t;
  c.fillRect(DOOR_X0, 34, DOOR_X1 - DOOR_X0, RY0 - 34);
  c.fillStyle = '#5a5f66';
  c.fillRect(DOOR_X0 - 5, 30, 5, RY0 - 30);
  c.fillRect(DOOR_X1, 30, 5, RY0 - 30);
  c.fillRect(DOOR_X0 - 5, 28, DOOR_X1 - DOOR_X0 + 10, 5);
  c.fillStyle = 'rgba(255,255,255,0.15)';
  c.fillRect(DOOR_X0 - 5, 28, DOOR_X1 - DOOR_X0 + 10, 1);
  // Entrada de abajo (por donde llegas), con rejilla
  c.fillStyle = '#07080b';
  c.fillRect(DOOR_X0, RY1, DOOR_X1 - DOOR_X0, FIELD_H - RY1);
  c.fillStyle = '#3e444b';
  for (let x = DOOR_X0 + 4; x < DOOR_X1; x += 8) c.fillRect(x, RY1 + 2, 2, FIELD_H - RY1 - 2);
  c.fillRect(DOOR_X0, RY1 + 1, DOOR_X1 - DOOR_X0, 2);
}

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------

const KILL_COLORS: Record<EnemyKind, string[]> = {
  rat: ['#8f7d6e', '#ff8fa3', '#ffffff'],
  bat: ['#8655d6', '#ffe066', '#ffffff'],
  slug: ['#b5d94a', '#e6ff8a', '#ffffff'],
  croc: ['#3fa34d', '#a8d58a', '#ffffff'],
  shroom: ['#c2367a', '#a6ff4d', '#ffffff'],
  king: ['#ffc23d', '#c0392b', '#8f7d6e', '#ffffff'],
  gator: ['#2f8a3f', '#ffd166', '#ffffff'],
};

interface Snd {
  shot: number;
  hit: number;
  kill: number;
  warn: number;
  spore: number;
  scrap: number;
  scrapN: number;
}

export function SewerGameView({ onOver, onScore }: WarViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<SewerGame>(null as unknown as SewerGame);
  if (!game.current) game.current = newSewer(Math.random, useGame.getState().s.sewerLv);
  const fx = useRef(new Fx());
  const [phase, setPhaseState] = useState<Phase>('taller');
  const phaseRef = useRef<Phase>('taller');
  const introEnd = useRef(0);
  const [introLeft, setIntroLeft] = useState(INTRO_MS);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'boss'; id: number } | null>(null);
  const scrapTotal = useGame((st) => st.s.sewerScrap);
  const metaLv = useGame((st) => st.s.sewerLv);
  const banked = useRef(0);
  const timers = useRef<number[]>([]);
  const clock = useRef(0);
  const roomCv = useRef<HTMLCanvasElement | null>(null);
  const roomSeed = useRef(-1);
  const snd = useRef<Snd>({ shot: 0, hit: 0, kill: 0, warn: 0, spore: 0, scrap: 0, scrapN: 0 });
  const scrapPop = useRef({ n: 0, at: 0 });
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  const input = useInput(canvas, 'stick');
  const [hud, pushHud] = useHud({ score: 0, room: 1, scrap: 0, hp: 3, max: 3, revive: 0, finds: '', boss: -1, bossKind: '' });

  // Solo en desarrollo: acceso a la partida para capturas y pruebas a mano
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __sewer?: unknown };
    w.__sewer = {
      game: () => game.current,
      scrap: (n: number) => useGame.getState().addSewerScrap(n),
      goto: (n: number) => {
        enterRoom(game.current, n, Math.random);
        game.current.y = RY1 - 26;
      },
    };
    return () => {
      delete w.__sewer;
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  /** Pasa a la cuenta la chatarra recogida que aún no se había guardado. */
  const bank = useCallback(() => {
    const g = game.current;
    const n = g.scrap - banked.current;
    if (n > 0) {
      useGame.getState().addSewerScrap(n);
      banked.current = g.scrap;
    }
  }, []);

  // Al salir (✕ o cambio de pantalla) se guarda lo pendiente y se paran los temporizadores
  useEffect(
    () => () => {
      bank();
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    },
    [bank],
  );

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      if (p !== 'play') releaseInput(input.current);
    },
    [input],
  );

  const say = useCallback((text: string, tone: 'good' | 'bad' | 'boss' = 'good') => setBanner({ text, tone, id: performance.now() }), []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [banner]);

  const start = useCallback(() => {
    if (phaseRef.current !== 'intro') return;
    setPhase('play');
    const g = game.current;
    if (g.packed) {
      const d = HALLAZGOS.find((h) => h.id === g.packed);
      if (d) say(`🎒 Mochila: ${d.emoji} ${d.name}`);
    } else say('Sala 1');
  }, [setPhase, say]);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'play') return;
    bank();
    setPhase('paused');
  }, [setPhase, bank]);

  // Escape o P también pausan en el ordenador
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

  const descend = () => {
    // Partida nueva con las mejoras del taller recién compradas
    game.current = newSewer(Math.random, useGame.getState().s.sewerLv);
    banked.current = 0;
    fx.current = new Fx();
    introEnd.current = performance.now() + INTRO_MS;
    setIntroLeft(INTRO_MS);
    setPhase('intro');
    tone(180, 0.35, 'sine', 0.05);
  };

  const onStep = (dt: number) => {
    const g = game.current;
    const inp = input.current;
    const k = moveVec(inp);
    const prevScore = g.score;
    const prevScrap = g.scrap;
    const ev = step(g, dt, k, Math.random);
    const f = fx.current;
    const now = performance.now();
    const s = snd.current;

    if (ev.shots && now - s.shot > 85) {
      s.shot = now;
      tone(760 + Math.random() * 120, 0.03, 'square', 0.014);
    }
    for (const h of ev.hits) {
      f.burst(h.x, h.y, { n: 3, colors: h.burn ? ['#ff9a3c', '#ffe066'] : h.ice ? ['#bdf0ff', '#ffffff'] : ['#ffffff', '#ffe066'], speed: 70, life: 200, size: 1.4, shape: 'spark' });
    }
    if (ev.hits.length && now - s.hit > 60) {
      s.hit = now;
      tone(260 + Math.random() * 60, 0.03, 'triangle', 0.02);
    }
    for (const p of ev.puffs) f.burst(p.x, p.y, { n: 4, colors: p.mine ? ['#ffe066', '#8a5a2b'] : ['#a6ff4d', '#4c9a1a'], speed: 50, life: 220, size: 1.3 });
    for (const e of ev.emerged) {
      f.burst(e.x, e.y + 4, { n: 10, colors: ['#7fd0e6', '#ffffff', '#2b6a7a'], speed: 70, life: 380, size: 1.6, gravity: 160 });
      f.ring(e.x, e.y + 4, '#9fe3f2', 16, 320);
    }
    for (const kp of ev.kills) {
      const big = kp.kind === 'king' || kp.kind === 'gator';
      f.burst(kp.x, kp.y, { n: big ? 70 : 16, colors: KILL_COLORS[kp.kind], speed: big ? 200 : 110, life: big ? 800 : 450, size: big ? 3 : 2.2 });
      f.ring(kp.x, kp.y, '#ffe9a8', big ? 90 : 20, big ? 520 : 300);
      f.text(kp.x, kp.y - 10, `+${kp.pts}`, '#ffe066', big ? 14 : 9);
      if (big) {
        f.shake(9, 650);
        f.flash('#ffffff', 220);
        tone(70, 0.7, 'sawtooth', 0.08);
        vibrate([40, 30, 90]);
      } else if (now - s.kill > 50) {
        s.kill = now;
        tone(480 + Math.random() * 160, 0.06, 'triangle', 0.04);
      }
    }
    if (ev.scrap) {
      const c = s;
      c.scrapN = now < c.scrap ? Math.min(c.scrapN + 1, 14) : 0;
      c.scrap = now + 420;
      tone(1050 * 2 ** (c.scrapN / 12), 0.035, 'sine', 0.025);
      const sp = scrapPop.current;
      sp.n = now - sp.at < 500 ? sp.n + ev.scrap : ev.scrap;
      sp.at = now;
    }
    if (ev.heal) {
      sfx('buy');
      f.text(g.x, g.y - 24, '+1 ❤️', '#ff8a9a', 11, 1000);
    }
    if (ev.warn && now - s.warn > 120) {
      s.warn = now;
      tone(330, 0.08, 'square', 0.03);
    }
    if (ev.spores && now - s.spore > 150) {
      s.spore = now;
      tone(190, 0.08, 'sine', 0.04);
    }
    for (const sl of ev.slams) {
      f.shake(sl.big ? 7 : 3.5, sl.big ? 380 : 200);
      f.burst(sl.x, sl.y, { n: sl.big ? 22 : 10, colors: ['#c9c2b5', '#8a8f96', '#ffffff'], speed: sl.big ? 140 : 90, life: 420, size: 2 });
      tone(sl.big ? 65 : 95, 0.22, 'sawtooth', 0.06);
      if (sl.big) vibrate(30);
    }
    if (ev.sweep) {
      f.ring(ev.sweep.x, ev.sweep.y, '#ff6b6b', SWEEP_R + 10, 420);
      f.burst(ev.sweep.x, ev.sweep.y, { n: 24, colors: ['#7fd0e6', '#ffffff'], speed: 170, life: 420, size: 2 });
      f.shake(5, 300);
      tone(120, 0.25, 'sawtooth', 0.06);
    }
    for (const p of ev.summon) {
      f.ring(p.x, p.y, '#c78bff', 22, 420);
      f.burst(p.x, p.y, { n: 8, colors: ['#7fd0e6', '#ffffff'], speed: 60, life: 340, size: 1.6 });
    }
    if (ev.summon.length) tone(520, 0.12, 'triangle', 0.04);
    if (ev.hurt) {
      f.flash('#ff2d55', 260);
      f.shake(6, 320);
      f.burst(g.x, g.y, { n: 20, colors: ['#ff4d6d', '#ffffff', '#ffc23d'], speed: 130 });
      tone(110, 0.3, 'sawtooth', 0.07);
      vibrate([60, 40, 60]);
    }
    if (ev.revive) {
      f.flash('#ffffff', 420);
      f.ring(g.x, g.y, '#ffe066', 120, 700);
      f.ring(g.x, g.y, '#ffffff', 80, 500);
      f.burst(g.x, g.y, { n: 40, colors: ['#ffe066', '#ffffff', '#bdf0ff'], speed: 200, life: 700, size: 2.4, shape: 'spark' });
      say('🪽 ¡Segunda oportunidad!', 'good');
      sfx('win');
      vibrate([30, 40, 30, 40, 80]);
    }
    if (ev.roomClear) {
      say(ev.bossDown ? '👑 ¡Jefe derrotado!' : `✅ ¡Sala ${g.room} limpia!`, ev.bossDown ? 'boss' : 'good');
      tone(660, 0.1, 'triangle', 0.05);
      later(() => tone(990, 0.12, 'triangle', 0.05), 110);
    }
    if (ev.choice) {
      bank();
      sfx('crit');
      setPhase('choice');
    }
    if (ev.door) {
      bank();
      tone(220, 0.4, 'sine', 0.05);
    }
    if (ev.roomStart) {
      const bk = g.map.boss;
      if (bk) {
        say(bk === 'king' ? '👑 ¡El Rey Rata!' : '🐊 ¡Cocodrilo gigante!', 'boss');
        tone(80, 0.8, 'sawtooth', 0.06);
        vibrate([30, 60, 30]);
      } else say(`Sala ${ev.roomStart}`);
    }
    if (g.score !== prevScore || g.scrap !== prevScrap) cb.current.onScore(summary(g));
    if (ev.lost) {
      bank();
      f.shake(10, 700);
      f.burst(g.x, g.y, { n: 60, colors: ['#ffc23d', '#ff9f1c', '#ffffff', '#2b5fb8'], speed: 200, life: 900, size: 3 });
      tone(70, 0.8, 'sawtooth', 0.08);
      vibrate([80, 50, 160]);
      say('💀 ¡Te atraparon!', 'bad');
      setPhase('over');
      later(() => cb.current.onOver(summary(g)), 1600);
    }
  };

  const onDraw = (ctx: CanvasRenderingContext2D, v: View, frame: number) => {
    const g = game.current;
    const ph = phaseRef.current;
    const live = ph === 'play' || ph === 'over' || ph === 'intro' || ph === 'taller';
    if (live) {
      fx.current.update(frame);
      clock.current += frame;
    }
    if (ph === 'intro') {
      const left = Math.max(0, introEnd.current - performance.now());
      setIntroLeft(Math.ceil(left / 100) * 100);
      if (left <= 0) start();
    }
    if (roomSeed.current !== g.map.seed || !roomCv.current) {
      roomCv.current ??= document.createElement('canvas');
      paintRoom(roomCv.current, g.map);
      roomSeed.current = g.map.seed;
    }
    drawWorld(ctx, v, g, fx.current, roomCv.current, clock.current, ph);
    // Pop de chatarra acumulada sobre ti
    const sp = scrapPop.current;
    if (sp.n && performance.now() - sp.at > 260) {
      fx.current.text(g.x, g.y - 22, `+${sp.n} 🔩`, '#dfe7ee', 9, 700);
      sp.n = 0;
    }
    fx.current.drawFlash(ctx, v);
    if (ph === 'play' || ph === 'intro') {
      // Pista del joystick por encima de donde empiezas (no te tapa)
      const gy = Math.min(v.ch - 120, v.oy + (RY1 - 130) * v.scale);
      drawSticks(ctx, v, input.current, [{ x: v.cw / 2, y: gy }]);
      if (!input.current.touched) label(ctx, 'Arrastra para moverte', v.cw / 2, gy + 64, { size: 13, color: '#ffffff', alpha: 0.75 });
    }
    const b = boss(g);
    const finds = HALLAZGOS.filter((h) => h.id !== 'heal' && (g.lv[h.id] ?? 0) > 0)
      .map((h) => `${h.id}:${g.lv[h.id]}`)
      .join(',');
    pushHud({
      score: g.score,
      room: g.room,
      scrap: g.scrap,
      hp: g.hp,
      max: maxHp(g),
      revive: g.meta.revive > 0 ? (g.reviveLeft ? 1 : 2) : 0,
      finds,
      boss: b && b.emerge <= 0 ? b.hp / b.max : -1,
      bossKind: b ? b.kind : '',
    });
  };

  useStage(canvas, FIELD, {
    step: onStep,
    draw: onDraw,
    running: () => phaseRef.current === 'play',
    onHidden: pause,
  });

  const g = game.current;
  const findList = hud.finds
    ? hud.finds.split(',').map((x) => {
        const [id, lv] = x.split(':');
        return { d: HALLAZGOS.find((h) => h.id === id)!, lv: Number(lv) };
      })
    : [];

  return (
    <div className="sh-wrap sw-wrap">
      <canvas ref={canvas} className="sh-canvas" role="img" aria-label={`Alcantarillas, sala ${hud.room}. ${hud.hp} vidas.`} />
      {phase !== 'taller' && (
        <HudBar
          items={[
            { icon: '🏆', value: hud.score, label: 'Puntos' },
            { icon: '🚪', value: hud.room, label: 'Sala' },
            { icon: '🔩', value: hud.scrap, label: 'Chatarra' },
          ]}
          onPause={phase === 'play' ? pause : undefined}
        >
          <div className="sh-hud-row sw-row">
            <Hearts hp={hud.hp} max={hud.max} />
            {hud.revive > 0 && (
              <span className={`sw-revive${hud.revive === 2 ? ' used' : ''}`} aria-label={hud.revive === 1 ? 'Segunda oportunidad lista' : 'Segunda oportunidad gastada'}>
                🪽
              </span>
            )}
            {findList.length > 0 && (
              <span className="sw-finds" aria-label={`Hallazgos: ${findList.map((f) => f.d.name).join(', ')}`}>
                {findList.map((f) => (
                  <i key={f.d.id} aria-hidden="true">
                    {f.d.emoji}
                    {f.lv > 1 && <small>{f.lv}</small>}
                  </i>
                ))}
              </span>
            )}
          </div>
          {hud.boss >= 0 && <Meter value={hud.boss} max={1} color="linear-gradient(90deg, #c0392b, #ff8a3d)" label="Vida del jefe" text={BOSS_NAME[hud.bossKind as EnemyKind] ?? 'JEFE'} />}
        </HudBar>
      )}
      {banner && <Banner key={banner.id} text={banner.text} tone={banner.tone} />}
      {phase === 'taller' && (
        <ShopPanel
          title="🔧 Taller"
          subtitle="Mejoras para siempre: se quedan aunque caigas. La chatarra 🔩 se gana en cada bajada."
          money={scrapTotal}
          moneyIcon="🔩"
          items={SEWER_META.map((d) => ({
            id: d.id,
            emoji: d.emoji,
            name: d.name,
            desc: d.desc,
            level: metaLv[d.id],
            max: d.costs.length,
            cost: sewerMetaCost(metaLv, d.id),
          }))}
          onBuy={(id) => {
            if (!useGame.getState().buySewerMeta(id as SewerMetaId)) sfx('error');
          }}
          doneText="⬇️ Bajar a las alcantarillas"
          onDone={descend}
        />
      )}
      {phase === 'intro' && (
        <StartCard
          title="🐀 Alcantarillas"
          left={introLeft}
          total={INTRO_MS}
          onSkip={start}
          lines={[
            { icon: '🕹️', text: 'Arrastra en cualquier parte para moverte (o WASD / flechas).' },
            { icon: '🎯', text: 'Quieto, disparas solo al enemigo más cercano. Moviéndote no disparas: ¡esquiva y para!' },
            { icon: '🚪', text: 'Limpia la sala, elige un hallazgo y sube por la puerta. Cada 5 salas, un jefe.' },
            { icon: '🔩', text: 'La chatarra se guarda aunque caigas: gástala en el taller.' },
          ]}
        />
      )}
      {phase === 'paused' && (
        <PauseCard onResume={() => setPhase('play')}>
          <p className="sh-sub">
            Sala {g.room} · {g.score} puntos · 🔩 {g.scrap}
          </p>
          <p className="sh-sub">La chatarra que llevas ya está a salvo.</p>
        </PauseCard>
      )}
      {phase === 'choice' && (
        <UpgradePick<HallazgoId>
          title={g.map.boss ? '👑 ¡Jefe derrotado!' : `🎁 ¡Sala ${g.room} limpia!`}
          subtitle="Elige un hallazgo para esta bajada"
          choices={g.offer}
          levels={g.lv}
          onPick={(d) => {
            if (!pickHallazgo(g, d.id)) return;
            say('🚪 ¡Sube por la puerta!');
            later(() => tone(880, 0.1, 'triangle', 0.04), 0);
            setPhase('play');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Dibujo del mundo
// ---------------------------------------------------------------------------------------------

function drawFlip(ctx: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, y: number, w: number, h: number, flip: boolean, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else ctx.drawImage(spr, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 1;
}

/** Lista reutilizada para ordenar por altura (lo de más abajo se pinta delante). */
const order: (Enemy | null)[] = [];

function drawWorld(ctx: CanvasRenderingContext2D, v: View, g: SewerGame, f: Fx, room: HTMLCanvasElement, clock: number, ph: Phase) {
  toScreenSpace(ctx, v);
  ctx.fillStyle = '#06060a';
  ctx.fillRect(0, 0, v.cw, v.ch);
  toWorldSpace(ctx, v);
  const sh = f.offset();
  ctx.translate(sh.x, sh.y);
  const t = clock;

  ctx.drawImage(room, 0, 0, FIELD_W, FIELD_H);

  // Agua que corre por los canales
  ctx.fillStyle = 'rgba(170, 225, 240, 0.22)';
  for (const w of g.map.water) {
    for (let i = 0; i < 9; i++) {
      const x = w.x + ((i * 47 + t * 0.03) % w.w);
      const y = w.y + 5 + ((i * 13) % (w.h - 10));
      ctx.fillRect(x, y, 10 + (i % 3) * 4, 1);
    }
  }

  // Gotas que caen del techo
  const dr = mulberry32(g.map.seed);
  for (let i = 0; i < 3; i++) {
    const x = RX0 + 20 + dr() * (RX1 - RX0 - 40);
    const period = 1600 + dr() * 1200;
    const fall = 30 + dr() * 50;
    const k = ((t + dr() * period) % period) / period;
    if (k < 0.5) disc(ctx, x, RY0 - 2 + fall * (k / 0.5) ** 2, 1.2, 'rgba(170, 225, 240, 0.7)');
    else {
      ctx.strokeStyle = `rgba(170, 225, 240, ${0.5 * (1 - (k - 0.5) * 2)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(x, RY0 - 2 + fall, 2 + 8 * (k - 0.5), 1 + 3 * (k - 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawDoor(ctx, g, t);

  // Babas de las babosas
  for (const sl of g.slime) {
    const a = Math.min(1, sl.life / 900);
    ctx.globalAlpha = 0.45 * a;
    ctx.fillStyle = '#9bd84a';
    ctx.beginPath();
    ctx.ellipse(sl.x, sl.y, sl.r, sl.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Chatarra y corazones
  const scrapSpr = sprite('sw-scrap', 12, 12, paintScrap);
  for (const p of g.pickups) {
    if (p.kind === 'scrap') ctx.drawImage(scrapSpr, p.x - 5.5, p.y - 5.5 + Math.sin(t / 200 + p.x) * 1.2, 11, 11);
    else {
      const s = 1 + Math.sin(t / 150) * 0.1;
      ctx.drawImage(sprite('sw-heart', 20, 16, paintHeart), p.x - 10 * s, p.y - 8 * s, 20 * s, 16 * s);
    }
  }

  // Avisos en el suelo: embestidas, barridos y salidas del agua
  for (const e of g.enemies) {
    if (e.emerge > 0) {
      const k = 1 - Math.min(1, e.emerge / 700);
      ctx.strokeStyle = `rgba(160, 225, 240, ${0.3 + 0.4 * k})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 4, e.r * (0.6 + k * 0.7), e.r * (0.3 + k * 0.35), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(20, 60, 75, ${0.5 * k})`;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 4, e.r * (0.6 + k * 0.7), e.r * (0.3 + k * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (e.state === 'warn' && e.kind !== 'shroom') drawLane(ctx, e, t);
    if (e.state === 'cast' && e.cast === 'sweep') {
      const k = 1 - e.st / e.stMax;
      ctx.fillStyle = `rgba(255, 50, 60, ${0.12 + 0.18 * k})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, SWEEP_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 70, 70, 0.35)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, SWEEP_R * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 90, 90, ${0.6 + 0.4 * Math.sin(t / 50)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, SWEEP_R, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.state === 'cast' && e.cast === 'summon') {
      const k = 1 - e.st / e.stMax;
      for (const p of g.map.grates) {
        ctx.strokeStyle = `rgba(199, 139, 255, ${0.3 + 0.5 * k})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + 10 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Sombras
  const shadow = sprite('sw-shadow', 20, 20, paintShadow);
  for (const e of g.enemies) {
    if (e.emerge > 0) continue;
    const [w] = KIND_SIZE[e.kind];
    const fly = e.kind === 'bat';
    ctx.drawImage(shadow, e.x - w * 0.4, e.y + (fly ? 12 : e.r * 0.55) - w * 0.12, w * 0.8, w * 0.24);
  }
  const showPlayer = ph !== 'over';
  if (showPlayer) ctx.drawImage(shadow, g.x - 10, g.y + 9, 20, 6);

  // Enemigos y tú, ordenados por altura
  order.length = 0;
  for (const e of g.enemies) if (e.emerge <= 0) order.push(e);
  if (showPlayer) order.push(null);
  order.sort((a, b) => (a ? a.y : g.y) - (b ? b.y : g.y));
  for (const e of order) {
    if (e) drawEnemy(ctx, e, t, f);
    else drawPlayer(ctx, g, t);
  }

  // Balas propias (brillo aditivo)
  ctx.globalCompositeOperation = 'lighter';
  const fire = (g.lv.fire ?? 0) > 0;
  const ice = (g.lv.ice ?? 0) > 0;
  const shotSpr = sprite(`sw-shot-${fire ? 'f' : ice ? 'i' : 'n'}`, 14, 14, paintShot(fire ? '#ff8a3d' : ice ? '#7ad7ff' : '#ffd23d'));
  for (const s of g.shots) ctx.drawImage(shotSpr, s.x - 7, s.y - 7, 14, 14);
  // Escudo orbital
  const orbs = g.lv.orbit ?? 0;
  if (orbs && showPlayer) {
    const orb = sprite('sw-orb', 18, 18, paintOrb);
    for (let i = 0; i < orbs; i++) {
      const a = g.orbA + (i / orbs) * Math.PI * 2;
      ctx.drawImage(orb, g.x + Math.cos(a) * ORBIT_R - 9, g.y + Math.sin(a) * ORBIT_R - 9, 18, 18);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Esporas encima de todo (son lo que hay que esquivar)
  const sporeSpr = sprite('sw-spore', 12, 12, paintSpore);
  for (const b of g.spores) {
    const s = b.r * 2.4;
    ctx.drawImage(sporeSpr, b.x - s / 2, b.y - s / 2, s, s);
  }

  // Punto de mira
  if ((ph === 'play' || ph === 'paused') && g.target && !g.open && g.trans === 0) {
    const e = g.enemies.find((x) => x.id === g.target);
    if (e) drawAim(ctx, g, e, t);
  }

  f.draw(ctx);

  // Luz de la linterna: el resto de la alcantarilla queda en penumbra
  toScreenSpace(ctx, v);
  const px = v.ox + (g.x + sh.x) * v.scale;
  const py = v.oy + (g.y + sh.y) * v.scale;
  const light = ctx.createRadialGradient(px, py, 70 * v.scale, px, py, 430 * v.scale);
  light.addColorStop(0, 'rgba(4, 4, 10, 0)');
  light.addColorStop(1, 'rgba(4, 4, 10, 0.55)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, v.cw, v.ch);

  // Una sola vida: viñeta roja que late
  if (g.hp === 1 && ph === 'play') {
    const a = 0.22 + 0.12 * Math.sin(t / 250);
    const r = ctx.createRadialGradient(v.cw / 2, v.ch / 2, Math.min(v.cw, v.ch) * 0.35, v.cw / 2, v.ch / 2, Math.max(v.cw, v.ch) * 0.75);
    r.addColorStop(0, 'rgba(255, 30, 60, 0)');
    r.addColorStop(1, `rgba(255, 30, 60, ${a})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, v.cw, v.ch);
  }

  // Fundido al cruzar la puerta
  if (g.trans > 0) {
    const half = TRANS_MS / 2;
    ctx.globalAlpha = Math.max(0, 1 - Math.abs(g.trans - half) / half);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, v.cw, v.ch);
    ctx.globalAlpha = 1;
  }
}

function drawDoor(ctx: CanvasRenderingContext2D, g: SewerGame, t: number) {
  const w = DOOR_X1 - DOOR_X0;
  const lift = g.open ? Math.min(1, g.openT / 450) : 0;
  // Luz verde que sale del túnel cuando está abierta
  if (g.open) {
    const glow = ctx.createRadialGradient(FIELD_W / 2, RY0, 4, FIELD_W / 2, RY0, 90);
    glow.addColorStop(0, `rgba(110, 255, 160, ${0.28 + 0.1 * Math.sin(t / 220)})`);
    glow.addColorStop(1, 'rgba(110, 255, 160, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(FIELD_W / 2 - 90, RY0 - 40, 180, 130);
    // Flechas hacia arriba
    for (let i = 0; i < 3; i++) {
      const k = ((t / 700 + i / 3) % 1 + 1) % 1;
      const y = RY0 + 24 - k * 46;
      ctx.strokeStyle = `rgba(160, 255, 190, ${Math.sin(k * Math.PI) * 0.9})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(FIELD_W / 2 - 8, y + 6);
      ctx.lineTo(FIELD_W / 2, y);
      ctx.lineTo(FIELD_W / 2 + 8, y + 6);
      ctx.stroke();
    }
  }
  // Barrotes (suben al abrirse)
  if (lift < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(DOOR_X0, 33, w, RY0 - 33);
    ctx.clip();
    const off = -lift * (RY0 - 33);
    ctx.fillStyle = '#3b4148';
    ctx.fillRect(DOOR_X0, 33 + off + (RY0 - 33) - 5, w, 4);
    ctx.fillRect(DOOR_X0, 33 + off + 8, w, 3);
    for (let x = DOOR_X0 + 4; x < DOOR_X1 - 2; x += 8) {
      ctx.fillStyle = '#59616a';
      ctx.fillRect(x, 33 + off, 3, RY0 - 33);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, 33 + off, 1, RY0 - 33);
    }
    ctx.restore();
  }
  // Farol encima de la puerta: rojo cerrado, verde abierto
  const on = g.open;
  const lampY = 22;
  const glow = ctx.createRadialGradient(FIELD_W / 2, lampY, 1, FIELD_W / 2, lampY, 16);
  glow.addColorStop(0, on ? 'rgba(110,255,160,0.8)' : 'rgba(255,70,70,0.7)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(FIELD_W / 2 - 16, lampY - 16, 32, 32);
  disc(ctx, FIELD_W / 2, lampY, 3.2, on ? '#8dffb0' : '#ff5a5f');
  disc(ctx, FIELD_W / 2 - 0.8, lampY - 0.8, 1, '#ffffff');
}

/** Carril rojo de la embestida: primero sigue tu posición y en el último momento se fija. */
function drawLane(ctx: CanvasRenderingContext2D, e: Enemy, t: number) {
  const k = 1 - e.st / e.stMax;
  const locked = e.st <= 320;
  const len = e.kind === 'croc' ? 230 : 560;
  const wdt = e.r * 1.7;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(Math.atan2(e.dy, e.dx));
  ctx.fillStyle = locked ? `rgba(255, 50, 60, ${0.3 + 0.15 * Math.sin(t / 40)})` : `rgba(255, 60, 70, ${0.12 + 0.12 * k})`;
  ctx.fillRect(0, -wdt / 2, len, wdt);
  ctx.fillStyle = 'rgba(255, 90, 90, 0.5)';
  ctx.fillRect(0, -wdt / 2, len * k, wdt);
  ctx.strokeStyle = locked ? 'rgba(255, 120, 120, 0.95)' : 'rgba(255, 90, 90, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0, -wdt / 2, len, wdt);
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number, f: Fx) {
  const [w, h] = KIND_SIZE[e.kind];
  const flip = e.face < 0;
  let sw = w;
  let shh = h;
  let y = e.y;
  let frame = 0;
  switch (e.kind) {
    case 'rat':
    case 'king':
      frame = Math.floor(e.age / (e.state === 'dash' ? 60 : 110)) % 2;
      break;
    case 'bat':
      frame = Math.floor(e.age / 90) % 2;
      y += Math.sin(e.age / 140) * 2 - 6;
      break;
    case 'slug': {
      const p = Math.sin(e.age / 260);
      sw *= 1 + 0.08 * p;
      shh *= 1 - 0.08 * p;
      break;
    }
    case 'shroom': {
      const k = e.state === 'warn' ? 1 - e.st / e.stMax : 0;
      sw *= 1 + 0.25 * k;
      shh *= 1 + 0.2 * k;
      if (k > 0) {
        disc(ctx, e.x, e.y - 4, 10 + 6 * k, `rgba(166, 255, 77, ${0.12 + 0.25 * k})`);
      }
      break;
    }
  }
  if (e.state === 'stun') y += Math.sin(t / 30) * 0.8;
  const shake = e.state === 'warn' ? Math.sin(t / 25) * 1.2 : 0;
  drawFlip(ctx, enemySprite(e.kind, false, frame), e.x + shake, y, sw, shh, flip);
  const big = e.kind === 'king' || e.kind === 'gator';
  if (e.flash > 0) drawFlip(ctx, enemySprite(e.kind, true, frame), e.x + shake, y, sw, shh, flip, big ? 0.45 : 0.75);
  if (e.slow > 0) {
    ctx.globalAlpha = 0.35;
    disc(ctx, e.x, y, e.r * 1.1, '#9fe8ff');
    ctx.globalAlpha = 1;
  }
  if (e.burn > 0 && Math.random() < 0.25) f.burst(e.x + (Math.random() - 0.5) * e.r, y - e.r * 0.4, { n: 1, colors: ['#ff9a3c', '#ffe066'], speed: 25, life: 350, size: 1.8, gravity: -60, angle: -Math.PI / 2, spread: 0.6 });
  if (e.state === 'warn' || (e.state === 'cast' && big)) label(ctx, '!', e.x, y - h / 2 - 7, { size: big ? 16 : 12, color: '#ff5a5f' });
  if (e.state === 'stun' && big) {
    for (let i = 0; i < 3; i++) {
      const a = t / 200 + (i * Math.PI * 2) / 3;
      disc(ctx, e.x + Math.cos(a) * 14, y - h / 2 - 4 + Math.sin(a) * 4, 1.8, '#ffe066');
    }
  }
  if (!big) hpBar(ctx, e.x, y - h / 2 - 3, w * 0.6, e.hp / e.max);
}

function drawPlayer(ctx: CanvasRenderingContext2D, g: SewerGame, t: number) {
  const blink = g.inv > 0 && Math.floor(g.inv / 80) % 2 === 0;
  const alpha = blink ? 0.35 : 1;
  const bob = g.moving ? Math.abs(Math.sin(t / 90)) * 1.6 : 0;
  // Arma: apunta al objetivo si disparas, si no hacia donde caminas
  let ax = g.mx;
  let ay = g.my;
  if (g.target && !g.moving) {
    const d = Math.hypot(g.aimX - g.x, g.aimY - g.y) || 1;
    ax = (g.aimX - g.x) / d;
    ay = (g.aimY - g.y) / d;
  }
  const behind = ay < -0.3;
  const gun = () => {
    ctx.save();
    ctx.translate(g.x + ax * 3, g.y + 2 - bob);
    ctx.rotate(Math.atan2(ay, ax));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = OUT;
    ctx.fillRect(2, -2.6, 13, 5.2);
    ctx.fillStyle = '#5d6b78';
    ctx.fillRect(3, -1.8, 11, 3.6);
    ctx.fillStyle = '#9fb0bf';
    ctx.fillRect(3, -1.8, 11, 1.1);
    ctx.fillStyle = '#ffc23d';
    ctx.fillRect(12, -1.8, 2, 3.6);
    ctx.restore();
    ctx.globalAlpha = 1;
  };
  if (behind) gun();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite('sw-player', 22, 28, paintPlayer), g.x - 11, g.y - 15 - bob, 22, 28);
  ctx.globalAlpha = 1;
  if (!behind) gun();
  // Fogonazo al disparar
  if (g.firing && g.gunT > fireMs(g) - 60) disc(ctx, g.x + ax * 17, g.y + 2 - bob + ay * 17, 3.2, 'rgba(255, 240, 180, 0.85)');
  if (g.revived && g.inv > 0) {
    ctx.strokeStyle = `rgba(255, 224, 102, ${0.35 + 0.25 * Math.sin(t / 60)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(g.x, g.y, 20, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawAim(ctx: CanvasRenderingContext2D, g: SewerGame, e: Enemy, t: number) {
  const firing = g.firing;
  if (firing) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t / 30;
    ctx.strokeStyle = 'rgba(255, 210, 80, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + 2);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
    ctx.restore();
  }
  // Retícula: cuatro esquinas que giran sobre el objetivo
  const r = e.r + 7 + (firing ? Math.sin(t / 90) * 1.5 : 0);
  ctx.save();
  ctx.translate(e.x, e.kind === 'bat' ? e.y - 6 : e.y);
  ctx.rotate(t / 700);
  ctx.strokeStyle = firing ? '#ffc23d' : 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = firing ? 2 : 1.4;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(r, r - 5);
    ctx.lineTo(r, r);
    ctx.lineTo(r - 5, r);
    ctx.stroke();
  }
  ctx.restore();
  // Pista para quien aún no lo ha pillado
  if (!firing && g.room === 1 && g.moving && g.t < 25000) label(ctx, '¡Para para disparar!', Math.max(RX0 + 52, Math.min(RX1 - 52, g.x)), g.y + 24, { size: 9, color: '#ffe066' });
}

export function SewerScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="sewer" label="Puntos de alcantarilla" view={(p) => <SewerGameView {...p} />} onClose={onClose} />;
}
