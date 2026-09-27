import { useEffect, useState } from 'react';
import { cloudEnabled } from '../firebase';
import { dateKey } from '../game/clock';
import { currentUid, fetchDailyTop, fetchTop, type ScoreEntry } from '../game/cloud';
import { fmt, fmtClock } from '../game/format';

export type BoardTab = 'daily' | 'stack' | 'merge' | 'city' | 'stars' | 'thief';

const TABS: { id: BoardTab; label: string }[] = [
  { id: 'daily', label: '🌃 Hoy' },
  { id: 'thief', label: '🦹 Ladrón' },
  { id: 'stack', label: '🏗️ Torre' },
  { id: 'merge', label: '🧱 Fusión' },
  { id: 'city', label: '🏙️ Ciudad' },
  { id: 'stars', label: '⭐ Leyenda' },
];

export function RankingTab({ initial = 'daily' }: { initial?: BoardTab }) {
  const [board, setBoard] = useState<BoardTab>(initial);
  const [rows, setRows] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState(false);
  const me = currentUid();

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    const p = board === 'daily' ? fetchDailyTop(dateKey()) : fetchTop(board);
    p.then((r) => alive && setRows(r)).catch((e) => {
      console.warn(e);
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, [board]);

  const value = (r: ScoreEntry) => {
    if (board === 'daily') return `${r.moves} mov · ${fmtClock(r.timeMs ?? 0)}`;
    if (board === 'stack') return `${r.score} pisos`;
    if (board === 'thief') return `${r.score} pts`;
    if (board === 'city') return `${fmt(r.score)} 🪙`;
    if (board === 'stars') return `${fmt(r.score)} ⭐`;
    return fmt(r.score);
  };

  return (
    <div className="tab">
      <div className="segmented wide">
        {TABS.map((t) => (
          <button key={t.id} className={board === t.id ? 'active' : ''} onClick={() => setBoard(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {board === 'city' && <p className="hint">Monedas ganadas en total. Se actualiza cada pocos minutos.</p>}
      {board === 'stars' && <p className="hint">Estrellas de legado. Se actualiza al refundar la ciudad.</p>}
      {!cloudEnabled && <p className="empty">Configura Firebase para ver los rankings.</p>}
      {error && <p className="empty">No se pudo cargar el ranking. Revisa tu conexión.</p>}
      {!error && cloudEnabled && rows === null && <p className="empty">Cargando…</p>}
      {cloudEnabled && rows && rows.length === 0 && <p className="empty">Aún no hay nadie. ¡Sé el primero!</p>}
      {rows && rows.length > 0 && (
        <ol className="ranking">
          {rows.map((r, i) => (
            <li key={r.uid} className={r.uid === me ? 'me' : ''}>
              <span className="pos">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              <span className="name">
                {r.name}
                {r.uid === me && ' (tú)'}
              </span>
              <span className="val">{value(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
