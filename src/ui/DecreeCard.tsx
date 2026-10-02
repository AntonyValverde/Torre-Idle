import { useEffect } from 'react';
import { track } from '../firebase';
import { now } from '../game/clock';
import { eventFrequency } from '../game/economy';
import { DECREE_BY_ID } from '../game/events';
import { useGame } from '../game/store';
import { isUnlocked } from '../game/tutorial';
import { sfx, vibrate } from './haptics';

/** Programa un decreto del consejo cada 4–7 minutos (más seguido con "Cielo festivo"). */
export function useDecreeScheduler(onOffer: () => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    // Solo se propone si el jugador puede verlo: con la app visible y sin la ventana de ganancias offline
    const offer = () => {
      const st = useGame.getState();
      // Durante el tutorial, los decretos esperan a que Clara los presente
      if (document.visibilityState === 'visible' && !st.decree && !st.s.pendingOffline && isUnlocked(st.s, 'decrees')) {
        st.offerDecree();
        onOffer();
      }
    };
    const schedule = () => {
      const f = eventFrequency(useGame.getState().s);
      timer = setTimeout(
        () => {
          offer();
          schedule();
        },
        (240_000 + Math.random() * 180_000) * f,
      );
    };
    // El primero llega antes para que el jugador nuevo lo descubra
    timer = setTimeout(() => {
      offer();
      schedule();
    }, 75_000);
    return () => clearTimeout(timer);
  }, [onOffer]);
}

export function DecreeCard() {
  const decree = useGame((st) => st.decree);
  const lastTick = useGame((st) => st.s.lastTick);
  if (!decree) return null;
  const left = Math.max(0, decree.expires - Math.max(lastTick, now() - 1000));

  const choose = (id: (typeof decree.options)[number]) => {
    const st = useGame.getState();
    const msg = st.chooseDecree(id);
    // Vacío si el decreto ya se eligió o caducó (p. ej. doble toque)
    if (!msg) return;
    st.toast(msg);
    sfx('win');
    vibrate([15, 30, 15]);
    track('decree', { id });
  };

  return (
    <section className="decree">
      <div className="decree-head">
        <span>📜 El consejo propone…</span>
        <small>{Math.ceil(left / 1000)} s</small>
      </div>
      <div className="decree-bar">
        <div style={{ width: `${(left / 60_000) * 100}%` }} />
      </div>
      <div className="decree-options">
        {decree.options.map((id) => {
          const d = DECREE_BY_ID.get(id)!;
          return (
            <button key={id} className="decree-option" onClick={() => choose(id)}>
              <span className="decree-emoji">{d.emoji}</span>
              <b>{d.title}</b>
              <small>{d.desc}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
