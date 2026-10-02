/**
 * ¿Debe un minijuego de lienzo usar esta pulsación (Espacio/Intro) como toque?
 * No, si es una repetición por mantener la tecla pulsada, ni si va a un botón o campo de la propia
 * pantalla del juego (el ✕, los botones del resultado): esos tienen que seguir funcionando con el teclado.
 * Los elementos de fuera (p. ej. la tarjeta del juego que quedó con el foco debajo) sí se interceptan,
 * para que Espacio no la vuelva a pulsar y gaste otro ticket.
 */
export function isGameKey(e: KeyboardEvent): boolean {
  if (e.code !== 'Space' && e.code !== 'Enter') return false;
  if (e.repeat) {
    e.preventDefault();
    return false;
  }
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest('.game-screen') && el.closest('button, a, input, textarea, select, [contenteditable="true"]')) return false;
  return true;
}
