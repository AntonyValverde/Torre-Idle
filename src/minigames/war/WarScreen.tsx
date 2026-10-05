import { useRef, useState, type ReactNode } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt } from '../../game/format';
import { useGame, type ThiefReward } from '../../game/store';
import { WAR_INFO, warBest, warFirstGems, type WarGame } from '../../game/war';
import { celebrate } from '../../ui/celebrate';
import { sfx } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import './war.css';

/** Cómo acabó una partida: la puntuación y una línea de detalle para el resultado. */
export interface WarSummary {
  score: number;
  detail: string;
}

export interface WarViewProps {
  onOver: (sum: WarSummary) => void;
  onScore: (sum: WarSummary) => void;
}

/**
 * Pantalla común de los juegos de guerra del arcade: cobra el premio al acabar (o al salir a mitad),
 * sube el récord y ofrece otra partida por un ticket. Cada juego solo pone su vista.
 */
export function WarScreen({ game, label, view, onClose }: { game: WarGame; label: string; view: (p: WarViewProps) => ReactNode; onClose: () => void }) {
  const info = WAR_INFO[game];
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ sum: WarSummary; reward: ThiefReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => warBest(st.s, game));
  const live = useRef<{ sum: WarSummary; rewarded: boolean }>({ sum: { score: 0, detail: '' }, rewarded: false });

  const handleOver = (sum: WarSummary) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardWar(game, sum.score);
    if (reward.newBest && sum.score > 0) submitScore(game, sum.score, store.s.name).catch(() => {});
    track('minigame_end', { game, score: sum.score });
    sfx(reward.newBest ? 'win' : 'buy');
    if (reward.newBest) celebrate(4);
    setResult({ sum, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game });
    live.current = { sum: { score: 0, detail: '' }, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir a mitad de partida cobra lo que ya llevabas
  const close = () => {
    if (!live.current.rewarded && live.current.sum.score > 0) {
      handleOver(live.current.sum);
      useGame.getState().toast(`${info.emoji} Cobraste ${live.current.sum.score} puntos`);
    }
    onClose();
  };

  return (
    <GameScreen title={info.name} right={`🏆 ${best}`} onClose={close}>
      <div key={run} className="war-host">
        {view({ onOver: handleOver, onScore: (sum) => (live.current.sum = sum) })}
      </div>
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">{info.emoji}</div>
            <div className="result-label">{label}</div>
            <div className="result-score">{result.sum.score}</div>
            {result.reward.newBest && result.sum.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            {result.sum.detail && (
              <p className="muted" style={{ margin: 0 }}>
                {result.sum.detail}
              </p>
            )}
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.gems > 0 ? <li>+{result.reward.gems} 💎</li> : <li className="muted">Llega a {warFirstGems(game)} puntos para ganar gemas</li>}
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

/** Texto flotante (puntos, avisos) en coordenadas del campo. */
export interface Flash {
  id: number;
  x: number;
  y: number;
  text: string;
  good: boolean;
  at: number;
}

let flashId = 0;
export const nextFlashId = () => ++flashId;
export const FLASH_MS = 900;

/** Pasa un toque en pantalla a coordenadas del viewBox de un SVG. */
export function toField(svg: SVGSVGElement | null, clientX: number, clientY: number): { x: number; y: number } {
  const m = svg?.getScreenCTM();
  if (!svg || !m) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
