import { useEffect, useState } from 'react';
import { track } from '../firebase';
import { eventFrequency } from '../game/economy';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';

/** Globo dorado que aparece cada 1–3 minutos. Tocarlo da una recompensa sorpresa. */
export function GoldenBalloon() {
  const [balloon, setBalloon] = useState<{ id: number; top: number } | null>(null);

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

  return (
    <button
      key={balloon.id}
      className="balloon"
      style={{ top: `${balloon.top}%` }}
      onAnimationEnd={() => setBalloon(null)}
      onPointerDown={() => {
        const store = useGame.getState();
        const text = store.rewardGolden();
        store.toast(`🎈 ${text}`);
        sfx('win');
        vibrate([15, 30, 15]);
        track('golden_balloon');
        setBalloon(null);
      }}
      aria-label="Globo dorado"
    >
      🎈
    </button>
  );
}
