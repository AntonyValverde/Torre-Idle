import { useEffect, useRef, useState, type ReactElement } from 'react';
import { track } from '../../firebase';
import { now } from '../../game/clock';
import { CARDS, CUP_GAME_INFO, TRAINING_BONUS, attemptsFor, slotOpen, type CardId, type CupGame, type CupSlot } from '../../game/cup';
import { submitCupScore } from '../../game/cupCloud';
import { useGame } from '../../game/store';
import { FireGameView } from '../../minigames/fire/FireScreen';
import { MemoryGame } from '../../minigames/memory/MemoryScreen';
import { MetroGame } from '../../minigames/metro/MetroGame';
import { StackGame } from '../../minigames/stack/StackGame';
import { ThiefGame } from '../../minigames/thief/ThiefScreen';
import { TrafficGame } from '../../minigames/traffic/TrafficGame';
import { celebrate } from '../celebrate';
import { sfx } from '../haptics';
import { GameScreen, Modal } from '../Modal';
import { pushCupMusic } from '../music/engine';

type Props = { onOver: (score: number) => void; onScore: (score: number) => void };

/** El minijuego tal cual, sin sus premios: en la Copa solo cuenta la marca. */
const GAMES: Record<CupGame, (p: Props) => ReactElement> = {
  thief: (p) => <ThiefGame onOver={p.onOver} onScore={p.onScore} />,
  fire: (p) => <FireGameView onOver={p.onOver} onScore={p.onScore} />,
  memory: (p) => <MemoryGame onOver={p.onOver} onScore={p.onScore} showPrize={false} />,
  metro: (p) => <MetroGame onGameOver={p.onOver} onScore={p.onScore} />,
  traffic: (p) => <TrafficGame onGameOver={p.onOver} onScore={p.onScore} />,
  stack: (p) => <StackGame onGameOver={p.onOver} onScore={p.onScore} />,
};

/**
 * Una prueba de la Copa: cada partida gasta un intento al empezar (salir a mitad no lo devuelve)
 * y la mejor marca se sube a Firestore.
 */
export function CupPlay({
  week,
  slot,
  game,
  final,
  card: firstCard = null,
  onClose,
}: {
  week: string;
  slot: CupSlot;
  game: CupGame;
  final: boolean;
  /** Carta usada en el primer intento (los siguientes van sin carta). */
  card?: CardId | null;
  onClose: () => void;
}) {
  const info = CUP_GAME_INFO[game];
  const cup = useGame((st) => st.s.cup);
  const used = cup.used[slot];
  const best = cup.best[slot];
  const [run, setRun] = useState(0);
  const [card, setCard] = useState<CardId | null>(firstCard);
  const [result, setResult] = useState<{ raw: number; score: number; improved: boolean; refunded: boolean; card: CardId | null } | null>(null);
  const live = useRef({ score: 0, done: false });
  const left = attemptsFor(cup, week, slot) - used;

  // Tema propio de la Copa mientras dura la prueba
  useEffect(() => pushCupMusic(), []);

  const finish = (raw: number) => {
    if (live.current.done) return;
    live.current.done = true;
    const store = useGame.getState();
    const r = store.cupScore(slot, raw, card);
    if (r.improved) submitCupScore(week, slot, r.best, store.s.name).catch((e) => console.warn('Copa: no se pudo subir la marca', e));
    track('cup_attempt', { game, slot, score: r.score, card: card ?? 'none' });
    sfx(r.improved ? 'win' : 'buy');
    if (r.improved) celebrate(3);
    setResult({ raw, score: r.score, improved: r.improved, refunded: r.refunded, card });
  };

  const again = () => {
    if (!slotOpen(week, slot, now())) {
      useGame.getState().toast('⏰ Esta prueba de la Copa ya terminó');
      onClose();
      return;
    }
    if (!useGame.getState().cupAttempt(slot)) return;
    live.current = { score: 0, done: false };
    setCard(null);
    setResult(null);
    setRun((x) => x + 1);
  };

  const bonusPct = Math.round(cup.training * TRAINING_BONUS * 100);

  // Salir a mitad de partida cuenta lo que llevabas en ese intento
  const close = () => {
    if (!live.current.done && live.current.score > 0) finish(live.current.score);
    onClose();
  };

  return (
    <GameScreen title={`${final ? 'Final' : 'Copa'} · ${info.name}`} right={`${card ? CARDS[card].emoji + ' ' : ''}🎯 ${best}`} onClose={close}>
      <div className="cup-play" key={run}>
        {GAMES[game]({ onOver: finish, onScore: (n) => (live.current.score = n) })}
      </div>
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">{info.emoji}</div>
            <div className="result-label">
              {final ? 'Final de la Copa' : 'Copa de Alcaldes'} · {info.name}
            </div>
            <div className="result-score">{result.score}</div>
            {result.improved && <div className="badge-gold">¡Tu mejor marca en esta prueba!</div>}
            <ul className="reward-list">
              {result.score !== result.raw && (
                <li>
                  Marca {result.raw}
                  {bonusPct > 0 && ` · 🏋️ +${bonusPct}%`}
                  {result.card === 'boost' && ' · ⚡ +15%'}
                  {result.card === 'star' && ' · ⭐ +30%'} → {result.score}
                </li>
              )}
              {result.refunded && <li className="rare">🛡️ El escudo te devolvió el intento</li>}
              <li>
                Cuenta tu mejor intento: {best} {info.unit}
              </li>
              <li className={left > 0 ? '' : 'muted'}>{left > 0 ? `Te quedan ${left} ${left === 1 ? 'intento' : 'intentos'}` : 'Ya usaste todos los intentos'}</li>
            </ul>
            <div className="btn-row">
              <button className="btn" onClick={onClose}>
                Volver
              </button>
              <button className="btn primary" disabled={left < 1} onClick={again}>
                Otro intento
              </button>
            </div>
          </div>
        </Modal>
      )}
    </GameScreen>
  );
}
