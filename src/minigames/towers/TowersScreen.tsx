import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt, fmtClock } from '../../game/format';
import { useGame, type ThiefReward } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { mulberry32 } from '../rng';
import {
  FIELD_H,
  FIELD_W,
  NEUTRAL,
  PLAYER,
  assaultMult,
  fmtMult,
  isAi,
  linked,
  newAssault,
  nextBattle,
  ownedBy,
  packetPos,
  randomTowers,
  send,
  step,
  type Tower,
  type TowersGame,
} from './logic';

const COUNTDOWN = 2400;
/** Cuenta atrás corta antes de cada batalla siguiente. */
const NEXT_COUNTDOWN = 1200;
/** Tiempo con el cartel de "¡Batalla ganada!" antes de pasar a la siguiente. */
const BETWEEN = 1800;
const COLORS: Record<number, string> = { 0: '#8b90a8', 1: '#3fb4ff', 2: '#ff5a5f', 3: '#ffb02e' };

interface Flash {
  id: number;
  x: number;
  y: number;
  text: string;
  good: boolean;
  at: number;
}

export interface TowersSummary {
  score: number;
  won: number;
  captured: number;
  /** Bono del asalto (en una partida normal no se usa). */
  mult: number;
}

let flashId = 0;

const radius = (t: Tower) => (t.big ? 7.5 : 6);

/** Silueta de una torre de castillo centrada en (x, y): cuerpo con tres almenas arriba. */
function towerPath(x: number, y: number, r: number): string {
  const w = r * 1.45;
  const x0 = x - w / 2;
  const top = y - r * 0.95;
  const bot = y + r * 0.8;
  const m = r * 0.32;
  const c = w / 5;
  // Un poco más ancha abajo, como una torre de piedra
  return `M${x0 - r * 0.1} ${bot}L${x0} ${top}h${c}v${m}h${c}v${-m}h${c}v${m}h${c}v${-m}h${c}L${x0 + w + r * 0.1} ${bot}z`;
}

/** Puerta en arco al pie de la torre. */
function doorPath(x: number, y: number, r: number): string {
  const w = r * 0.42;
  const bot = y + r * 0.8;
  return `M${x - w / 2} ${bot}v${-r * 0.3}a${w / 2} ${w / 2} 0 0 1 ${w} 0v${r * 0.3}z`;
}

/**
 * Pantalla de la Guerra de torres. Con `assault` es una sola batalla corta (el asalto de la Conquista)
 * que termina al ganarla, perderla o acabarse el tiempo; lo que cuenta es el bono.
 */
export function TowersGameView({
  onOver,
  onScore,
  assault,
}: {
  onOver: (r: TowersSummary) => void;
  onScore: (r: TowersSummary) => void;
  assault?: { level: number };
}) {
  const init = useRef<ReturnType<typeof randomTowers> | null>(null);
  if (!init.current) {
    if (assault) {
      const r = mulberry32(Math.floor(Math.random() * 2 ** 32));
      init.current = { game: newAssault(assault.level, r), rand: r };
    } else init.current = randomTowers();
  }
  const single = !!assault;
  const rand = init.current.rand;
  const game = useRef<TowersGame>(init.current.game);
  const start = useRef(performance.now() + COUNTDOWN);
  const nextAt = useRef(0);
  const flashes = useRef<Flash[]>([]);
  const drag = useRef<{ from: number; x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [, setFrame] = useState(0);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });

  const summary = (g: TowersGame): TowersSummary => ({ score: g.score, won: g.won, captured: g.captured, mult: assaultMult(g) });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      let g = game.current;
      if (g.state === 'won' && !single && t >= nextAt.current) {
        g = game.current = nextBattle(g, rand);
        start.current = t + NEXT_COUNTDOWN;
        drag.current = null;
        setSel(null);
      }
      if (g.state === 'play' && t >= start.current) {
        const before = g.towers.map((x) => x.owner);
        const ev = step(g, dt, rand);
        g.towers.forEach((x, i) => {
          if (x.owner === before[i]) return;
          if (x.owner === PLAYER) flashes.current.push({ id: ++flashId, x: x.x, y: x.y, text: '+1', good: true, at: t });
          else if (before[i] === PLAYER) flashes.current.push({ id: ++flashId, x: x.x, y: x.y, text: '¡Perdida!', good: false, at: t });
        });
        if (ev.captured) {
          tone(880, 0.08, 'triangle', 0.05);
          vibrate([10, 20, 10]);
        }
        if (ev.lost) tone(160, 0.15, 'sawtooth', 0.04);
        if (ev.captured || ev.battleWon) cb.current.onScore(summary(g));
        if (ev.battleWon) {
          nextAt.current = t + BETWEEN;
          sfx('win');
          celebrate(2);
          if (single) endTimer = setTimeout(() => cb.current.onOver(summary(g)), 1400);
        }
        if (ev.battleLost) {
          vibrate([80, 50, 160]);
          tone(90, 0.4, 'sawtooth', 0.06);
          endTimer = setTimeout(() => cb.current.onOver(summary(g)), 1400);
        }
      }
      flashes.current = flashes.current.filter((x) => t - x.at < 900);
      setFrame((f) => f + 1);
      if ((g.over || (single && g.state !== 'play')) && flashes.current.length === 0) return;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
    };
  }, [rand, single]);

  const toField = (e: ReactPointerEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const towerAt = (p: { x: number; y: number }): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    game.current.towers.forEach((t, i) => {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      // Se perdona un poco de puntería: los dedos son gordos
      if (d <= radius(t) + 5 && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };

  const ready = () => game.current.state === 'play' && performance.now() >= start.current;

  const order = (from: number, to: number) => {
    const g = game.current;
    if (send(g, from, to) > 0) {
      tone(520, 0.05, 'square', 0.03);
      vibrate(8);
      return;
    }
    const t = g.towers[to];
    flashes.current.push({ id: ++flashId, x: t.x, y: t.y, text: linked(g, from, to) ? 'Sin soldados' : 'Sin camino', good: false, at: performance.now() });
    tone(200, 0.06, 'square', 0.03);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!ready()) return;
    const p = toField(e);
    const i = towerAt(p);
    // Con una torre elegida, tocar otra envía soldados hacia ella
    if (sel !== null && i !== null && i !== sel) {
      order(sel, i);
      setSel(null);
      return;
    }
    if (i !== null && game.current.towers[i].owner === PLAYER) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { from: i, ...p };
    } else setSel(null);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current) drag.current = { ...drag.current, ...toField(e) };
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !ready()) return;
    const j = towerAt(toField(e));
    if (j === null) return;
    if (j === d.from) setSel(sel === j ? null : j);
    else order(d.from, j);
  };

  const g = game.current;
  const t = performance.now();
  const counting = g.state === 'play' && t < start.current;
  const countNum = Math.ceil((start.current - t) / 800);
  const left = Math.max(0, g.limit - g.t);
  const total = g.towers.length;
  const mine = ownedBy(g, PLAYER);
  const neutral = ownedBy(g, NEUTRAL);
  const active = drag.current?.from ?? sel;
  const dragTo = drag.current;

  const links: [number, number][] = [];
  g.adj.forEach((ns, a) => ns.forEach((b) => a < b && links.push([a, b])));

  return (
    <div className="towers-wrap">
      <div className="thief-hud">
        {single ? (
          <div>
            <small>Bono</small>
            <b>{fmtMult(assaultMult(g))}</b>
          </div>
        ) : (
          <>
            <div>
              <small>Puntos</small>
              <b>{g.score}</b>
            </div>
            <div>
              <small>Batalla</small>
              <b>{g.battle}</b>
            </div>
          </>
        )}
        <div>
          <small>Tiempo</small>
          <b className={left < 15_000 ? 'hot' : ''}>{fmtClock(left)}</b>
        </div>
      </div>
      <div className="towers-share" aria-label={`Tus torres: ${mine} de ${total}`}>
        <i style={{ flex: mine, background: COLORS[PLAYER] }} />
        <i style={{ flex: neutral, background: COLORS[NEUTRAL] }} />
        <i style={{ flex: total - mine - neutral, background: COLORS[2] }} />
      </div>
      <svg
        ref={svg}
        className="towers-field"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        role="img"
        aria-label={`Batalla ${g.battle}: tienes ${mine} de ${total} torres`}
      >
        <defs>
          <linearGradient id="tw-shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
          </linearGradient>
          <pattern id="tw-grass" width="23" height="17" patternUnits="userSpaceOnUse">
            <path d="M3 12l0.8 -2.2l0.8 2.2M14 5l0.7 -2l0.7 2M19 15l0.6 -1.8l0.6 1.8M8 3.5l0.5 -1.4l0.5 1.4" fill="none" stroke="rgba(150,210,120,0.11)" strokeWidth="0.45" strokeLinecap="round" />
          </pattern>
        </defs>
        <rect width={FIELD_W} height={FIELD_H} fill="url(#tw-grass)" />
        {/* Caminos de tierra: un borde oscuro y el camino encima */}
        <g className="towers-links">
          {links.map(([a, b]) => (
            <line key={`e${a}-${b}`} x1={g.towers[a].x} y1={g.towers[a].y} x2={g.towers[b].x} y2={g.towers[b].y} className="edge" />
          ))}
          {links.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={g.towers[a].x}
              y1={g.towers[a].y}
              x2={g.towers[b].x}
              y2={g.towers[b].y}
              className={active === a || active === b ? 'road hot' : 'road'}
            />
          ))}
        </g>
        {dragTo && (
          <line x1={g.towers[dragTo.from].x} y1={g.towers[dragTo.from].y} x2={dragTo.x} y2={dragTo.y} className="towers-aim" stroke={COLORS[PLAYER]} />
        )}
        {g.packets.map((p, i) => {
          const pos = packetPos(g, p);
          // Estela: dónde estaban un poco antes
          const t1 = packetPos(g, { ...p, d: Math.max(0, p.d - 2.4) });
          const t2 = packetPos(g, { ...p, d: Math.max(0, p.d - 4.6) });
          return (
            <g key={i} className="towers-packet">
              <circle cx={t2.x} cy={t2.y} r={1.1} fill={COLORS[p.owner]} opacity={0.35} />
              <circle cx={t1.x} cy={t1.y} r={1.7} fill={COLORS[p.owner]} opacity={0.55} />
              <circle cx={pos.x} cy={pos.y} r={2.7} fill={COLORS[p.owner]} stroke="#fff" strokeWidth={0.45} />
              <text x={pos.x} y={pos.y + 1} fontSize={2.6} textAnchor="middle">
                {p.count}
              </text>
            </g>
          );
        })}
        {g.towers.map((tw, i) => {
          const r = radius(tw);
          const target = active !== null && active !== i && linked(g, active, i);
          return (
            <g key={i} className={`towers-tower${tw.owner === PLAYER ? ' mine' : ''}${isAi(tw.owner) ? ' enemy' : ''}`}>
              {/* Zona que se puede tocar (y que usan las pruebas para encontrar la torre) */}
              <circle cx={tw.x} cy={tw.y} r={r} className="towers-hit" />
              {active === i && <circle cx={tw.x} cy={tw.y} r={r + 2.8} className="towers-sel" />}
              {target && <circle cx={tw.x} cy={tw.y} r={r + 2.2} className="towers-target" />}
              <ellipse cx={tw.x} cy={tw.y + r * 0.82} rx={r * 0.95} ry={r * 0.32} className="towers-shadow" />
              <path d={towerPath(tw.x, tw.y, r)} fill={COLORS[tw.owner]} className={`towers-body${tw.owner === NEUTRAL ? ' neutral' : ''}`} />
              <path d={towerPath(tw.x, tw.y, r)} fill="url(#tw-shade)" className="towers-shine" />
              <path d={doorPath(tw.x, tw.y, r)} className="towers-door" />
              {tw.big && (
                <g className="towers-flag">
                  <path d={`M${tw.x} ${tw.y - r * 0.95}v${-r * 0.75}`} />
                  <path d={`M${tw.x} ${tw.y - r * 1.7}l${r * 0.6} ${r * 0.18}l${-r * 0.6} ${r * 0.18}z`} fill={COLORS[tw.owner]} />
                </g>
              )}
              <text x={tw.x} y={tw.y + (tw.big ? 1.4 : 1.2)} fontSize={tw.big ? 4.4 : 3.7} textAnchor="middle" className="towers-units">
                {Math.floor(tw.units)}
              </text>
            </g>
          );
        })}
        {flashes.current.map((f) => (
          <text
            key={f.id}
            x={f.x}
            y={f.y - 9 - ((t - f.at) / 900) * 6}
            fontSize={3.6}
            textAnchor="middle"
            className={`towers-flash${f.good ? '' : ' bad'}`}
            opacity={1 - (t - f.at) / 900}
          >
            {f.text}
          </text>
        ))}
      </svg>
      <p className="hint">
        {single
          ? 'Asalto: cada torre que tomes sube el bono de tus soldados, y si eliminas al rival es x1,5. Arrastra desde una torre azul hasta una vecina para enviar todos sus soldados.'
          : 'Arrastra desde una torre azul hasta una vecina (o toca una y luego la otra) para enviar todos sus soldados. Ojo: la torre queda vacía. Gana quien conquiste todas las torres rivales.'}
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>
            {countNum >= 2 && single ? '¡Al asalto!' : g.battle > 1 && countNum >= 2 ? `Batalla ${g.battle}` : countNum > 0 ? countNum : '¡Ya!'}
          </span>
        </div>
      )}
      {g.state === 'won' && (
        <div className="countdown towers-banner">
          <span>{single ? `🏰 ¡Asalto perfecto! ${fmtMult(assaultMult(g))}` : '🏰 ¡Batalla ganada!'}</span>
        </div>
      )}
      {g.state === 'lost' && (
        <div className="countdown towers-banner">
          <span>
            {g.t >= g.limit ? '⏱️ ¡Se acabó el tiempo!' : '💥 ¡Te conquistaron!'}
            {single && ` Bono ${fmtMult(assaultMult(g))}`}
          </span>
        </div>
      )}
    </div>
  );
}

export function TowersScreen({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ sum: TowersSummary; reward: ThiefReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => st.s.towersBest);
  const live = useRef<{ sum: TowersSummary; rewarded: boolean }>({ sum: { score: 0, won: 0, captured: 0, mult: 1 }, rewarded: false });

  const handleOver = (sum: TowersSummary) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardTowers(sum.score);
    if (reward.newBest && sum.score > 0) submitScore('towers', sum.score, store.s.name).catch(() => {});
    track('minigame_end', { game: 'towers', score: sum.score, battles: sum.won });
    sfx(reward.newBest ? 'win' : 'buy');
    if (reward.newBest) celebrate(4);
    setResult({ sum, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'towers' });
    live.current = { sum: { score: 0, won: 0, captured: 0, mult: 1 }, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir a mitad de partida cobra lo que ya llevabas
  const close = () => {
    if (!live.current.rewarded && live.current.sum.score > 0) {
      handleOver(live.current.sum);
      useGame.getState().toast(`🏰 Cobraste ${live.current.sum.score} puntos`);
    }
    onClose();
  };

  return (
    <GameScreen title="Guerra de torres" right={`🏆 ${best}`} onClose={close}>
      <TowersGameView key={run} onOver={handleOver} onScore={(sum) => (live.current.sum = sum)} />
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🏰</div>
            <div className="result-label">Puntos de conquista</div>
            <div className="result-score">{result.sum.score}</div>
            {result.reward.newBest && result.sum.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <p className="muted" style={{ margin: 0 }}>
              {result.sum.won} {result.sum.won === 1 ? 'batalla ganada' : 'batallas ganadas'} · {result.sum.captured}{' '}
              {result.sum.captured === 1 ? 'torre conquistada' : 'torres conquistadas'}
            </p>
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.gems > 0 ? <li>+{result.reward.gems} 💎</li> : <li className="muted">Llega a 20 puntos para ganar gemas</li>}
            </ul>
            <div className="btn-row">
              <button className="btn" onClick={onClose}>
                Volver
              </button>
              <button className="btn primary" disabled={tickets < 1} onClick={again}>
                Otra vez · 🎟️1
              </button>
            </div>
          </div>
        </Modal>
      )}
    </GameScreen>
  );
}
