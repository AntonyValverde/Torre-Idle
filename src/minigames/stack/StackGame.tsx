import { useEffect, useRef } from 'react';
import { tone, vibrate } from '../../ui/haptics';
import { isGameKey } from '../keys';

interface Block {
  x: number;
  w: number;
  hue: number;
}

interface Debris extends Block {
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

const BLOCK_H = 26;
const PERFECT_PX = 5;
/** Paso máximo de la simulación, en segundos. */
const SIM_STEP = 1 / 120;

export function StackGame({ onGameOver, onScore }: { onGameOver: (score: number) => void; onScore?: (score: number) => void }) {
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

    const baseW = Math.min(W * 0.62, 260);
    const baseY = H - 140;
    const hue0 = Math.floor(Math.random() * 360);
    const stack: Block[] = [{ x: (W - baseW) / 2, w: baseW, hue: hue0 }];
    const debris: Debris[] = [];
    const particles: Particle[] = [];
    let cur = { x: 0, w: baseW, dir: 1, hue: hue0 };
    let score = 0;
    let combo = 0;
    let cam = 0;
    let over = false;
    let overAt = 0;
    let reported = false;
    let started = false;
    let flash = 0;
    let msg = '';
    let msgT = 0;

    const worldY = (level: number) => baseY - level * BLOCK_H;
    const speed = () => Math.min(140 + score * 7, 480);
    const bounds = (w: number) => [-w * 0.55, W - w * 0.45] as const;

    function spawnNext() {
      const top = stack[stack.length - 1];
      const dir = stack.length % 2 === 0 ? -1 : 1;
      const [minX, maxX] = bounds(top.w);
      cur = { x: dir > 0 ? minX : maxX, w: top.w, dir, hue: top.hue + 9 };
    }
    spawnNext();

    function burst(x: number, y: number, hue: number) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 80 + Math.random() * 220;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0.7 + Math.random() * 0.4, hue });
      }
    }

    function place() {
      if (over) return;
      started = true;
      const top = stack[stack.length - 1];
      const level = stack.length;
      const diff = cur.x - top.x;

      if (Math.abs(diff) <= PERFECT_PX) {
        combo++;
        let { x, w } = top;
        if (combo >= 3 && w < baseW) {
          const grow = Math.min(12, baseW - w);
          w += grow;
          x -= grow / 2;
        }
        stack.push({ x, w, hue: cur.hue });
        burst(x + w / 2, worldY(level), cur.hue);
        flash = 0.35;
        msg = combo > 1 ? `¡PERFECTO! x${combo}` : '¡PERFECTO!';
        msgT = 1;
        vibrate(combo > 2 ? [15, 30, 15] : 15);
        // Escala mayor ascendente: cada perfecto seguido suena más agudo
        const scale = [0, 2, 4, 5, 7, 9, 11, 12];
        const step = combo - 1;
        tone(523 * 2 ** ((scale[step % 8] + 12 * Math.floor(step / 8)) / 12));
      } else {
        combo = 0;
        const l = Math.max(cur.x, top.x);
        const r = Math.min(cur.x + cur.w, top.x + top.w);
        const overlap = r - l;
        if (overlap <= 0) {
          debris.push({ ...cur, y: worldY(level), vx: cur.dir * 60, vy: 0, rot: 0, vr: cur.dir * 2 });
          over = true;
          overAt = performance.now();
          vibrate([40, 40, 90]);
          tone(140, 0.25, 'sawtooth', 0.05);
          return;
        }
        stack.push({ x: l, w: overlap, hue: cur.hue });
        debris.push({
          x: diff > 0 ? r : cur.x,
          w: cur.w - overlap,
          hue: cur.hue,
          y: worldY(level),
          vx: diff > 0 ? 50 : -50,
          vy: 0,
          rot: 0,
          vr: diff > 0 ? 2.5 : -2.5,
        });
        vibrate(8);
        tone(330, 0.06, 'square', 0.035);
      }
      score++;
      scoreRef.current?.(score);
      spawnNext();
    }

    function drawBlock(x: number, y: number, w: number, h: number, hue: number) {
      ctx.fillStyle = `hsl(${hue % 360} 72% 56%)`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = `hsl(${hue % 360} 85% 70%)`;
      ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = `hsl(${hue % 360} 65% 40%)`;
      ctx.fillRect(x, y + h - 3, w, 3);
    }

    function update(dt: number) {
      if (!over) {
        cur.x += cur.dir * speed() * dt;
        const [minX, maxX] = bounds(cur.w);
        if (cur.x < minX) {
          cur.x = minX;
          cur.dir = 1;
        } else if (cur.x > maxX) {
          cur.x = maxX;
          cur.dir = -1;
        }
      }
      const camTarget = Math.max(0, H * 0.42 - worldY(stack.length));
      cam += (camTarget - cam) * Math.min(1, dt * 6);

      for (const d of debris) {
        d.vy += 1500 * dt;
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        d.rot += d.vr * dt;
      }
      for (let i = debris.length - 1; i >= 0; i--) if (debris[i].y + cam > H + 200) debris.splice(i, 1);
      for (const p of particles) {
        p.life -= dt;
        p.vy += 600 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
      flash = Math.max(0, flash - dt);
      msgT = Math.max(0, msgT - dt * 0.9);
    }

    let last = performance.now();
    let raf = 0;
    function frame(t: number) {
      // Se simula el tiempo real en pasos pequeños: con pocos fps el bloque no va a cámara lenta
      // (sería más fácil) y en pantallas de 120 Hz no va más rápido. Tras una pausa larga
      // (app en segundo plano) no se recupera todo el hueco de golpe.
      let left = Math.min(0.25, Math.max(0, (t - last) / 1000));
      last = t;
      while (left > 0) {
        const step = Math.min(SIM_STEP, left);
        update(step);
        left -= step;
      }

      // Fondo
      const h = (hue0 + score * 4) % 360;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${h} 45% 20%)`);
      g.addColorStop(1, `hsl(${(h + 40) % 360} 50% 7%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Torre
      for (let i = 0; i < stack.length; i++) {
        const b = stack[i];
        const y = worldY(i) + cam;
        if (y > H) continue;
        if (i < stack.length - 20 && y + BLOCK_H < 0) continue;
        drawBlock(b.x, y, b.w, i === 0 ? H - y : BLOCK_H, b.hue);
      }
      if (!over) drawBlock(cur.x, worldY(stack.length) + cam, cur.w, BLOCK_H, cur.hue);

      for (const d of debris) {
        ctx.save();
        ctx.translate(d.x + d.w / 2, d.y + cam + BLOCK_H / 2);
        ctx.rotate(d.rot);
        drawBlock(-d.w / 2, -BLOCK_H / 2, d.w, BLOCK_H, d.hue);
        ctx.restore();
      }
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = `hsl(${p.hue % 360} 90% 75%)`;
        ctx.fillRect(p.x - 3, p.y + cam - 3, 6, 6);
      }
      ctx.globalAlpha = 1;

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Texto
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = '800 64px "Baloo 2", system-ui, sans-serif';
      ctx.fillText(String(score), W / 2, H * 0.16);
      if (msgT > 0) {
        ctx.globalAlpha = msgT;
        ctx.font = '800 26px "Baloo 2", system-ui, sans-serif';
        ctx.fillStyle = '#ffe27a';
        ctx.fillText(msg, W / 2, H * 0.16 + 44);
        ctx.globalAlpha = 1;
      }
      if (!started) {
        ctx.font = '600 20px "Baloo 2", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText('Toca para soltar el bloque', W / 2, H * 0.16 + 44);
      }

      if (over && !reported && t - overAt > 900) {
        reported = true;
        cbRef.current(score);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      place();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isGameKey(e)) {
        e.preventDefault();
        place();
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
