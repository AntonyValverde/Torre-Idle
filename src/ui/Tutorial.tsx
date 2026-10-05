import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { track } from '../firebase';
import { useGame } from '../game/store';
import { TUTORIAL, TUTORIAL_DONE, currentStep, rewardText } from '../game/tutorial';
import type { TabId } from './BottomNav';
import { TAB_LABEL } from './ClaraTip';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';

/**
 * Efectos del tutorial que deben funcionar aunque la burbuja no se vea (p. ej. con un minijuego abierto):
 * premio y sonido al completar un paso, analítica y el decreto del paso de decretos.
 */
export function useTutorialEffects() {
  const step = useGame((st) => st.s.tutorial.step);
  const stepId = useGame((st) => currentStep(st.s)?.id ?? null);
  const decree = useGame((st) => st.decree);
  const pendingOffline = useGame((st) => !!st.s.pendingOffline);
  const prev = useRef({ step, replay: false, later: 0 });

  useEffect(() => {
    const t = useGame.getState().s.tutorial;
    const was = prev.current;
    prev.current = { step, replay: !!t.replay, later: t.later?.length ?? 0 };
    // Solo un paso hacia delante: saltar el tutorial o cargar otra partida no es completar un paso
    if (step !== was.step + 1) return;
    const done = TUTORIAL[was.step];
    const st = useGame.getState();
    // En el repaso y en los pasos dejados para más tarde no hay premio
    const postponed = (t.later?.length ?? 0) > was.later;
    const reward = was.replay || postponed ? '' : rewardText(done.reward);
    if (step >= TUTORIAL_DONE) {
      celebrate(was.replay ? 3 : 8);
      sfx('win');
      vibrate([30, 50, 30, 50, 80]);
      if (was.replay) st.toast('📖 ¡Repaso terminado!');
      else if (reward) st.toast(`🎉 ¡Tutorial completado! ${reward}`);
      track(was.replay ? 'tutorial_replay_done' : 'tutorial_done');
      return;
    }
    if (reward) {
      st.toast(`✅ ¡Bien hecho! ${reward}`);
      sfx('win');
      vibrate([15, 30, 15]);
    }
    if (!was.replay) track(postponed ? 'tutorial_later' : 'tutorial_step', { step, id: postponed ? done.id : TUTORIAL[step].id });
  }, [step]);

  // Paso de decretos: el consejo propone uno enseguida (y otro si el anterior caducó sin elegir)
  useEffect(() => {
    if (stepId !== 'decree' || decree || pendingOffline) return;
    const timer = setTimeout(() => {
      const st = useGame.getState();
      if (!st.decree && document.visibilityState === 'visible') st.offerDecree();
    }, 1500);
    return () => clearTimeout(timer);
  }, [stepId, decree, pendingOffline]);
}

export function TutorialBubble({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const tutorial = useGame((st) => st.s.tutorial);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const step = TUTORIAL[tutorial.step];
  const replay = !!tutorial.replay;

  // Lo que señala Clara se desplaza a la vista (la burbuja ocupa la parte de abajo de la pantalla)
  useEffect(() => {
    const raf = requestAnimationFrame(() => document.querySelector('.tut-target')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(raf);
  }, [tutorial.step, tab]);

  if (!step) return null;
  const elsewhere = step.event !== null && step.tab !== tab;
  const reward = replay ? '' : rewardText(step.reward);
  // En el repaso cualquier paso con evento se puede pasar (p. ej. el sobre de regalo ya se abrió)
  const later = step.event !== null ? (replay ? 'Siguiente ›' : step.later) : undefined;

  const skip = () => {
    if (!replay) track('tutorial_skip', { step: tutorial.step, id: step.id });
    useGame.getState().tutorialSkip();
    setConfirmSkip(false);
  };

  return (
    <section className="tutorial" key={tutorial.step} aria-live="polite">
      <div className="tut-avatar" aria-hidden="true">
        👩‍💼
      </div>
      <div className="tut-body">
        <div className="tut-head">
          <b>Clara</b>
          <small className="muted">
            {replay ? 'Repaso' : 'Consejera'} · {tutorial.step + 1}/{TUTORIAL.length}
          </small>
          {!confirmSkip && (
            <button className="tut-skip" onClick={() => setConfirmSkip(true)}>
              {replay ? 'Terminar' : 'Saltar'}
            </button>
          )}
        </div>
        {confirmSkip ? (
          <>
            <p className="tut-text">
              {replay
                ? '¿Terminar el repaso? Puedes volver a empezarlo cuando quieras desde la Guía de Clara.'
                : '¿Saltar el tutorial? Se abrirá todo el juego de golpe y no recibirás sus premios. Te lo iré explicando sobre la marcha.'}
            </p>
            <div className="btn-row">
              <button className="btn small" onClick={() => setConfirmSkip(false)}>
                Seguir con Clara
              </button>
              <button className="btn small primary" onClick={skip}>
                {replay ? 'Terminar' : 'Saltar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="tut-text">{step.text}</p>
            {step.event ? (
              <div className="tut-progress">
                <div className="progress">
                  <div style={{ width: `${(tutorial.p / step.target) * 100}%` } as CSSProperties} />
                </div>
                <small>
                  {Math.floor(tutorial.p)}/{step.target}
                </small>
              </div>
            ) : (
              <button
                className="btn primary small tut-cta"
                onClick={() => {
                  useGame.getState().tutorialNext();
                  sfx('buy');
                }}
              >
                {step.cta}
              </button>
            )}
            <div className="tut-foot">
              {elsewhere && (
                <button className="tut-go" onClick={() => onTab(step.tab)}>
                  👉 Ir a {TAB_LABEL[step.tab]}
                </button>
              )}
              {later && (
                <button className="tut-later" onClick={() => useGame.getState().tutorialLater()}>
                  {later}
                </button>
              )}
              {reward && <small className="tut-reward">🎁 {reward}</small>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
