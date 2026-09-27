import type { ReactNode } from 'react';

export function Modal({ children, onBackdrop }: { children: ReactNode; onBackdrop?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
