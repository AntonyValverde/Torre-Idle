import { useEffect, useMemo, useState } from 'react';
import { track } from '../../firebase';
import { dateKey, isNewDay, msUntilTomorrow } from '../../game/clock';
import { saveCloud, submitDaily } from '../../game/cloud';
import { fmt, fmtClock, fmtTime } from '../../game/format';
import { useGame, type DailyReward } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { E, N, S, SIZE, W, connected, dailyRoads, exits, isSolved, rotate } from './logic';

/** Tramo de calle dibujado según sus salidas. */
function RoadTile({ mask, lit }: { mask: number; lit: boolean }) {
  const arms = [
    [N, 36, 0, 28, 50],
    [E, 50, 36, 50, 28],
    [S, 36, 50, 28, 50],
    [W, 0, 36, 50, 28],
  ];
  return (
    <svg viewBox="0 0 100 100" className={`road-svg${lit ? ' lit' : ''}`} aria-hidden="true">
      <rect x="36" y="36" width="28" height="28" rx="6" />
      {arms.map(([bit, x, y, w, h]) => (mask & bit ? <rect key={bit} x={x} y={y} width={w} height={h} /> : null))}
    </svg>
  );
}

export function RoadsScreen({ onClose, onRanking }: { onClose: () => void; onRanking: () => void }) {
  const date = useMemo(() => dateKey(), []);
  const puzzle = useMemo(() => dailyRoads(date), [date]);
  const [tiles, setTiles] = useState(puzzle.tiles);
  // Giros acumulados por casilla, solo para animar el giro con CSS
  const [turns, setTurns] = useState<number[]>(() => Array(puzzle.tiles.length).fill(0));
  const [moves, setMoves] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<(DailyReward & { moves: number; timeMs: number }) | null>(null);
  const roads = useGame((st) => st.s.roads);
  const alreadyDone = !isNewDay(roads.last, date) && !result;
  const houses = useMemo(() => new Set(puzzle.houses), [puzzle]);
  const reach = useMemo(() => connected(tiles, puzzle.hall), [tiles, puzzle]);
  const linked = puzzle.houses.filter((h) => reach.has(h)).length;

  useEffect(() => {
    if (startAt === null || result) return;
    const id = setInterval(() => setElapsed(Date.now() - startAt), 250);
    return () => clearInterval(id);
  }, [startAt, result]);

  const turn = (i: number) => {
    // Un cruce de cuatro salidas no cambia al girarlo: no cuenta como movimiento
    if (result || alreadyDone || exits(tiles[i]) === 4) return;
    const t0 = startAt ?? Date.now();
    if (startAt === null) setStartAt(t0);
    const next = tiles.slice();
    next[i] = rotate(next[i]);
    const m = moves + 1;
    setTiles(next);
    setTurns((tt) => tt.map((x, k) => (k === i ? x + 1 : x)));
    setMoves(m);
    vibrate(8);
    const nextReach = connected(next, puzzle.hall);
    const nowLinked = puzzle.houses.filter((h) => nextReach.has(h)).length;
    if (nowLinked > linked) tone(660 + nowLinked * 30, 0.06);
    else sfx('tap');
    if (!isSolved(next, puzzle.hall, puzzle.houses)) return;

    const timeMs = Date.now() - t0;
    setElapsed(timeMs);
    const store = useGame.getState();
    const reward = store.completeRoads(date, m, puzzle.par);
    if (!reward) return;
    sfx('win');
    vibrate([20, 40, 20, 40, 60]);
    track('roads_complete', { moves: m, timeMs, streak: reward.streak });
    submitDaily(date, m, timeMs, store.s.name, 'roads').catch(() => {});
    saveCloud(useGame.getState().s).catch(() => {});
    setResult({ ...reward, moves: m, timeMs });
  };

  const reset = () => {
    setTiles(puzzle.tiles);
    // Se completa la vuelta para que la animación no gire hacia atrás
    setTurns((tt) => tt.map((x) => Math.ceil(x / 4) * 4));
    setMoves(0);
  };

  return (
    <GameScreen title="Conecta las calles" right={`🔥 ${roads.streak}`} onClose={onClose}>
      <div className="daily-wrap">
        {alreadyDone ? (
          <div className="daily-done">
            <div className="big-emoji">🛣️</div>
            <h2>¡Plano de hoy completado!</h2>
            <p>
              Racha actual: <b>🔥 {roads.streak} días</b>
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
                <small>Giros</small>
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
              Toca un tramo para girarlo. Une todas las casas 🏠 con el ayuntamiento 🏛️. ({linked}/{puzzle.houses.length})
            </p>
            <div className="roads-board" style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}>
              {tiles.map((_, i) => (
                <button key={i} className="road-cell" onClick={() => turn(i)} aria-label={`Tramo ${i + 1}`}>
                  <span className="road-rot" style={{ transform: `rotate(${turns[i] * 90}deg)` }}>
                    <RoadTile mask={puzzle.tiles[i]} lit={reach.has(i)} />
                  </span>
                  {i === puzzle.hall && <span className="road-icon hall">🏛️</span>}
                  {houses.has(i) && <span className={`road-icon${reach.has(i) ? ' on' : ''}`}>🏠</span>}
                </button>
              ))}
            </div>
            <p className="hint">Todos los jugadores tienen el mismo plano hoy. ¡Compite por menos giros y menos tiempo!</p>
          </>
        )}
      </div>

      {result && (
        <Modal>
          <div className="result">
            <div className="big-emoji">🛣️</div>
            <div className="result-label">¡Barrio conectado!</div>
            <div className="result-score small">
              {result.moves} giros · {fmtClock(result.timeMs)}
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
