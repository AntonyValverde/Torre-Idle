import { useEffect, useRef } from 'react';
import { tone, vibrate } from '../../ui/haptics';
import { BOX0, BOX1, CAR_L, LANE, STOP, carRect, newTraffic, patienceMs, step, toggleLight, type Car, type Dir } from './logic';

const ROAD = '#3b3a52';
const FONT = '"Baloo 2", system-ui, sans-serif';

export function TrafficGame({ onGameOver, onScore }: { onGameOver: (score: number) => void; onScore?: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef(onGameOver);
  const scoreRef = useRef(onScore);
  useEffect(() => {
    cbRef.current = onGameOver;
    scoreRef.current = onScore;
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let W = 0;
    let H = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const g = newTraffic();
    let started = false;
    let overAt = 0;
    let reported = false;
    let flash = 0;

    // Tablero cuadrado centrado, con sitio arriba para el marcador
    const board = () => {
      const size = Math.min(W - 16, H - 96);
      return { size, ox: (W - size) / 2, oy: Math.max(80, (H - size) / 2 + 30) };
    };

    function toggle() {
      if (g.crash) return;
      started = true;
      toggleLight(g);
      vibrate(8);
      tone(g.light === 'h' ? 660 : 520, 0.05, 'square', 0.035);
    }

    function drawCity(size: number) {
      // Cuatro manzanas con edificios en las esquinas
      const blocks = [
        [0, 0],
        [BOX1, 0],
        [0, BOX1],
        [BOX1, BOX1],
      ];
      for (const [bx, by] of blocks) {
        ctx.fillStyle = '#1d1b3a';
        ctx.fillRect(bx * size, by * size, BOX0 * size, BOX0 * size);
        for (let k = 0; k < 4; k++) {
          const x = (bx + 0.04 + (k % 2) * 0.18) * size;
          const y = (by + 0.04 + Math.floor(k / 2) * 0.18) * size;
          const s = 0.14 * size;
          ctx.fillStyle = `hsl(${250 + k * 18} 30% ${22 + k * 3}%)`;
          ctx.fillRect(x, y, s, s);
          ctx.fillStyle = 'rgba(255, 214, 102, 0.55)';
          for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 3; wx++) if ((wx + wy + k) % 3) ctx.fillRect(x + s * (0.12 + wx * 0.3), y + s * (0.12 + wy * 0.3), s * 0.16, s * 0.16);
        }
      }
    }

    function drawRoads(size: number) {
      ctx.fillStyle = ROAD;
      ctx.fillRect(0, BOX0 * size, size, (BOX1 - BOX0) * size);
      ctx.fillRect(BOX0 * size, 0, (BOX1 - BOX0) * size, size);
      // Línea discontinua central (fuera del cruce)
      ctx.strokeStyle = 'rgba(255, 220, 120, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([size * 0.03, size * 0.025]);
      ctx.beginPath();
      ctx.moveTo(0, 0.5 * size);
      ctx.lineTo(BOX0 * size, 0.5 * size);
      ctx.moveTo(BOX1 * size, 0.5 * size);
      ctx.lineTo(size, 0.5 * size);
      ctx.moveTo(0.5 * size, 0);
      ctx.lineTo(0.5 * size, BOX0 * size);
      ctx.moveTo(0.5 * size, BOX1 * size);
      ctx.lineTo(0.5 * size, size);
      ctx.stroke();
      ctx.setLineDash([]);
      // Líneas de stop (cada una en su carril)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(STOP * size, 0.5 * size);
      ctx.lineTo(STOP * size, BOX1 * size);
      ctx.moveTo((1 - STOP) * size, BOX0 * size);
      ctx.lineTo((1 - STOP) * size, 0.5 * size);
      ctx.moveTo(BOX0 * size, STOP * size);
      ctx.lineTo(0.5 * size, STOP * size);
      ctx.moveTo(0.5 * size, (1 - STOP) * size);
      ctx.lineTo(BOX1 * size, (1 - STOP) * size);
      ctx.stroke();
    }

    function drawLight(x: number, y: number, green: boolean, size: number) {
      const r = size * 0.022;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(x - r * 1.5, y - r * 2.7, r * 3, r * 5.4, r);
      ctx.fill();
      ctx.fillStyle = green ? '#3a1c1c' : '#ff4d4d';
      ctx.shadowColor = green ? 'transparent' : '#ff4d4d';
      ctx.shadowBlur = green ? 0 : 12;
      ctx.beginPath();
      ctx.arc(x, y - r * 1.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = green ? '#3dff8a' : '#163a24';
      ctx.shadowColor = green ? '#3dff8a' : 'transparent';
      ctx.shadowBlur = green ? 12 : 0;
      ctx.beginPath();
      ctx.arc(x, y + r * 1.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function drawLights(size: number) {
      const h = g.light === 'h';
      // Uno por entrada, junto a su línea de stop
      drawLight((STOP - 0.04) * size, (BOX1 + 0.05) * size, h, size);
      drawLight((1 - STOP + 0.04) * size, (BOX0 - 0.05) * size, h, size);
      drawLight((BOX0 - 0.05) * size, (STOP - 0.04) * size, !h, size);
      drawLight((BOX1 + 0.05) * size, (1 - STOP + 0.04) * size, !h, size);
    }

    const ANGLE: Record<Dir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

    function drawCar(c: Car, size: number, t: number, patience: number) {
      const r = carRect(c);
      const cx = ((r.x0 + r.x1) / 2) * size;
      const cy = ((r.y0 + r.y1) / 2) * size;
      const len = CAR_L * size;
      const wid = (LANE.E - LANE.W) * size * 0.7;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ANGLE[c.dir]);
      const angry = c.rush || c.wait > patience * 0.5;
      const blink = c.rush && Math.floor(t / 120) % 2 === 0;
      ctx.fillStyle = blink ? '#ff3b3b' : `hsl(${c.hue} 70% 56%)`;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.3);
      ctx.fill();
      // Parabrisas (delante) y luna trasera
      ctx.fillStyle = 'rgba(20, 24, 48, 0.75)';
      ctx.fillRect(len * 0.08, -wid * 0.36, len * 0.18, wid * 0.72);
      ctx.fillRect(-len * 0.34, -wid * 0.32, len * 0.12, wid * 0.64);
      // Faros
      ctx.fillStyle = '#fff6c2';
      ctx.fillRect(len / 2 - 3, -wid / 2 + 2, 3, 3);
      ctx.fillRect(len / 2 - 3, wid / 2 - 5, 3, 3);
      ctx.restore();
      if (angry) {
        ctx.font = `${Math.round(size * 0.05)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(c.rush ? '😡' : '😠', cx, cy - size * 0.05);
      }
    }

    let last = performance.now();
    let raf = 0;
    const rand = Math.random;
    function frame(t: number) {
      const dtMs = Math.min(33, t - last);
      last = t;

      if (started && !g.crash) {
        // Pasos pequeños para que los coches rápidos no "atraviesen" a otros entre fotogramas
        for (let left = dtMs; left > 0; left -= 8) {
          const ev = step(g, Math.min(8, left), rand);
          if (ev.passed) {
            scoreRef.current?.(g.score);
            tone(880 + Math.min(g.score, 40) * 10, 0.04, 'triangle', 0.03);
          }
          if (ev.rushed) tone(330, 0.12, 'sawtooth', 0.04);
          if (ev.crashed) {
            overAt = t;
            flash = 0.6;
            vibrate([60, 40, 120]);
            tone(110, 0.3, 'sawtooth', 0.06);
            break;
          }
        }
      }
      flash = Math.max(0, flash - dtMs / 1000);

      const { size, ox, oy } = board();
      ctx.fillStyle = '#12102a';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, 16);
      ctx.clip();
      drawCity(size);
      drawRoads(size);
      const patience = patienceMs(g.score);
      for (const c of g.cars) drawCar(c, size, t, patience);
      drawLights(size);
      if (g.crash) {
        ctx.font = `${Math.round(size * 0.16)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💥', g.crash.x * size, g.crash.y * size);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      if (flash > 0) {
        ctx.fillStyle = `rgba(255, 80, 80, ${flash * 0.4})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = `800 52px ${FONT}`;
      ctx.fillText(String(g.score), W / 2, oy - 20);
      if (!started) {
        ctx.font = `700 20px ${FONT}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillText('Toca para cambiar el semáforo', W / 2, oy + size / 2 - 8);
        ctx.font = `600 15px ${FONT}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillText('¡Que no choquen!', W / 2, oy + size / 2 + 18);
        ctx.fillText('Si esperan mucho en rojo, se lo saltan 😡', W / 2, oy + size / 2 + 38);
      }

      if (g.crash && !reported && t - overAt > 1000) {
        reported = true;
        cbRef.current(g.score);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      toggle();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        toggle();
      }
    };
    canvas.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return <canvas ref={canvasRef} className="stack-canvas" />;
}
