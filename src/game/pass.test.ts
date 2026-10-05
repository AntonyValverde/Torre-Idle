import { describe, expect, it } from 'vitest';
import { headlines } from '../ui/gazette';
import { now } from './clock';
import { LEAGUE_MAX, addPoints, applyPassReward, syncPeriods } from './missions';
import { paperState, rollPaper } from './paper';
import {
  PASS_LEVELS,
  PASS_MAX,
  PASS_TOTAL_XP,
  addPassXp,
  claimNext,
  hasDeco,
  newPass,
  passClaimable,
  passLevel,
  passProgress,
  passRewardAt,
  passRewardText,
  passSeason,
  passState,
  passThreshold,
  rolloverPass,
  seasonDeco,
  type PassState,
} from './pass';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const pass = (extra: Partial<PassState> = {}): PassState => ({ ...newPass(0), ...extra });
const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), name: 'Ana', ...extra });

describe('pase: niveles y umbrales', () => {
  it('la pista tiene 25 niveles y cuesta 2300 puntos', () => {
    expect(PASS_MAX).toBe(25);
    expect(PASS_LEVELS).toHaveLength(25);
    expect(PASS_TOTAL_XP).toBe(2300);
    expect(PASS_LEVELS[PASS_MAX - 1].reward.kind).toBe('deco');
  });

  it('passLevel en los bordes de cada tramo', () => {
    expect(passLevel(0)).toBe(0);
    expect(passLevel(59)).toBe(0);
    expect(passLevel(60)).toBe(1);
    expect(passLevel(119)).toBe(1);
    expect(passLevel(120)).toBe(2);
    expect(passLevel(599)).toBe(9);
    expect(passLevel(600)).toBe(10);
    expect(passLevel(699)).toBe(10);
    expect(passLevel(700)).toBe(11);
    expect(passLevel(2299)).toBe(24);
    expect(passLevel(2300)).toBe(25);
    expect(passLevel(1e9)).toBe(25);
  });

  it('passThreshold acumula los costes y se recorta a la pista', () => {
    expect(passThreshold(0)).toBe(0);
    expect(passThreshold(-3)).toBe(0);
    expect(passThreshold(1)).toBe(60);
    expect(passThreshold(10)).toBe(600);
    expect(passThreshold(11)).toBe(700);
    expect(passThreshold(20)).toBe(1600);
    expect(passThreshold(25)).toBe(2300);
    expect(passThreshold(40)).toBe(2300);
    // Umbral y nivel son inversos
    for (let l = 1; l <= PASS_MAX; l++) {
      expect(passLevel(passThreshold(l))).toBe(l);
      expect(passLevel(passThreshold(l) - 1)).toBe(l - 1);
    }
  });

  it('passProgress dice cuánto falta dentro del nivel (nada al completar)', () => {
    expect(passProgress(pass({ xp: 70 }))).toEqual({ level: 1, into: 10, cost: 60 });
    expect(passProgress(pass({ xp: 650 }))).toEqual({ level: 10, into: 50, cost: 100 });
    expect(passProgress(pass({ xp: 2300 }))).toEqual({ level: 25, into: 0, cost: 0 });
    expect(passProgress(pass({ xp: 9999 }))).toEqual({ level: 25, into: 0, cost: 0 });
  });

  it('passClaimable: niveles ganados menos cobrados, nunca negativo', () => {
    expect(passClaimable(pass({ xp: 130 }))).toBe(2);
    expect(passClaimable(pass({ xp: 130, claimed: 2 }))).toBe(0);
    expect(passClaimable(pass({ xp: 130, claimed: 5 }))).toBe(0);
    expect(passClaimable(pass({ xp: 2300 }))).toBe(25);
  });

  it('addPassXp ignora cantidades no positivas y redondea hacia abajo', () => {
    const p = pass({ xp: 10, total: 50 });
    expect(addPassXp(p, 0)).toBe(p);
    expect(addPassXp(p, -4)).toBe(p);
    expect(addPassXp(p, NaN)).toBe(p);
    expect(addPassXp(p, 15.9)).toEqual({ ...p, xp: 25, total: 65 });
  });
});

describe('pase: cobrar niveles', () => {
  it('claimNext recorre la pista en orden y acaba con el cosmético de la temporada', () => {
    let p = pass({ xp: PASS_TOTAL_XP });
    const r1 = claimNext(p)!;
    expect(r1.level).toBe(1);
    expect(r1.reward).toEqual({ kind: 'gems', n: 3 });
    expect(r1.pass.claimed).toBe(1);
    p = r1.pass;
    const r2 = claimNext(p)!;
    expect(r2.level).toBe(2);
    expect(r2.reward).toEqual({ kind: 'tickets', n: 1 });
    p = r2.pass;
    for (let l = 3; l <= 24; l++) {
      const r = claimNext(p)!;
      expect(r.level).toBe(l);
      expect(r.reward).toEqual(passRewardAt(l, 0));
      expect(r.pass.decos).toEqual([]);
      p = r.pass;
    }
    const last = claimNext(p)!;
    expect(last.level).toBe(25);
    expect(last.reward).toEqual({ kind: 'deco', n: 1, gems: 30, deco: 'zeppelin' });
    expect(last.pass.decos).toEqual(['zeppelin']);
    expect(hasDeco(last.pass, 'zeppelin')).toBe(true);
    expect(claimNext(last.pass)).toBeNull();
  });

  it('no cobra sin niveles ganados y no repite cosméticos', () => {
    expect(claimNext(pass({ xp: 59 }))).toBeNull();
    expect(claimNext(pass({ xp: 120, claimed: 2 }))).toBeNull();
    const r = claimNext(pass({ xp: PASS_TOTAL_XP, claimed: 24, decos: ['zeppelin'] }))!;
    expect(r.reward.deco).toBe('zeppelin');
    expect(r.pass.decos).toEqual(['zeppelin']);
  });

  it('el cosmético va rotando por temporadas', () => {
    expect(seasonDeco(0)).toBe('zeppelin');
    expect(seasonDeco(1)).toBe('aurora');
    expect(seasonDeco(2)).toBe('fountain');
    expect(seasonDeco(3)).toBe('lanterns');
    expect(seasonDeco(4)).toBe('zeppelin');
    expect(seasonDeco(-1)).toBe('lanterns');
    expect(passRewardAt(25, 2).deco).toBe('fountain');
    expect(passRewardAt(1, 2).deco).toBeUndefined();
  });

  it('passRewardText describe cada premio', () => {
    expect(passRewardText({ kind: 'gems', n: 3 })).toBe('+3 💎');
    expect(passRewardText({ kind: 'tickets', n: 2 })).toBe('+2 🎟️');
    expect(passRewardText({ kind: 'chips', n: 300 })).toBe('+300 🎰');
    expect(passRewardText({ kind: 'card', n: 1 })).toContain('carta');
    expect(passRewardText({ kind: 'pack', n: 1 })).toContain('sobre');
    expect(passRewardText({ kind: 'deco', n: 1, gems: 30, deco: 'zeppelin' })).toBe('🛩️ Zepelín dorado y +30 💎');
    expect(passRewardText({ kind: 'deco', n: 1 })).toBe('cosmético');
  });
});

describe('pase: cambio de temporada', () => {
  it('la temporada del pase es la de la Copa', () => {
    expect(passSeason(at(2026, 9, 30))).toBe(0);
    expect(passSeason(at(2026, 10, 25))).toBe(0);
    expect(passSeason(at(2026, 10, 28))).toBe(1);
    expect(passSeason(at(2026, 11, 25))).toBe(2);
  });

  it('misma temporada: no cambia nada', () => {
    const p = pass({ xp: 130 });
    expect(rolloverPass(p, 0)).toEqual({ pass: p, owed: [] });
    expect(rolloverPass(p, 0).pass).toBe(p);
  });

  it('temporada nueva: paga lo ganado y no cobrado, y conserva cosméticos y total', () => {
    const r = rolloverPass(pass({ xp: 130, claimed: 1, total: 500, decos: ['aurora'] }), 1);
    expect(r.owed).toEqual([{ kind: 'tickets', n: 1 }]);
    expect(r.pass).toEqual({ season: 1, xp: 0, claimed: 0, decos: ['aurora'], total: 500 });
    // El cosmético pendiente es el de la temporada que termina, no el de la nueva
    const full = rolloverPass(pass({ season: 1, xp: PASS_TOTAL_XP, claimed: 23 }), 2);
    expect(full.owed).toEqual([
      { kind: 'gems', n: 10 },
      { kind: 'deco', n: 1, gems: 30, deco: 'aurora' },
    ]);
    expect(full.pass.season).toBe(2);
    // Sin nada pendiente, la pista solo se reinicia
    expect(rolloverPass(pass({ xp: 130, claimed: 2 }), 1).owed).toEqual([]);
  });
});

describe('pase: partidas guardadas', () => {
  it('passState arregla datos raros', () => {
    expect(passState(null, 3)).toEqual(newPass(3));
    expect(passState('x', 3)).toEqual(newPass(3));
    expect(passState({ season: 'x', xp: -5, claimed: 99, decos: ['zeppelin', 'inventado', 3], total: NaN }, 3)).toEqual({
      season: 3,
      xp: 0,
      claimed: PASS_MAX,
      decos: ['zeppelin'],
      total: 0,
    });
    expect(passState({ season: 1, xp: 70.9, claimed: 2.5, decos: 'no', total: 80 }, 3)).toEqual({ season: 1, xp: 70, claimed: 2, decos: [], total: 80 });
  });

  it('normalize crea la pista de la temporada actual y conserva la guardada', () => {
    const t = at(2026, 10, 28);
    expect(normalize({}, t).pass).toEqual(newPass(1));
    expect(newState(t).pass).toEqual(newPass(1));
    const s = { ...newState(t), pass: pass({ season: 1, xp: 250, claimed: 2, decos: ['zeppelin'], total: 2550 }) };
    expect(normalize(JSON.parse(JSON.stringify(s)), t).pass).toEqual(s.pass);
  });
});

describe('pase: integración con el juego', () => {
  it('los puntos de liga también avanzan el pase (y siguen sumando con la liga al tope)', () => {
    let s = addPoints(base(), 15);
    expect(s.league.points).toBe(15);
    expect(s.pass.xp).toBe(15);
    expect(s.pass.total).toBe(15);
    s = addPoints({ ...s, league: { ...s.league, points: LEAGUE_MAX } }, 40);
    expect(s.league.points).toBe(LEAGUE_MAX);
    expect(s.pass.xp).toBe(55);
  });

  it('applyPassReward da cada tipo de premio', () => {
    const s = base({ gems: 1, tickets: 2 });
    expect(applyPassReward(s, { kind: 'gems', n: 5 }).gems).toBe(6);
    expect(applyPassReward(s, { kind: 'tickets', n: 2 }).tickets).toBe(4);
    expect(applyPassReward(s, { kind: 'chips', n: 300 }).casino.chips).toBe(s.casino.chips + 300);
    expect(applyPassReward(s, { kind: 'pack', n: 1 }).advisors.packs).toBe(s.advisors.packs + 1);
    const cards = (x: GameState) => Object.values(x.cup.cards).reduce((n, c) => n + c, 0);
    expect(cards(applyPassReward(s, { kind: 'card', n: 1 }))).toBe(cards(s) + 1);
    const deco = applyPassReward(s, { kind: 'deco', n: 1, gems: 30, deco: 'aurora' });
    expect(deco.gems).toBe(31);
    expect(deco.pass.decos).toEqual(['aurora']);
    // Ya lo tenía: solo las gemas, sin repetirlo
    const again = applyPassReward(deco, { kind: 'deco', n: 1, gems: 30, deco: 'aurora' });
    expect(again.pass.decos).toEqual(['aurora']);
    expect(again.gems).toBe(61);
  });

  it('store.claimPass cobra nivel a nivel y paga el premio', () => {
    const t = now();
    useGame.getState().init({ ...newState(t), gems: 0, tickets: 0, pass: { ...newPass(passSeason(t)), xp: 120 } });
    const g = () => useGame.getState();
    const r1 = g().claimPass()!;
    expect(r1).toEqual({ level: 1, reward: { kind: 'gems', n: 3 }, text: '+3 💎' });
    expect(g().s.gems).toBe(3);
    expect(g().s.pass.claimed).toBe(1);
    const r2 = g().claimPass()!;
    expect(r2.level).toBe(2);
    expect(r2.reward).toEqual({ kind: 'tickets', n: 1 });
    expect(g().s.tickets).toBe(1);
    expect(g().claimPass()).toBeNull();
    expect(g().s.pass.claimed).toBe(2);
  });

  it('store.claimPass: el último nivel da el cosmético una sola vez y sus gemas', () => {
    const t = now();
    const season = passSeason(t);
    useGame.getState().init({ ...newState(t), gems: 0, pass: { ...newPass(season), xp: PASS_TOTAL_XP, claimed: 24 } });
    const r = useGame.getState().claimPass()!;
    expect(r.level).toBe(25);
    expect(r.reward.deco).toBe(seasonDeco(season));
    expect(r.text).toContain('+30 💎');
    const s = useGame.getState().s;
    expect(s.gems).toBe(30);
    expect(s.pass.decos).toEqual([seasonDeco(season)]);
    expect(s.pass.claimed).toBe(25);
    expect(useGame.getState().claimPass()).toBeNull();
  });

  it('syncPeriods cierra la temporada: paga lo pendiente y renueva la pista', () => {
    const t0 = at(2026, 9, 30);
    const t1 = at(2026, 10, 28);
    const s0 = { ...syncPeriods(newState(t0), t0), gems: 0, tickets: 0 };
    const s = { ...s0, pass: { ...s0.pass, xp: 130, total: 130 } };
    // Misma temporada: la pista no se toca
    expect(syncPeriods(s, t0 + 3_600_000).pass).toBe(s.pass);
    const next = syncPeriods(s, t1);
    expect(next.pass).toEqual({ season: 1, xp: 0, claimed: 0, decos: [], total: 130 });
    expect(next.gems).toBe(3);
    expect(next.tickets).toBe(1);
  });

  it('store.cupClaim y claimConquest suman puntos al pase', () => {
    const t = now();
    const g = () => useGame.getState();
    g().init({ ...newState(t), gems: 0 });
    const outcome = { played: true, groupRank: 1, groupSize: 4, finalist: true, finalRank: 1, beatRival: true, rivalName: null };
    expect(g().cupClaim('2026-09-28', outcome)).not.toBeNull();
    // 5 de jugar + 20 del grupo + 100 de ganar la final
    expect(g().s.pass.xp).toBe(125);
    expect(g().claimConquest('2026-09-28', 1, 4, 40)).not.toBeNull();
    // Participación: 5 + hasta 15 por puntos
    expect(g().s.pass.xp).toBe(145);
    // Cobros repetidos no suman
    expect(g().claimConquest('2026-09-28', 1, 4, 40)).toBeNull();
    expect(g().s.pass.xp).toBe(145);
  });
});

describe('pase: La Gaceta', () => {
  it('titular al completar la pista', () => {
    let s = rollPaper(base({ pass: pass({ xp: PASS_TOTAL_XP, claimed: 24 }) }), '2026-10-01');
    s = rollPaper({ ...s, pass: { ...s.pass, claimed: 25, decos: ['zeppelin'] } }, '2026-10-02');
    expect(s.paper.prev!.passDone).toBe(true);
    expect(s.paper.prev!.passSeason).toBe(false);
    const h = headlines(s, s.paper.prev);
    expect(h[0]).toMatchObject({ emoji: '🏁', title: '¡Ana completa el pase de temporada!' });
    // Al día siguiente ya no es noticia
    const later = rollPaper(s, '2026-10-03');
    expect(later.paper.prev!.passDone).toBe(false);
    expect(headlines(later, later.paper.prev).some((x) => x.emoji === '🏁')).toBe(false);
  });

  it('titular al empezar una temporada nueva (no al estrenar el pase en una partida vieja)', () => {
    let s = rollPaper(base({ pass: pass({ season: 0 }) }), '2026-10-25');
    s = rollPaper({ ...s, pass: pass({ season: 1 }) }, '2026-10-27');
    expect(s.paper.prev!.passSeason).toBe(true);
    expect(headlines(s, s.paper.prev).some((x) => x.emoji === '🎫' && x.title.includes('Nueva temporada'))).toBe(true);
    // Edición vieja sin datos del pase: la foto trae -1 y no sale el titular
    const old = paperState({ day: '2026-10-01', snap: { earned: 0 } });
    expect(old.snap!.passSeason).toBe(-1);
    const upgraded = rollPaper(base({ paper: old, pass: pass({ season: 3 }) }), '2026-10-02');
    expect(upgraded.paper.prev!.passSeason).toBe(false);
    expect(upgraded.paper.prev!.passDone).toBe(false);
  });
});
