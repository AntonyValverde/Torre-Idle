import { useState } from 'react';
import { track } from '../firebase';
import { SUGGESTION_MAX, SUGGESTION_MIN, sendSuggestion, suggestionLength, type SuggestionKind } from '../game/cloud';
import { useGame } from '../game/store';

const KINDS: { id: SuggestionKind; label: string; placeholder: string }[] = [
  { id: 'idea', label: '💡 Idea', placeholder: '¿Qué te gustaría ver en el juego? Un minijuego, un edificio, una mejora…' },
  { id: 'bug', label: '🐞 Error', placeholder: '¿Qué pasó? ¿Qué estabas haciendo justo antes?' },
  { id: 'otro', label: '💬 Otro', placeholder: 'Cuéntanos lo que quieras' },
];

export function SuggestionBox() {
  const toast = useGame((st) => st.toast);
  const [kind, setKind] = useState<SuggestionKind>('idea');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Se cuenta igual que en las reglas de Firestore (un emoji es un carácter)
  const len = suggestionLength(text);

  const send = async () => {
    if (len < SUGGESTION_MIN || sending) return;
    setSending(true);
    try {
      await sendSuggestion(kind, text, useGame.getState().s);
      track('suggestion_sent', { kind });
      setText('');
      toast('🙌 ¡Gracias! Recibimos tu sugerencia');
    } catch (e) {
      toast(`⚠️ ${e instanceof Error && e.message ? e.message : 'No se pudo enviar. Revisa tu conexión'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card">
      <b>Reportar sugerencias</b>
      <div className="segmented">
        {KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="suggestion-input"
        value={text}
        maxLength={SUGGESTION_MAX}
        rows={4}
        placeholder={KINDS.find((k) => k.id === kind)!.placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="suggestion-foot">
        <small className="muted">
          {len}/{SUGGESTION_MAX} · Se envía con tu nombre, tu era y el tipo de dispositivo.
        </small>
        <button className="btn small primary" onClick={send} disabled={len < SUGGESTION_MIN || sending}>
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
