import { fmt, fmtTime } from '../game/format';
import { useGame } from '../game/store';
import { sfx } from './haptics';
import { Modal } from './Modal';
import { ClaraTip } from './ClaraTip';

export function OfflineModal() {
  const offline = useGame((st) => st.s.pendingOffline);
  const tickets = useGame((st) => st.s.tickets);
  const collect = useGame((st) => st.collectOffline);
  if (!offline) return null;

  const take = (double: boolean) => {
    collect(double);
    sfx('win');
  };

  return (
    <Modal>
      <div className="result">
        <div className="big-emoji">🌙</div>
        <div className="result-label">Mientras no estabas ({fmtTime(offline.seconds)})</div>
        <div className="result-score">+{fmt(offline.earned)} 🪙</div>
        <p className="muted">Tu ciudad siguió trabajando. Mejora el “Gerente nocturno” para acumular más horas.</p>
        <ClaraTip id="offline" />
        <div className="btn-row">
          <button className="btn" onClick={() => take(false)}>
            Recoger
          </button>
          <button className="btn primary" disabled={tickets < 1} onClick={() => take(true)}>
            x2 · 🎟️1
          </button>
        </div>
      </div>
    </Modal>
  );
}
