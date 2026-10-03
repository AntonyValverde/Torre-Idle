import { describe, expect, it } from 'vitest';
import { newState, normalize } from './state';
import { useGame } from './store';
import { MIN_VIEW_W, WORLD_H, WORLD_W, cityPosition, clampView, isDormant, landDecor, markerRadius, onLand, zoomView } from './world';

describe('mapa del mundo', () => {
  it('cada ciudad tiene siempre la misma posición, en tierra y dentro del mapa', () => {
    const uids = Array.from({ length: 300 }, (_, i) => `uid${i}AbCdEfGh${i * 7}`);
    for (const uid of uids) {
      const p = cityPosition(uid);
      expect(cityPosition(uid)).toEqual(p);
      expect(onLand(p.x, p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(WORLD_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(WORLD_H);
    }
    // Las ciudades se reparten (no salen todas en el mismo sitio)
    expect(new Set(uids.map((u) => JSON.stringify(cityPosition(u)))).size).toBeGreaterThan(250);
  });

  it('los adornos están en tierra y no cambian', () => {
    const a = landDecor();
    expect(a).toHaveLength(40);
    expect(landDecor()).toEqual(a);
    for (const d of a) expect(onLand(d.x, d.y)).toBe(true);
  });

  it('el marcador crece con la era hasta un tope', () => {
    expect(markerRadius(1)).toBe(6);
    expect(markerRadius(3)).toBe(8);
    expect(markerRadius(50)).toBe(14);
  });

  it('una ciudad sin actividad en una semana se ve dormida', () => {
    const t = 1_000_000_000_000;
    expect(isDormant(t - 86_400_000, t)).toBe(false);
    expect(isDormant(t - 8 * 86_400_000, t)).toBe(true);
    expect(isDormant(null, t)).toBe(false);
  });

  it('la vista no se sale del mapa ni hace zoom de más', () => {
    const aspect = 1.6;
    const far = clampView({ x: -500, y: 99999, w: 10, h: 16 }, aspect);
    expect(far.w).toBe(MIN_VIEW_W);
    expect(far.h).toBeCloseTo(MIN_VIEW_W * aspect);
    expect(far.x).toBe(0);
    expect(far.y).toBeCloseTo(WORLD_H - far.h);
    // Alejada del todo: el mapa entero, centrado
    const all = clampView({ x: 0, y: 0, w: 1e6, h: 1e6 }, aspect);
    expect(all.w).toBeGreaterThanOrEqual(WORLD_W);
    expect(all.h).toBeGreaterThanOrEqual(WORLD_H - 1e-9);
  });

  it('el zoom deja quieto el punto donde se hace', () => {
    const aspect = 1.5;
    const v = clampView({ x: 100, y: 200, w: 400, h: 600 }, aspect);
    const z = zoomView(v, 2, 300, 500, aspect);
    expect(z.w).toBe(200);
    // El punto (300, 500) queda en la misma fracción de la vista
    expect((300 - z.x) / z.w).toBeCloseTo((300 - v.x) / v.w);
    expect((500 - z.y) / z.h).toBeCloseTo((500 - v.y) / v.h);
  });
});

describe('Guerra de torres: premio y récord', () => {
  it('da monedas, gemas según los puntos y guarda el récord', () => {
    useGame.getState().init(newState(Date.now()));
    const r = useGame.getState().rewardTowers(50);
    expect(r.gems).toBe(2);
    expect(r.newBest).toBe(true);
    expect(r.coins).toBeGreaterThan(0);
    expect(useGame.getState().s.towersBest).toBe(50);
    expect(useGame.getState().rewardTowers(10)).toMatchObject({ gems: 0, newBest: false });
    expect(useGame.getState().s.towersBest).toBe(50);
  });

  it('las partidas antiguas empiezan sin récord', () => {
    expect(normalize({ coins: 5 }, 0).towersBest).toBe(0);
    expect(normalize({ towersBest: 33 }, 0).towersBest).toBe(33);
  });
});
