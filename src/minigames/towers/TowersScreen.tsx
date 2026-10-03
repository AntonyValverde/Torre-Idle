import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt, fmtClock } from '../../game/format';
import { useGame, type ThiefReward } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import {
  BATTLE_MS,
  FIELD_H,
  FIELD_W,
  NEUTRAL,
  PLAYER,
  isAi,
  linked,
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
}

let flashId = 0;

const radius = (t: Tower) => (t.big ? 7.5 : 6);

export function TowersGameView({ onOver, onScore }: { onOver: (r: TowersSummary) => void; onScore: (r: TowersSummary) => void }) {
  const init = useRef<ReturnType<typeof randomTowers> | null>(null);
  if (!init.current) init.current = randomTowers();
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

  const summary = (g: TowersGame): TowersSummary => ({ score: g.score, won: g.won, captured: g.captured });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      let g = game.current;
      if (g.state === 'won' && t >= nextAt.current) {
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
        }
        if (ev.battleLost) {
          vibrate([80, 50, 160]);
          tone(90, 0.4, 'sawtooth', 0.06);
          endTimer = setTimeout(() => cb.current.onOver(summary(g)), 1400);
        }
      }
      flashes.current = flashes.current.filter((x) => t - x.at < 900);
      setFrame((f) => f + 1);
      if (g.over && flashes.current.length === 0) return;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
    };
  }, [rand]);

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
  const left = Math.max(0, BATTLE_MS - g.t);
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
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Batalla</small>
          <b>{g.battle}</b>
        </div>
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
        <g className="towers-links">
          {links.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={g.towers[a].x}
              y1={g.towers[a].y}
              x2={g.towers[b].x}
              y2={g.towers[b].y}
              className={active === a || active === b ? 'hot' : ''}
            />
          ))}
        </g>
        {dragTo && (
          <line x1={g.towers[dragTo.from].x} y1={g.towers[dragTo.from].y} x2={dragTo.x} y2={dragTo.y} className="towers-aim" stroke={COLORS[PLAYER]} />
        )}
        {g.packets.map((p, i) => {
          const pos = packetPos(g, p);
          return (
            <g key={i} className="towers-packet">
              <circle cx={pos.x} cy={pos.y} r={2.6} fill={COLORS[p.owner]} />
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
              {active === i && <circle cx={tw.x} cy={tw.y} r={r + 2.6} className="towers-sel" />}
              {target && <circle cx={tw.x} cy={tw.y} r={r + 2} className="towers-target" />}
              <circle cx={tw.x} cy={tw.y} r={r} fill="#141a33" stroke={COLORS[tw.owner]} strokeWidth={1.4} />
              <circle cx={tw.x} cy={tw.y} r={r - 1.6} fill={COLORS[tw.owner]} opacity={tw.owner === NEUTRAL ? 0.35 : 0.8} />
              {tw.big && <path d={`M${tw.x - 3} ${tw.y - r - 0.6}h1.4v-1.4h1.2v1.4h0.8v-1.4h1.2v1.4h1.4v-2.6h-6z`} fill={COLORS[tw.owner]} />}
              <text x={tw.x} y={tw.y + (tw.big ? 1.7 : 1.4)} fontSize={tw.big ? 4.6 : 3.9} textAnchor="middle" className="towers-units">
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
        Arrastra desde una torre azul hasta una vecina (o toca una y luego la otra) para enviar todos sus soldados. Ojo: la torre queda vacía. Gana quien conquiste
        todas las torres rivales.
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{g.battle > 1 && countNum >= 2 ? `Batalla ${g.battle}` : countNum > 0 ? countNum : '¡Ya!'}</span>
        </div>
      )}
      {g.state === 'won' && (
        <div className="countdown towers-banner">
          <span>🏰 ¡Batalla ganada!</span>
        </div>
      )}
      {g.state === 'lost' && (
        <div className="countdown towers-banner">
          <span>{g.t >= BATTLE_MS ? '⏱️ ¡Se acabó el tiempo!' : '💥 ¡Te conquistaron!'}</span>
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
  const live = useRef<{ sum: TowersSummary; rewarded: boolean }>({ sum: { score: 0, won: 0, captured: 0 }, rewarded: false });

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
    live.current = { sum: { score: 0, won: 0, captured: 0 }, rewarded: false };
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
