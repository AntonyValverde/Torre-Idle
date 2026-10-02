import { useEffect, useState } from 'react';
import { track } from '../firebase';
import { fetchDailyTop, type ScoreEntry } from '../game/cloud';
import { dateKey, now, prevDateKey } from '../game/clock';
import { fmt, fmtTime } from '../game/format';
import { PAPER_GEMS, paperUnread } from '../game/paper';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';
import { agenda, claraTip, classifieds, editionNumber, forecast, headlines, longDate, marketMovers, sinceLabel } from './gazette';

const PUZZLES = [
  { kind: 'daily', emoji: '🌃', name: 'Apagón' },
  { kind: 'roads', emoji: '🛣️', name: 'Calles' },
  { kind: 'parks', emoji: '🌳', name: 'Plan verde' },
] as const;

/** Tarjeta de la Ciudad que abre el periódico del día. */
export function NewspaperCard({ onOpen }: { onOpen: () => void }) {
  const s = useGame((st) => st.s);
  const t = now();
  const today = dateKey(t);
  const unread = paperUnread(s, today);
  const lead = headlines(s, s.paper.prev)[0];
  return (
    <button className={`paper-card${unread ? ' unread' : ''}`} onClick={onOpen}>
      <span className="paper-card-icon">📰</span>
      <span className="paper-card-main">
        <small>
          La Gaceta · edición nº {editionNumber(today)}
          {unread && <span className="new-tag">NUEVO</span>}
        </small>
        <b>
          {lead.emoji} {lead.title}
        </b>
      </span>
      {unread && <span className="paper-card-tip">+{PAPER_GEMS} 💎</span>}
    </button>
  );
}

/** Ganadores de ayer de los tres retos diarios (lo único que se lee de la base de datos). */
function useYesterdayWinners(yesterday: string) {
  const [winners, setWinners] = useState<(ScoreEntry | null)[] | null>(null);
  useEffect(() => {
    let alive = true;
    // Sin conexión, la consulta puede tardar mucho en fallar: a los 6 s se da por perdida
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
    const top = (kind: (typeof PUZZLES)[number]['kind']) =>
      Promise.race([fetchDailyTop(yesterday, kind, 1).then((r) => r[0] ?? null, () => null), timeout]);
    Promise.all(PUZZLES.map((p) => top(p.kind))).then((w) => {
      if (alive) setWinners(w);
    });
    return () => {
      alive = false;
    };
  }, [yesterday]);
  return winners;
}

export function NewspaperScreen({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.s);
  const [t] = useState(now);
  const today = dateKey(t);
  const yesterday = prevDateKey(today);
  const winners = useYesterdayWinners(yesterday);
  const d = s.paper.prev;
  const stories = headlines(s, d);
  const [lead, ...rest] = stories;
  const { up, down } = marketMovers(t);

  // Al abrirlo se cobra la propina del repartidor (una vez al día)
  useEffect(() => {
    const st = useGame.getState();
    const gems = st.readPaper();
    track('paper_open', { tip: gems });
    if (gems > 0) {
      st.toast(`🗞️ Propina del repartidor: +${gems} 💎`);
      sfx('win');
      vibrate(15);
    }
  }, []);

  // Sin signo: el verbo (sube / cae) ya lo dice
  const pct = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`;

  return (
    <div className="paper-screen" role="dialog" aria-label="La Gaceta de Infinite City">
      <div className="paper">
        <button className="paper-close" onClick={onClose} aria-label="Cerrar el periódico">
          ✕
        </button>
        <header className="paper-masthead">
          <h1>La Gaceta</h1>
          <div className="paper-sub">de Infinite City</div>
          <div className="paper-meta">
            <span>Edición nº {editionNumber(today)}</span>
            <span>{longDate(t)}</span>
            <span>Precio: 1 🪙</span>
          </div>
        </header>

        <div className="paper-weather">
          {forecast(t).map((f) => (
            <span key={f.label}>
              <small>{f.label}</small> {f.weather}
            </span>
          ))}
        </div>

        <article className="paper-lead">
          <div className="paper-lead-emoji">{lead.emoji}</div>
          <h2>{lead.title}</h2>
          <p>{lead.text}</p>
        </article>

        {rest.length > 0 && (
          <div className="paper-briefs">
            {rest.map((x) => (
              <p key={x.title}>
                <b>
                  {x.emoji} {x.title}.
                </b>{' '}
                {x.text}
              </p>
            ))}
          </div>
        )}

        {d && (
          <section className="paper-section">
            <h3>{sinceLabel(d, today)}</h3>
            <div className="paper-stats">
              <span>
                <b>{fmt(d.earned)}</b> monedas
              </span>
              <span>
                <b>{fmt(d.taps)}</b> toques
              </span>
              <span>
                <b>{d.balloons}</b> globos
              </span>
              <span>
                <b>{d.missions}</b> misiones
              </span>
            </div>
          </section>
        )}

        <div className="paper-columns">
          <section className="paper-section">
            <h3>📈 Bolsa</h3>
            <p>
              {up.def.emoji} <b>{up.def.name}</b> {up.pct >= 0 ? 'sube' : 'baja'} un <b className={up.pct >= 0 ? 'up' : 'down'}>{pct(up.pct)}</b> en 24 h.
            </p>
            <p>
              {down.def.emoji} <b>{down.def.name}</b> {down.pct >= 0 ? 'sube solo' : 'cae'} un{' '}
              <b className={down.pct >= 0 ? 'up' : 'down'}>{pct(down.pct)}</b>.
            </p>
          </section>

          <section className="paper-section">
            <h3>🧩 Retos de ayer</h3>
            {!winners && <p className="paper-muted">Consultando a los jueces…</p>}
            {winners &&
              PUZZLES.map((p, i) => (
                <p key={p.kind}>
                  {p.emoji} {p.name}:{' '}
                  {winners[i] ? (
                    <>
                      ganó <b>{winners[i]!.name}</b>
                      {winners[i]!.moves !== undefined && ` en ${winners[i]!.moves} movimientos`}
                      {winners[i]!.timeMs !== undefined && ` (${fmtTime(winners[i]!.timeMs! / 1000)})`}
                    </>
                  ) : (
                    <span className="paper-muted">sin resultados</span>
                  )}
                </p>
              ))}
          </section>
        </div>

        <section className="paper-section">
          <h3>📅 Agenda de hoy</h3>
          <ul className="paper-list">
            {agenda(s, t).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>

        <section className="paper-section paper-clara">
          <h3>👩‍💼 La columna de Clara</h3>
          <p>«{claraTip(s, t)}»</p>
        </section>

        <section className="paper-section">
          <h3>📌 Clasificados</h3>
          {classifieds(t).map((x) => (
            <p key={x} className="paper-ad">
              {x}
            </p>
          ))}
        </section>

        <button className="btn primary paper-done" onClick={onClose}>
          Volver a la ciudad
        </button>
      </div>
    </div>
  );
}
