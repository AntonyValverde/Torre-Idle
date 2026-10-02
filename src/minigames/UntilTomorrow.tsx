import { useEffect, useState } from 'react';
import { dateKey, msUntilTomorrow } from '../game/clock';
import { fmtTime } from '../game/format';

/**
 * Cuenta atrás hasta el próximo reto diario, refrescada cada segundo. Al cambiar de día llama a
 * `onNewDay` (para cargar el reto nuevo sin tener que salir y volver a entrar).
 */
export function UntilTomorrow({ date, onNewDay }: { date: string; onNewDay: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (dateKey() > date) onNewDay();
      else setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [date, onNewDay]);
  return <>{fmtTime(Math.max(0, msUntilTomorrow()) / 1000)}</>;
}
