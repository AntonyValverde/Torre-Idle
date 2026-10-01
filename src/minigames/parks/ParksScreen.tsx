import { useEffect, useMemo, useState } from 'react';
import { track } from '../../firebase';
import { dateKey, isNewDay, msUntilTomorrow } from '../../game/clock';
import { saveCloud, submitDaily } from '../../game/cloud';
import { fmt, fmtClock, fmtTime } from '../../game/format';
import { useGame, type DailyReward } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { CARDS } from '../../game/cup';
import { GameScreen, Modal } from '../../ui/Modal';
import { EMPTY, HOUSE, PARK, SIZE, cycle, dailyParks, isSolved, problems, type Cell } from './logic';

const ICON: Record<Cell, string> = { 0: '', 1: '🏠', 2: '🌳' };

export function ParksScreen({ onClose, onRanking }: { onClose: () => void; onRanking: () => void }) {
  const date = useMemo(() => dateKey(), []);
  const puzzle = useMemo(() => dailyParks(date), [date]);
  const [cells, setCells] = useState<Cell[]>(puzzle.givens);
  const [moves, setMoves] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<(DailyReward & { moves: number; timeMs: number }) | null>(null);
  const parks = useGame((st) => st.s.parks);
  const alreadyDone = !isNewDay(parks.last, date) && !result;
  const bad = useMemo(() => problems(cells), [cells]);
  const left = cells.filter((c) => c === EMPTY).length;

  useEffect(() => {
    if (startAt === null || result) return;
    const id = setInterval(() => setElapsed(Date.now() - startAt), 250);
    return () => clearInterval(id);
  }, [startAt, result]);

  const tap = (i: number) => {
    if (result || alreadyDone || puzzle.givens[i] !== EMPTY) return;
    const t0 = startAt ?? Date.now();
    if (startAt === null) setStartAt(t0);
    const next = cells.slice();
    next[i] = cycle(next[i]);
    const m = moves + 1;
    setCells(next);
    setMoves(m);
    vibrate(6);
    if (problems(next).has(i)) tone(260, 0.06, 'square', 0.03);
    else tone(next[i] === HOUSE ? 620 : next[i] === PARK ? 760 : 480, 0.04, 'triangle', 0.03);
    if (!isSolved(next)) return;

    const timeMs = Date.now() - t0;
    setElapsed(timeMs);
    const store = useGame.getState();
    const reward = store.completeParks(date, m, puzzle.par);
    if (!reward) return;
    sfx('win');
    vibrate([20, 40, 20, 40, 60]);
    track('parks_complete', { moves: m, timeMs, streak: reward.streak });
    submitDaily(date, m, timeMs, store.s.name, 'parks').catch(() => {});
    saveCloud(useGame.getState().s).catch(() => {});
    setResult({ ...reward, moves: m, timeMs });
  };

  const reset = () => {
    setCells(puzzle.givens);
    setMoves(0);
  };

  return (
    <GameScreen title="Plan verde" right={`🔥 ${parks.streak}`} onClose={onClose}>
      <div className="daily-wrap">
        {alreadyDone ? (
          <div className="daily-done">
            <div className="big-emoji">🌳</div>
            <h2>¡Barrio de hoy planificado!</h2>
            <p>
              Racha actual: <b>🔥 {parks.streak} días</b>
            </p>
            <p className="muted">Nuevo plano en {fmtTime(msUntilTomorrow() / 1000)}</p>
            <button className="btn primary" onClick={onRanking}>
              Ver ranking de hoy
            </button>
          </div>
        ) : (
          <>
            <div className="merge-stats">
              <div>
                <small>Toques</small>
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
            <ul className="parks-rules">
              <li>Cada fila y cada columna: 3 🏠 y 3 🌳.</li>
              <li>Nunca tres iguales seguidos (ni en fila ni en columna).</li>
            </ul>
            <div className="parks-board" style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}>
              {cells.map((c, i) => {
                const fixed = puzzle.givens[i] !== EMPTY;
                return (
                  <button
                    key={i}
                    className={`parks-cell${fixed ? ' fixed' : ''}${bad.has(i) ? ' bad' : ''}${c === PARK ? ' park' : c === HOUSE ? ' house' : ''}`}
                    onClick={() => tap(i)}
                    aria-label={`Casilla ${i + 1}: ${c === HOUSE ? 'casa' : c === PARK ? 'parque' : 'vacía'}${fixed ? ' (fija)' : ''}`}
                  >
                    {ICON[c]}
                  </button>
                );
              })}
            </div>
            <p className="hint">
              Toca una casilla libre: vacía → 🏠 → 🌳. Las oscuras vienen fijas. {left > 0 ? `Quedan ${left}.` : bad.size ? 'Hay casillas en rojo: revísalas.' : ''}
            </p>
          </>
        )}
      </div>

      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🌳</div>
            <div className="result-label">¡Barrio planificado!</div>
            <div className="result-score small">
              {result.moves} toques · {fmtClock(result.timeMs)}
            </div>
            {result.moves <= puzzle.par && <div className="badge-gold">¡Dentro del par! +2 💎</div>}
            <ul className="reward-list">
              <li>+{result.gems} 💎</li>
              <li>+{fmt(result.coins)} 🪙</li>
              <li>🔥 Racha: {result.streak} {result.streak === 1 ? 'día' : 'días'}</li>
              {result.card && (
                <li className="rare">
                  🃏 Carta de la Copa: {CARDS[result.card].emoji} {CARDS[result.card].name}
                </li>
              )}
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
