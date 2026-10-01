import { describe, expect, it } from 'vitest';
import { seasonAt, weatherAt, type Weather } from './weather';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('clima de la ciudad', () => {
  it('es el mismo para todos a la misma hora y dura bloques de 3 horas', () => {
    expect(weatherAt(at(2026, 9, 30, 13))).toBe(weatherAt(at(2026, 9, 30, 13)));
    expect(weatherAt(at(2026, 9, 30, 12))).toBe(weatherAt(at(2026, 9, 30, 14)));
  });

  it('solo nieva en invierno y en temporada de lluvias llueve más', () => {
    const count = (month: number) => {
      const c: Record<Weather, number> = { clear: 0, cloudy: 0, rain: 0, storm: 0, snow: 0 };
      for (let d = 1; d <= 28; d++) for (let h = 0; h < 24; h += 3) c[weatherAt(at(2026, month, d, h))]++;
      return c;
    };
    expect(count(7).snow).toBe(0);
    expect(count(12).snow).toBeGreaterThan(0);
    const wetOct = count(10).rain + count(10).storm;
    const wetFeb = count(2).rain + count(2).storm;
    expect(wetOct).toBeGreaterThan(wetFeb);
    expect(count(10).clear).toBeGreaterThan(0);
  });

  it('reconoce las fechas especiales', () => {
    expect(seasonAt(at(2026, 12, 15))).toBe('christmas');
    expect(seasonAt(at(2027, 1, 6))).toBe('christmas');
    expect(seasonAt(at(2027, 1, 7))).toBeNull();
    expect(seasonAt(at(2026, 12, 31, 22))).toBe('newyear');
    expect(seasonAt(at(2027, 1, 1, 2))).toBe('newyear');
    expect(seasonAt(at(2026, 10, 31))).toBe('halloween');
    expect(seasonAt(at(2026, 9, 30))).toBeNull();
  });
});
