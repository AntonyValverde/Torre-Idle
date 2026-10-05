import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useGame } from '../../game/store';
import { tone, vibrate } from '../../ui/haptics';
import { FLASH_MS, WarScreen, nextFlashId, toField, type Flash, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  AMMO_MAX,
  BATTERY,
  BUILDING_W,
  FIELD_H,
  FIELD_W,
  GROUND,
  MIN_AIM_Y,
  blastRadius,
  fire,
  flakTheme,
  newFlak,
  standing,
  step,
  type FlakGame,
} from './logic';

const COUNTDOWN = 2400;

/** Ventanitas de un edificio (filas y columnas según su altura). */
function windows(x: number, h: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const x0 = x - BUILDING_W / 2;
  for (let y = GROUND - h + 3; y < GROUND - 3; y += 5) for (let c = 0; c < 3; c++) out.push({ x: x0 + 1.6 + c * 3.2, y });
  return out;
}

const summary = (g: FlakGame): WarSummary => ({
  score: g.score,
  detail: `Oleada ${g.wave} · ${g.kills} ${g.kills === 1 ? 'derribo' : 'derribos'}${g.bestChain >= 2 ? ` · cadena x${g.bestChain}` : ''}`,
});

export function FlakGameView({ onOver, onScore }: WarViewProps) {
  const era = useGame((st) => st.s.era);
  const theme = flakTheme(era);
  const [g0] = useState<FlakGame>(() => newFlak(Math.random));
  const game = useRef<FlakGame>(g0);
  const start = useRef(performance.now() + COUNTDOWN);
  const flashes = useRef<Flash[]>([]);
  const shakeUntil = useRef(0);
  const banner = useRef<{ text: string; until: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [, setFrame] = useState(0);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      const g = game.current;
      if (!g.over && t >= start.current) {
        const ev = step(g, dt, Math.random);
        if (ev.kills) {
          tone(ev.kills > 1 ? 980 : 760, 0.06, 'triangle', 0.045);
          vibrate(ev.kills > 1 ? [10, 20, 10] : 8);
        }
        for (const p of ev.pops) flashes.current.push({ id: nextFlashId(), x: p.x, y: p.y, text: `+${p.pts}`, good: true, at: t });
        if (ev.hits) {
          shakeUntil.current = t + 400;
          vibrate([60, 40, 60]);
          tone(110, 0.3, 'sawtooth', 0.06);
        }
        if (ev.split) tone(420, 0.05, 'square', 0.02);
        if (ev.points) cb.current.onScore(summary(g));
        if (ev.waveCleared) {
          banner.current = { text: ev.rebuilt ? `🏗️ ¡Oleada ${g.wave} superada! Reconstruido un edificio` : `🛡️ ¡Oleada ${g.wave} superada!`, until: t + 1800 };
          tone(660, 0.1, 'triangle', 0.05);
        }
        if (ev.lost) {
          shakeUntil.current = t + 700;
          vibrate([80, 50, 160]);
          tone(80, 0.5, 'sawtooth', 0.07);
          endTimer = setTimeout(() => cb.current.onOver(summary(g)), 1400);
        }
      }
      flashes.current = flashes.current.filter((x) => t - x.at < FLASH_MS);
      setFrame((f) => f + 1);
      if (g.over && t >= shakeUntil.current && flashes.current.length === 0 && g.blasts.length === 0) return;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
    };
  }, []);

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = game.current;
    const t = performance.now();
    if (g.over || t < start.current) return;
    const p = toField(svg.current, e.clientX, e.clientY);
    const r = fire(g, p.x, p.y);
    if (r === 'ok') {
      tone(300, 0.05, 'square', 0.025);
      return;
    }
    flashes.current.push({ id: nextFlashId(), x: p.x, y: Math.min(p.y, MIN_AIM_Y), text: r === 'empty' ? 'Sin munición' : 'Muy bajo', good: false, at: t });
    tone(200, 0.06, 'square', 0.03);
  };

  const g = game.current;
  const t = performance.now();
  const counting = t < start.current;
  const countNum = Math.ceil((start.current - t) / 800);
  const alive = standing(g);
  const showBanner = banner.current && t < banner.current.until ? banner.current.text : null;

  return (
    <div className={`war-wrap${t < shakeUntil.current ? ' shake' : ''}`}>
      <div className="thief-hud">
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Oleada</small>
          <b>{g.wave}</b>
        </div>
        <div>
          <small>Edificios</small>
          <b className={alive <= 2 ? 'hot' : ''}>
            {alive}/{g.buildings.length}
          </b>
        </div>
      </div>
      <svg
        ref={svg}
        className="war-field flak-field"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        preserveAspectRatio="xMidYMax meet"
        onPointerDown={onDown}
        role="img"
        aria-label={`Oleada ${g.wave}: ${alive} edificios en pie`}
      >
        <defs>
          <radialGradient id="flak-blast">
            <stop offset="0%" stopColor="#fff7d1" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#ffb938" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ff5a3a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="flak-hit">
            <stop offset="0%" stopColor="#ffd2a0" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#b8331d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Estrellas */}
        {[8, 23, 41, 57, 72, 88, 15, 64, 95, 33].map((x, i) => (
          <circle key={i} cx={x} cy={6 + ((i * 37) % 50)} r={0.35} className="flak-star" />
        ))}
        <rect x={0} y={GROUND} width={FIELD_W} height={FIELD_H - GROUND} className="flak-ground" />
        {g.buildings.map((b, i) =>
          b.alive ? (
            <g key={i}>
              <rect x={b.x - BUILDING_W / 2} y={GROUND - b.h} width={BUILDING_W} height={b.h} className="flak-building" />
              {windows(b.x, b.h).map((w, k) => (
                <rect key={k} x={w.x} y={w.y} width={1.6} height={2} className={(k * 7 + i) % 5 === 0 ? 'flak-win off' : 'flak-win'} />
              ))}
            </g>
          ) : (
            <path
              key={i}
              d={`M${b.x - BUILDING_W / 2} ${GROUND}l2 -4l2 2l2.5 -5l2 3l2.5 -2v6z`}
              className="flak-rubble"
            />
          ),
        )}
        {/* Batería antiaérea */}
        <path d={`M${BATTERY.x - 6} ${GROUND}v-3a6 5 0 0 1 12 0v3z`} className="flak-battery" />
        <rect x={BATTERY.x - 0.8} y={BATTERY.y - 7} width={1.6} height={6} className="flak-barrel" />
        {g.enemies.map((e, i) => (
          <g key={i}>
            <line x1={e.x0} y1={e.y0} x2={e.x} y2={e.y} stroke={theme.trail} strokeWidth={e.kind === 'fast' ? 0.5 : 0.8} />
            <circle cx={e.x} cy={e.y} r={e.kind === 'split' ? 2.4 : e.kind === 'fast' ? 1.4 : 1.8} fill={theme.color} className={`flak-enemy ${e.kind}`} />
          </g>
        ))}
        {g.shots.map((s, i) => (
          <g key={i}>
            <path d={`M${s.tx - 1.5} ${s.ty - 1.5}l3 3m0 -3l-3 3`} className="flak-mark" />
            <line x1={BATTERY.x} y1={BATTERY.y - 6} x2={s.x} y2={s.y} className="flak-shot-trail" />
            <circle cx={s.x} cy={s.y} r={0.9} className="flak-shot" />
          </g>
        ))}
        {g.blasts.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r={blastRadius(b)} fill={b.depth < 0 ? 'url(#flak-hit)' : 'url(#flak-blast)'} />
        ))}
        {flashes.current.map((f) => (
          <text
            key={f.id}
            x={f.x}
            y={f.y - 3 - ((t - f.at) / FLASH_MS) * 6}
            fontSize={3.6}
            textAnchor="middle"
            className={`war-flash${f.good ? '' : ' bad'}`}
            opacity={1 - (t - f.at) / FLASH_MS}
          >
            {f.text}
          </text>
        ))}
      </svg>
      <div className="war-ammo" aria-label={`Munición: ${g.ammo} de ${AMMO_MAX}`}>
        <span>💥</span>
        <div className="fire-tank">
          {Array.from({ length: AMMO_MAX }, (_, k) => (
            <i key={k} className={k < g.ammo ? 'on' : ''} />
          ))}
        </div>
      </div>
      <p className="hint">
        Llegan {theme.name}. Toca el cielo para que explote un obús ahí: lo que toque la explosión cae y estalla también, ¡en cadena puntúa más!
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{countNum > 0 ? countNum : '¡Ya!'}</span>
        </div>
      )}
      {!counting && !g.over && showBanner && (
        <div className="countdown war-banner">
          <span>{showBanner}</span>
        </div>
      )}
      {g.over && (
        <div className="countdown war-banner">
          <span>💥 ¡Cayó la ciudad!</span>
        </div>
      )}
    </div>
  );
}

export function FlakScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="flak" label="Puntos de defensa" view={(p) => <FlakGameView {...p} />} onClose={onClose} />;
}
