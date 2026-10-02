import type { KeyboardEvent } from 'react';

/**
 * Hace que un elemento que no es un botón (p. ej. una fila de una lista) se pueda usar con el teclado:
 * recibe el foco con Tab y se activa con Enter o Espacio, igual que con un toque.
 */
export function pressable(onPress: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress();
      }
    },
  };
}
