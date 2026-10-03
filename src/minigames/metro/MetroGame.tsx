import { useEffect, useRef, useState } from 'react';
import { tone, vibrate } from '../../ui/haptics';
import {
  CAPACITY,
  FIELD_H,
  FIELD_W,
  MAX_LINES,
  OVER_MS,
  QUEUE_MAX,
  connect,
  newMetro,
  removeLine,
  stationAt,
  stationById,
  step,
  trainPosition,
  type Metro,
  type Shape,
} from './logic';

export const LINE_COLORS = ['#ff5a5f', '#3fa7ff', '#ffc93c'];
const FONT = '"Baloo 2", system-ui, sans-serif';
const INK = '#221f3f';

function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number) {
  ctx.beginPath();
  if (shape === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === 1) {
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r * 1.1, y + r * 0.8);
    ctx.lineTo(x - r * 1.1, y + r * 0.8);
    ctx.closePath();
  } else ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
}

export function MetroGame({ onGameOver, onScore }: { onGameOver: (score: number) => void; onScore?: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Estado inicial perezoso: no se vuelve a crear en cada render
  const [g0] = useState<Metro>(() => newMetro(Math.random));
  const game = useRef<Metro>(g0);
  const [, setFrame] = useState(0);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cb = useRef({ onGameOver, onScore });
  useEffect(() => {
    cb.current = { onGameOver, onScore };
  });
  const startedRef = useRef(false);

  // El marcador (tiempo, estaciones, ocupación de los trenes) se refresca dos veces por segundo
  // mientras se juega (al terminar ya no cambia)
  useEffect(() => {
    const id = setInterval(() => {
      if (!game.current.over) setFrame((f) => f + 1);
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const g = game.current;
    // Solo en desarrollo: para probar la partida desde la consola
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__metro = g;
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
    // Cambiar el tamaño borra el lienzo: si la partida ya terminó (sin animación), se redibuja
    const ro = new ResizeObserver(() => {
      resize();
      if (reported) draw(last);
    });
    ro.observe(canvas);

    // Plano centrado: k = píxeles por unidad
    const view = () => {
      const k = Math.min(W / FIELD_W, H / FIELD_H);
      return { k, ox: (W - FIELD_W * k) / 2, oy: (H - FIELD_H * k) / 2 };
    };
    const toField = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { k, ox, oy } = view();
      return { x: (e.clientX - rect.left - ox) / k, y: (e.clientY - rect.top - oy) / k };
    };

    const born = new Map<number, number>(g.stations.map((s) => [s.id, 0]));
    let drag: { from: number; line?: number; x: number; y: number } | null = null;
    let overAt = 0;
    let reported = false;
    let msgTimer: ReturnType<typeof setTimeout> | undefined;
    const say = (text: string) => {
      setMessage(text);
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => setMessage(null), 1800);
    };

    const onDown = (e: PointerEvent) => {
      if (g.over) return;
      const p = toField(e);
      const s = stationAt(g, p.x, p.y);
      if (!s) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drag = { from: s.id, x: p.x, y: p.y };
      vibrate(5);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || g.over) return;
      const p = toField(e);
      drag.x = p.x;
      drag.y = p.y;
      const s = stationAt(g, p.x, p.y, 7);
      if (!s || s.id === drag.from) return;
      const r = connect(g, drag.from, s.id, drag.line);
      if (r.kind === 'none') {
        if (r.reason === 'nolines') {
          say('No quedan líneas: borra una abajo 🗑️');
          drag = null;
        }
        return;
      }
      drag.from = s.id;
      drag.line = r.line.id;
      vibrate(10);
      tone(r.kind === 'new' ? 520 : 660, 0.05, 'triangle', 0.035);
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
      }
      setFrame((f) => f + 1);
    };
    const onUp = () => {
      drag = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    let last = performance.now();
    let raf = 0;
    let lastScore = 0;
    const frame = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      if (startedRef.current && !g.over) {
        const ev = step(g, dt, Math.random);
        if (ev.newStation) {
          const s = g.stations[g.stations.length - 1];
          born.set(s.id, t);
          tone(880, 0.08, 'sine', 0.03);
        }
        if (ev.delivered) tone(980 + Math.min(g.score, 60) * 6, 0.04, 'triangle', 0.03);
        if (ev.lost) {
          overAt = t;
          drag = null;
          setFrame((f) => f + 1);
          vibrate([60, 40, 140]);
          tone(120, 0.4, 'sawtooth', 0.06);
        }
      }
      if (g.score !== lastScore) {
        lastScore = g.score;
        cb.current.onScore?.(g.score);
        setFrame((f) => f + 1);
      }
      // Fin de partida: avisa tras la animación y deja de animar (queda el último fotograma)
      if (g.over && !reported && t - overAt > 1500) {
        reported = true;
        cb.current.onGameOver(g.score);
      }
      draw(t);
      if (!reported) raf = requestAnimationFrame(frame);
    };

    const draw = (t: number) => {
      const { k, ox, oy } = view();
      ctx.fillStyle = '#100e26';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(ox, oy);

      // Plano: manzanas y un río
      ctx.fillStyle = '#17153a';
      ctx.beginPath();
      ctx.roundRect(0, 0, FIELD_W * k, FIELD_H * k, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let x = 10; x < FIELD_W; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x * k, 0);
        ctx.lineTo(x * k, FIELD_H * k);
        ctx.stroke();
      }
      for (let y = 10; y < FIELD_H; y += 10) {
        ctx.beginPath();
        ctx.moveTo(0, y * k);
        ctx.lineTo(FIELD_W * k, y * k);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(70,130,220,0.22)';
      ctx.lineWidth = 9 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-5 * k, 92 * k);
      ctx.bezierCurveTo(30 * k, 70 * k, 60 * k, 112 * k, 105 * k, 84 * k);
      ctx.stroke();

      // Líneas
      ctx.lineJoin = 'round';
      for (const line of g.lines) {
        ctx.strokeStyle = LINE_COLORS[line.color];
        ctx.lineWidth = 2.6 * k;
        ctx.beginPath();
        line.stops.forEach((id, i) => {
          const s = stationById(g, id)!;
          if (i === 0) ctx.moveTo(s.x * k, s.y * k);
          else ctx.lineTo(s.x * k, s.y * k);
        });
        ctx.stroke();
      }
      if (drag) {
        const from = stationById(g, drag.from)!;
        const line = g.lines.find((l) => l.id === drag!.line);
        const used = new Set(g.lines.map((l) => l.color));
        const color = line ? LINE_COLORS[line.color] : LINE_COLORS[[0, 1, 2].find((c) => !used.has(c)) ?? 0];
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3 * k, 2.5 * k]);
        ctx.lineWidth = 2.2 * k;
        ctx.beginPath();
        ctx.moveTo(from.x * k, from.y * k);
        ctx.lineTo(drag.x * k, drag.y * k);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Trenes
      for (const line of g.lines) {
        const p = trainPosition(g, line);
        ctx.save();
        ctx.translate(p.x * k, p.y * k);
        ctx.rotate(p.angle);
        ctx.fillStyle = LINE_COLORS[line.color];
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.6 * k;
        ctx.beginPath();
        ctx.roundRect(-4.6 * k, -2.6 * k, 9.2 * k, 5.2 * k, 1.2 * k);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        line.train.cargo.forEach((c, i) => {
          const cx = (-3 + (i % 3) * 3) * k;
          const cy = (i < 3 ? -1.1 : 1.1) * k;
          shapePath(ctx, c, cx, cy, 0.8 * k);
          ctx.fill();
        });
        ctx.restore();
      }

      // Estaciones con su andén
      const r = 3.6 * k;
      for (const s of g.stations) {
        const x = s.x * k;
        const y = s.y * k;
        const age = t - (born.get(s.id) ?? 0);
        if (age < 1200 && born.get(s.id)) {
          ctx.strokeStyle = `rgba(255,255,255,${1 - age / 1200})`;
          ctx.lineWidth = 1.2 * k;
          ctx.beginPath();
          ctx.arc(x, y, r + (age / 1200) * 10 * k, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (s.over > 0) {
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 1.4 * k;
          ctx.beginPath();
          ctx.arc(x, y, r + 2.4 * k, -Math.PI / 2, -Math.PI / 2 + (Math.min(1, s.over / OVER_MS) * Math.PI * 2));
          ctx.stroke();
        }
        const lost = g.lostAt === s.id;
        // Parpadea en rojo; en el fotograma final se queda en rojo
        ctx.fillStyle = lost && (reported || Math.floor(t / 200) % 2) ? '#ff4d6d' : '#fff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.3 * k;
        shapePath(ctx, s.shape, x, y, r);
        ctx.fill();
        ctx.stroke();
        s.queue.forEach((c, i) => {
          ctx.fillStyle = i >= QUEUE_MAX ? '#ff6b81' : '#d6d0ff';
          shapePath(ctx, c, x + r + (2 + (i % 6) * 2.6) * k, y - r * 0.6 + Math.floor(i / 6) * 2.6 * k, 0.95 * k);
          ctx.fill();
        });
      }
      ctx.restore();

      if (!startedRef.current) {
        ctx.textAlign = 'center';
        ctx.font = `700 18px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText('Arrastra de una estación a otra', W / 2, oy + 26);
        ctx.fillText('para trazar una línea de metro', W / 2, oy + 48);
      }

    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(msgTimer);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const g = game.current;
  const drop = (id: number) => {
    removeLine(g, id);
    vibrate(10);
    setFrame((f) => f + 1);
  };
  const slots = Array.from({ length: MAX_LINES }, (_, c) => g.lines.find((l) => l.color === c) ?? null);

  return (
    <div className="metro-wrap">
      <div className="thief-hud">
        <div>
          <small>Viajeros</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Estaciones</small>
          <b>{g.stations.length}</b>
        </div>
        <div>
          <small>Tiempo</small>
          <b>{started ? `${Math.floor(g.t / 1000)} s` : '-'}</b>
        </div>
      </div>
      <canvas ref={canvasRef} className="metro-canvas" />
      {message && <div className="metro-msg">{message}</div>}
      {g.over && <div className="metro-msg lost">🚉 ¡Estación saturada!</div>}
      <div className="metro-lines">
        {slots.map((line, c) => (
          <div key={c} className={`metro-line${line ? '' : ' free'}`} style={{ borderColor: LINE_COLORS[c] }}>
            <span className="metro-dot" style={{ background: LINE_COLORS[c] }} />
            {line ? (
              <>
                <span>
                  {line.stops.length} est. · {line.train.cargo.length}/{CAPACITY}
                </span>
                <button className="metro-del" onClick={() => drop(line.id)} aria-label={`Borrar la línea ${c + 1}`} disabled={g.over}>
                  🗑️
                </button>
              </>
            ) : (
              <span className="muted">Libre</span>
            )}
          </div>
        ))}
      </div>
      <p className="hint metro-hint">Cada tren lleva a los viajeros a una estación con su forma (● ▲ ■). Si un andén se llena demasiado tiempo, se acaba.</p>
    </div>
  );
}
