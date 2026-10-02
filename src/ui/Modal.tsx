import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ children, onBackdrop }: { children: ReactNode; onBackdrop?: () => void }) {
  // Escape cierra la ventana igual que tocar fuera (solo si se puede cerrar así)
  const close = useRef(onBackdrop);
  useEffect(() => {
    close.current = onBackdrop;
  });
  const closable = !!onBackdrop;
  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable]);

  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function GameScreen({
  title,
  right,
  onClose,
  children,
}: {
  title: string;
  right?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="game-screen">
      <header className="game-header">
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <span className="game-title">{title}</span>
        <span className="game-right">{right}</span>
      </header>
      <div className="game-body">{children}</div>
    </div>
  );
}
