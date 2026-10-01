import { describe, expect, it } from 'vitest';
import { niceCeil } from './charts';
import { newState } from '../game/state';
import { ago, lastDays, median, summarize, type Player } from './metrics';

const DAY = 86_400_000;
const T = new Date(2026, 8, 30, 15, 0).getTime();

function player(uid: string, extra: Partial<Player['s']> = {}, savedAgo: number | null = 0): Player {
  return { uid, name: uid, savedAt: savedAgo === null ? null : T - savedAgo, s: { ...newState(T - 30 * DAY), ...extra } };
}

describe('panel de administración', () => {
  it('cuenta activos, nuevos y refundaciones', () => {
    const players = [
      player('a', { createdAt: T - 2 * DAY, era: 3 }, 1000),
      player('b', { createdAt: T - 10 * DAY }, 3 * DAY),
      player('c', {}, 40 * DAY),
      player('d', {}, null),
    ];
    const s = summarize(players, T);
    expect(s.total).toBe(4);
    expect(s.active24h).toBe(1);
    expect(s.active7d).toBe(2);
    expect(s.new7d).toBe(1);
    expect(s.prestiged).toBe(1);
    expect(s.lastSeen.map((b) => b.value)).toEqual([1, 1, 0, 2]);
    expect(s.eras.map((b) => b.value)).toEqual([3, 0, 1]);
  });

  it('agrupa las altas por día en los últimos 14 días', () => {
    const s = summarize([player('a', { createdAt: T }), player('b', { createdAt: T - 1000 }), player('c', { createdAt: T - DAY })], T);
    expect(s.signups).toHaveLength(14);
    expect(s.signups[13]).toEqual({ label: '2026-09-30', value: 2 });
    expect(s.signups[12]).toEqual({ label: '2026-09-29', value: 1 });
    expect(lastDays(T, 3)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });

  it('mide cuántos jugaron cada minijuego y quién tiene el récord', () => {
    const s = summarize([player('ana', { trafficBest: 40 }), player('beto', { trafficBest: 90, memoryBest: 7 }), player('caro')], T);
    expect(s.adoption.find((g) => g.label.includes('Semáforo'))?.value).toBe(2);
    expect(s.adoption.find((g) => g.label.includes('Memoria'))?.value).toBe(1);
    expect(s.records.find((r) => r.game.includes('Semáforo'))).toEqual({ game: '🚦 Semáforo', value: 90, name: 'beto' });
    // Sin nadie que lo haya jugado, no hay récord que mostrar
    expect(s.records.find((r) => r.game.includes('Ladrón'))).toBeUndefined();
  });

  it('funciona sin jugadores', () => {
    const s = summarize([], T);
    expect(s.total).toBe(0);
    expect(s.avgAchievements).toBe(0);
    expect(s.eras).toEqual([{ label: 'Era 1', value: 0 }]);
  });

  it('utilidades', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(ago(T - 30_000, T)).toBe('ahora');
    expect(ago(T - 5 * 60_000, T)).toBe('hace 5 min');
    expect(ago(T - DAY, T)).toBe('hace 1 día');
    expect(ago(null, T)).toBe('nunca');
    expect([0, 1, 3, 7, 12, 99, 101].map(niceCeil)).toEqual([1, 1, 5, 10, 20, 100, 200]);
  });
});
