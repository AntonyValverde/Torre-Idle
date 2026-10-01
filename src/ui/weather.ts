import { dateKey } from '../game/clock';
import { hashString, mulberry32 } from '../minigames/rng';

// Clima y fechas especiales de la ciudad. Es el mismo para todos los jugadores a la misma hora:
// sale de la fecha y de un bloque de 3 horas, no del azar de cada dispositivo.

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';
export type Season = 'christmas' | 'newyear' | 'halloween' | null;

// Probabilidad de lluvia por mes (ene…dic): más en la temporada de lluvias
const RAIN = [0.08, 0.08, 0.1, 0.15, 0.3, 0.35, 0.3, 0.3, 0.4, 0.45, 0.3, 0.12];
// Nieve solo en pleno invierno (y como capricho festivo)
const SNOW = [0.12, 0.08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.22];

export function weatherAt(ms: number): Weather {
  const d = new Date(ms);
  const block = Math.floor(d.getHours() / 3);
  const r = mulberry32(hashString(`clima:${dateKey(ms)}:${block}`))();
  const m = d.getMonth();
  if (r < SNOW[m]) return 'snow';
  if (r < SNOW[m] + RAIN[m] * 0.3) return 'storm';
  if (r < SNOW[m] + RAIN[m]) return 'rain';
  if (r < SNOW[m] + RAIN[m] + 0.25) return 'cloudy';
  return 'clear';
}

export function seasonAt(ms: number): Season {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  if ((m === 12 && day === 31 && h >= 18) || (m === 1 && day === 1 && h < 4)) return 'newyear';
  if ((m === 12 && day >= 1) || (m === 1 && day <= 6)) return 'christmas';
  if ((m === 10 && day >= 24) || (m === 11 && day <= 2)) return 'halloween';
  return null;
}

/** 1 = noche cerrada, 0 = pleno día (hora local con decimales). */
export function nightAt(hour: number): number {
  if (hour < 5 || hour >= 20.5) return 1;
  if (hour >= 8 && hour <= 16.5) return 0;
  if (hour < 8) return 1 - (hour - 5) / 3;
  return (hour - 16.5) / 4;
}

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: '☀️ Despejado',
  cloudy: '☁️ Nublado',
  rain: '🌧️ Lluvia',
  storm: '⛈️ Tormenta',
  snow: '❄️ Nieve',
};

export const SEASON_LABEL: Record<Exclude<Season, null>, string> = {
  christmas: '🎄 Navidad',
  newyear: '🎆 Año Nuevo',
  halloween: '🎃 Halloween',
};
