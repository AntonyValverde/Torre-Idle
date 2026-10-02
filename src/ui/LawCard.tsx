import { useState } from 'react';
import { track } from '../firebase';
import { eraName } from '../game/economy';
import { currentLaw, lawOptions, lawPending, type LawDef } from '../game/laws';
import { useGame } from '../game/store';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';
import { Modal } from './Modal';

/**
 * Ley de la era: si falta elegirla, muestra las tres opciones; si ya rige, un resumen
 * (solo con `showCurrent`, para no ocupar sitio en la Ciudad).
 */
export function LawCard({ showCurrent = false }: { showCurrent?: boolean }) {
  const s = useGame((st) => st.s);
  const [confirm, setConfirm] = useState<LawDef | null>(null);
  const law = currentLaw(s);

  if (!lawPending(s)) {
    if (!showCurrent || !law) return null;
    return (
      <div className="law-current">
        <span className="law-emoji">{law.emoji}</span>
        <div>
          <small className="muted">Ley de esta era</small>
          <b>{law.name}</b>
          <small>
            <span className="law-pro">✔ {law.pro}</span> · <span className="law-con">✘ {law.con}</span>
          </small>
        </div>
      </div>
    );
  }

  const approve = () => {
    if (!confirm) return;
    const st = useGame.getState();
    if (st.chooseLaw(confirm.id)) {
      st.toast(`⚖️ Ley aprobada: ${confirm.emoji} ${confirm.name}`);
      sfx('win');
      vibrate([20, 40, 20]);
      celebrate(3);
      track('law_choose', { law: confirm.id, era: st.s.era });
    }
    setConfirm(null);
  };

  return (
    <section className="law-card">
      <div className="law-head">
        <b>⚖️ Ley de la era {s.era}</b>
        <small className="muted">{eraName(s.era)} · elige una: rige hasta que refundes</small>
      </div>
      <div className="law-options">
        {lawOptions(s.era).map((l) => (
          <button key={l.id} className="law-option" onClick={() => setConfirm(l)}>
            <span className="law-emoji">{l.emoji}</span>
            <b>{l.name}</b>
            <small className="law-pro">✔ {l.pro}</small>
            <small className="law-con">✘ {l.con}</small>
          </button>
        ))}
      </div>
      <small className="muted law-note">Todos los alcaldes de la era {s.era} eligen entre estas mismas tres.</small>

      {confirm && (
        <Modal onBackdrop={() => setConfirm(null)}>
          <div className="result">
            <div className="big-emoji">{confirm.emoji}</div>
            <div className="result-label">¿Aprobar la ley?</div>
            <div className="result-score small">{confirm.name}</div>
            <p>
              <span className="law-pro">✔ {confirm.pro}</span>
              <br />
              <span className="law-con">✘ {confirm.con}</span>
            </p>
            <p className="muted">No se puede cambiar hasta la próxima era.</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirm(null)}>
                Pensarlo
              </button>
              <button className="btn primary" onClick={approve}>
                ¡Aprobar!
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
