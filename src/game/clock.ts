// Reloj "de confianza". No usa directamente la hora del móvil, que el jugador puede cambiar:
//  - Se ancla a la hora del servidor de Firebase cuando hay conexión.
//  - Mientras el juego está abierto avanza con performance.now(), que no se ve afectado
//    si el jugador cambia la hora del dispositivo.
//  - Al volver de segundo plano solo puede avanzar, nunca retroceder.
const KEY = 'torre-clock-offset';

function readOffset(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

let offset = readOffset();
let anchorWall = Date.now() + offset;
let anchorPerf = performance.now();

export function now(): number {
  return anchorWall + (performance.now() - anchorPerf);
}

/** Ancla el reloj a la hora del servidor (la única fuente fiable). */
export function setServerTime(serverMs: number) {
  anchorWall = serverMs;
  anchorPerf = performance.now();
  offset = serverMs - Date.now();
  try {
    localStorage.setItem(KEY, String(offset));
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Al volver de segundo plano (donde performance.now puede haberse detenido), usa la hora
 * del dispositivo para recuperar el tiempo perdido, pero solo hacia delante.
 */
export function resyncFromDevice() {
  const guess = Date.now() + offset;
  if (guess > now()) {
    anchorWall = guess;
    anchorPerf = performance.now();
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function dateKey(ms: number = now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function prevDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1).getTime());
}

/**
 * ¿Es `today` un día nuevo respecto a `last`? Solo cuenta si es posterior: así, cambiar la zona
 * horaria adelante y atrás no permite repetir el reto diario ni el giro gratis.
 */
export function isNewDay(last: string | null, today: string): boolean {
  return !last || today > last;
}

/** La semana se identifica por su lunes (AAAA-MM-DD), en hora local. */
export function weekKey(ms: number = now()): string {
  const d = new Date(ms);
  const sinceMonday = (d.getDay() + 6) % 7;
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday, 12).getTime());
}

export function msUntilNextWeek(ms: number = now()): number {
  const d = new Date(ms);
  const sinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday + 7).getTime() - ms;
}

export function msUntilTomorrow(ms: number = now()): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - ms;
}
