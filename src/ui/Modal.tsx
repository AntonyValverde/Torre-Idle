import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
  );
}

/** Diálogos abiertos, del más antiguo al más reciente: solo el de arriba responde al teclado. */
const openDialogs: HTMLElement[] = [];

/**
 * Comportamiento de diálogo accesible:
 * - al abrir, mueve el foco al primer elemento enfocable (o al contenedor, con tabIndex=-1)
 * - al cerrar, devuelve el foco a donde estaba
 * - atrapa Tab / Shift+Tab dentro del contenedor
 * - Escape llama a `onEscape` (si existe)
 * - con varios diálogos abiertos, solo el de arriba atiende el teclado
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, { onEscape }: { onEscape?: () => void } = {}) {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });
  const hasEscape = !!onEscape;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = focusables(root)[0];
    (first ?? root).focus({ preventScroll: true });
    openDialogs.push(root);

    const onKey = (e: KeyboardEvent) => {
      // Con una ventana encima de una pantalla de juego, Escape y Tab solo valen para la de arriba
      if (openDialogs[openDialogs.length - 1] !== root) return;
      if (e.key === 'Escape') {
        if (!hasEscape) return;
        e.preventDefault();
        e.stopPropagation();
        escape.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstEl || !root.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !root.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openDialogs.lastIndexOf(root);
      if (i >= 0) openDialogs.splice(i, 1);
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, [ref, hasEscape]);
}

export function Modal({ children, onBackdrop }: { children: ReactNode; onBackdrop?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Escape cierra la ventana igual que tocar fuera (solo si se puede cerrar así)
  useDialogFocus(box, { onEscape: onBackdrop });

  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
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
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, { onEscape: onClose });

  return (
    <div ref={box} className="game-screen" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
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
