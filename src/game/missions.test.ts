import { describe, expect, it } from 'vitest';
import { msUntilNextWeek, weekKey } from './clock';
import {
  CHEST_REWARD,
  DAILY_REWARD,
  MISSION_BY_ID,
  PUZZLE_POINTS,
  WEEKLY_REWARD,
  bump,
  chestReady,
  claimableMissions,
  dailyMissions,
  divisionOf,
  nextDivision,
  syncPeriods,
  weeklyMissions,
} from './missions';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

/** Partida con las misiones de un día concreto ya asignadas. */
function withDay(t: number, extra: Partial<GameState> = {}): GameState {
  return syncPeriods({ ...newState(t), ...extra }, t);
}

describe('semana', () => {
  it('la semana empieza el lunes', () => {
    // 30/9/2026 es miércoles; su lunes es el 28
    expect(weekKey(at(2026, 9, 30))).toBe('2026-09-28');
    expect(weekKey(at(2026, 9, 28, 0))).toBe('2026-09-28');
    expect(weekKey(at(2026, 10, 4, 23))).toBe('2026-09-28');
    expect(weekKey(at(2026, 10, 5, 0))).toBe('2026-10-05');
    expect(msUntilNextWeek(at(2026, 10, 4, 23))).toBe(3_600_000);
  });
});

describe('misiones', () => {
  it('son las mismas para todos ese día: una de cada grupo, sin repetir', () => {
    const a = dailyMissions('2026-09-30');
    expect(dailyMissions('2026-09-30')).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((x) => x.id)).size).toBe(3);
    expect(a.every((x) => MISSION_BY_ID.has(x.id) && x.p === 0 && !x.c)).toBe(true);
    expect(weeklyMissions('2026-09-28')).toHaveLength(3);
    // A lo largo de un mes salen misiones variadas
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) for (const m of dailyMissions(`2026-02-${String(d).padStart(2, '0')}`)) ids.add(m.id);
    expect(ids.size).toBeGreaterThan(8);
  });

  it('el progreso suma o guarda el máximo, sin pasar del objetivo', () => {
    let s = withDay(at(2026, 9, 30));
    s = {
      ...s,
      missions: {
        ...s.missions,
        daily: [{ id: 'd-tap', p: 0, c: false }, { id: 'd-traffic', p: 0, c: false }, { id: 'd-wheel', p: 0, c: false }],
        weekly: [{ id: 'w-build', p: 0, c: false }],
      },
    };
    s = bump(s, 'tap', 250);
    s = bump(s, 'tap', 100);
    expect(s.missions.daily[0].p).toBe(300);
    s = bump(s, 'traffic', 12);
    s = bump(s, 'traffic', 8);
    expect(s.missions.daily[1].p).toBe(12);
    // Un evento que no cuenta para ninguna misión no cambia nada
    expect(bump(s, 'memory', 3)).toBe(s);
  });

  it('cambian al día siguiente, pero no al volver atrás en el tiempo', () => {
    const s = withDay(at(2026, 9, 30));
    const next = syncPeriods(s, at(2026, 10, 1));
    expect(next.missions.day).toBe('2026-10-01');
    expect(next.missions.week).toBe('2026-09-28');
    expect(next.missions.weekly).toBe(s.missions.weekly);
    const back = syncPeriods(next, at(2026, 9, 30));
    expect(back).toBe(next);
  });

  it('migra partidas sin misiones', () => {
    const s = normalize({ coins: 5, missions: { daily: [{ id: 'no-existe', p: 3 }] } }, 0);
    expect(s.missions.daily).toEqual([]);
    expect(s.league).toEqual({ week: null, points: 0, prev: null, best: -1 });
  });
});

describe('recompensas y liga', () => {
  function play(): GameState {
    const t = Date.now();
    const base = syncPeriods(newState(t), t);
    // Completa las tres diarias a mano
    const daily = base.missions.daily.map((x) => ({ ...x, p: MISSION_BY_ID.get(x.id)!.target }));
    useGame.getState().init({ ...base, missions: { ...base.missions, daily } });
    return useGame.getState().s;
  }

  it('reclamar misiones da premio y puntos de liga; las tres abren el cofre', () => {
    const s0 = play();
    expect(claimableMissions(s0)).toBe(3);
    const msg = useGame.getState().claimMission('daily', 0);
    expect(msg).toContain('pts de liga');
    expect(useGame.getState().claimMission('daily', 0)).toBeNull();
    const s1 = useGame.getState().s;
    expect(s1.gems).toBe(s0.gems + DAILY_REWARD.gems);
    expect(s1.tickets).toBe(s0.tickets + DAILY_REWARD.tickets);
    expect(s1.league.points).toBe(DAILY_REWARD.points);
    expect(s1.missionsDone).toBe(1);
    expect(chestReady(s1)).toBe(false);
    useGame.getState().claimMission('daily', 1);
    useGame.getState().claimMission('daily', 2);
    expect(chestReady(useGame.getState().s)).toBe(true);
    expect(useGame.getState().claimChest()).not.toBeNull();
    expect(useGame.getState().claimChest()).toBeNull();
    const s2 = useGame.getState().s;
    expect(s2.league.points).toBe(DAILY_REWARD.points * 3 + CHEST_REWARD.points);
    expect(s2.boosts.some((b) => b.k === 'cofre' && b.m === CHEST_REWARD.boost)).toBe(true);
  });

  it('una misión semanal sin completar no se puede reclamar', () => {
    play();
    expect(useGame.getState().claimMission('weekly', 0)).toBeNull();
    const s = useGame.getState().s;
    const weekly = s.missions.weekly.map((x, i) => (i === 0 ? { ...x, p: MISSION_BY_ID.get(x.id)!.target } : x));
    useGame.setState({ s: { ...s, missions: { ...s.missions, weekly } } });
    expect(useGame.getState().claimMission('weekly', 0)).toContain(`+${WEEKLY_REWARD.gems}`);
  });

  it('los retos diarios suman puntos de liga y cuentan para las misiones', () => {
    const t = Date.now();
    const base = syncPeriods(newState(t), t);
    useGame.getState().init({ ...base, missions: { ...base.missions, weekly: [{ id: 'w-puzzle', p: 0, c: false }] } });
    const date = useGame.getState().s.missions.day!;
    useGame.getState().completeDaily(date, 8, 8);
    useGame.getState().completeRoads(date, 30, 30);
    const s = useGame.getState().s;
    expect(s.league.points).toBe(PUZZLE_POINTS * 2);
    expect(s.missions.weekly[0].p).toBe(2);
  });

  it('al cambiar de semana se guarda el resultado y se cobra según la división', () => {
    const t0 = at(2026, 9, 30);
    let s = withDay(t0);
    s = { ...s, league: { ...s.league, points: 320 } };
    s = syncPeriods(s, at(2026, 10, 6));
    expect(s.league).toMatchObject({ week: '2026-10-05', points: 0, prev: { week: '2026-09-28', points: 320 } });
    useGame.setState({ s });
    const gems = s.gems;
    const r = useGame.getState().claimLeague()!;
    expect(r.division.id).toBe('oro');
    expect(useGame.getState().s.gems).toBe(gems + r.division.gems);
    expect(useGame.getState().s.league.best).toBe(2);
    expect(useGame.getState().claimLeague()).toBeNull();
    // Una semana sin puntos no deja premio pendiente
    expect(syncPeriods({ ...withDay(t0) }, at(2026, 10, 6)).league.prev).toBeNull();
  });

  it('divisiones', () => {
    expect(divisionOf(0).id).toBe('bronce');
    expect(divisionOf(150).id).toBe('plata');
    expect(divisionOf(449).id).toBe('oro');
    expect(divisionOf(1000).id).toBe('diamante');
    expect(nextDivision(200)?.id).toBe('oro');
    expect(nextDivision(500)).toBeNull();
  });
});
