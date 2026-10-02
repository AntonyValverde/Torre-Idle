import { beforeEach, describe, expect, it } from 'vitest';
import { classifieds, editionNumber, headlines, marketMovers, sinceLabel } from '../ui/gazette';
import { dateKey, now } from './clock';
import { syncPeriods } from './missions';
import { PAPER_GEMS, newPaper, paperState, paperStats, paperUnread, rollPaper } from './paper';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), name: 'Ana', ...extra });

describe('periódico: foto diaria y resumen', () => {
  it('la primera edición no tiene resumen; la del día siguiente compara con la foto', () => {
    let s = rollPaper(base({ allTimeEarned: 1000, taps: 50 }), '2026-10-01');
    expect(s.paper.day).toBe('2026-10-01');
    expect(s.paper.prev).toBeNull();
    // Mismo día: no cambia nada
    expect(rollPaper(s, '2026-10-01')).toBe(s);
    s = { ...s, allTimeEarned: 6000, taps: 170, balloons: 3, missionsDone: 2, stackBest: 30, cup: { ...s.cup, gold: 1 }, era: 2, stars: 4 };
    s = rollPaper(s, '2026-10-02');
    expect(s.paper.day).toBe('2026-10-02');
    const d = s.paper.prev!;
    expect(d.since).toBe('2026-10-01');
    expect(d.earned).toBe(5000);
    expect(d.taps).toBe(120);
    expect(d.balloons).toBe(3);
    expect(d.missions).toBe(2);
    expect(d.trophy).toBe('gold');
    expect(d.eras).toBe(1);
    expect(d.stars).toBe(4);
    expect(d.records).toEqual([{ key: 'stackBest', value: 30 }]);
  });

  it('el cambio de día de las misiones también saca el periódico', () => {
    const t = new Date(2026, 9, 3, 10).getTime();
    const s = syncPeriods(base(), t);
    expect(s.paper.day).toBe(dateKey(t));
  });

  it('la propina se cobra una vez al día', () => {
    useGame.getState().init(base({ gems: 0 }));
    const today = dateKey(now());
    expect(paperUnread(useGame.getState().s, today)).toBe(true);
    expect(useGame.getState().readPaper()).toBe(PAPER_GEMS);
    expect(useGame.getState().readPaper()).toBe(0);
    expect(useGame.getState().s.gems).toBe(PAPER_GEMS);
    expect(paperUnread(useGame.getState().s, today)).toBe(false);
  });

  it('carga sin romperse con datos raros y conserva lo guardado', () => {
    expect(normalize({}, 0).paper).toEqual(newPaper());
    expect(paperState({ read: 5, day: '2026-10-01', snap: { earned: 'x', bests: { stackBest: 4, inventado: 9 } }, prev: { since: 3 } })).toEqual({
      read: null,
      day: '2026-10-01',
      snap: expect.objectContaining({ earned: 0, era: 1, league: -1, bests: expect.objectContaining({ stackBest: 4 }) }),
      prev: null,
    });
    const s = rollPaper(rollPaper(base({ taps: 3 }), '2026-10-01'), '2026-10-02');
    expect(normalize(JSON.parse(JSON.stringify(s)), 0).paper).toEqual(s.paper);
  });

  it('paperStats lee lo que importa de la partida', () => {
    const st = paperStats(base({ allTimeEarned: 9, achievements: { earn: 3, tap: 2 }, league: { week: null, points: 0, prev: null, best: 2 } }));
    expect(st.earned).toBe(9);
    expect(st.achievements).toBe(5);
    expect(st.league).toBe(2);
  });
});

describe('periódico: contenido', () => {
  beforeEach(() => useGame.getState().init(base()));

  it('número de edición desde la nº 1', () => {
    expect(editionNumber('2026-09-25')).toBe(1);
    expect(editionNumber('2026-10-01')).toBe(7);
    expect(editionNumber('2027-09-25')).toBe(366);
  });

  it('los titulares van de lo más importante a lo menos', () => {
    let s = rollPaper(base(), '2026-10-01');
    s = rollPaper({ ...s, allTimeEarned: 500, era: 2, stars: 3, stackBest: 12, cup: { ...s.cup, silver: 1 } }, '2026-10-02');
    const h = headlines(s, s.paper.prev);
    expect(h.map((x) => x.emoji)).toEqual(['🌅', '🥈', '🏗️', '💰']);
    expect(headlines(s, null)[0].title).toContain('primera edición');
    // Sin novedades: día tranquilo
    const quiet = rollPaper(rollPaper(base(), '2026-10-01'), '2026-10-02');
    expect(headlines(quiet, quiet.paper.prev)[0].emoji).toBe('😴');
  });

  it('"ayer" o "desde tu última visita"', () => {
    const d = { ...rollPaper(rollPaper(base(), '2026-09-28'), '2026-10-02').paper.prev! };
    expect(sinceLabel(d, '2026-10-02')).toBe('Desde tu última visita (28/9)');
    expect(sinceLabel({ ...d, since: '2026-10-01' }, '2026-10-02')).toBe('Ayer en tu ciudad');
  });

  it('bolsa y clasificados son iguales para todos', () => {
    const t = new Date(2026, 9, 2, 9).getTime();
    const m = marketMovers(t);
    expect(m.up.pct).toBeGreaterThanOrEqual(m.down.pct);
    expect(marketMovers(t)).toEqual(m);
    const c = classifieds(t);
    expect(c).toHaveLength(2);
    expect(c[0]).not.toBe(c[1]);
    expect(classifieds(t)).toEqual(c);
  });
});
