import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { track } from '../../firebase';
import { submitScore } from '../../game/cloud';
import { fmt } from '../../game/format';
import { useGame, type MergeReward } from '../../game/store';
import { sfx, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { MATERIALS, SIZE, canMove, move, newBoard, spawn, type Dir, type Tile } from './logic';

export function MergeScreen({ onClose }: { onClose: () => void }) {
  const [tiles, setTiles] = useState<Tile[]>(() => newBoard());
  const tilesRef = useRef(tiles);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<(MergeReward & { score: number; maxTile: number }) | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const paid = useRef(false);
  const best = useGame((st) => st.s.mergeBest);
  const tickets = useGame((st) => st.s.tickets);

  const maxTile = tiles.reduce((m, t) => Math.max(m, t.v), 0);
  const over = !canMove(tiles);

  const doMove = useCallback(
    (dir: Dir) => {
      if (result) return;
      const r = move(tilesRef.current, dir);
      if (!r.moved) return;
      const next = spawn(r.tiles);
      tilesRef.current = next;
      setTiles(next);
      if (r.gained) {
        setScore((s) => s + r.gained);
        vibrate(10);
        sfx('tap');
      }
    },
    [result],
  );

  useEffect(() => {
    const keys: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const onKey = (e: KeyboardEvent) => {
      const d = keys[e.key];
      if (d) {
        e.preventDefault();
        doMove(d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doMove]);

  const finish = useCallback(() => {
    if (result || paid.current) return;
    paid.current = true;
    const store = useGame.getState();
    const reward = store.rewardMerge(score, maxTile);
    if (reward.newBest && score > 0) submitScore('merge', score, store.s.name).catch(() => {});
    track('minigame_end', { game: 'merge', score, maxTile });
    sfx(reward.gems > 0 || reward.newRare.length ? 'win' : 'buy');
    setResult({ ...reward, score, maxTile });
  }, [result, score, maxTile]);

  useEffect(() => {
    if (over && !result) {
      const id = setTimeout(finish, 700);
      return () => clearTimeout(id);
    }
  }, [over, result, finish]);

  // Salir a mitad de partida cobra lo conseguido
  const close = () => {
    if (!result && !paid.current && score > 0) {
      finish();
      useGame.getState().toast(`🧱 Cobraste ${fmt(score)} puntos de Fusión`);
    }
    onClose();
  };

  const again = () => {
    if (!useGame.getState().spendTicket()) return;
    track('minigame_start', { game: 'merge' });
    const b = newBoard();
    paid.current = false;
    tilesRef.current = b;
    setTiles(b);
    setScore(0);
    setResult(null);
  };

  const onDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    // Captura el puntero para que pointerup llegue al tablero aunque el dedo salga de él
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* navegadores sin captura de puntero */
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left');
    else doMove(dy > 0 ? 'down' : 'up');
  };

  return (
    <GameScreen title="Fusión" right={`🏆 ${fmt(best)}`} onClose={close}>
      <div className="merge-wrap">
        <div className="merge-stats">
          <div>
            <small>Puntos</small>
            <b>{fmt(score)}</b>
          </div>
          <div>
            <small>Mejor material</small>
            <b>
              {MATERIALS[maxTile]?.emoji} {maxTile}
            </b>
          </div>
          <button className="btn small" onClick={finish} disabled={!!result || score === 0}>
            Cobrar
          </button>
        </div>
        <p className="hint">Desliza para fusionar materiales iguales. A partir de 🗽 256 desbloqueas edificios raros.</p>
        <div className="merge-board" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (start.current = null)}>
          {Array.from({ length: SIZE * SIZE }, (_, i) => (
            <div key={i} className="merge-cell" style={{ '--r': Math.floor(i / SIZE), '--c': i % SIZE } as CSSProperties} />
          ))}
          {tiles.map((t) => (
            <div key={t.id} className="tile" style={{ '--r': t.r, '--c': t.c } as CSSProperties}>
              {/* El interior se vuelve a montar al cambiar de valor para repetir la animación de fusión */}
              <div key={t.v} className={`tile-inner v${Math.min(t.v, 4096)}${t.isNew ? ' new' : ''}${t.merged ? ' merged' : ''}`}>
                <span className="tile-emoji">{MATERIALS[t.v]?.emoji ?? '💠'}</span>
                <span className="tile-num">{t.v}</span>
              </div>
            </div>
          ))}
        </div>
        {over && !result && <p className="hint strong">¡Sin movimientos!</p>}
      </div>

      {result && (
        <Modal>
          <div className="result">
            <div className="result-label">Puntos</div>
            <div className="result-score">{fmt(result.score)}</div>
            {result.newBest && result.score > 0 && <div className="badge-gold">¡Nuevo récord!</div>}
            <ul className="reward-list">
              <li>+{fmt(result.coins)} 🪙</li>
              {result.gems > 0 ? <li>+{result.gems} 💎</li> : <li className="muted">Llega a 🏗️ 128 para ganar gemas</li>}
              {result.newRare.map((r) => (
                <li key={r.id} className="rare">
                  {r.emoji} ¡{r.name} desbloqueado! +{Math.round(r.bonus * 100)}% producción
                </li>
              ))}
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
