import { useEffect, useState } from 'react';
import { cloudEnabled } from '../firebase';
import { dateKey, msUntilNextWeek, weekKey } from '../game/clock';
import {
  DAILY_KINDS,
  currentUid,
  fetchDailyTop,
  fetchLeagueTop,
  fetchTop,
  leaguePosition,
  type Board,
  type DailyKind,
  type ScoreEntry,
} from '../game/cloud';
import { fmt, fmtClock, fmtTime } from '../game/format';
import { DIVISIONS, divisionOf, nextDivision } from '../game/missions';
import { useGame } from '../game/store';
import { isWarGame } from '../game/war';
import { pressable } from './a11y';
import { ClaraTip } from './ClaraTip';

export type BoardTab = 'league' | DailyKind | Board;

const BOARD_INFO: Record<BoardTab, { emoji: string; label: string }> = {
  league: { emoji: '🏆', label: 'Liga' },
  daily: { emoji: '🌃', label: 'Apagón' },
  roads: { emoji: '🛣️', label: 'Calles' },
  parks: { emoji: '🌳', label: 'Plan verde' },
  thief: { emoji: '🦹', label: 'Ladrón' },
  fire: { emoji: '🚒', label: 'Bomberos' },
  metro: { emoji: '🚇', label: 'Metro' },
  towers: { emoji: '🏰', label: 'Torres' },
  flak: { emoji: '🛡️', label: 'Antiaérea' },
  artillery: { emoji: '🎯', label: 'Artillería' },
  lanes: { emoji: '🚧', label: 'Calles' },
  duel: { emoji: '🎖️', label: 'Duelo' },
  traffic: { emoji: '🚦', label: 'Semáforo' },
  memory: { emoji: '🧠', label: 'Memoria' },
  stack: { emoji: '🏗️', label: 'Torre' },
  merge: { emoji: '🧱', label: 'Fusión' },
  city: { emoji: '🏙️', label: 'Monedas' },
  stars: { emoji: '⭐', label: 'Leyenda' },
};

// Dos niveles: primero el grupo y, si tiene varios rankings, una fila de fichas debajo
const GROUPS: { id: string; emoji: string; label: string; boards: BoardTab[] }[] = [
  { id: 'league', emoji: '🏆', label: 'Liga', boards: ['league'] },
  { id: 'today', emoji: '📅', label: 'Hoy', boards: ['daily', 'roads', 'parks'] },
  { id: 'arcade', emoji: '🎮', label: 'Arcade', boards: ['towers', 'flak', 'artillery', 'lanes', 'duel', 'thief', 'fire', 'metro', 'traffic', 'memory', 'stack', 'merge'] },
  { id: 'city', emoji: '🏙️', label: 'Ciudad', boards: ['city', 'stars'] },
];

const isDaily = (b: BoardTab): b is DailyKind => (DAILY_KINDS as string[]).includes(b);

export function RankingTab({ initial = 'league', onVisit }: { initial?: BoardTab; onVisit?: (uid: string) => void }) {
  const [board, setBoard] = useState<BoardTab>(initial);
  const [rows, setRows] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState(false);
  const me = currentUid();
  const group = GROUPS.find((g) => g.boards.includes(board)) ?? GROUPS[0];
  // Último ranking visto de cada grupo, para volver a él al cambiar de grupo
  const [lastOf, setLastOf] = useState<Record<string, BoardTab>>({});

  const choose = (b: BoardTab) => {
    setBoard(b);
    const g = GROUPS.find((x) => x.boards.includes(b));
    if (g) setLastOf((m) => ({ ...m, [g.id]: b }));
  };

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    const p = board === 'league' ? fetchLeagueTop(weekKey()) : isDaily(board) ? fetchDailyTop(dateKey(), board) : fetchTop(board);
    p.then((r) => alive && setRows(r)).catch((e) => {
      console.warn(e);
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, [board]);

  const value = (r: ScoreEntry) => {
    if (board === 'league') return `${divisionOf(r.score).emoji} ${r.score} pts`;
    if (isDaily(board)) return `${r.moves} mov · ${fmtClock(r.timeMs ?? 0)}`;
    if (board === 'stack') return `${r.score} pisos`;
    if (board === 'thief' || board === 'fire' || board === 'towers' || isWarGame(board)) return `${r.score} pts`;
    if (board === 'metro') return `${r.score} viajeros`;
    if (board === 'traffic') return `${r.score} coches`;
    if (board === 'memory') return `${r.score} rondas`;
    if (board === 'city') return `${fmt(r.score)} 🪙`;
    if (board === 'stars') return `${fmt(r.score)} ⭐`;
    return fmt(r.score);
  };

  return (
    <div className="tab">
      <ClaraTip id="ranking" />
      <div className="segmented rank-groups" role="tablist">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === group.id}
            className={g.id === group.id ? 'active' : ''}
            onClick={() => choose(lastOf[g.id] ?? g.boards[0])}
          >
            <span className="rank-group-emoji">{g.emoji}</span>
            {g.label}
          </button>
        ))}
      </div>
      {group.boards.length > 1 && (
        <div className="chip-row">
          {group.boards.map((b) => (
            <button key={b} className={`chip${b === board ? ' active' : ''}`} onClick={() => choose(b)}>
              {BOARD_INFO[b].emoji} {BOARD_INFO[b].label}
            </button>
          ))}
        </div>
      )}
      {board === 'league' && <LeagueHeader />}
      {isDaily(board) && <p className="hint">Reto de hoy: gana quien use menos movimientos y, si empatan, menos tiempo.</p>}
      {board === 'city' && <p className="hint">Monedas ganadas en total. Se actualiza cada pocos minutos.</p>}
      {board === 'stars' && <p className="hint">Estrellas de legado. Se actualiza al refundar la ciudad.</p>}
      {onVisit && rows && rows.length > 0 && <p className="hint">🏙️ Toca a un jugador para visitar su ciudad.</p>}
      {!cloudEnabled && <p className="empty">Configura Firebase para ver los rankings.</p>}
      {error && <p className="empty">No se pudo cargar el ranking. Revisa tu conexión.</p>}
      {!error && cloudEnabled && rows === null && <p className="empty">Cargando…</p>}
      {cloudEnabled && rows && rows.length === 0 && (
        <p className="empty">{board === 'league' ? 'Nadie ha sumado puntos esta semana. ¡Completa una misión!' : 'Aún no hay nadie. ¡Sé el primero!'}</p>
      )}
      {rows && rows.length > 0 && (
        <ol className="ranking">
          {rows.map((r, i) => (
            <li
              key={r.uid}
              className={`${r.uid === me ? 'me' : ''}${onVisit ? ' clickable' : ''}`}
              {...(onVisit ? pressable(() => onVisit(r.uid)) : {})}
            >
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

/** Tu división, tu posición en la semana y lo que falta para la siguiente. */
function LeagueHeader() {
  const lg = useGame((st) => st.s.league);
  const lastTick = useGame((st) => st.s.lastTick);
  const [pos, setPos] = useState<{ position: number; total: number } | null>(null);
  const div = divisionOf(lg.points);
  const next = nextDivision(lg.points);

  useEffect(() => {
    let alive = true;
    if (lg.week && lg.points > 0)
      leaguePosition(lg.week, lg.points)
        .then((p) => alive && setPos(p))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lg.week, lg.points]);

  return (
    <div className="card league-card">
      <div className="league-top">
        <span className="league-emoji">{div.emoji}</span>
        <div>
          <b>
            Liga {div.name} · {lg.points} pts
          </b>
          <small className="muted">
            {pos ? `Puesto ${pos.position} de ${pos.total} · ` : ''}Termina en {fmtTime(msUntilNextWeek(lastTick) / 1000)}
          </small>
        </div>
      </div>
      {next && (
        <div className="ms-bar">
          <div style={{ width: `${((lg.points - div.min) / (next.min - div.min)) * 100}%` }} />
          <span>
            {next.min - lg.points} pts para {next.emoji} {next.name}
          </span>
        </div>
      )}
      <ul className="division-list">
        {DIVISIONS.map((d) => (
          <li key={d.id} className={d.id === div.id ? 'on' : ''}>
            <span>
              {d.emoji} {d.name}
            </span>
            <small className="muted">{d.min}+ pts</small>
            <small>
              +{d.gems} 💎{d.tickets ? ` +${d.tickets} 🎟️` : ''}
            </small>
          </li>
        ))}
      </ul>
      <p className="hint">Los puntos salen de las misiones (📋 en Ciudad) y de los retos diarios. Al terminar la semana cobras el premio de tu división.</p>
    </div>
  );
}
