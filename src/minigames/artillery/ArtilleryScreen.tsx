import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tone, vibrate } from '../../ui/haptics';
import { FLASH_MS, WarScreen, nextFlashId, toField, type Flash, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  BLAST_MS,
  BLAST_R,
  CANNON,
  FIELD_H,
  FIELD_W,
  GROUND,
  KINDS,
  LIVES,
  RELOAD_MS,
  WALL_TOP,
  WALL_X,
  aimFrom,
  canShoot,
  newArtillery,
  preview,
  shoot,
  step,
  type ArtilleryGame,
  type Enemy,
} from './logic';

const COUNTDOWN = 2400;
/** Arrastres más cortos que esto (en potencia) no disparan: es un toque sin querer. */
const MIN_POWER = 0.08;

const summary = (g: ArtilleryGame): WarSummary => ({
  score: g.score,
  detail: `${g.kills} ${g.kills === 1 ? 'máquina destruida' : 'máquinas destruidas'} · puntería ${g.shots ? Math.round((g.hitShots / g.shots) * 100) : 0}%`,
});

function Machine({ e }: { e: Enemy }) {
  const k = KINDS[e.kind];
  const x0 = e.x - k.w / 2;
  const top = GROUND - k.h;
  const cls = `art-enemy${e.hurt > 0 ? ' hurt' : ''}`;
  if (e.kind === 'ram') {
    return (
      <g className={cls}>
        <path d={`M${x0} ${GROUND - 2.4}V${top + 2.5}L${e.x} ${top}L${x0 + k.w} ${top + 2.5}V${GROUND - 2.4}z`} className="art-wood" />
        <rect x={x0 - 3} y={GROUND - 4.6} width={4} height={1.6} rx={0.8} className="art-log" />
        <circle cx={x0 + 2.4} cy={GROUND - 1.4} r={1.4} className="art-wheel" />
        <circle cx={x0 + k.w - 2.4} cy={GROUND - 1.4} r={1.4} className="art-wheel" />
      </g>
    );
  }
  if (e.kind === 'rider') {
    return (
      <g className={cls}>
        <path d={`M${x0} ${GROUND - 3.5}h${k.w}v-2.5h${-k.w}z`} className="art-horse" />
        <path d={`M${x0 - 0.6} ${GROUND - 6}l-1.2 -1.6h2z`} className="art-horse" />
        <path d={`M${x0 + 1} ${GROUND - 3.5}v3.5M${x0 + k.w - 1} ${GROUND - 3.5}v3.5`} className="art-legs" />
        <circle cx={e.x + 0.5} cy={top + 1.6} r={1.5} className="art-rider" />
        <path d={`M${e.x + 0.5} ${top + 2.8}v3`} className="art-legs" />
        <path d={`M${e.x + 2} ${top + 3}l-6 -1.6`} className="art-lance" />
      </g>
    );
  }
  return (
    <g className={cls}>
      <path d={`M${x0} ${GROUND - 2}V${top + 1.6}h1.6v-1.6h1.6v1.6h1.6v-1.6h1.6v1.6h1.6v-1.6h2v${k.h - 2}z`} className="art-wood dark" />
      <rect x={x0 + 2.5} y={top + 5} width={2.6} height={3} className="art-slot" />
      <circle cx={x0 + 2.4} cy={GROUND - 1.4} r={1.4} className="art-wheel" />
      <circle cx={x0 + k.w - 2.4} cy={GROUND - 1.4} r={1.4} className="art-wheel" />
      {Array.from({ length: KINDS.tower.hp }, (_, i) => (
        <rect key={i} x={x0 + i * 3.6} y={top - 3} width={3} height={1.2} className={i < e.hp ? 'art-hp on' : 'art-hp'} />
      ))}
    </g>
  );
}

export function ArtilleryGameView({ onOver, onScore }: WarViewProps) {
  const [g0] = useState<ArtilleryGame>(() => newArtillery(Math.random));
  const game = useRef<ArtilleryGame>(g0);
  const start = useRef(performance.now() + COUNTDOWN);
  const flashes = useRef<Flash[]>([]);
  const shakeUntil = useRef(0);
  const drag = useRef<{ x: number; y: number; angle: number; power: number } | null>(null);
  // Último ángulo apuntado: el cañón se queda así entre disparos
  const lastAngle = useRef(Math.PI / 5);
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
        for (const b of ev.blasts) {
          tone(150, 0.12, 'sawtooth', 0.04);
          if (!ev.kills) flashes.current.push({ id: nextFlashId(), x: b.x, y: b.y - 4, text: '¡Fallo!', good: false, at: t });
        }
        if (ev.kills) {
          const b = ev.blasts[ev.blasts.length - 1];
          const text = ev.multi >= 3 ? `¡Triple! +${ev.points}` : ev.multi === 2 ? `¡Doble! +${ev.points}` : `+${ev.points}`;
          if (b) flashes.current.push({ id: nextFlashId(), x: b.x, y: b.y - 6, text, good: true, at: t });
          vibrate(ev.multi > 1 ? [10, 20, 10] : 8);
          tone(880, 0.07, 'triangle', 0.05);
          cb.current.onScore(summary(g));
        }
        if (ev.breached) {
          shakeUntil.current = t + 450;
          vibrate([60, 40, 60]);
          tone(100, 0.3, 'sawtooth', 0.06);
          flashes.current.push({ id: nextFlashId(), x: WALL_X, y: WALL_TOP - 4, text: '¡Brecha!', good: false, at: t });
        }
        if (ev.lost) {
          shakeUntil.current = t + 700;
          vibrate([80, 50, 160]);
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

  const ready = () => !game.current.over && performance.now() >= start.current;

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!ready()) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toField(svg.current, e.clientX, e.clientY);
    drag.current = { ...p, angle: lastAngle.current, power: 0 };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toField(svg.current, e.clientX, e.clientY);
    const a = aimFrom(p.x - d.x, p.y - d.y);
    drag.current = { ...d, ...a };
    if (a.power >= MIN_POWER) lastAngle.current = a.angle;
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !ready() || d.power < MIN_POWER) return;
    const g = game.current;
    if (!canShoot(g)) {
      flashes.current.push({ id: nextFlashId(), x: CANNON.x + 6, y: CANNON.y - 8, text: 'Recargando…', good: false, at: performance.now() });
      tone(200, 0.06, 'square', 0.03);
      return;
    }
    shoot(g, d.angle, d.power, Math.random);
    tone(120, 0.15, 'square', 0.05);
    vibrate(12);
  };

  const g = game.current;
  const t = performance.now();
  const counting = t < start.current;
  const countNum = Math.ceil((start.current - t) / 800);
  const aim = drag.current;
  const angle = aim && aim.power >= MIN_POWER ? aim.angle : lastAngle.current;
  const dots = aim && aim.power >= MIN_POWER ? preview(aim.angle, aim.power) : [];
  const reload = g.reload / RELOAD_MS;
  const windArrow = g.wind === 0 ? '·' : g.wind > 0 ? '→' : '←';

  return (
    <div className={`war-wrap${t < shakeUntil.current ? ' shake' : ''}`}>
      <div className="thief-hud">
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Viento</small>
          <b className={Math.abs(g.wind) >= 10 ? 'hot' : ''}>
            {windArrow} {Math.abs(g.wind)}
          </b>
        </div>
        <div>
          <small>Muralla</small>
          <b className="war-hearts" aria-label={`${g.lives} de ${LIVES} vidas`}>
            {'❤️'.repeat(g.lives)}
            {'🖤'.repeat(LIVES - g.lives)}
          </b>
        </div>
      </div>
      <svg
        ref={svg}
        className="war-field art-field"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        preserveAspectRatio="xMidYMax meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        role="img"
        aria-label={`Artillería: ${g.enemies.length} máquinas a la vista, ${g.lives} vidas`}
      >
        <path d={`M0 ${GROUND - 8}Q20 ${GROUND - 20} 40 ${GROUND - 10}T75 ${GROUND - 14}T${FIELD_W} ${GROUND - 9}V${GROUND}H0z`} className="art-hills" />
        <rect x={0} y={GROUND} width={FIELD_W} height={FIELD_H - GROUND} className="art-ground" />
        {/* Muralla con almenas */}
        <path
          d={`M0 ${GROUND}V${WALL_TOP}h3v-3h3v3h3v-3h3v3h${WALL_X - 12}V${GROUND}z`}
          className={`art-wall${g.lives <= 1 ? ' cracked' : ''}`}
        />
        <path d={`M2 ${WALL_TOP + 6}h13M2 ${WALL_TOP + 12}h13M2 ${WALL_TOP + 18}h13M8 ${WALL_TOP}v6M5 ${WALL_TOP + 6}v6M11 ${WALL_TOP + 12}v6`} className="art-bricks" />
        {/* Cañón */}
        <g transform={`rotate(${(-angle * 180) / Math.PI} ${CANNON.x} ${CANNON.y})`}>
          <rect x={CANNON.x} y={CANNON.y - 1.5} width={9} height={3} rx={1} className="art-barrel" />
        </g>
        <circle cx={CANNON.x} cy={CANNON.y + 1} r={3} className="art-cannon" />
        {reload > 0 && <path d={`M${CANNON.x - 4} ${CANNON.y + 6}h${8 * (1 - reload)}`} className="art-reload" />}
        {dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.7} className="art-dot" opacity={1 - i / (dots.length + 2)} />
        ))}
        {aim && aim.power >= MIN_POWER && (
          <text x={CANNON.x + 2} y={CANNON.y - 10} fontSize={3.4} className="war-flash">
            {Math.round(aim.power * 100)}%
          </text>
        )}
        {g.enemies.map((e) => (
          <Machine key={e.id} e={e} />
        ))}
        {g.shells.map((s, i) => (
          <g key={i}>
            <line x1={s.x - s.vx * 0.04} y1={s.y - s.vy * 0.04} x2={s.x} y2={s.y} className="art-trail" />
            <circle cx={s.x} cy={s.y} r={1.2} className="art-shell" />
          </g>
        ))}
        {g.blasts.map((b, i) => {
          const k = b.age / BLAST_MS;
          return <circle key={i} cx={b.x} cy={b.y} r={BLAST_R * (0.4 + 0.6 * k)} className="art-blast" opacity={1 - k} />;
        })}
        {flashes.current.map((f) => (
          <text
            key={f.id}
            x={f.x}
            y={f.y - ((t - f.at) / FLASH_MS) * 6}
            fontSize={3.6}
            textAnchor="middle"
            className={`war-flash${f.good ? '' : ' bad'}`}
            opacity={1 - (t - f.at) / FLASH_MS}
          >
            {f.text}
          </text>
        ))}
      </svg>
      <p className="hint">
        Arrastra hacia atrás (como un tirachinas) para apuntar y suelta para disparar. La guía no cuenta el viento: ¡compénsalo! Un impacto directo hace doble daño.
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{countNum > 0 ? countNum : '¡Fuego!'}</span>
        </div>
      )}
      {g.over && (
        <div className="countdown war-banner">
          <span>🏚️ ¡Derribaron la muralla!</span>
        </div>
      )}
    </div>
  );
}

export function ArtilleryScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="artillery" label="Puntos de artillería" view={(p) => <ArtilleryGameView {...p} />} onClose={onClose} />;
}
