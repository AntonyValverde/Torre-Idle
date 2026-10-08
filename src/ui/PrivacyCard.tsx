import { useState } from 'react';
import { deleteMyAccount, eraseErrorMessage } from '../game/cloud';
import { useGame } from '../game/store';
import { Modal } from './Modal';

/** Política de privacidad y eliminación de la cuenta desde el propio juego (Google Play lo exige). */
export function PrivacyCard({ google }: { google: boolean }) {
  const toast = useGame((st) => st.toast);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setWord('');
  };

  const erase = async () => {
    setBusy(true);
    try {
      // Si todo va bien no vuelve: recarga el juego (o sale hacia Google para confirmar y sigue al volver)
      await deleteMyAccount();
    } catch (e) {
      console.warn('No se pudo eliminar la cuenta', e);
      toast(`⚠️ ${eraseErrorMessage(e)}`);
      setBusy(false);
    }
  };

  const confirmed = word.trim().toUpperCase() === 'ELIMINAR';

  return (
    <div className="card privacy-card">
      <b>🔒 Privacidad</b>
      <p className="muted">Qué datos guarda el juego, para qué, y cómo borrarlos.</p>
      <div className="btn-row">
        <a className="btn" href="/privacidad" target="_blank" rel="noopener">
          Política de privacidad
        </a>
        <button className="btn danger" onClick={() => setOpen(true)}>
          🗑️ Eliminar mi cuenta
        </button>
      </div>

      {open && (
        <Modal onBackdrop={close}>
          <div className="result">
            <div className="big-emoji">🗑️</div>
            <div className="result-label">¿Eliminar tu cuenta?</div>
            <p className="muted">
              Se borra para siempre tu partida (en este dispositivo y en la nube), tu ciudad pública, tus récords en los rankings, los
              retos diarios, la liga, la Copa y la Conquista de esta semana, tus regalos y tus sugerencias.
              {google && ' También se borra la cuenta del juego vinculada a tu Google (puede que antes te pida confirmarla).'}
            </p>
            <p className="warn">No se puede deshacer.</p>
            <label className="field privacy-confirm">
              <span>Escribe ELIMINAR para confirmar</span>
              <input
                value={word}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                disabled={busy}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmed && !busy && erase()}
              />
            </label>
            <div className="btn-row">
              <button className="btn" onClick={close} disabled={busy}>
                Cancelar
              </button>
              <button className="btn danger" onClick={erase} disabled={!confirmed || busy}>
                {busy ? 'Eliminando…' : 'Eliminar para siempre'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
