import { useEffect, useMemo, useState } from 'react';
import { track } from '../../firebase';
import { dateKey, isNewDay, msUntilTomorrow } from '../../game/clock';
import { saveCloud, submitDaily } from '../../game/cloud';
import { fmt, fmtClock, fmtTime } from '../../game/format';
import { useGame, type DailyReward } from '../../game/store';
import { sfx, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { GRID, dailyPuzzle, isSolved, press } from './logic';

export function DailyScreen({ onClose, onRanking }: { onClose: () => void; onRanking: () => void }) {
  const date = useMemo(() => dateKey(), []);
  const puzzle = useMemo(() => dailyPuzzle(date), [date]);
  const [board, setBoard] = useState(puzzle.board);
  const [moves, setMoves] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<(DailyReward & { moves: number; timeMs: number }) | null>(null);
  const daily = useGame((st) => st.s.daily);
  const alreadyDone = !isNewDay(daily.last, date) && !result;

  useEffect(() => {
    if (startAt === null || result) return;
    const id = setInterval(() => setElapsed(Date.now() - startAt), 250);
    return () => clearInterval(id);
  }, [startAt, result]);

  const tapWindow = (i: number) => {
    if (result || alreadyDone) return;
    const t0 = startAt ?? Date.now();
    if (startAt === null) setStartAt(t0);
    const next = press(board, i);
    const m = moves + 1;
    setBoard(next);
    setMoves(m);
    vibrate(8);
    sfx('tap');
    if (!isSolved(next)) return;

    const timeMs = Date.now() - t0;
    setElapsed(timeMs);
    const store = useGame.getState();
    const reward = store.completeDaily(date, m, puzzle.par);
    if (!reward) return;
    sfx('win');
    vibrate([20, 40, 20, 40, 60]);
    track('daily_complete', { moves: m, timeMs, streak: reward.streak });
    submitDaily(date, m, timeMs, store.s.name).catch(() => {});
    saveCloud(useGame.getState().s).catch(() => {});
    setResult({ ...reward, moves: m, timeMs });
  };

  const reset = () => {
    setBoard(puzzle.board);
    setMoves(0);
  };

  const lit = board.filter(Boolean).length;

  return (
    <GameScreen title="Apagón diario" right={`🔥 ${daily.streak}`} onClose={onClose}>
      <div className="daily-wrap">
        {alreadyDone ? (
          <div className="daily-done">
            <div className="big-emoji">🌃</div>
            <h2>¡Reto de hoy completado!</h2>
            <p>
              Racha actual: <b>🔥 {daily.streak} días</b>
            </p>
            <p className="muted">Nuevo reto en {fmtTime(msUntilTomorrow() / 1000)}</p>
            <button className="btn primary" onClick={onRanking}>
              Ver ranking de hoy
            </button>
          </div>
        ) : (
          <>
            <div className="merge-stats">
              <div>
                <small>Movimientos</small>
                <b>
                  {moves} <span className="muted">/ par {puzzle.par}</span>
                </b>
              </div>
              <div>
                <small>Tiempo</small>
                <b>{fmtClock(elapsed)}</b>
              </div>
              <button className="btn small" onClick={reset} disabled={moves === 0}>
                Reiniciar
              </button>
            </div>
            <p className="hint">
              Enciende todas las ventanas. Cada toque cambia la ventana y sus 4 vecinas. ({lit}/{GRID * GRID})
            </p>
            <div className="facade">
              <div className="facade-roof" />
              <div className="facade-grid" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
                {board.map((on, i) => (
                  <button key={i} className={`window${on ? ' on' : ''}`} onClick={() => tapWindow(i)} aria-label={`Ventana ${i + 1}`} />
                ))}
              </div>
              <div className="facade-door" />
            </div>
            <p className="hint">Todos los jugadores tienen el mismo edificio hoy. ¡Compite por menos movimientos y menos tiempo!</p>
          </>
        )}
      </div>

      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🌃</div>
            <div className="result-label">¡Ciudad iluminada!</div>
            <div className="result-score small">
              {result.moves} mov · {fmtClock(result.timeMs)}
            </div>
            {result.moves <= puzzle.par && <div className="badge-gold">¡Dentro del par! +2 💎</div>}
            <ul className="reward-list">
              <li>+{result.gems} 💎</li>
              <li>+{fmt(result.coins)} 🪙</li>
              <li>🔥 Racha: {result.streak} {result.streak === 1 ? 'día' : 'días'}</li>
            </ul>
            <p className="muted">Vuelve mañana para mantener la racha (más gemas cada día, hasta 7).</p>
            <div className="btn-row">
              <button className="btn" onClick={onClose}>
                Volver
              </button>
              <button className="btn primary" onClick={onRanking}>
                Ver ranking
              </button>
            </div>
          </div>
        </Modal>
      )}
    </GameScreen>
  );
}
