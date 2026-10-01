import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt } from '../../game/format';
import { useGame, type MemoryReward } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { CELLS, COLS, extend, firstSequence, flashMs, memoryTickets } from './logic';

type Phase = 'watch' | 'play' | 'fail';

// Una nota por ventana (escala pentatónica): ayuda a recordar la secuencia de oído
const NOTES = [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175];
const LEAD_MS = 700;

export function MemoryGame({
  onOver,
  onScore,
  showPrize = true,
}: {
  onOver: (rounds: number) => void;
  onScore: (rounds: number) => void;
  /** En la Copa no se ganan tickets: no se muestra el premio. */
  showPrize?: boolean;
}) {
  const [seq, setSeq] = useState(() => firstSequence(Math.random));
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('watch');
  const [lit, setLit] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onOverRef = useRef(onOver);
  useEffect(() => {
    onOverRef.current = onOver;
  });

  useEffect(
    () => () => {
      clearTimeout(flashTimer.current);
      clearTimeout(endTimer.current);
    },
    [],
  );

  // Muestra la secuencia ventana a ventana
  useEffect(() => {
    if (phase !== 'watch') return;
    const on = flashMs(round);
    const stepMs = on * 1.5;
    const timers: ReturnType<typeof setTimeout>[] = [];
    seq.forEach((cell, k) => {
      const at = LEAD_MS + k * stepMs;
      timers.push(
        setTimeout(() => {
          setLit(cell);
          tone(NOTES[cell], (on / 1000) * 0.5);
        }, at),
      );
      timers.push(setTimeout(() => setLit(null), at + on));
    });
    timers.push(
      setTimeout(() => {
        setPos(0);
        setPhase('play');
      }, LEAD_MS + seq.length * stepMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, seq, round]);

  const press = (i: number) => {
    if (phase !== 'play') return;
    if (seq[pos] !== i) {
      // Se marca la ventana tocada y la que tocaba
      setWrong(i);
      setLit(seq[pos]);
      setPhase('fail');
      vibrate([60, 40, 60]);
      sfx('error');
      endTimer.current = setTimeout(() => onOverRef.current(round), 1300);
      return;
    }
    tone(NOTES[i], 0.12);
    vibrate(8);
    setLit(i);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setLit(null), 220);
    if (pos + 1 < seq.length) {
      setPos(pos + 1);
      return;
    }
    const r = round + 1;
    onScore(r);
    setRound(r);
    setSeq(extend(seq, Math.random));
    setPhase('watch');
  };

  const prize = memoryTickets(round);
  const status =
    phase === 'watch' ? '👀 Mira la secuencia…' : phase === 'play' ? '👆 ¡Tu turno! Repítela' : '❌ ¡Esa no era!';

  return (
    <div className="memory-wrap">
      <div className="thief-hud">
        <div>
          <small>Ronda</small>
          <b>{round + 1}</b>
        </div>
        <div>
          <small>Secuencia</small>
          <b>
            {phase === 'watch' ? 0 : pos}/{seq.length}
          </b>
        </div>
        {showPrize ? (
          <div>
            <small>Premio</small>
            <b className={prize > 0 ? 'hot' : ''}>🎟️ {prize}</b>
          </div>
        ) : (
          <div>
            <small>Superadas</small>
            <b>{round}</b>
          </div>
        )}
      </div>
      <p className={`hint${phase === 'play' ? ' strong' : ''}`}>{status}</p>
      <div className="facade">
        <div className="facade-roof" />
        <div className="facade-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {Array.from({ length: CELLS }, (_, i) => (
            <button
              key={i}
              className={`window${lit === i ? ' on' : ''}${wrong === i ? ' wrong' : ''}`}
              onPointerDown={() => press(i)}
              aria-label={`Ventana ${i + 1}`}
            />
          ))}
        </div>
        <div className="facade-door" />
      </div>
      <p className="hint">
        {showPrize
          ? 'Cada ronda la secuencia suma una ventana. Desde la ronda 5 recuperas tickets (hasta 4, sin pasar del máximo).'
          : 'Cada ronda la secuencia suma una ventana. Cuentan las rondas superadas.'}
      </p>
    </div>
  );
}

export function MemoryScreen({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ rounds: number; reward: MemoryReward } | null>(null);
  const tickets = useGame((st) => st.s.tickets);
  const best = useGame((st) => st.s.memoryBest);
  const live = useRef({ rounds: 0, rewarded: false });

  const handleOver = (rounds: number) => {
    if (live.current.rewarded) return;
    live.current.rewarded = true;
    const store = useGame.getState();
    const reward = store.rewardMemory(rounds);
    if (reward.newBest && rounds > 0) submitScore('memory', rounds, store.s.name).catch(() => {});
    track('minigame_end', { game: 'memory', score: rounds });
    sfx(reward.newBest ? 'win' : 'buy');
    if (reward.newBest) celebrate(4);
    setResult({ rounds, reward });
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'memory' });
    live.current = { rounds: 0, rewarded: false };
    setResult(null);
    setRun((r) => r + 1);
  };

  // Salir a mitad de partida cobra las rondas ya superadas
  const close = () => {
    if (!live.current.rewarded && live.current.rounds > 0) {
      handleOver(live.current.rounds);
      useGame.getState().toast(`🧠 Cobraste ${live.current.rounds} rondas`);
    }
    onClose();
  };

  return (
    <GameScreen title="Memoria de ventanas" right={`🏆 ${best}`} onClose={close}>
      <MemoryGame key={run} onOver={handleOver} onScore={(n) => (live.current.rounds = n)} />
      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🧠</div>
            <div className="result-label">Rondas superadas</div>
            <div className="result-score">{result.rounds}</div>
            {result.reward.newBest && result.rounds > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <ul className="reward-list">
              <li>+{fmt(result.reward.coins)} 🪙</li>
              {result.reward.tickets > 0 && <li>+{result.reward.tickets} 🎟️</li>}
              {result.reward.lost > 0 && <li className="muted">Tickets llenos: {result.reward.lost} 🎟️ no cupieron</li>}
              {result.reward.tickets === 0 && result.reward.lost === 0 && <li className="muted">Supera 5 rondas para recuperar tickets</li>}
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
