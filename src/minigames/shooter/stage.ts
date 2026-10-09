import { useEffect, useRef, type RefObject } from 'react';
import { clamp, type Vec } from './kit';

// Escenario de los shooters: un <canvas> que ocupa todo el hueco, dibuja el campo de juego (de tamaño
// fijo en unidades del juego) escalado para que quepa entero y centrado, y avanza la partida con paso
// fijo. También recoge la entrada: joystick flotante, dos joysticks, arrastre relativo o toques, y
// teclado en el ordenador.

/** Paso fijo de la simulación (ms). */
export const STEP_MS = 1000 / 60;

export interface Field {
  w: number;
  h: number;
}

export interface View {
  /** Tamaño del canvas en px CSS. */
  cw: number;
  ch: number;
  dpr: number;
  /** px CSS por unidad del juego y dónde empieza el campo. */
  scale: number;
  ox: number;
  oy: number;
  /** Zona visible en unidades del juego (más que el campo si sobra pantalla por los lados). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function emptyView(): View {
  return { cw: 1, ch: 1, dpr: 1, scale: 1, ox: 0, oy: 0, x0: 0, y0: 0, x1: 1, y1: 1 };
}

/** Pasa el dibujo a unidades del juego. */
export function toWorldSpace(ctx: CanvasRenderingContext2D, v: View) {
  ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, v.dpr * v.ox, v.dpr * v.oy);
}

/** Pasa el dibujo a px CSS del canvas (para joysticks y avisos de pantalla). */
export function toScreenSpace(ctx: CanvasRenderingContext2D, v: View) {
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
}

/** Punto en px CSS del canvas → unidades del juego. */
export function screenToWorld(v: View, sx: number, sy: number): Vec {
  return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
}

export function worldToScreen(v: View, x: number, y: number): Vec {
  return { x: v.ox + x * v.scale, y: v.oy + y * v.scale };
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface StageHandlers {
  /** Avanza la partida `dt` ms (siempre STEP_MS). */
  step: (dt: number) => void;
  /** Pinta un fotograma. `frameMs` es el tiempo real desde el anterior (para efectos). */
  draw: (ctx: CanvasRenderingContext2D, v: View, frameMs: number) => void;
  /** Si la partida avanza ahora (false en la cuenta atrás, en pausa o eligiendo mejora). */
  running: () => boolean;
  /** La app pasó a segundo plano o perdió el foco: buen momento para pausar. */
  onHidden?: () => void;
}

/**
 * Bucle del juego sobre un canvas. Devuelve la vista actual (para pasar toques a unidades del juego).
 * Los handlers se leen en cada fotograma, así que pueden cerrar sobre estado nuevo sin reiniciar nada.
 */
export function useStage(canvasRef: RefObject<HTMLCanvasElement | null>, field: Field, handlers: StageHandlers): RefObject<View> {
  const view = useRef<View>(emptyView());
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cw = Math.max(1, r.width);
      const ch = Math.max(1, r.height);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const scale = Math.min(cw / field.w, ch / field.h);
      const ox = (cw - field.w * scale) / 2;
      const oy = (ch - field.h * scale) / 2;
      view.current = { cw, ch, dpr, scale, ox, oy, x0: -ox / scale, y0: -oy / scale, x1: (cw - ox) / scale, y1: (ch - oy) / scale };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (t: number) => {
      const frame = Math.min(100, t - last);
      last = t;
      if (h.current.running()) {
        acc += frame;
        let n = 0;
        while (acc >= STEP_MS && n < 6) {
          h.current.step(STEP_MS);
          acc -= STEP_MS;
          n++;
        }
        if (n === 6) acc = 0;
      } else acc = 0;
      h.current.draw(ctx, view.current, frame);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const hidden = () => {
      if (document.visibilityState === 'hidden') h.current.onHidden?.();
    };
    const blur = () => h.current.onHidden?.();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
    };
  }, [canvasRef, field.w, field.h]);

  return view;
}

// =============================================================================================
// Entrada
// =============================================================================================

export interface Stick {
  active: boolean;
  /** Toque que lo maneja. */
  pointer: number;
  /** Centro (donde se apoyó el dedo) y posición actual, en px CSS del canvas. */
  ox: number;
  oy: number;
  x: number;
  y: number;
  /** Dirección y fuerza (0..1). */
  vx: number;
  vy: number;
  mag: number;
}

function newStick(): Stick {
  return { active: false, pointer: -1, ox: 0, oy: 0, x: 0, y: 0, vx: 0, vy: 0, mag: 0 };
}

/**
 * - `stick`: un joystick flotante donde apoyes el dedo (o WASD / flechas).
 * - `twin`: mitad izquierda mueve, mitad derecha apunta (o WASD + flechas, o WASD + ratón).
 * - `drag`: arrastrar mueve lo mismo que el dedo (para la nave), sin tapar lo que mueves.
 * - `tap`: solo toques y mantener pulsado.
 */
export type InputMode = 'stick' | 'twin' | 'drag' | 'tap';

export interface Input {
  mode: InputMode;
  move: Stick;
  aim: Stick;
  /** Arrastre acumulado (px CSS) desde la última lectura con takeDrag(). */
  dragX: number;
  dragY: number;
  /** Toques nuevos (px CSS del canvas) desde la última lectura con takeTaps(). */
  taps: Vec[];
  /** Algún dedo o botón está pulsado. */
  held: boolean;
  /** Ratón sobre el canvas (para apuntar en el ordenador) y si su botón está pulsado. */
  mouse: { x: number; y: number; inside: boolean; down: boolean };
  keys: Set<string>;
  /** Ya se tocó o se pulsó una tecla (para quitar la ayuda). */
  touched: boolean;
}

/** Radio del joystick en px CSS. */
export const STICK_R = 46;

const KEY_MOVE: Record<string, [number, number]> = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };
const KEY_ARROW: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] };

function keyVec(keys: Set<string>, map: Record<string, [number, number]>): Vec {
  let x = 0;
  let y = 0;
  for (const k of keys) {
    const d = map[k];
    if (d) {
      x += d[0];
      y += d[1];
    }
  }
  const m = Math.hypot(x, y);
  return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
}

/** Dirección de movimiento (joystick o teclado), con fuerza 0..1. */
export function moveVec(inp: Input): Vec {
  if (inp.move.active) return { x: inp.move.vx * inp.move.mag, y: inp.move.vy * inp.move.mag };
  const k = keyVec(inp.keys, KEY_MOVE);
  if (k.x || k.y || inp.mode === 'twin') return k;
  return keyVec(inp.keys, KEY_ARROW);
}

/** Dirección de apuntado en modo `twin` (joystick derecho o flechas); null si no se apunta. */
export function aimVec(inp: Input): Vec | null {
  if (inp.aim.active && inp.aim.mag > 0.2) return { x: inp.aim.vx, y: inp.aim.vy };
  const k = keyVec(inp.keys, KEY_ARROW);
  return k.x || k.y ? k : null;
}

export function takeTaps(inp: Input): Vec[] {
  const t = inp.taps;
  inp.taps = [];
  return t;
}

export function takeDrag(inp: Input): Vec {
  const d = { x: inp.dragX, y: inp.dragY };
  inp.dragX = 0;
  inp.dragY = 0;
  return d;
}

function setStick(s: Stick, x: number, y: number) {
  s.x = x;
  s.y = y;
  const dx = x - s.ox;
  const dy = y - s.oy;
  const d = Math.hypot(dx, dy);
  // El centro sigue al dedo si se aleja mucho: así nunca hay que volver atrás para cambiar de dirección
  if (d > STICK_R * 1.4) {
    s.ox = x - (dx / d) * STICK_R * 1.4;
    s.oy = y - (dy / d) * STICK_R * 1.4;
  }
  s.vx = d ? dx / d : 0;
  s.vy = d ? dy / d : 0;
  s.mag = clamp(d / STICK_R, 0, 1);
  if (s.mag < 0.12) s.mag = 0;
}

/** Engancha toques, ratón y teclado al canvas. */
export function useInput(canvasRef: RefObject<HTMLCanvasElement | null>, mode: InputMode): RefObject<Input> {
  const inp = useRef<Input>({
    mode,
    move: newStick(),
    aim: newStick(),
    dragX: 0,
    dragY: 0,
    taps: [],
    held: false,
    mouse: { x: 0, y: 0, inside: false, down: false },
    keys: new Set(),
    touched: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = inp.current;
    st.mode = mode;
    const down = new Map<number, { x: number; y: number }>();
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const p = local(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura */
      }
      down.set(e.pointerId, p);
      st.held = true;
      st.touched = true;
      st.taps.push(p);
      if (e.pointerType === 'mouse') st.mouse.down = true;
      if (mode === 'stick' || (mode === 'twin' && (p.x < canvas.clientWidth / 2 || e.pointerType === 'mouse'))) {
        // Con ratón en modo twin el clic dispara (apunta el ratón) y no mueve
        if (mode === 'twin' && e.pointerType === 'mouse') return;
        if (!st.move.active) Object.assign(st.move, { active: true, pointer: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, vx: 0, vy: 0, mag: 0 });
      } else if (mode === 'twin') {
        if (!st.aim.active) Object.assign(st.aim, { active: true, pointer: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, vx: 0, vy: 0, mag: 0 });
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (e.pointerType === 'mouse') Object.assign(st.mouse, { x: p.x, y: p.y, inside: true });
      const prev = down.get(e.pointerId);
      if (!prev) return;
      if (mode === 'drag') {
        st.dragX += p.x - prev.x;
        st.dragY += p.y - prev.y;
      }
      down.set(e.pointerId, p);
      if (st.move.active && st.move.pointer === e.pointerId) setStick(st.move, p.x, p.y);
      if (st.aim.active && st.aim.pointer === e.pointerId) setStick(st.aim, p.x, p.y);
    };
    const onUp = (e: PointerEvent) => {
      down.delete(e.pointerId);
      st.held = down.size > 0;
      if (e.pointerType === 'mouse') st.mouse.down = false;
      if (st.move.pointer === e.pointerId) Object.assign(st.move, newStick());
      if (st.aim.pointer === e.pointerId) Object.assign(st.aim, newStick());
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') st.mouse.inside = false;
    };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.repeat) return;
      if (KEY_MOVE[e.code] || KEY_ARROW[e.code] || e.code === 'Space') {
        e.preventDefault();
        st.keys.add(e.code);
        st.touched = true;
        if (e.code === 'Space') st.held = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      st.keys.delete(e.code);
      if (e.code === 'Space') st.held = down.size > 0;
    };
    const clear = () => {
      st.keys.clear();
      down.clear();
      st.held = false;
      st.mouse.down = false;
      Object.assign(st.move, newStick());
      Object.assign(st.aim, newStick());
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, [canvasRef, mode]);

  return inp;
}

/** Suelta todo lo pulsado (al pausar o al abrir una elección, para que nadie siga moviéndose solo). */
export function releaseInput(inp: Input) {
  inp.keys.clear();
  inp.held = false;
  inp.taps = [];
  inp.dragX = 0;
  inp.dragY = 0;
  Object.assign(inp.move, newStick());
  Object.assign(inp.aim, newStick());
}

/**
 * Pinta los joysticks activos (en px CSS). Si aún no se ha tocado, deja ver dónde van como pista:
 * `ghost` son los centros sugeridos (uno, o dos en modo twin).
 */
export function drawSticks(ctx: CanvasRenderingContext2D, v: View, inp: Input, ghost?: Vec[]) {
  toScreenSpace(ctx, v);
  const ring = (cx: number, cy: number, kx: number, ky: number, alpha: number, color: string) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(10, 8, 30, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, STICK_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, alpha * 1.6);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(kx, ky, STICK_R * 0.42, 0, Math.PI * 2);
    ctx.fill();
  };
  const draw = (s: Stick, color: string) => {
    if (!s.active) return;
    const k = Math.min(STICK_R, Math.hypot(s.x - s.ox, s.y - s.oy));
    ring(s.ox, s.oy, s.ox + s.vx * k, s.oy + s.vy * k, 0.35, color);
  };
  draw(inp.move, '#ffffff');
  draw(inp.aim, '#ffc23d');
  if (!inp.touched && ghost) ghost.forEach((g, i) => ring(g.x, g.y, g.x, g.y, 0.18, i === 0 ? '#ffffff' : '#ffc23d'));
  ctx.globalAlpha = 1;
}
