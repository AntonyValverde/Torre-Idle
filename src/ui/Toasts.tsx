import { useGame } from '../game/store';

export function Toasts() {
  const toasts = useGame((st) => st.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" style={{ animationDuration: `${t.ms}ms` }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
