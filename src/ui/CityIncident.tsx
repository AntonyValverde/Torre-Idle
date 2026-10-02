import { useEffect } from 'react';
import { now } from '../game/clock';
import { eventFrequency } from '../game/economy';
import { INCIDENTS, INCIDENT_BONUS, INCIDENT_LIFE_MS, nextIncidentDelay } from '../game/incidents';
import { useGame } from '../game/store';
import { tutorialDone } from '../game/tutorial';
import { vibrate } from './haptics';

/**
 * Saca un incidente a la ciudad cada 6–10 minutos. `canOffer` dice si el jugador lo vería ahora
 * (en la pestaña Ciudad y sin otra pantalla encima); si no, se espera al siguiente.
 */
export function useIncidentScheduler(canOffer: () => boolean) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const offer = () => {
      const st = useGame.getState();
      if (document.visibilityState === 'visible' && canOffer() && tutorialDone(st.s) && !st.s.pendingOffline && !st.incident) {
        st.offerIncident();
        vibrate([20, 40, 20]);
      }
    };
    const schedule = (ms: number) => {
      timer = setTimeout(() => {
        offer();
        schedule(nextIncidentDelay(Math.random, eventFrequency(useGame.getState().s)));
      }, ms);
    };
    // El primero llega antes, para que se descubra pronto
    schedule(150_000 + Math.random() * 60_000);
    return () => clearTimeout(timer);
  }, [canOffer]);
}

/** Marcador del incidente sobre la escena. Tocarlo abre el minijuego que lo resuelve. */
export function CityIncident({ onPlay }: { onPlay: () => void }) {
  const incident = useGame((st) => st.incident);
  // Se vuelve a dibujar con el tick para la cuenta atrás
  useGame((st) => st.s.lastTick);
  if (!incident) return null;
  const def = INCIDENTS[incident.kind];
  const left = Math.max(0, incident.expires - now());

  return (
    <button
      className={`incident incident-${incident.kind}`}
      style={{ left: `${incident.x}%` }}
      onClick={onPlay}
      aria-label={`${def.title} Tócalo para resolverlo gratis con monedas x${INCIDENT_BONUS}`}
    >
      <span className="incident-label">
        <b>{def.title}</b>
        <small>Gratis · 🪙x{INCIDENT_BONUS}</small>
        <span className="incident-time">
          <span style={{ width: `${(left / INCIDENT_LIFE_MS) * 100}%` }} />
        </span>
      </span>
      <span className="incident-emoji">{def.emoji}</span>
      <span className="incident-ring" />
    </button>
  );
}
