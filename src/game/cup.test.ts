import { describe, expect, it } from 'vitest';
import {
  ATTEMPTS,
  GROUP_MAX,
  activeDays,
  attemptsFor,
  buildCup,
  cardSlots,
  cupScoreOf,
  fansBonus,
  pendingSeason,
  pickPayout,
  randomCard,
  seasonOf,
  seasonReward,
  seasonStandings,
  seasonWeeks,
  summarizeCup,
  trackActivity,
  trainingCost,
  type CardId,
  cupEvents,
  cupGamesFor,
  WAR_CUP_WEEK,
  SHOOTER_CUP_WEEK,
  cupPhase,
  cupRewards,
  cupStart,
  cupWeekKey,
  groupStandings,
  isClaimed,
  makeGroups,
  mergeResults,
  slotOpen,
  unsyncedBest,
  newCup,
  outcomeOf,
  pendingCup,
  prevCupWeek,
  registeredFor,
  rivalOf,
  tierOf,
  type CupEntry,
  type CupResult,
} from './cup';
import { newState } from './state';
import { useGame } from './store';

// Horas en Costa Rica (UTC-6)
const cr = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h + 6, min);
const entry = (uid: string, tier = 5): CupEntry => ({ uid, name: uid.toUpperCase(), tier, gold: 0, silver: 0, bronze: 0 });

describe('calendario de la Copa', () => {
  it('la semana empieza el lunes a las 00:00 de Costa Rica', () => {
    // Miércoles 30 de septiembre de 2026
    expect(cupWeekKey(cr(2026, 9, 30, 15))).toBe('2026-09-28');
    expect(cupWeekKey(cr(2026, 9, 28, 0, 0))).toBe('2026-09-28');
    // Domingo a las 23:59 aún es la misma semana; un minuto después ya es la siguiente
    expect(cupWeekKey(cr(2026, 10, 4, 23, 59))).toBe('2026-09-28');
    expect(cupWeekKey(cr(2026, 10, 5, 0, 0))).toBe('2026-10-05');
    expect(cupStart('2026-09-28')).toBe(cr(2026, 9, 28));
    expect(prevCupWeek('2026-10-05')).toBe('2026-09-28');
  });

  it('inscripción de lunes a viernes, grupos el sábado y final el domingo', () => {
    expect(cupPhase(cr(2026, 9, 28, 0, 1)).phase).toBe('signup');
    expect(cupPhase(cr(2026, 10, 2, 23, 59)).phase).toBe('signup');
    const sat = cupPhase(cr(2026, 10, 3, 0, 0));
    expect(sat.phase).toBe('groups');
    expect(sat.endsAt).toBe(cr(2026, 10, 4));
    expect(cupPhase(cr(2026, 10, 4, 12)).phase).toBe('final');
    expect(cupPhase(cr(2026, 10, 2, 22)).endsAt).toBe(cr(2026, 10, 3));
  });

  it('cuatro pruebas distintas cada semana, iguales para todos', () => {
    const a = cupEvents('2026-09-28');
    expect(cupEvents('2026-09-28')).toEqual(a);
    expect(new Set(Object.values(a)).size).toBe(4);
    const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((w) => JSON.stringify(cupEvents(w)));
    expect(new Set(weeks).size).toBeGreaterThan(1);
  });

  it('los juegos de guerra solo entran desde su semana y no cambian las Copas anteriores', () => {
    const classic = ['thief', 'fire', 'metro', 'traffic', 'memory', 'stack'];
    // Esta semana (ya anunciada) y las anteriores: las mismas pruebas que antes de añadirlos
    expect(cupEvents('2026-10-05')).toEqual({ g1: 'memory', g2: 'stack', g3: 'fire', f: 'thief' });
    for (const w of ['2026-09-28', '2026-10-05']) expect(Object.values(cupEvents(w)).every((g) => classic.includes(g))).toBe(true);
    expect(cupGamesFor('2026-10-05')).toHaveLength(6);
    expect(cupGamesFor(WAR_CUP_WEEK)).toHaveLength(10);
    // La Copa de esa semana no cambia al añadir los shooters; desde la siguiente entran dos
    expect(cupGamesFor('2026-10-12')).not.toContain('squadron');
    expect(cupGamesFor(SHOOTER_CUP_WEEK)).toEqual(expect.arrayContaining(['squadron', 'neon']));
    expect(cupGamesFor(SHOOTER_CUP_WEEK)).toHaveLength(12);
    // Desde entonces, a veces sale alguno
    const later = Array.from({ length: 20 }, (_, i) => Object.values(cupEvents(cupWeekKey(cupStart(WAR_CUP_WEEK) + i * 7 * 86_400_000)))).flat();
    expect(later.some((g) => !classic.includes(g))).toBe(true);
  });

  it('nivel según las monedas ganadas', () => {
    expect(tierOf(0)).toBe(0);
    expect(tierOf(999)).toBe(2);
    expect(tierOf(1e12)).toBe(12);
  });
});

describe('grupos', () => {
  it('grupos de hasta 8, de tamaño parecido, y los mismos sin importar el orden', () => {
    const list = Array.from({ length: 19 }, (_, i) => entry(`u${i}`, i % 7));
    const groups = makeGroups(list, '2026-09-28');
    expect(groups.map((g) => g.length)).toEqual([7, 6, 6]);
    expect(groups.flat()).toHaveLength(19);
    expect(makeGroups(list.slice().reverse(), '2026-09-28')).toEqual(groups);
    // Los de más nivel van juntos
    expect(Math.min(...groups[0].map((e) => e.tier))).toBeGreaterThanOrEqual(Math.max(...groups[2].map((e) => e.tier)));
    expect(makeGroups(Array.from({ length: GROUP_MAX }, (_, i) => entry(`x${i}`)), 'w')).toHaveLength(1);
    expect(makeGroups([], 'w')).toEqual([]);
  });

  it('cada prueba reparte puntos por puesto y los empates comparten puesto', () => {
    const g = [entry('a'), entry('b'), entry('c'), entry('d')];
    const res = new Map<string, CupResult>([
      ['a', { g1: 50, g2: 10, g3: 7 }],
      ['b', { g1: 50, g2: 30 }],
      ['c', { g1: 20, g2: 20, g3: 9 }],
    ]);
    const rows = groupStandings(g, res);
    const by = Object.fromEntries(rows.map((r) => [r.entry.uid, r]));
    expect(by.a.places).toEqual([1, 3, 2]);
    expect(by.b.places).toEqual([1, 1, 0]);
    expect(by.a.points).toBe(10 + 6 + 8);
    expect(by.b.points).toBe(10 + 10);
    expect(by.c.points).toBe(6 + 8 + 10);
    expect(by.d.points).toBe(0);
    expect(by.d.played).toBe(false);
    // a y c empatan a 24 puntos y a una victoria: desempata la suma de marcas (67 contra 49)
    expect(rows.map((r) => r.entry.uid)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('los rivales son duelos fijos del grupo (el último de un grupo impar se cruza con el penúltimo)', () => {
    const g = ['a', 'b', 'c', 'd', 'e'].map((u) => entry(u));
    expect(['a', 'b', 'c', 'd', 'e'].map((u) => rivalOf(g, u)!.uid)).toEqual(['b', 'a', 'd', 'c', 'd']);
    expect(rivalOf([entry('solo')], 'solo')).toBeNull();
    expect(rivalOf(g, 'nadie')).toBeNull();
  });

  it('superar al rival: quedar por delante de tu pareja de duelo, no solo ser primero', () => {
    const g = ['a', 'b', 'c', 'd'].map((u) => entry(u));
    // Duelos a-b y c-d. c gana el grupo y supera a d (que no jugó); b queda 2º y supera a a (3º).
    const res = new Map<string, CupResult>([
      ['a', { g1: 10 }],
      ['b', { g1: 20 }],
      ['c', { g1: 30 }],
    ]);
    const standings = [groupStandings(g, res)];
    const view = { groups: [g], standings, finalists: [], final: [] };
    expect(standings[0].map((r) => r.entry.uid)).toEqual(['c', 'b', 'a', 'd']);
    expect(outcomeOf(view, 'b')).toMatchObject({ groupRank: 2, beatRival: true, rivalName: 'A' });
    expect(outcomeOf(view, 'a')).toMatchObject({ groupRank: 3, beatRival: false, rivalName: 'B' });
    expect(outcomeOf(view, 'c')).toMatchObject({ groupRank: 1, beatRival: true, rivalName: 'D' });
    // Quien no jugó no supera a nadie
    expect(outcomeOf(view, 'd').beatRival).toBe(false);
    expect(cupRewards(outcomeOf(view, 'b')).gems).toBe(5 + 12 + 5);
  });

  it('con un solo grupo pasan 4 a la final; con varios, 2 por grupo', () => {
    const one = Array.from({ length: 6 }, (_, i) => entry(`p${i}`));
    const res = new Map<string, CupResult>(one.map((e, i) => [e.uid, { g1: 10 + i }]));
    expect(buildCup(one, res, 'w').finalists).toHaveLength(4);
    const many = Array.from({ length: 12 }, (_, i) => entry(`q${i}`));
    const res2 = new Map<string, CupResult>(many.map((e, i) => [e.uid, { g1: 10 + i }]));
    const v = buildCup(many, res2, 'w');
    expect(v.groups).toHaveLength(2);
    expect(v.finalists).toHaveLength(4);
    // Quien no jugó no pasa aunque su grupo sea pequeño
    expect(buildCup([entry('solo'), entry('nada')], new Map([['solo', { g1: 3 }]]), 'w').finalists.map((e) => e.uid)).toEqual(['solo']);
  });
});

describe('final y premios', () => {
  const players = Array.from({ length: 5 }, (_, i) => entry(`f${i}`));
  const res = new Map<string, CupResult>([
    ['f0', { g1: 90, g2: 90, g3: 90, f: 10 }],
    ['f1', { g1: 80, g2: 80, g3: 80, f: 40 }],
    ['f2', { g1: 70, g2: 70, g3: 70, f: 25 }],
    ['f3', { g1: 60, g2: 60, g3: 60 }],
    ['f4', { g1: 1 }],
  ]);
  const view = buildCup(players, res, 'w');

  it('la final se ordena por la marca de la final', () => {
    expect(view.final.map((r) => r.entry.uid)).toEqual(['f1', 'f2', 'f0', 'f3']);
  });

  it('el campeón gana la copa de oro y las gemas de cada fase', () => {
    const o = outcomeOf(view, 'f1');
    expect(o).toMatchObject({ played: true, groupRank: 2, finalist: true, finalRank: 1 });
    const r = cupRewards(o);
    expect(r.trophy).toBe('gold');
    // Participación + 2º del grupo + campeón (+5 si quedó por delante de su pareja de duelo)
    const rival = view.standings[0].find((x) => x.entry.uid === rivalOf(view.groups[0], 'f1')!.uid)!;
    expect(o.beatRival).toBe(rival.rank > 2);
    expect(r.gems).toBe(5 + 12 + 50 + (o.beatRival ? 5 : 0));
    expect(r.tickets).toBe(1);
    expect(cupRewards(outcomeOf(view, 'f2')).trophy).toBe('silver');
    expect(cupRewards(outcomeOf(view, 'f0')).trophy).toBe('bronze');
    // El 1º del grupo siempre supera a su rival
    expect(outcomeOf(view, 'f0').beatRival).toBe(true);
  });

  it('un finalista que no jugó la final no sube al podio', () => {
    const o = outcomeOf(view, 'f3');
    expect(o.finalist).toBe(true);
    expect(o.finalRank).toBeNull();
    expect(cupRewards(o).trophy).toBeNull();
  });

  it('quien no jugó no gana nada', () => {
    const empty = buildCup([entry('z')], new Map(), 'w');
    expect(cupRewards(outcomeOf(empty, 'z'))).toEqual({ gems: 0, tickets: 0, trophy: null, lines: [] });
  });
});

describe('preparación', () => {
  it('el entrenamiento y las cartas suben la marca, con tope de 5000', () => {
    expect(cupScoreOf(100, 0, null)).toBe(100);
    expect(cupScoreOf(100, 5, null)).toBe(110);
    expect(cupScoreOf(100, 0, 'boost')).toBe(114); // 100 · 1,15 (redondeo hacia abajo de coma flotante)
    expect(cupScoreOf(100, 5, 'star')).toBe(143);
    expect(cupScoreOf(4900, 5, 'star')).toBe(5000);
  });

  it('huecos de carta y coste del centro de entrenamiento', () => {
    expect([0, 1, 2, 3, 4, 5].map(cardSlots)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(trainingCost(0, 0)).toBe(2000);
    expect(trainingCost(2, 100)).toBe(60000 * 9);
  });

  it('la afición cuenta los días jugados de lunes a viernes', () => {
    let c = newCup();
    for (const d of [28, 29, 29, 30]) c = trackActivity(c, cr(2026, 9, d, 10));
    expect(activeDays(c, '2026-09-28')).toBe(3);
    expect(fansBonus(c, '2026-09-28', 'g1')).toBe(1);
    expect(fansBonus(c, '2026-09-28', 'f')).toBe(0);
    // El fin de semana no cuenta y la semana siguiente empieza de cero
    expect(trackActivity(c, cr(2026, 10, 3, 10))).toBe(c);
    expect(activeDays(trackActivity(c, cr(2026, 10, 5, 10)), '2026-10-05')).toBe(1);
    for (const d of [1, 2]) c = trackActivity(c, cr(2026, 10, d, 10));
    expect(fansBonus(c, '2026-09-28', 'f')).toBe(1);
    c = registeredFor(c, '2026-09-28');
    expect(attemptsFor(c, '2026-09-28', 'g2')).toBe(ATTEMPTS + 1);
  });

  it('las cartas equipadas y sin usar vuelven a la colección al cambiar de Copa', () => {
    const c = { ...registeredFor(newCup(), '2026-09-28'), loadout: ['shield', 'boost'] as CardId[] };
    const next = registeredFor(c, '2026-10-05');
    expect(next.loadout).toEqual([]);
    expect(next.cards.shield).toBe(1);
    expect(next.cards.boost).toBe(1);
  });

  it('las cartas salen según su peso', () => {
    expect(randomCard(() => 0)).toBe('extra');
    expect(randomCard(() => 0.99)).toBe('star');
  });
});

describe('pronósticos y temporadas', () => {
  const players = Array.from({ length: 4 }, (_, i) => entry(`s${i}`));
  const res = new Map<string, CupResult>([
    ['s0', { g1: 9, f: 30 }],
    ['s1', { g1: 8, f: 20 }],
    ['s2', { g1: 7 }],
    ['s3', { g1: 6, f: 10 }],
  ]);
  const view = buildCup(players, res, '2026-09-28');

  it('el pronóstico paga ×5 al campeón, ×2 al podio y devuelve la apuesta a un finalista', () => {
    const pick = (uid: string) => ({ week: '2026-09-28', uid, name: uid, stake: 10 });
    expect(pickPayout(pick('s0'), view).gems).toBe(50);
    expect(pickPayout(pick('s1'), view).gems).toBe(20);
    expect(pickPayout(pick('s2'), view).gems).toBe(10);
    expect(pickPayout(pick('nadie'), view).gems).toBe(0);
    expect(pickPayout(null, view).gems).toBe(0);
  });

  it('temporadas de 4 semanas desde la primera Copa', () => {
    expect(seasonOf('2026-09-28')).toBe(0);
    expect(seasonOf('2026-10-19')).toBe(0);
    expect(seasonOf('2026-10-26')).toBe(1);
    expect(seasonWeeks(1)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
  });

  it('la clasificación de temporada suma los puntos de cada Copa', () => {
    const a = summarizeCup(view, '2026-09-28');
    expect(a.podium.map((p) => p.uid)).toEqual(['s0', 's1', 's3']);
    // Campeón: jugar 5 + 1º del grupo 20 + 100
    expect(a.rows.find((r) => r.uid === 's0')!.pts).toBe(125);
    const b = { week: '2026-10-05', podium: [{ uid: 's1', name: 'S1' }], rows: [{ uid: 's1', name: 'S1', pts: 125 }] };
    const table = seasonStandings([a, b]);
    expect(table[0]).toMatchObject({ uid: 's1', pts: 125 + a.rows.find((r) => r.uid === 's1')!.pts, cups: 1 });
    expect(seasonReward(1)?.flag).toBe(true);
    expect(seasonReward(11)).toBeNull();
  });

  it('una temporada terminada queda pendiente si jugaste alguna Copa', () => {
    const c = { ...newCup(), history: [{ week: '2026-10-12', group: 2, size: 6, final: null, gems: 17 }] };
    expect(pendingSeason(c, '2026-10-19')).toBeNull();
    expect(pendingSeason(c, '2026-10-26')).toBe(0);
    expect(pendingSeason({ ...c, seasonClaimed: 0 }, '2026-10-26')).toBeNull();
    // Solo apostar no cuenta para la temporada
    expect(pendingSeason({ ...newCup(), history: [{ week: '2026-10-12', group: null, size: 0, final: null, gems: 0 }] }, '2026-10-26')).toBeNull();
  });
});

describe('estado de la Copa en la partida', () => {
  // Sábado y domingo de la Copa del 28/9
  const SAT = cr(2026, 10, 3, 12);
  const SUN = cr(2026, 10, 4, 12);

  it('escudo, intento extra, equipar, entrenar, apostar y cobrar', () => {
    const week = '2026-09-28';
    const base = registeredFor(newCup(), week);
    useGame.getState().init({ ...newState(Date.now()), coins: 1e9, gems: 30, cup: { ...base, cards: { extra: 1, shield: 1, boost: 2, star: 0 } } });
    const g = () => useGame.getState();
    // Equipar: con nivel 0 solo cabe una carta
    expect(g().cupEquip('shield')).toBe(true);
    expect(g().cupEquip('boost')).toBe(false);
    expect(g().cupTrain()).toBeGreaterThan(0);
    expect(g().cupTrain()).toBeGreaterThan(0);
    expect(g().s.cup.training).toBe(2);
    expect(g().cupEquip('extra')).toBe(true);
    expect(g().s.cup.loadout).toEqual(['shield', 'extra']);
    // Intento extra
    expect(g().cupUseCard('extra', 'g1')).toBe(true);
    expect(attemptsFor(g().s.cup, week, 'g1')).toBe(ATTEMPTS + 1);
    // Escudo: el intento que no mejora no se gasta
    expect(g().cupAttempt('g1', SAT)).toBe(true);
    g().cupScore('g1', 50);
    expect(g().cupAttempt('g1', SAT)).toBe(true);
    g().cupUseCard('shield', 'g1');
    const r = g().cupScore('g1', 10, 'shield');
    expect(r).toMatchObject({ improved: false, refunded: true });
    expect(g().s.cup.used.g1).toBe(1);
    expect(g().s.cup.loadout).toEqual([]);
    // La estrella solo vale en la final
    useGame.setState({ s: { ...g().s, cup: { ...g().s.cup, loadout: ['star'] } } });
    expect(g().cupUseCard('star', 'g2')).toBe(false);
    // Pronóstico: una vez por semana y cuesta las gemas apostadas
    expect(g().cupPredict(week, 'bob', 'Bob', 10)).toBe(true);
    expect(g().cupPredict(week, 'ana', 'Ana', 5)).toBe(false);
    expect(g().s.gems).toBe(20);
    const outcome = { played: true, groupRank: 3, groupSize: 6, finalist: false, finalRank: null, beatRival: false, rivalName: null };
    const claim = g().cupClaim(week, outcome, 50)!;
    expect(claim.gems).toBe(5 + 6 + 50);
    expect(claim.card).not.toBeNull();
    expect(g().s.cup.pick).toBeNull();
    expect(g().s.gems).toBe(20 + 61);
    // Temporada: una sola vez
    expect(g().seasonClaim(0, 1)).toEqual({ gems: 100, flag: true });
    expect(g().seasonClaim(0, 1)).toBeNull();
    expect(g().s.cup.seasons).toBe(1);
  });


  it('inscribirse en otra semana no pierde el premio pendiente', () => {
    let c = registeredFor(newCup(), '2026-09-28');
    c = { ...c, used: { ...c.used, g1: 2 } };
    expect(pendingCup(c, '2026-09-28')).toBeNull();
    expect(pendingCup(c, '2026-10-05')).toBe('2026-09-28');
    c = registeredFor(c, '2026-10-05');
    expect(c.used.g1).toBe(0);
    expect(pendingCup(c, '2026-10-05')).toBe('2026-09-28');
  });

  it('los intentos se acaban y cada Copa se cobra una sola vez', () => {
    useGame.getState().init({ ...newState(Date.now()), cup: registeredFor(newCup(), '2026-09-28') });
    const st = useGame.getState();
    for (let k = 0; k < ATTEMPTS; k++) expect(useGame.getState().cupAttempt('g1', SAT)).toBe(true);
    expect(useGame.getState().cupAttempt('g1', SAT)).toBe(false);
    expect(st.cupScore('g2', 30).improved).toBe(true);
    expect(useGame.getState().cupScore('g2', 20)).toEqual({ score: 20, best: 30, improved: false, refunded: false });
    const gems = useGame.getState().s.gems;
    const outcome = { played: true, groupRank: 1, groupSize: 6, finalist: true, finalRank: 2, beatRival: false, rivalName: null };
    const r = useGame.getState().cupClaim('2026-09-28', outcome)!;
    expect(r.trophy).toBe('silver');
    const s = useGame.getState().s;
    expect(s.gems).toBe(gems + r.gems);
    expect(s.cup.silver).toBe(1);
    expect(s.cup.history.at(-1)).toMatchObject({ week: '2026-09-28', group: 1, final: 2 });
    expect(useGame.getState().cupClaim('2026-09-28', outcome)).toBeNull();
    expect(pendingCup(s.cup, '2026-10-05')).toBeNull();
  });

  it('cada prueba solo se juega en su día y en su semana', () => {
    const week = '2026-09-28';
    expect(slotOpen(week, 'g1', SAT)).toBe(true);
    expect(slotOpen(week, 'f', SAT)).toBe(false);
    expect(slotOpen(week, 'f', SUN)).toBe(true);
    expect(slotOpen(week, 'g2', SUN)).toBe(false);
    expect(slotOpen(week, 'g1', cr(2026, 10, 2, 23, 59))).toBe(false);
    expect(slotOpen(week, 'f', cr(2026, 10, 5, 0, 0))).toBe(false);
    expect(slotOpen(week, 'g1', cr(2026, 10, 10, 12))).toBe(false);
    useGame.getState().init({ ...newState(Date.now()), cup: registeredFor(newCup(), week) });
    const g = () => useGame.getState();
    expect(g().cupAttempt('g1', cr(2026, 10, 2, 12))).toBe(false);
    expect(g().cupAttempt('g1', SUN)).toBe(false);
    expect(g().cupAttempt('f', SUN)).toBe(true);
    // Pasada la medianoche del domingo ya no se gastan intentos (el servidor no aceptaría la marca)
    expect(g().cupAttempt('f', cr(2026, 10, 5, 0, 1))).toBe(false);
    expect(g().s.cup.used).toEqual({ g1: 0, g2: 0, g3: 0, f: 1 });
  });

  it('no se puede apostar con un pronóstico anterior sin cobrar', () => {
    const pick = { week: '2026-09-28', uid: 'bob', name: 'Bob', stake: 10 };
    useGame.getState().init({ ...newState(Date.now()), gems: 100, cup: { ...newCup(), pick } });
    const g = () => useGame.getState();
    expect(g().cupPredict('2026-10-05', 'ana', 'Ana', 5)).toBe(false);
    expect(g().s.cup.pick).toEqual(pick);
    expect(g().s.gems).toBe(100);
    const outcome = { played: false, groupRank: null, groupSize: 0, finalist: false, finalRank: null, beatRival: false, rivalName: null };
    expect(g().cupClaim('2026-09-28', outcome, 50)!.gems).toBe(50);
    expect(g().cupPredict('2026-10-05', 'ana', 'Ana', 5)).toBe(true);
    expect(g().s.gems).toBe(145);
    // Tampoco con una Copa jugada sin cobrar
    useGame.getState().init({ ...newState(Date.now()), gems: 100, cup: registeredFor(newCup(), '2026-09-28') });
    expect(g().cupPredict('2026-10-05', 'ana', 'Ana', 5)).toBe(false);
  });

  it('las Copas se cobran de la más antigua a la más reciente y nunca dos veces', () => {
    let c = registeredFor(newCup(), '2026-09-28');
    c = { ...c, pick: { week: '2026-09-21', uid: 'x', name: 'X', stake: 5 } };
    expect(pendingCup(c, '2026-10-05')).toBe('2026-09-21');
    // Todo lo anterior a la última Copa cobrada cuenta como cobrado, aunque ya no esté en el historial
    const old = { ...registeredFor(newCup(), '2026-09-28'), claimed: '2026-12-07', history: [] };
    expect(isClaimed(old, '2026-09-28')).toBe(true);
    expect(pendingCup(old, '2027-01-04')).toBeNull();
    expect(isClaimed(old, '2026-12-14')).toBe(false);
    // Cobrar una semana anterior no hace retroceder la última cobrada
    useGame.getState().init({ ...newState(Date.now()), cup: { ...newCup(), claimed: '2026-10-12' } });
    const outcome = { played: false, groupRank: null, groupSize: 0, finalist: false, finalRank: null, beatRival: false, rivalName: null };
    expect(useGame.getState().cupClaim('2026-10-05', outcome)).toBeNull();
    expect(useGame.getState().cupClaim('2026-10-19', outcome)).not.toBeNull();
    expect(useGame.getState().s.cup.claimed).toBe('2026-10-19');
  });

  it('marcas locales que el servidor no tiene, solo de las pruebas en juego', () => {
    const best = { g1: 120, g2: 0, g3: 40, f: 300 };
    expect(unsyncedBest(best, { g1: 100, g3: 40 }, 'groups')).toEqual({ g1: 120 });
    expect(unsyncedBest(best, undefined, 'groups')).toEqual({ g1: 120, g3: 40 });
    expect(unsyncedBest(best, { f: 300 }, 'final')).toEqual({});
    expect(unsyncedBest(best, { f: 10 }, 'final')).toEqual({ f: 300 });
    expect(unsyncedBest(best, undefined, 'signup')).toEqual({});
    expect(unsyncedBest({ ...best, g1: 9999 }, undefined, 'groups').g1).toBe(5000);
  });

  it('las lecturas parciales de marcas se suman a las que ya había', () => {
    const full = mergeResults(null, [
      { uid: 'a', result: { g1: 10 }, at: 1000 },
      { uid: 'b', result: { g1: 20 }, at: 3000 },
    ]);
    expect(full.maxAt).toBe(3000);
    expect([...full.data.keys()]).toEqual(['a', 'b']);

    // Llega una marca nueva de 'a' y un jugador nuevo; 'b' no cambió y se conserva
    const next = mergeResults(full, [
      { uid: 'a', result: { g1: 15, g2: 5 }, at: 5000 },
      { uid: 'c', result: { g1: 1 }, at: 4000 },
    ]);
    expect(next.data.get('a')).toEqual({ g1: 15, g2: 5 });
    expect(next.data.get('b')).toEqual({ g1: 20 });
    expect(next.data.get('c')).toEqual({ g1: 1 });
    expect(next.maxAt).toBe(5000);
    // No toca la anterior y siempre es un Map nuevo (la pantalla tiene que notar el cambio)
    expect(full.data.get('a')).toEqual({ g1: 10 });
    expect(mergeResults(next, []).data).not.toBe(next.data);

    // Una marca repetida por el margen de solapamiento no cambia nada ni hace retroceder maxAt
    const again = mergeResults(next, [{ uid: 'c', result: { g1: 1 }, at: 4000 }]);
    expect(again.data).toEqual(next.data);
    expect(again.maxAt).toBe(5000);
  });
});
