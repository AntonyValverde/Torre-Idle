import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { now } from '../game/clock';
import { eraName, totalAchievements, totalBuildings } from '../game/economy';
import { fmt } from '../game/format';
import { citySnapshot } from '../game/cities';
import { DAILY_KINDS, currentUid } from '../game/cloud';
import { useGame } from '../game/store';
import { CityVisit } from '../ui/CityVisit';
import { GameScreen, Modal } from '../ui/Modal';
import { pressable } from '../ui/a11y';
import { BarList, ColumnChart } from './charts';
import {
  PLAYER_LIMIT,
  dailyParticipation,
  deleteAccount,
  deleteSuggestion,
  cupCount,
  leagueCount,
  loadPlayers,
  loadSuggestions,
  rankingsOf,
  removeFromRankings,
  setSuggestionStatus,
  type DailyCounts,
  type RankEntry,
  type Suggestion,
  type SuggestionStatus,
} from './data';
import { GAMES, ago, lastDays, summarize, type Player } from './metrics';

type Tab = 'summary' | 'players' | 'suggestions';

const shortDate = (key: string) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d}/${m}`;
};

const errorText = (e: unknown) =>
  (e as { code?: string })?.code === 'permission-denied'
    ? 'Sin permiso. Entra con la cuenta de Google de administrador.'
    : 'No se pudo cargar. Revisa tu conexión.';

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [daily, setDaily] = useState<DailyCounts[] | null>(null);
  const [league, setLeague] = useState<number | null>(null);
  const [cup, setCup] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Cada pestaña empieza arriba
  useEffect(() => {
    wrap.current?.scrollTo(0, 0);
  }, [tab]);

  const load = useCallback(async () => {
    setError(null);
    const [p, s, d, l, c] = await Promise.allSettled([
      loadPlayers(),
      loadSuggestions(),
      dailyParticipation(lastDays(now(), 7)),
      leagueCount(),
      cupCount(),
    ]);
    if (p.status === 'fulfilled') setPlayers(p.value);
    if (s.status === 'fulfilled') setSuggestions(s.value);
    if (d.status === 'fulfilled') setDaily(d.value);
    if (l.status === 'fulfilled') setLeague(l.value);
    if (c.status === 'fulfilled') setCup(c.value);
    const failed = [p, s, d, l, c].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) {
      console.warn('Panel de administración', failed.reason);
      setError(errorText(failed.reason));
    }
    setLoadedAt(now());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fresh = suggestions?.filter((x) => x.status === 'nuevo').length ?? 0;

  return (
    <GameScreen title="Administración" right={loadedAt ? <button className="link-btn" onClick={load}>↻ Actualizar</button> : null} onClose={onClose}>
      <div className="admin-wrap" ref={wrap}>
        <div className="segmented">
          <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
            📊 Resumen
          </button>
          <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
            👥 Jugadores
          </button>
          <button className={tab === 'suggestions' ? 'active' : ''} onClick={() => setTab('suggestions')}>
            💡 Sugerencias{fresh > 0 && <span className="seg-badge">{fresh}</span>}
          </button>
        </div>
        {error && <p className="empty">{error}</p>}
        {tab === 'summary' && <SummaryView players={players} daily={daily} league={league} cup={cup} suggestionsNew={fresh} />}
        {tab === 'players' && (
          <PlayersView
            players={players}
            onDeleted={(uid) => {
              setPlayers((list) => list?.filter((x) => x.uid !== uid) ?? null);
              setSuggestions((list) => list?.filter((x) => x.uid !== uid) ?? null);
            }}
          />
        )}
        {tab === 'suggestions' && <SuggestionsView items={suggestions} onChange={setSuggestions} />}
      </div>
    </GameScreen>
  );
}

// ---------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------

function SummaryView({
  players,
  daily,
  league,
  cup,
  suggestionsNew,
}: {
  players: Player[] | null;
  daily: DailyCounts[] | null;
  league: number | null;
  cup: number | null;
  suggestionsNew: number;
}) {
  const sum = useMemo(() => (players ? summarize(players, now()) : null), [players]);
  if (!sum) return <p className="empty">Cargando…</p>;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

  return (
    <>
      <div className="stats-grid">
        <div>
          <small>Jugadores</small>
          <b>{fmt(sum.total)}</b>
        </div>
        <div>
          <small>Activos 24 h</small>
          <b>{fmt(sum.active24h)}</b>
        </div>
        <div>
          <small>Activos 7 días</small>
          <b>{fmt(sum.active7d)}</b>
        </div>
        <div>
          <small>Nuevos 7 días</small>
          <b>{fmt(sum.new7d)}</b>
        </div>
        <div>
          <small>Refundaron</small>
          <b>{fmt(sum.prestiged)}</b>
        </div>
        <div>
          <small>Sugerencias nuevas</small>
          <b>{suggestionsNew}</b>
        </div>
        <div>
          <small>En la liga (semana)</small>
          <b>{league ?? '…'}</b>
        </div>
        <div>
          <small>Inscritos en la Copa</small>
          <b>{cup ?? '…'}</b>
        </div>
        <div>
          <small>Misiones hechas</small>
          <b>{fmt(sum.missionsDone)}</b>
        </div>
        <div>
          <small>Cofres hoy</small>
          <b>{fmt(sum.chestsToday)}</b>
        </div>
      </div>
      {sum.total >= PLAYER_LIMIT && <p className="hint">Se muestran las {PLAYER_LIMIT} partidas guardadas más recientes.</p>}

      <div className="card">
        <b>Altas por día</b>
        <small className="muted">Partidas nuevas creadas en los últimos 14 días</small>
        <ColumnChart data={sum.signups} formatLabel={shortDate} unit={(n) => `${n} ${n === 1 ? 'alta' : 'altas'}`} />
      </div>

      <div className="card">
        <b>Última conexión</b>
        <small className="muted">Según el último guardado en la nube</small>
        <BarList data={sum.lastSeen} total={sum.total} />
      </div>

      <div className="card">
        <b>Tutorial de Clara</b>
        <small className="muted">
          {sum.tutorialPlayers
            ? `Pasos completados por las ${sum.tutorialPlayers} partidas nuevas · ${sum.tutorialSkipped} lo saltaron`
            : 'Aún no hay partidas creadas desde que existe el tutorial'}
        </small>
        {sum.tutorialPlayers > 0 && <BarList data={sum.tutorial} total={sum.tutorialPlayers} />}
      </div>

      <div className="card">
        <b>Leyes de era</b>
        <small className="muted">Ley que rige ahora en cada ciudad (desde la era 2)</small>
        <BarList data={sum.laws} total={Math.max(1, sum.laws.reduce((n, b) => n + b.value, 0))} />
      </div>

      <div className="card">
        <b>Jugadores por minijuego</b>
        <small className="muted">Cuántos lo han jugado al menos una vez</small>
        <BarList data={sum.adoption} total={sum.total} />
      </div>

      <div className="card">
        <b>Retos diarios (7 días)</b>
        {daily ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Día</th>
                <th className="num">🌃 Apagón</th>
                <th className="num">🛣️ Calles</th>
                <th className="num">🌳 Verde</th>
              </tr>
            </thead>
            <tbody>
              {daily
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date}>
                    <td>{shortDate(d.date)}</td>
                    <td className="num">{d.daily}</td>
                    <td className="num">{d.roads}</td>
                    <td className="num">{d.parks}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Cargando…</p>
        )}
      </div>

      <div className="card">
        <b>Jugadores por era</b>
        <BarList data={sum.eras} total={sum.total} />
      </div>

      <div className="card">
        <b>Economía</b>
        <table className="admin-table">
          <tbody>
            <tr>
              <td>Mediana de monedas ganadas</td>
              <td className="num">{fmt(sum.medianEarned)}</td>
            </tr>
            <tr>
              <td>Gemas en circulación</td>
              <td className="num">{fmt(sum.gemsInCirculation)}</td>
            </tr>
            <tr>
              <td>Logros por jugador (media)</td>
              <td className="num">{sum.avgAchievements.toFixed(1)}</td>
            </tr>
            <tr>
              <td>Edificios por jugador (media)</td>
              <td className="num">{fmt(Math.round(sum.avgBuildings))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {sum.records.length > 0 && (
        <div className="card">
          <b>Récords</b>
          <table className="admin-table">
            <tbody>
              {sum.records.map((r) => (
                <tr key={r.game}>
                  <td>{r.game}</td>
                  <td>{r.name}</td>
                  <td className="num">{fmt(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="muted">Apagón, Calles y Plan verde: mejor racha. Rueda: giros.</small>
        </div>
      )}

      {projectId && (
        <a
          className="btn"
          href={`https://console.firebase.google.com/project/${projectId}/analytics`}
          target="_blank"
          rel="noreferrer"
          style={{ textAlign: 'center', textDecoration: 'none' }}
        >
          📈 Sesiones y eventos en Firebase Analytics
        </a>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Jugadores
// ---------------------------------------------------------------------

type Sort = 'recent' | 'earned' | 'era';

function PlayersView({ players, onDeleted }: { players: Player[] | null; onDeleted: (uid: string) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [open, setOpen] = useState<Player | null>(null);
  const t = now();

  const rows = useMemo(() => {
    if (!players) return [];
    const needle = q.trim().toLowerCase();
    // Los UID mezclan mayúsculas y minúsculas: se comparan sin distinguirlas
    const list = needle ? players.filter((p) => p.name.toLowerCase().includes(needle) || p.uid.toLowerCase().startsWith(needle)) : players.slice();
    if (sort === 'earned') list.sort((a, b) => b.s.allTimeEarned - a.s.allTimeEarned);
    if (sort === 'era') list.sort((a, b) => b.s.era - a.s.era || b.s.stars - a.s.stars);
    return list.slice(0, 200);
  }, [players, q, sort]);

  if (!players) return <p className="empty">Cargando…</p>;

  return (
    <>
      <input className="admin-search" placeholder="Buscar por nombre o UID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="segmented">
        <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>
          Recientes
        </button>
        <button className={sort === 'earned' ? 'active' : ''} onClick={() => setSort('earned')}>
          Más monedas
        </button>
        <button className={sort === 'era' ? 'active' : ''} onClick={() => setSort('era')}>
          Era
        </button>
      </div>
      <small className="muted">
        {rows.length} de {players.length} jugadores
      </small>
      <ol className="ranking">
        {rows.map((p) => (
          <li key={p.uid} className="clickable" {...pressable(() => setOpen(p))}>
            <span className="name">
              {p.name}
              <small className="muted"> · Era {p.s.era}</small>
            </span>
            <span className="val">
              {fmt(p.s.allTimeEarned)} 🪙
              <small className="muted"> · {ago(p.savedAt, t)}</small>
            </span>
          </li>
        ))}
      </ol>
      {open && (
        <PlayerDetail
          p={open}
          onClose={() => setOpen(null)}
          onDeleted={(uid) => {
            setOpen(null);
            onDeleted(uid);
          }}
        />
      )}
    </>
  );
}

const BOARD_LABEL: Record<string, string> = {
  stack: '🏗️ Stack',
  merge: '🧱 Fusión',
  city: '🏙️ Ciudad',
  stars: '⭐ Leyenda',
  thief: '🦹 Ladrón',
  traffic: '🚦 Semáforo',
  memory: '🧠 Memoria',
  fire: '🚒 Bomberos',
  metro: '🚇 Metro',
  daily: '🌃 Apagón (hoy)',
  roads: '🛣️ Calles (hoy)',
  parks: '🌳 Plan verde (hoy)',
  league: '🏆 Liga (semana)',
  cup: '🏆 Copa (semana)',
};

function PlayerDetail({ p, onClose, onDeleted }: { p: Player; onClose: () => void; onDeleted: (uid: string) => void }) {
  const toast = useGame((st) => st.toast);
  const [ranks, setRanks] = useState<RankEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const s = p.s;
  const t = now();

  useEffect(() => {
    rankingsOf(p.uid)
      .then(setRanks)
      .catch(() => setRanks([]));
  }, [p.uid]);

  const remove = async () => {
    if (!confirm(`¿Quitar a ${p.name} de todos los rankings? Su partida no se toca.`)) return;
    setBusy(true);
    try {
      await removeFromRankings(p.uid);
      setRanks([]);
      toast(`🧹 ${p.name} ya no aparece en los rankings`);
    } catch (e) {
      toast(`⚠️ ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const self = currentUid() === p.uid;

  const erase = async () => {
    const answer = prompt(
      `Vas a ELIMINAR la cuenta de ${p.name}: su partida (también la de su dispositivo), rankings, retos, liga, ciudad, Copa de esta semana y sugerencias. No se puede deshacer.\n\nEscribe ELIMINAR para confirmar.`,
    );
    if (answer?.trim().toUpperCase() !== 'ELIMINAR') return;
    setBusy(true);
    try {
      await deleteAccount(p.uid);
      toast(`🗑️ Cuenta de ${p.name} eliminada`);
      onDeleted(p.uid);
    } catch (e) {
      toast(`⚠️ ${errorText(e)}`);
      setBusy(false);
    }
  };

  const copyUid = () => {
    navigator.clipboard?.writeText(p.uid).then(
      () => toast('UID copiado'),
      () => toast(p.uid),
    );
  };

  const rows: [string, string][] = [
    ['Era', `${s.era} · ${eraName(s.era)}`],
    ['Estrellas', `${fmt(s.stars)} (gastadas ${fmt(s.starsSpent)})`],
    ['Monedas', fmt(s.coins)],
    ['Total histórico', fmt(s.allTimeEarned)],
    ['Gemas', fmt(s.gems)],
    ['Tickets', String(s.tickets)],
    ['Edificios', fmt(totalBuildings(s))],
    ['Logros reclamados', String(totalAchievements(s))],
    ['Raros', s.rare.length ? s.rare.join(', ') : '-'],
    ['Toques', fmt(s.taps)],
    ['Globos', fmt(s.balloons)],
    ['Bolsa (neto)', fmt(s.stockProfit)],
    ['Cuenta creada', new Date(s.createdAt).toLocaleString('es')],
    ['Último guardado', p.savedAt ? `${new Date(p.savedAt).toLocaleString('es')} (${ago(p.savedAt, t)})` : 'nunca'],
  ];

  if (cityOpen) return <CityVisit uid={p.uid} city={citySnapshot(s)} onClose={() => setCityOpen(false)} />;

  return (
    <Modal onBackdrop={onClose}>
      <div className="admin-detail">
        {/* Cabecera fija: nombre, rankings y acciones; los datos de la partida se desplazan debajo */}
        <div className="admin-detail-head">
          <div className="admin-detail-title">
            <h2>{p.name}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <button className="link-btn" onClick={copyUid}>
            UID: {p.uid.slice(0, 10)}… (copiar)
          </button>
          <b>En los rankings</b>
          {ranks === null ? (
            <small className="muted">Cargando…</small>
          ) : ranks.length === 0 ? (
            <small className="muted">No aparece en ningún ranking</small>
          ) : (
            <ul className="admin-chips">
              {ranks.map((r) => (
                <li key={r.board}>
                  {BOARD_LABEL[r.board] ?? r.board}: {(DAILY_KINDS as string[]).includes(r.board) ? 'jugado' : fmt(r.score)}
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button className="btn" onClick={() => setCityOpen(true)}>
              🏙️ Ver ciudad
            </button>
            <button className="btn danger" onClick={remove} disabled={busy || !ranks?.length}>
              Quitar de rankings
            </button>
          </div>
          <div className="btn-row">
            <button className="btn danger" onClick={erase} disabled={busy || self} title={self ? 'Es tu propia cuenta' : undefined}>
              🗑️ Eliminar cuenta
            </button>
          </div>
        </div>
        <div className="admin-detail-body">
        <table className="admin-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">{v}</td>
              </tr>
            ))}
            {GAMES.filter((g) => g.best).map((g) => (
              <tr key={g.id}>
                <td>{g.label}</td>
                <td className="num">{fmt(g.best!(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Sugerencias
// ---------------------------------------------------------------------

const KIND_EMOJI = { idea: '💡', bug: '🐞', otro: '💬' } as const;
const STATUS: { id: SuggestionStatus | 'all'; label: string }[] = [
  { id: 'nuevo', label: 'Nuevas' },
  { id: 'leido', label: 'Leídas' },
  { id: 'hecho', label: 'Hechas' },
  { id: 'descartado', label: 'Descartadas' },
  { id: 'all', label: 'Todas' },
];

function SuggestionsView({ items, onChange }: { items: Suggestion[] | null; onChange: Dispatch<SetStateAction<Suggestion[] | null>> }) {
  const toast = useGame((st) => st.toast);
  const [filter, setFilter] = useState<SuggestionStatus | 'all'>('nuevo');
  const t = now();
  if (!items) return <p className="empty">Cargando…</p>;
  const shown = filter === 'all' ? items : items.filter((x) => x.status === filter);

  const setStatus = async (x: Suggestion, status: SuggestionStatus) => {
    try {
      await setSuggestionStatus(x.id, status);
      // Sobre la lista actual (no la de cuando se pulsó): si hay varias acciones a la vez, no se pisan
      onChange((prev) => prev && prev.map((y) => (y.id === x.id ? { ...y, status } : y)));
    } catch (e) {
      toast(`⚠️ ${errorText(e)}`);
    }
  };

  const remove = async (x: Suggestion) => {
    if (!confirm('¿Borrar esta sugerencia para siempre?')) return;
    try {
      await deleteSuggestion(x.id);
      onChange((prev) => prev && prev.filter((y) => y.id !== x.id));
    } catch (e) {
      toast(`⚠️ ${errorText(e)}`);
    }
  };

  return (
    <>
      <div className="segmented wide">
        {STATUS.map((f) => {
          const n = f.id === 'all' ? items.length : items.filter((x) => x.status === f.id).length;
          return (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
              {f.label} <span className="muted">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="empty">No hay sugerencias aquí.</p>}
      {shown.map((x) => (
        <div key={x.id} className="card suggestion">
          <div className="suggestion-head">
            <b>
              {KIND_EMOJI[x.kind]} {x.name}
            </b>
            <small className="muted">
              {x.era ? `Era ${x.era} · ` : ''}
              {ago(x.createdAt, t)}
            </small>
          </div>
          <p className="suggestion-text">{x.text}</p>
          {x.ua && <small className="muted ua">{x.ua}</small>}
          <div className="suggestion-actions">
            {x.status !== 'leido' && (
              <button className="btn small" onClick={() => setStatus(x, 'leido')}>
                👀 Leída
              </button>
            )}
            {x.status !== 'hecho' && (
              <button className="btn small" onClick={() => setStatus(x, 'hecho')}>
                ✅ Hecha
              </button>
            )}
            {x.status !== 'descartado' && (
              <button className="btn small" onClick={() => setStatus(x, 'descartado')}>
                🚫 Descartar
              </button>
            )}
            <button className="btn small danger" onClick={() => remove(x)}>
              🗑️
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
