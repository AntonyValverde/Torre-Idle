import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt } from '../../game/format';
import { useGame, type ThiefReward } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';

type Kind = 'thief' | 'gold' | 'neighbor';

interface Actor {
  id: number;
  kind: Kind;
  emoji: string;
  born: number;
  life: number;
  hit: null | { at: number; text: string; good: boolean };
}

const COLS = 3;
const ROWS = 4;
const HOLES = COLS * ROWS;
const DURATION = 30_000;
const COUNTDOWN = 2400;
const NEIGHBORS = ['👵', '🧓', '👩', '👨', '🧒', '👩‍🍳'];

interface Game {
  start: number;
  holes: (Actor | null)[];
  score: number;
  combo: number;
  bestCombo: number;
  penalty: number;
  nextSpawn: number;
  over: boolean;
  shakeUntil: number;
}

let actorId = 0;

function newGame(): Game {
  const t = performance.now();
  return { start: t + COUNTDOWN, holes: Array(HOLES).fill(null), score: 0, combo: 0, bestCombo: 0, penalty: 0, nextSpawn: t + COUNTDOWN, over: false, shakeUntil: 0 };
}

function comboMult(combo: number) {
  return 1 + Math.floor(combo / 5);
}

function ThiefGame({ onOver, onScore }: { onOver: (score: number) => void; onScore: (score: number) => void }) {
  const game = useRef<Game>(newGame());
  const [, setFrame] = useState(0);
  const onOverRef = useRef(onOver);
  const onScoreRef = useRef(onScore);
  useEffect(() => {
    onOverRef.current = onOver;
    onScoreRef.current = onScore;
  });

  useEffect(() => {
    let raf = 0;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (t: number) => {
      const g = game.current;
      if (!g.over && t >= g.start) {
        const elapsed = t - g.start + g.penalty;
        const p = Math.min(1, elapsed / DURATION);
        // Salen y desaparecen
        for (let i = 0; i < HOLES; i++) {
          const a = g.holes[i];
          if (!a) continue;
          if (a.hit && t - a.hit.at > 380) g.holes[i] = null;
          else if (!a.hit && t - a.born > a.life) {
            if (a.kind !== 'neighbor') g.combo = 0; // se escapó
            g.holes[i] = null;
          }
        }
        const active = g.holes.filter((a) => a && !a.hit).length;
        const maxActive = 1 + Math.floor(p * 3);
        if (t >= g.nextSpawn && active < maxActive) {
          const free = g.holes.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
          if (free.length) {
            const i = free[Math.floor(Math.random() * free.length)];
            const r = Math.random();
            const kind: Kind = r < 0.07 ? 'gold' : r < 0.07 + 0.2 + p * 0.12 ? 'neighbor' : 'thief';
            g.holes[i] = {
              id: ++actorId,
              kind,
              emoji: kind === 'gold' ? '🥷' : kind === 'thief' ? '🦹' : NEIGHBORS[Math.floor(Math.random() * NEIGHBORS.length)],
              born: t,
              life: 1300 - p * 650,
              hit: null,
            };
          }
          g.nextSpawn = t + (900 - p * 520) * (0.7 + Math.random() * 0.6);
        }
        if (elapsed >= DURATION) {
          g.over = true;
          endTimer = setTimeout(() => onOverRef.current(g.score), 700);
        }
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
    };
  }, []);

  const hitHole = (i: number) => {
    const g = game.current;
    const a = g.holes[i];
    const t = performance.now();
    if (g.over || t < g.start || !a || a.hit) return;
    if (a.kind === 'neighbor') {
      g.combo = 0;
      g.penalty += 3000;
      g.shakeUntil = t + 350;
      a.hit = { at: t, text: '-3 s', good: false };
      vibrate([60, 40, 60]);
      sfx('error');
      return;
    }
    const mult = comboMult(g.combo);
    const pts = (a.kind === 'gold' ? 5 : 1) * mult;
    g.score += pts;
    onScoreRef.current?.(g.score);
    g.combo++;
    g.bestCombo = Math.max(g.bestCombo, g.combo);
    a.hit = { at: t, text: `+${pts}`, good: true };
    vibrate(a.kind === 'gold' ? [15, 20, 15] : 10);
    tone(a.kind === 'gold' ? 1320 : 660 + Math.min(g.combo, 20) * 25, 0.05, 'square', 0.04);
  };

  const g = game.current;
  const t = performance.now();
  const counting = t < g.start;
  const elapsed = Math.max(0, t - g.start + g.penalty);
  const left = Math.max(0, DURATION - elapsed);
  const countNum = Math.ceil((g.start - t) / 800);

  return (
    <div className={`thief-wrap${t < g.shakeUntil ? ' shake' : ''}`}>
      <div className="thief-hud">
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Combo</small>
          <b className={g.combo >= 5 ? 'hot' : ''}>
            {g.combo} {comboMult(g.combo) > 1 && <span>x{comboMult(g.combo)}</span>}
          </b>
        </div>
        <div>
          <small>Tiempo</small>
          <b>{Math.ceil(left / 1000)} s</b>
        </div>
      </div>
      <div className="thief-timer">
        <div style={{ width: `${(left / DURATION) * 100}%` }} />
      </div>
      <div className="thief-building">
        <div className="thief-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {g.holes.map((a, i) => (
            <button key={i} className="thief-window" onPointerDown={() => hitHole(i)} aria-label={`Ventana ${i + 1}`}>
              {a && (
                <span key={a.id} className={`actor ${a.kind}${a.hit ? (a.hit.good ? ' caught' : ' wrong') : ''}`}>
                  {a.hit ? (a.hit.good ? '💥' : '😡') : a.emoji}
                </span>
              )}
              {a?.hit && <span className={`actor-pts${a.hit.good ? '' : ' bad'}`}>{a.hit.text}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        Toca a los ladrones 🦹 (el 🥷 dorado vale x5). ¡No toques a los vecinos! Cada 5 seguidos sube el multiplicador.
      </p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{countNum > 0 ? countNum : '¡Ya!'}</span>
        </div>
      )}
      {g.over && (
        <div className="countdown">
          <span>¡Tiempo!</span>
        </div>
      )}
    </div>
  );
}

export function ThiefScreen({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ score: number; reward: ThiefReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => st.s.thiefBest);
  const live = useRef({ score: 0, rewarded: false });

  const handleOver = (score: number) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardThief(score);
    if (reward.newBest && score > 0) submitScore('thief', score, store.s.name).catch(() => {});
    track('minigame_end', { game: 'thief', score });
    sfx(reward.newBest ? 'win' : 'buy');
    setResult({ score, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'thief' });
    live.current = { score: 0, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir antes de tiempo cobra lo que ya llevabas
  const close = () => {
    if (!live.current.rewarded && live.current.score > 0) {
      handleOver(live.current.score);
      useGame.getState().toast(`🦹 Cobraste ${live.current.score} puntos`);
    }
    onClose();
  };

  return (
    <GameScreen title="Atrapa al ladrón" right={`🏆 ${best}`} onClose={close}>
      <ThiefGame key={run} onOver={handleOver} onScore={(n) => (live.current.score = n)} />
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🚔</div>
            <div className="result-label">Ladrones atrapados</div>
            <div className="result-score">{result.score}</div>
            {result.reward.newBest && result.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.gems > 0 ? <li>+{result.reward.gems} 💎</li> : <li className="muted">Llega a 30 puntos para ganar gemas</li>}
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
