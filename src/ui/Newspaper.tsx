import { useEffect, useState } from 'react';
import { track } from '../firebase';
import { fetchDailyTop, type ScoreEntry } from '../game/cloud';
import { dateKey, now, prevDateKey } from '../game/clock';
import { fmt, fmtTime } from '../game/format';
import { PAPER_GEMS, paperUnread } from '../game/paper';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';
import { agenda, claraTip, classifieds, editionNumber, forecast, headlines, longDate, marketMovers, sinceLabel, sparkline, splitAd } from './gazette';

const PUZZLES = [
  { kind: 'daily', emoji: '🌃', name: 'Apagón' },
  { kind: 'roads', emoji: '🛣️', name: 'Calles' },
  { kind: 'parks', emoji: '🌳', name: 'Plan verde' },
] as const;

/** Mosaico de la fila de accesos de la Ciudad que abre el periódico del día. */
export function NewspaperCard({ onOpen }: { onOpen: () => void }) {
  const s = useGame((st) => st.s);
  const today = dateKey(now());
  const unread = paperUnread(s, today);
  const lead = headlines(s, s.paper.prev)[0];
  return (
    <button className={`hub-tile hub-paper${unread ? ' ready' : ''}`} onClick={onOpen} title={`${lead.emoji} ${lead.title}`}>
      {unread && <span className="hub-badge new">NUEVO</span>}
      <span className="hub-icon">📰</span>
      <b>La Gaceta</b>
      <small>{unread ? `+${PAPER_GEMS} 💎` : `Nº ${editionNumber(today)}`}</small>
    </button>
  );
}

/** Minigráfica de las últimas 24 h de una acción (valores 0..1). */
function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const w = 72;
  const h = 18;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - v * (h - 2)).toFixed(1)}`).join(' ');
  return (
    <svg className={`paper-spark ${up ? 'up' : 'down'}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
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

  // Sin signo: la flecha ya lo dice
  const pct = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`;
  const stats = d
    ? [
        { emoji: '🪙', value: d.earned, label: 'monedas' },
        { emoji: '👆', value: d.taps, label: 'toques' },
        { emoji: '🎈', value: d.balloons, label: 'globos' },
        { emoji: '✅', value: d.missions, label: 'misiones' },
      ]
    : [];

  return (
    <div className="paper-screen" role="dialog" aria-label="La Gaceta de Infinite City">
      <div className="paper">
        <button className="paper-close" onClick={onClose} aria-label="Cerrar el periódico">
          ✕
        </button>
        <header className="paper-masthead">
          <div className="paper-tagline">
            <span>Fundado en 2026</span>
            <span>Diario independiente</span>
          </div>
          <h1>La Gaceta</h1>
          <div className="paper-sub">✦ de Infinite City ✦</div>
          <div className="paper-meta">
            <span>Nº {editionNumber(today)}</span>
            <span className="paper-date">{longDate(t)}</span>
            <span>1 🪙</span>
          </div>
        </header>

        <div className="paper-weather">
          {forecast(t).map((f) => {
            const [icon, ...txt] = f.weather.split(' ');
            return (
              <div key={f.label}>
                <span className="paper-weather-icon">{icon}</span>
                <span>
                  <small>{f.label}</small>
                  {txt.join(' ')}
                </span>
              </div>
            );
          })}
        </div>

        <article className="paper-lead">
          <div className="paper-kicker">En portada</div>
          <div className="paper-lead-emoji">{lead.emoji}</div>
          <h2>{lead.title}</h2>
          <p>{lead.text}</p>
        </article>

        {rest.length > 0 && (
          <div className="paper-briefs">
            {rest.map((x) => (
              <p key={x.title}>
                <span className="paper-brief-emoji">{x.emoji}</span>
                <span>
                  <b>{x.title}.</b> {x.text}
                </span>
              </p>
            ))}
          </div>
        )}

        {d && (
          <section className="paper-section">
            <h3>{sinceLabel(d, today)}</h3>
            <div className="paper-stats">
              {stats.map((x) => (
                <div key={x.label} className={x.value > 0 ? '' : 'zero'}>
                  <span>{x.emoji}</span>
                  <b>{fmt(x.value)}</b>
                  <small>{x.label}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="paper-columns">
          <section className="paper-section">
            <h3>📈 Bolsa · 24 h</h3>
            {[up, down].map((m) => (
              <div key={m.def.id} className="paper-stock">
                <span className="paper-stock-emoji">{m.def.emoji}</span>
                <span className="paper-stock-main">
                  <b>{m.def.name}</b>
                  <span className="paper-stock-line">
                    <Sparkline values={sparkline(m.def, t)} up={m.pct >= 0} />
                    <span className={`paper-stock-pct ${m.pct >= 0 ? 'up' : 'down'}`}>
                      {m.pct >= 0 ? '▲' : '▼'} {pct(m.pct)}
                    </span>
                  </span>
                </span>
              </div>
            ))}
          </section>

          <section className="paper-section">
            <h3>🧩 Retos de ayer</h3>
            {!winners && <p className="paper-muted">Consultando a los jueces…</p>}
            {winners &&
              PUZZLES.map((p, i) => {
                const w = winners[i];
                return (
                  <div key={p.kind} className="paper-winner">
                    <span className="paper-winner-emoji">{p.emoji}</span>
                    <span className="paper-winner-main">
                      <small>
                        {p.name}
                        {w && ' · 👑'}
                      </small>
                      {w ? (
                        <>
                          <b>{w.name}</b>
                          <span className="paper-winner-score">
                            {[w.moves !== undefined && `${w.moves} mov.`, w.timeMs !== undefined && fmtTime(w.timeMs / 1000)].filter(Boolean).join(' · ')}
                          </span>
                        </>
                      ) : (
                        <span className="paper-muted">Desierto</span>
                      )}
                    </span>
                  </div>
                );
              })}
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
          <h3>Opinión</h3>
          <div className="paper-clara-body">
            <span className="paper-clara-face" aria-hidden>
              👩‍💼
            </span>
            <blockquote>
              <p>{claraTip(s, t)}</p>
              <cite>— Clara, consejera del alcalde</cite>
            </blockquote>
          </div>
        </section>

        <section className="paper-section">
          <h3>📌 Clasificados</h3>
          <div className="paper-ads">
            {classifieds(t).map((x) => {
              const [head, body] = splitAd(x);
              return (
                <p key={x} className="paper-ad">
                  {head && <b>{head}</b>} {body}
                </p>
              );
            })}
          </div>
        </section>

        <button className="btn primary paper-done" onClick={onClose}>
          Volver a la ciudad
        </button>
      </div>
    </div>
  );
}
