import { useRef, useState } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt, fmtTime } from '../../game/format';
import { useGame, type StackReward } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { MetroGame } from './MetroGame';

export function MetroScreen({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ score: number; reward: StackReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => st.s.metroBest);
  const live = useRef({ score: 0, rewarded: false });

  const handleOver = (score: number) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardMetro(score);
    if (reward.newBest && score > 0) submitScore('metro', score, store.s.name).catch(() => {});
    track('minigame_end', { game: 'metro', score });
    sfx(reward.newBest ? 'win' : 'buy');
    if (reward.newBest) celebrate(4);
    setResult({ score, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'metro' });
    live.current = { score: 0, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir a mitad de partida cobra los viajeros que ya llegaron
  const close = () => {
    if (!live.current.rewarded && live.current.score > 0) {
      handleOver(live.current.score);
      useGame.getState().toast(`🚇 Cobraste ${live.current.score} viajeros`);
    }
    onClose();
  };

  return (
    <GameScreen title="Metro" right={`🏆 ${best}`} onClose={close}>
      <MetroGame key={run} onGameOver={handleOver} onScore={(n) => (live.current.score = n)} />
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🚇</div>
            <div className="result-label">Viajeros que llegaron</div>
            <div className="result-score">{result.score}</div>
            {result.reward.newBest && result.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.mult > 1 ? (
                <li>
                  ⚡ Boost x{result.reward.mult} durante {fmtTime(result.reward.seconds)}
                </li>
              ) : (
                <li className="muted">Lleva a 20 viajeros para ganar un boost</li>
              )}
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
