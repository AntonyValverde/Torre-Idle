import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { track } from '../firebase';
import { fetchDailyTop, type ScoreEntry } from '../game/cloud';
import { dateKey, now, prevDateKey } from '../game/clock';
import { fmt, fmtTime } from '../game/format';
import { PAPER_GEMS, paperUnread } from '../game/paper';
import { useGame } from '../game/store';
import { rustle, sfx, vibrate } from './haptics';
import { agenda, claraTip, classifieds, editionNumber, forecast, headlines, longDate, marketMovers, sinceLabel, sparkline, splitAd } from './gazette';

const PUZZLES = [
  { kind: 'daily', emoji: '🌃', name: 'Apagón' },
  { kind: 'roads', emoji: '🛣️', name: 'Calles' },
  { kind: 'parks', emoji: '🌳', name: 'Plan verde' },
] as const;

/** Lo que dura el giro de una página (en sintonía con `pageOut`/`pageIn` de styles.css). */
const TURN_MS = 520;

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

/** Cabecera de las páginas interiores: cintillo con el nombre del diario y título de la sección. */
function RunningHead({ title, edition, page }: { title: string; edition: number; page: number }) {
  return (
    <header className="paper-runhead">
      <div className="paper-runhead-top">
        <span className="paper-runhead-logo">La Gaceta</span>
        <span>
          Nº {edition} · Pág. {page}
        </span>
      </div>
      <h2>{title}</h2>
    </header>
  );
}

export function NewspaperScreen({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.s);
  const [t] = useState(now);
  const today = dateKey(t);
  const yesterday = prevDateKey(today);
  const edition = editionNumber(today);
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

  const pages: { name: string; body: ReactNode }[] = [
    {
      name: 'Portada',
      body: (
        <>
          <header className="paper-masthead">
            <div className="paper-tagline">
              <span>Fundado en 2026</span>
              <span>Diario independiente</span>
            </div>
            <h1>La Gaceta</h1>
            <div className="paper-sub">✦ de Infinite City ✦</div>
            <div className="paper-meta">
              <span>Nº {edition}</span>
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
        </>
      ),
    },
    {
      name: 'La Ciudad',
      body: (
        <>
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
        </>
      ),
    },
    {
      name: 'Opinión y anuncios',
      body: (
        <>
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
        </>
      ),
    },
  ];

  // Página visible y, mientras gira una hoja, de cuál a cuál
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState<{ from: number; to: number } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const turnTimer = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => window.clearTimeout(turnTimer.current), []);

  const goTo = (to: number) => {
    if (turn || to === page || to < 0 || to >= pages.length) return;
    rustle();
    vibrate(8);
    screenRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setPage(to);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setTurn({ from: page, to });
    turnTimer.current = window.setTimeout(() => setTurn(null), TURN_MS);
  };

  // Flechas del teclado para hojear
  const goRef = useRef(goTo);
  goRef.current = goTo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(page + 1);
      else if (e.key === 'ArrowLeft') goRef.current(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page]);

  // Deslizar el dedo en horizontal pasa la página (el desplazamiento vertical se respeta)
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(page + (dx < 0 ? 1 : -1));
  };

  /** Papel que le toca a cada página: la que gira encima, la que queda debajo o ninguna. */
  const role = (i: number) => {
    if (!turn) return i === page ? 'current' : '';
    const forward = turn.to > turn.from;
    if (forward) return i === turn.from ? 'turn-out' : i === turn.to ? 'under reveal' : '';
    return i === turn.to ? 'turn-in' : i === turn.from ? 'under cover' : '';
  };

  return (
    <div className="paper-screen" ref={screenRef} role="dialog" aria-label="La Gaceta de Infinite City">
      <div
        className="paper-book"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={onTouchEnd}
      >
        <button className="paper-close" onClick={onClose} aria-label="Cerrar el periódico">
          ✕
        </button>
        {pages.map((p, i) => (
          <div key={p.name} className={`paper ${role(i)}`} aria-hidden={i !== page} inert={i !== page}>
            {i > 0 && <RunningHead title={p.name} edition={edition} page={i + 1} />}
            {p.body}
            <footer className="paper-folio">
              <span>— {i + 1} —</span>
              {i < pages.length - 1 && (
                <button onClick={() => goTo(i + 1)}>
                  Sigue en la pág. {i + 2} <span aria-hidden>›</span>
                </button>
              )}
            </footer>
          </div>
        ))}
      </div>

      <nav className="paper-nav" aria-label="Páginas del periódico">
        <button onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Página anterior">
          ‹
        </button>
        <div className="paper-nav-mid">
          <span>{pages[page].name}</span>
          <div className="paper-dots">
            {pages.map((p, i) => (
              <button key={p.name} className={i === page ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Página ${i + 1}: ${p.name}`} />
            ))}
          </div>
        </div>
        <button onClick={() => goTo(page + 1)} disabled={page === pages.length - 1} aria-label="Página siguiente">
          ›
        </button>
      </nav>
    </div>
  );
}
