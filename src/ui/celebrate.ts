// Fuegos artificiales en la ciudad. Cualquier pantalla puede pedirlos; la escena los lanza
// la próxima vez que se dibuje (aunque el jugador esté en otra pestaña en ese momento).

let until = 0;

export function celebrate(seconds = 6) {
  until = Math.max(until, performance.now() + seconds * 1000);
}

export function celebrating(t = performance.now()): boolean {
  return t < until;
}
