import { useEffect, useRef, useState } from 'react';
import { cloudEnabled, track } from '../firebase';
import { onAccountChange } from '../game/cloud';
import { useGame } from '../game/store';
import { TIPS, TIP_BY_ID, bubbleTip, tipAvailable, tipSeen } from '../game/tips';
import { tutorialDone } from '../game/tutorial';
import type { TabId } from './BottomNav';
import { sfx } from './haptics';
import { GameScreen } from './Modal';

export const TAB_LABEL: Record<TabId, string> = {
  city: '🏙️ Ciudad',
  upgrades: '⬆️ Mejoras',
  games: '🎮 Juegos',
  ranking: '🏆 Ranking',
  profile: '🏅 Logros',
};

/** Marca un consejo como visto (con su evento de analítica la primera vez). */
function dismiss(id: string) {
  const st = useGame.getState();
  if (!tipSeen(st.s, id)) track('tip_seen', { id });
  st.seeTip(id);
}

/**
 * Tarjeta de Clara dentro de una pantalla: sale la primera vez que se abre y se cierra con "Entendido".
 * Durante el tutorial no sale (Clara ya está hablando abajo).
 */
export function ClaraTip({ id, cta = 'Entendido' }: { id: string; cta?: string }) {
  const show = useGame((st) => tutorialDone(st.s) && !tipSeen(st.s, id));
  const tip = TIP_BY_ID.get(id);
  if (!show || !tip) return null;
  return (
    <div className="card clara-tip" role="note">
      <span className="clara-tip-face" aria-hidden="true">
        👩‍💼
      </span>
      <div>
        <b>
          {tip.emoji} {tip.title}
        </b>
        <p>{tip.text}</p>
        <button className="btn primary small" onClick={() => dismiss(id)}>
          {cta}
        </button>
      </div>
    </div>
  );
}

/** Entre una burbuja y la siguiente, para no agobiar (los incidentes no esperan: duran poco). */
const BUBBLE_GAP_MS = 45_000;

/** Decide qué burbuja de Clara toca enseñar, mirando la partida cada pocos segundos. */
export function useClaraTips(ready: boolean) {
  const guest = useRef(false);
  const lastClosed = useRef(0);
  const tip = useGame((st) => st.tip);

  useEffect(() => (cloudEnabled ? onAccountChange((a) => (guest.current = !!a && a.googleEmail == null)) : undefined), []);

  // Al cerrarse una burbuja empieza la pausa hasta la siguiente
  useEffect(() => {
    if (!tip) lastClosed.current = Date.now();
  }, [tip]);

  useEffect(() => {
    if (!ready) return;
    // La primera, como pronto, unos segundos después de abrir el juego
    lastClosed.current = Date.now() - BUBBLE_GAP_MS + 8000;
    const check = () => {
      const st = useGame.getState();
      if (st.tip || document.visibilityState !== 'visible') return;
      const id = bubbleTip(st.s, { incident: !!st.incident, guest: guest.current });
      if (!id) return;
      if (id !== 'incident' && Date.now() - lastClosed.current < BUBBLE_GAP_MS) return;
      st.showTip(id);
    };
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, [ready]);
}

/** Burbuja de Clara abajo, en el sitio de la del tutorial, para lo que pasa en la ciudad. */
export function ClaraTipBubble({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const id = useGame((st) => st.tip);
  const tip = id ? TIP_BY_ID.get(id) : undefined;

  useEffect(() => {
    if (tip) sfx('buy');
  }, [tip]);

  if (!tip) return null;
  return (
    <section className="tutorial clara-bubble" key={tip.id} aria-live="polite">
      <div className="tut-avatar" aria-hidden="true">
        👩‍💼
      </div>
      <div className="tut-body">
        <div className="tut-head">
          <b>Clara</b>
          <small className="muted">
            {tip.emoji} {tip.title}
          </small>
        </div>
        <p className="tut-text">{tip.text}</p>
        <div className="tut-foot">
          {tip.tab && tip.tab !== tab && (
            <button className="tut-go" onClick={() => onTab(tip.tab!)}>
              👉 Ir a {TAB_LABEL[tip.tab]}
            </button>
          )}
          <button className="btn primary small tut-ok" onClick={() => dismiss(tip.id)}>
            Entendido
          </button>
        </div>
      </div>
    </section>
  );
}

/** Guía de Clara (👤 Perfil): todos los consejos para repasarlos, y el tutorial otra vez. */
export function ClaraGuide({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.s);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const available = TIPS.filter((t) => tipAvailable(s, t));
  const locked = TIPS.length - available.length;

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    if (!tipSeen(s, id)) dismiss(id);
  };

  const replay = () => {
    useGame.getState().tutorialReplay();
    track('tutorial_replay');
    onClose();
  };

  return (
    <GameScreen title="Guía de Clara" right={`📖 ${available.length}/${TIPS.length}`} onClose={onClose}>
      <div className="guide-wrap">
        <div className="card clara-tip guide-intro">
          <span className="clara-tip-face" aria-hidden="true">
            👩‍💼
          </span>
          <div>
            <b>Todo lo que te he contado</b>
            <p>Toca un tema para repasarlo. Lo que aún no has descubierto sale con candado.</p>
          </div>
        </div>
        <ul className="list guide-list">
          {available.map((t) => (
            <li key={t.id} className={`guide-item${open === t.id ? ' open' : ''}`}>
              <button className="guide-head" onClick={() => toggle(t.id)} aria-expanded={open === t.id}>
                <span className="row-emoji">{t.emoji}</span>
                <b>{t.title}</b>
                {!tipSeen(s, t.id) && <span className="new-tag">NUEVO</span>}
                <span className="guide-caret" aria-hidden="true">
                  {open === t.id ? '▴' : '▾'}
                </span>
              </button>
              {open === t.id && <p className="guide-text">{t.text}</p>}
            </li>
          ))}
          {locked > 0 && (
            <li className="guide-item locked">
              <div className="guide-head">
                <span className="row-emoji">🔒</span>
                <b>{locked === 1 ? 'Un tema más' : `${locked} temas más`}</b>
                <small className="muted">Los descubrirás jugando</small>
              </div>
            </li>
          )}
        </ul>
        {tutorialDone(s) && (
          <div className="card">
            <b>🔁 Repetir el tutorial</b>
            {confirm ? (
              <>
                <p className="muted">Clara te acompañará otra vez paso a paso. No se cierra nada y no da premios: es solo un repaso.</p>
                <div className="btn-row">
                  <button className="btn" onClick={() => setConfirm(false)}>
                    Cancelar
                  </button>
                  <button className="btn primary" onClick={replay}>
                    Empezar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">Vuelve a hacer los primeros pasos con Clara, a tu ritmo.</p>
                <button className="btn" onClick={() => setConfirm(true)}>
                  Repetir
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </GameScreen>
  );
}

/** Tarjeta de 👤 Perfil que abre la guía. */
export function GuideCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="game-card guide-card" onClick={() => setOpen(true)}>
        <span className="game-emoji">📖</span>
        <div className="game-info">
          <b>Guía de Clara</b>
          <small>Repasa cómo funciona cada parte de la ciudad, o repite el tutorial.</small>
        </div>
      </button>
      {open && <ClaraGuide onClose={() => setOpen(false)} />}
    </>
  );
}
