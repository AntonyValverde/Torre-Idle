import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tone, vibrate } from '../../ui/haptics';
import { FLASH_MS, WarScreen, nextFlashId, toField, type Flash, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  DEFENSES,
  DEFENSE_KINDS,
  ENEMIES,
  FIELD_H,
  FIELD_W,
  HALL_Y,
  LANES,
  LANE_W,
  LIVES,
  ROWS,
  SLOT_HALF,
  build,
  hpScale,
  laneX,
  newLanes,
  rowY,
  step,
  type DefenseKind,
  type LanesGame,
} from './logic';

const COUNTDOWN = 2400;

const summary = (g: LanesGame): WarSummary => ({
  score: g.score,
  detail: `Oleada ${g.wave} · ${g.kills} ${g.kills === 1 ? 'enemigo frenado' : 'enemigos frenados'}`,
});

export function LanesGameView({ onOver, onScore }: WarViewProps) {
  const [g0] = useState<LanesGame>(() => newLanes());
  const game = useRef<LanesGame>(g0);
  const start = useRef(performance.now() + COUNTDOWN);
  const flashes = useRef<Flash[]>([]);
  const shakeUntil = useRef(0);
  const banner = useRef<{ text: string; until: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [pick, setPick] = useState<DefenseKind>('archer');
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
          tone(760, 0.05, 'triangle', 0.04);
          cb.current.onScore(summary(g));
        }
        if (ev.broken) tone(180, 0.12, 'sawtooth', 0.04);
        if (ev.leaked) {
          shakeUntil.current = t + 400;
          vibrate([60, 40, 60]);
          tone(100, 0.3, 'sawtooth', 0.06);
          flashes.current.push({ id: nextFlashId(), x: FIELD_W / 2, y: HALL_Y - 4, text: '¡Han entrado!', good: false, at: t });
        }
        if (ev.waveCleared) {
          banner.current = { text: `🚧 ¡Oleada ${g.wave} frenada! +${20 + 5 * g.wave} 💰`, until: t + 2000 };
          tone(660, 0.1, 'triangle', 0.05);
          cb.current.onScore(summary(g));
        }
        if (ev.waveStart && g.wave % 5 === 0) banner.current = { text: `🐏 Oleada ${g.wave}: ¡viene un ariete!`, until: t + 1800 };
        if (ev.lost) {
          shakeUntil.current = t + 700;
          vibrate([80, 50, 160]);
          tone(80, 0.5, 'sawtooth', 0.07);
          endTimer = setTimeout(() => cb.current.onOver(summary(g)), 1400);
        }
      }
      flashes.current = flashes.current.filter((x) => t - x.at < FLASH_MS);
      setFrame((f) => f + 1);
      if (g.over && t >= shakeUntil.current && flashes.current.length === 0) return;
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
    if (g.over) return;
    const p = toField(svg.current, e.clientX, e.clientY);
    const lane = Math.floor(p.x / LANE_W);
    let row = -1;
    for (let r = 0; r < ROWS; r++) if (Math.abs(p.y - rowY(r)) <= SLOT_HALF + 2) row = r;
    if (lane < 0 || lane >= LANES || row < 0) return;
    const r = build(g, pick, lane, row);
    if (r === 'ok') {
      tone(520, 0.06, 'square', 0.03);
      vibrate(8);
      return;
    }
    if (r === 'money') {
      flashes.current.push({ id: nextFlashId(), x: laneX(lane), y: rowY(row), text: `Faltan ${Math.ceil(DEFENSES[pick].cost - g.money)} 💰`, good: false, at: t });
      tone(200, 0.06, 'square', 0.03);
    }
  };

  const g = game.current;
  const t = performance.now();
  const counting = t < start.current;
  const countNum = Math.ceil((start.current - t) / 800);
  const money = Math.floor(g.money);
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
          <small>Ayuntamiento</small>
          <b className={g.lives <= 2 ? 'hot' : ''}>
            {g.lives}/{LIVES}
          </b>
        </div>
      </div>
      <svg
        ref={svg}
        className="war-field lanes-field"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        preserveAspectRatio="xMidYMax meet"
        onPointerDown={onDown}
        role="img"
        aria-label={`Oleada ${g.wave}: ${g.enemies.length} enemigos en las calles, ${g.lives} vidas`}
      >
        {Array.from({ length: LANES }, (_, l) => (
          <g key={l}>
            <rect x={l * LANE_W + 4} y={0} width={LANE_W - 8} height={HALL_Y} className="lanes-street" />
            <path d={`M${laneX(l)} 2V${HALL_Y}`} className="lanes-dash" />
          </g>
        ))}
        {Array.from({ length: LANES - 1 }, (_, l) => (
          <rect key={l} x={(l + 1) * LANE_W - 4} y={0} width={8} height={HALL_Y} className="lanes-block" />
        ))}
        {/* Casillas para construir */}
        {g.defenses.map((col, l) =>
          col.map((d, r) => (
            <rect
              key={`${l}-${r}`}
              x={laneX(l) - SLOT_HALF}
              y={rowY(r) - SLOT_HALF}
              width={SLOT_HALF * 2}
              height={SLOT_HALF * 2}
              rx={2.5}
              className={d ? 'lanes-slot taken' : money >= DEFENSES[pick].cost ? 'lanes-slot free' : 'lanes-slot'}
            />
          )),
        )}
        {g.tracers.map((tr, i) => (
          <line key={i} x1={laneX(tr.lane)} y1={tr.y0 - 4} x2={laneX(tr.lane)} y2={tr.y1} className={`lanes-tracer ${tr.kind}`} />
        ))}
        {g.defenses.map((col) =>
          col.map((d) => {
            if (!d) return null;
            const x = laneX(d.lane);
            const y = rowY(d.row);
            const max = DEFENSES[d.kind].hp;
            return (
              <g key={`${d.lane}-${d.row}`} className="lanes-def">
                <text x={x} y={y + 3.2} fontSize={9} textAnchor="middle">
                  {DEFENSES[d.kind].emoji}
                </text>
                {d.hp < max && (
                  <>
                    <rect x={x - 7} y={y + SLOT_HALF - 2.2} width={14} height={1.4} className="lanes-bar" />
                    <rect x={x - 7} y={y + SLOT_HALF - 2.2} width={(14 * d.hp) / max} height={1.4} className="lanes-bar hp" />
                  </>
                )}
              </g>
            );
          }),
        )}
        {g.enemies.map((e) => {
          const x = laneX(e.lane);
          const max = Math.round(ENEMIES[e.kind].hp * hpScale(g.wave));
          return (
            <g key={e.id} className={`lanes-enemy${e.hurt > 0 ? ' hurt' : ''}`}>
              <text x={x} y={e.y + 3} fontSize={e.kind === 'ram' ? 10 : 7.5} textAnchor="middle">
                {ENEMIES[e.kind].emoji}
              </text>
              <rect x={x - 5} y={e.y - 6} width={10} height={1.2} className="lanes-bar" />
              <rect x={x - 5} y={e.y - 6} width={(10 * Math.max(0, e.hp)) / Math.max(max, e.hp)} height={1.2} className="lanes-bar foe" />
            </g>
          );
        })}
        {/* Ayuntamiento */}
        <rect x={0} y={HALL_Y} width={FIELD_W} height={FIELD_H - HALL_Y} className="lanes-hall" />
        <text x={FIELD_W / 2} y={HALL_Y + 12} fontSize={10} textAnchor="middle">
          🏛️
        </text>
        {flashes.current.map((f) => (
          <text
            key={f.id}
            x={f.x}
            y={f.y - ((t - f.at) / FLASH_MS) * 6}
            fontSize={3.8}
            textAnchor="middle"
            className={`war-flash${f.good ? '' : ' bad'}`}
            opacity={1 - (t - f.at) / FLASH_MS}
          >
            {f.text}
          </text>
        ))}
      </svg>
      <div className="lanes-bar-row">
        <span className="lanes-money" aria-label={`Dinero: ${money}`}>
          💰 {money}
        </span>
        {DEFENSE_KINDS.map((k) => {
          const d = DEFENSES[k];
          return (
            <button key={k} className={`lanes-pick${pick === k ? ' on' : ''}${money < d.cost ? ' poor' : ''}`} onClick={() => setPick(k)} aria-pressed={pick === k}>
              <span>{d.emoji}</span>
              <small>
                {d.name} · {d.cost}
              </small>
            </button>
          );
        })}
      </div>
      <p className="hint">
        Elige una defensa abajo y toca una casilla de la calle para construirla. 🏹 dispara calle arriba, 🚧 aguanta golpes y 💣 daña a todo el grupo. Ganas 💰 con el tiempo y con cada enemigo.
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{countNum > 0 ? countNum : '¡Defiende!'}</span>
        </div>
      )}
      {!counting && !g.over && showBanner && (
        <div className="countdown war-banner">
          <span>{showBanner}</span>
        </div>
      )}
      {g.over && (
        <div className="countdown war-banner">
          <span>🏛️ ¡Tomaron el ayuntamiento!</span>
        </div>
      )}
    </div>
  );
}

export function LanesScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="lanes" label="Puntos de defensa" view={(p) => <LanesGameView {...p} />} onClose={onClose} />;
}
