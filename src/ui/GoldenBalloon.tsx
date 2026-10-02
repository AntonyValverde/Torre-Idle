import { useEffect, useRef, useState } from 'react';
import { track } from '../firebase';
import { eventFrequency } from '../game/economy';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';

/** Globo dorado que aparece cada 1–3 minutos. Tocarlo da una recompensa sorpresa. */
export function GoldenBalloon() {
  const [balloon, setBalloon] = useState<{ id: number; top: number } | null>(null);
  const claimed = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') setBalloon({ id: Date.now(), top: 18 + Math.random() * 45 });
          schedule();
        },
        (60_000 + Math.random() * 120_000) * eventFrequency(useGame.getState().s),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  if (!balloon) return null;

  // Se cobra al tocarlo (pointerdown, que no falla aunque el globo se mueva) o con click/teclado.
  // Un toque dispara los dos eventos: el id del globo cobrado evita pagar dos veces.
  const claim = () => {
    if (claimed.current === balloon.id) return;
    claimed.current = balloon.id;
    const store = useGame.getState();
    const text = store.rewardGolden();
    store.toast(`🎈 ${text}`);
    sfx('win');
    vibrate([15, 30, 15]);
    track('golden_balloon');
    setBalloon(null);
  };

  return (
    <button
      key={balloon.id}
      className="balloon"
      style={{ top: `${balloon.top}%` }}
      onAnimationEnd={() => setBalloon(null)}
      onPointerDown={claim}
      onClick={claim}
      aria-label="Globo dorado: tócalo para conseguir un premio"
    >
      🎈
    </button>
  );
}
