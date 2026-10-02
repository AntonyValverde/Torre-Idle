import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt } from '../../game/format';
import { useGame, type ThiefReward } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { COLS, LOSE_AT, WATER_MAX, burning, newFire, spray, step, type FireGame } from './logic';

const COUNTDOWN = 2400;

interface Splash {
  id: number;
  cell: number;
  text: string;
  good: boolean;
  at: number;
}

let splashId = 0;

export function FireGameView({ onOver, onScore }: { onOver: (score: number) => void; onScore: (score: number) => void }) {
  const game = useRef<FireGame>(newFire());
  const start = useRef(performance.now() + COUNTDOWN);
  const splashes = useRef<Splash[]>([]);
  const shakeUntil = useRef(0);
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
        if (ev.spread) tone(180, 0.08, 'sawtooth', 0.025);
        if (ev.lost) {
          shakeUntil.current = t + 600;
          vibrate([80, 50, 160]);
          tone(90, 0.4, 'sawtooth', 0.06);
          endTimer = setTimeout(() => cb.current.onOver(g.score), 1200);
        }
      }
      splashes.current = splashes.current.filter((x) => t - x.at < 500);
      setFrame((f) => f + 1);
      // Al terminar, cuando acaban la sacudida y los textos, deja de animar (y de volver a pintar)
      if (g.over && t >= shakeUntil.current && splashes.current.length === 0) return;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
    };
  }, []);

  const hit = (i: number) => {
    const g = game.current;
    const t = performance.now();
    if (g.over || t < start.current) return;
    const r = spray(g, i);
    if (r.kind === 'empty') {
      tone(220, 0.06, 'square', 0.03);
      splashes.current.push({ id: ++splashId, cell: i, text: 'Sin agua', good: false, at: t });
      return;
    }
    if (r.kind === 'miss') {
      vibrate(5);
      return;
    }
    cb.current.onScore(g.score);
    vibrate(r.out ? [10, 20, 10] : 8);
    tone(r.out ? 1040 : 620, 0.05, 'triangle', 0.04);
    splashes.current.push({ id: ++splashId, cell: i, text: `+${r.points}`, good: true, at: t });
  };

  const g = game.current;
  const t = performance.now();
  const counting = t < start.current;
  const countNum = Math.ceil((start.current - t) / 800);
  const lit = burning(g);
  const danger = lit / LOSE_AT;

  return (
    <div className={`thief-wrap fire-wrap${t < shakeUntil.current ? ' shake' : ''}`}>
      <div className="thief-hud">
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Apagados</small>
          <b>{g.putOut}</b>
        </div>
        <div>
          <small>En llamas</small>
          <b className={danger >= 0.75 ? 'hot' : ''}>
            {lit}/{LOSE_AT}
          </b>
        </div>
      </div>
      <div className="fire-danger" aria-hidden="true">
        <div style={{ width: `${Math.min(1, danger) * 100}%` }} />
      </div>
      <div className="thief-building fire-building">
        <div className="thief-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {g.level.map((lv, i) => (
            <button key={i} className={`thief-window fire-window lv${lv}`} onPointerDown={() => hit(i)} aria-label={`Ventana ${i + 1}${lv ? `, fuego nivel ${lv}` : ''}`}>
              {lv > 0 && <span className="fire-flame">🔥</span>}
              {lv === 3 && <span className="fire-smoke">💨</span>}
              {splashes.current
                .filter((x) => x.cell === i)
                .map((x) => (
                  <span key={x.id} className={`actor-pts${x.good ? '' : ' bad'}`}>
                    {x.text}
                  </span>
                ))}
            </button>
          ))}
        </div>
      </div>
      <div className="fire-water" aria-label={`Agua: ${g.water} de ${WATER_MAX}`}>
        <span>💧</span>
        <div className="fire-tank">
          {Array.from({ length: WATER_MAX }, (_, k) => (
            <i key={k} className={k < g.water ? 'on' : ''} />
          ))}
        </div>
      </div>
      <p className="hint">Toca las ventanas en llamas: cada chorro baja el fuego un nivel. El agua se recarga sola, ¡no la malgastes! Si arden {LOSE_AT} a la vez, se pierde el edificio.</p>
      {counting && (
        <div className="countdown">
          <span key={countNum}>{countNum > 0 ? countNum : '¡Ya!'}</span>
        </div>
      )}
      {g.over && (
        <div className="countdown">
          <span>🔥 ¡Se quemó!</span>
        </div>
      )}
    </div>
  );
}

export function FireScreen({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ score: number; reward: ThiefReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => st.s.fireBest);
  const live = useRef({ score: 0, rewarded: false });

  const handleOver = (score: number) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardFire(score);
    if (reward.newBest && score > 0) submitScore('fire', score, store.s.name).catch(() => {});
    track('minigame_end', { game: 'fire', score });
    sfx(reward.newBest ? 'win' : 'buy');
    if (reward.newBest) celebrate(4);
    setResult({ score, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'fire' });
    live.current = { score: 0, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir a mitad de partida cobra lo que ya llevabas
  const close = () => {
    if (!live.current.rewarded && live.current.score > 0) {
      handleOver(live.current.score);
      useGame.getState().toast(`🚒 Cobraste ${live.current.score} puntos`);
    }
    onClose();
  };

  return (
    <GameScreen title="Bomberos" right={`🏆 ${best}`} onClose={close}>
      <FireGameView key={run} onOver={handleOver} onScore={(n) => (live.current.score = n)} />
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🚒</div>
            <div className="result-label">Puntos de bombero</div>
            <div className="result-score">{result.score}</div>
            {result.reward.newBest && result.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.gems > 0 ? <li>+{result.reward.gems} 💎</li> : <li className="muted">Llega a 60 puntos para ganar gemas</li>}
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
