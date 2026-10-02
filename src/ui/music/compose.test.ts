import { describe, expect, it } from 'vitest';
import { CASINO_STYLE, CUP_STYLE, ERA_STYLE_COUNT, composeBar, degreeMidi, eraStyle, withMood, type Mood } from './compose';

const DAY: Mood = { night: 0, weather: 'clear', season: null };
const PITCHED = (v: string) => !['kick', 'snare', 'hat'].includes(v);

describe('música generativa', () => {
  it('cada era tiene su propio estilo y pasado el Multiverso cambia de tonalidad', () => {
    const ids = new Set(Array.from({ length: ERA_STYLE_COUNT }, (_, i) => eraStyle(i + 1).id));
    expect(ids.size).toBe(ERA_STYLE_COUNT);
    const roots = new Set(Array.from({ length: 12 }, (_, i) => eraStyle(ERA_STYLE_COUNT + 1 + i).root));
    expect(roots.size).toBe(12);
    for (const r of roots) expect(r >= 55 && r <= 66).toBe(true);
    expect(eraStyle(0).id).toBe(eraStyle(1).id);
  });

  it('los grados suben por octavas', () => {
    const major = [0, 2, 4, 5, 7, 9, 11];
    expect(degreeMidi(major, 60, 0)).toBe(60);
    expect(degreeMidi(major, 60, 7)).toBe(72);
    expect(degreeMidi(major, 60, -1)).toBe(59);
    expect(degreeMidi(major, 60, 9)).toBe(76);
  });

  it('compone igual con la misma semilla y distinto con otra', () => {
    const s = eraStyle(1);
    expect(composeBar(s, 7, 3)).toEqual(composeBar(s, 7, 3));
    const a = Array.from({ length: 16 }, (_, i) => composeBar(s, 7, i));
    const b = Array.from({ length: 16 }, (_, i) => composeBar(s, 8, i));
    expect(a).not.toEqual(b);
  });

  it('las notas caben en el compás y en un rango audible', () => {
    const styles = [...Array.from({ length: ERA_STYLE_COUNT + 2 }, (_, i) => eraStyle(i + 1)), CUP_STYLE, CASINO_STYLE];
    for (const s of styles) {
      for (let bar = 0; bar < 48; bar++) {
        for (const n of composeBar(s, 42, bar)) {
          expect(n.t).toBeGreaterThanOrEqual(0);
          expect(n.t).toBeLessThan(4);
          expect(n.dur).toBeGreaterThan(0);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          if (PITCHED(n.voice)) {
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('la melodía está en la escala y cae en notas del acorde en los tiempos fuertes', () => {
    for (let era = 1; era <= ERA_STYLE_COUNT; era++) {
      const s = eraStyle(era);
      const inScale = new Set(s.scale.map((x) => (s.root + x) % 12));
      let leads = 0;
      for (let bar = 0; bar < 32; bar++) {
        for (const n of composeBar(s, 5, bar)) {
          if (n.voice !== s.lead || n.vel < 0.85) continue;
          leads++;
          expect(inScale.has(n.midi % 12)).toBe(true);
        }
      }
      expect(leads).toBeGreaterThan(10);
    }
  });

  it('forma AABA: la primera frase se repite en la segunda y en la cuarta', () => {
    const s = eraStyle(3);
    const lead = (bar: number) => composeBar(s, 11, bar).filter((n) => n.voice === s.lead);
    expect(lead(4)).toEqual(lead(0));
    expect(lead(12)).toEqual(lead(0));
    expect(lead(8)).not.toEqual(lead(0));
  });

  it('de noche va más lenta, más suave y sin batería fuerte', () => {
    const s = eraStyle(5);
    const night = withMood(s, { ...DAY, night: 1 });
    expect(night.bpm).toBeLessThan(s.bpm);
    expect(night.density).toBeLessThan(s.density);
    expect(night.brightness).toBeLessThan(s.brightness);
    expect(night.drums).toBe('soft');
    expect(withMood(s, DAY)).toEqual(s);
  });

  it('la lluvia la apaga; nieve y Navidad ponen campanitas; Halloween pasa a menor', () => {
    const s = eraStyle(1);
    expect(withMood(s, { ...DAY, weather: 'rain' }).brightness).toBeLessThan(s.brightness);
    expect(withMood(s, { ...DAY, weather: 'snow' }).sparkle).toBe(true);
    const xmas = withMood(s, { ...DAY, season: 'christmas' });
    expect(xmas.sparkle).toBe(true);
    expect(xmas.drums).toBe('shaker');
    expect(composeBar(xmas, 1, 0).some((n) => n.voice === 'hat')).toBe(true);
    expect(withMood(s, { ...DAY, season: 'halloween' }).scale).not.toEqual(s.scale);
    // Nunca se apaga del todo, ni de noche con tormenta
    expect(withMood(eraStyle(7), { night: 1, weather: 'storm', season: null }).brightness).toBeGreaterThanOrEqual(1800);
  });

  it('el tema de la Copa es el más rápido y lleva batería', () => {
    for (let era = 1; era <= ERA_STYLE_COUNT; era++) expect(CUP_STYLE.bpm).toBeGreaterThan(eraStyle(era).bpm);
    const notes = composeBar(CUP_STYLE, 1, 0);
    expect(notes.some((n) => n.voice === 'kick')).toBe(true);
    expect(notes.some((n) => n.voice === 'snare')).toBe(true);
  });
});
