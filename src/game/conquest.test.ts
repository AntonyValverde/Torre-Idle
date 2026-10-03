import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_TILES,
  CAPITAL_CAP,
  CAPITAL_GROW_MS,
  CAPITAL_SLOTS,
  CENTER,
  GROW_MS,
  msUntilGarrison,
  RECRUITS_DAY,
  RECRUITS_MAX,
  ASSAULT_COOLDOWN_MS,
  ASSAULT_MAX,
  assaultWaitMs,
  attackPower,
  recruitCap,
  soldiersFor,
  withCapture,
  SHIELD_MS,
  SKEW_MS,
  TILE_CAP,
  TROOP_CAP,
  TROOP_MS,
  addRecruits,
  adjacent,
  applyReports,
  applySeason,
  conquestAlert,
  newConquest,
  pendingSeason,
  withReserve,
  withSeasonSkipped,
  seasonPrize,
  withWorld,
  banditGarrison,
  conquestState,
  distToCenter,
  garrisonAt,
  neighbors,
  nextTroopMs,
  ownerHue,
  parseTile,
  recruitsToSend,
  seasonOf,
  sourceFor,
  standings,
  targetInfo,
  troopsAt,
  type Tile,
} from './conquest';
import { citySnapshot } from './cities';
import { newState, normalize, type GameState } from './state';

const tile = (id: string, owner: string, extra: Partial<Tile> = {}): Tile => ({ id, owner, name: owner, g: 10, t: 0, ct: -1e9, capital: false, ...extra });
const map = (...ts: Tile[]) => new Map(ts.map((t) => [t.id, t]));

describe('Conquista: mapa', () => {
  it('61 territorios, 6 vecinos en el interior y menos en el borde', () => {
    expect(ALL_TILES).toHaveLength(61);
    expect(neighbors(CENTER)).toHaveLength(6);
    expect(neighbors('-4_4')).toHaveLength(3);
    for (const id of ALL_TILES) for (const n of neighbors(id)) expect(adjacent(id, n)).toBe(true);
    expect(adjacent('0_0', '2_0')).toBe(false);
    expect(parseTile('5_0')).toBeNull();
    expect(parseTile('4_4')).toBeNull();
    expect(parseTile('x')).toBeNull();
  });

  it('las capitales están en el borde, son distintas y no se tocan entre sí las dos primeras', () => {
    expect(new Set(CAPITAL_SLOTS).size).toBe(16);
    for (const id of CAPITAL_SLOTS) expect(distToCenter(id)).toBe(4);
    expect(adjacent(CAPITAL_SLOTS[0], CAPITAL_SLOTS[1])).toBe(false);
  });

  it('los bandidos son más fuertes hacia el centro', () => {
    expect(banditGarrison('-4_3')).toBe(4);
    expect(banditGarrison('-3_3')).toBe(7);
    expect(banditGarrison('1_0')).toBe(13);
    expect(banditGarrison(CENTER)).toBe(40);
  });

  it('las reglas de Firestore usan las mismas casillas y cifras', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const slots = rules.match(/function conqSlots\(\) \{\s*return \[([^\]]+)\]/)?.[1];
    expect(slots?.split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual(CAPITAL_SLOTS);
    expect(rules).toContain(`/ ${TROOP_MS}`);
    expect(rules).toContain(`let rate = old.capital ? ${CAPITAL_GROW_MS}.0 : ${GROW_MS}.0;`);
    expect(rules).toContain(`let cap = old.capital ? ${CAPITAL_CAP} : ${TILE_CAP};`);
    expect(rules).toContain(`/ ${GROW_MS}.0`);
    expect(rules).toContain(`x <= ${TROOP_CAP}`);
    expect(rules).toContain(`duration.value(${SHIELD_MS / 60_000}, 'm')`);
    expect(rules).toContain(`d.rToday <= ${RECRUITS_MAX}`);
    expect(rules).toContain(`duration.value(${ASSAULT_COOLDOWN_MS / 60_000}, 'm')`);
    expect(rules).toContain(`p * 2 <= d.sent * 3`);
    expect(ASSAULT_MAX).toBe(1.5);
  });
});

describe('Conquista: tropas y guarniciones', () => {
  it('la reserva se recarga hasta el tope, y lo que viene de reclutas no recarga', () => {
    expect(troopsAt({ troops: 0, t: 0 }, 30 * 60_000)).toBe(10);
    expect(troopsAt({ troops: 50, t: 0 }, 10 * 3600_000)).toBe(TROOP_CAP);
    expect(troopsAt({ troops: 80, t: 0 }, 10 * 3600_000)).toBe(80);
    expect(nextTroopMs({ troops: 3.5, t: 0 }, 0)).toBe(TROOP_MS / 2);
    expect(nextTroopMs({ troops: TROOP_CAP, t: 0 }, 0)).toBe(0);
  });

  it('los soldados crecen hasta su tope (la capital, el doble de rápido) y lo que lo pasa se queda', () => {
    expect(garrisonAt({ g: 1, t: 0, capital: false }, 3600_000)).toBe(16);
    expect(garrisonAt({ g: 1, t: 0, capital: true }, 3600_000)).toBe(31);
    expect(garrisonAt({ g: 1, t: 0, capital: false }, 1e9)).toBe(TILE_CAP);
    expect(garrisonAt({ g: 1, t: 0, capital: true }, 1e9)).toBe(CAPITAL_CAP);
    expect(garrisonAt({ g: 45, t: 0, capital: false }, 1e9)).toBe(45);
  });

  it('cuánto falta para tener n soldados', () => {
    expect(msUntilGarrison({ g: 5, t: 0, capital: false }, 8, 0)).toBe(3 * GROW_MS);
    expect(msUntilGarrison({ g: 5, t: 0, capital: true }, 8, 0)).toBe(3 * CAPITAL_GROW_MS);
    expect(msUntilGarrison({ g: 9, t: 0, capital: false }, 8, 0)).toBe(0);
    // Más que el tope: solo con refuerzos
    expect(msUntilGarrison({ g: 5, t: 0, capital: false }, TILE_CAP + 1, 0)).toBe(Infinity);
  });
});

describe('Conquista: qué se puede hacer con un territorio', () => {
  const T = 1_000_000_000;
  const tiles = map(tile('-4_4', 'yo', { capital: true }), tile('-4_3', 'yo'), tile('-3_2', 'otro', { g: 5, t: T, ct: T - SHIELD_MS - 60_000 }), tile('4_-4', 'otro', { capital: true }));

  it('bandidos vecinos: hace falta uno más que su guarnición, y se ataca desde el vecino propio más fuerte', () => {
    expect(targetInfo('-3_3', tiles, 'yo', T)).toEqual({ kind: 'attack', need: 8, bandits: true, from: '-4_4' });
    // Con un origen elegido que también es vecino, se ataca desde él
    expect(targetInfo('-3_3', tiles, 'yo', T, '-4_3')).toMatchObject({ kind: 'attack', from: '-4_3' });
  });

  it('un territorio lejano, un solar de capital o una capital no se atacan', () => {
    expect(targetInfo('0_0', tiles, 'yo', T).kind).toBe('far');
    expect(targetInfo('-3_4', tiles, 'yo', T).kind).toBe('reserved');
    expect(targetInfo('4_-4', tiles, 'yo', T).kind).toBe('capital');
  });

  it('lo tuyo se refuerza desde la reserva', () => {
    expect(targetInfo('-4_3', tiles, 'yo', T).kind).toBe('own');
  });

  it('a otro alcalde se le ataca contando sus soldados con margen de reloj', () => {
    const info = targetInfo('-3_2', tiles, 'yo', T);
    expect(info).toEqual({ kind: 'attack', need: Math.floor(5 + SKEW_MS / GROW_MS) + 1, bandits: false, from: '-4_3' });
    // Recién conquistado: escudo
    const fresh = map(...tiles.values(), tile('-3_2', 'otro', { ct: T - 60_000 }));
    expect(targetInfo('-3_2', fresh, 'yo', T)).toEqual({ kind: 'shield', until: T - 60_000 + SHIELD_MS });
  });

  it('el ataque sale del territorio propio vecino con más soldados ahora mismo', () => {
    const t2 = map(tile('-4_4', 'yo', { capital: true, g: 30, t: T }), tile('-4_3', 'yo', { g: 2, t: T }));
    expect(sourceFor('-3_3', t2, 'yo', T)).toBe('-4_4');
    expect(sourceFor('-3_3', t2, 'yo', T, '-4_3')).toBe('-4_3');
    expect(sourceFor('0_0', t2, 'yo', T)).toBeNull();
    // Un territorio propio no es origen de sí mismo
    expect(sourceFor('-4_4', map(tile('-4_4', 'yo', { capital: true })), 'yo', T)).toBeNull();
  });
});

describe('Conquista: clasificación, colores y temporada', () => {
  it('cuenta territorios y la Torre central vale triple', () => {
    const rows = standings(
      [tile('-4_4', 'a', { capital: true }), tile(CENTER, 'b'), tile('4_-4', 'b', { capital: true }), tile('-4_3', 'a'), tile('-3_3', 'a')],
      [
        { uid: 'a', name: 'Ana', slot: 0, troops: 0, t: 0, rDay: '', rToday: 0, aAt: 0 },
        { uid: 'b', name: 'Beto', slot: 1, troops: 0, t: 0, rDay: '', rToday: 0, aAt: 0 },
        { uid: 'c', name: 'Caro', slot: 2, troops: 0, t: 0, rDay: '', rToday: 0, aAt: 0 },
      ],
    );
    expect(rows.map((r) => [r.name, r.tiles, r.points, r.center])).toEqual([
      ['Beto', 2, 4, true],
      ['Ana', 3, 3, false],
      ['Caro', 0, 0, false],
    ]);
  });

  it('tu color siempre es azul y el de los demás nunca lo es', () => {
    expect(ownerHue('yo', 'yo')).toBe(205);
    for (let i = 0; i < 200; i++) {
      const h = ownerHue('uid' + i, 'yo');
      expect(h < 170 || h >= 230).toBe(true);
    }
  });

  it('la temporada es la semana de la Copa y dura 7 días', () => {
    const s = seasonOf(Date.UTC(2026, 9, 2, 12));
    expect(s.week).toBe('2026-09-28');
    expect(s.endsAt).toBe(Date.UTC(2026, 9, 5, 6));
  });
});

describe('Conquista: reclutas en la partida', () => {
  it('se suman con tope diario y empiezan de cero cada día', () => {
    let s = newState(0);
    s = addRecruits(s, 5, '2026-10-02');
    s = addRecruits(s, 5, '2026-10-02');
    expect(s.conquest).toMatchObject({ day: '2026-10-02', recruits: 10 });
    for (let i = 0; i < 10; i++) s = addRecruits(s, 5, '2026-10-02');
    expect(s.conquest.recruits).toBe(RECRUITS_DAY);
    expect(addRecruits(s, 3, '2026-10-03').conquest).toMatchObject({ day: '2026-10-03', recruits: 3 });
  });

  it('un reloj atrasado (día anterior) no borra el contador de hoy', () => {
    const s = addRecruits(newState(0), 10, '2026-10-03');
    expect(addRecruits(s, 5, '2026-10-02').conquest).toMatchObject({ day: '2026-10-03', recruits: 15 });
    // Y al avanzar el día sí empieza de cero
    expect(addRecruits(s, 5, '2026-10-04').conquest).toMatchObject({ day: '2026-10-04', recruits: 5 });
  });

  it('solo se envían los que aún no están en la reserva', () => {
    const s = addRecruits(newState(0), 10, '2026-10-02');
    expect(recruitsToSend(s, { rDay: '2026-10-02', rToday: 4 }, '2026-10-02')).toBe(6);
    expect(recruitsToSend(s, { rDay: '2026-10-01', rToday: 20 }, '2026-10-02')).toBe(10);
    expect(recruitsToSend(s, { rDay: '', rToday: 0 }, '2026-10-03')).toBe(0);
  });

  it('las partidas viejas o raras se normalizan', () => {
    expect(normalize({ coins: 1 }, 0).conquest).toEqual(newConquest());
    expect(conquestState({ day: '2026-10-02', recruits: 999, wins: -3, reports: [{ by: 'x' }, { by: 'b', name: 'Bruno', tile: '1_0', at: 5 }] })).toMatchObject({
      day: '2026-10-02',
      recruits: RECRUITS_MAX,
      wins: 0,
      reports: [{ by: 'b', name: 'Bruno', tile: '1_0', at: 5 }],
    });
  });
});

describe('Conquista: avisos de la tarjeta del Mapa del mundo', () => {
  const T = Date.UTC(2026, 9, 2, 12);
  const week = seasonOf(T).week;
  const day = '2026-10-02';

  it('sin haber jugado nunca, no molesta; si jugaste, avisa de la temporada nueva', () => {
    expect(conquestAlert(newState(0), T, day)).toBeNull();
    expect(conquestAlert(withWorld(newState(0), '2026-09-21', 'w0'), T, day)).toBe('⚔️ ¡Nueva temporada!');
  });

  it('partes sin leer, luego reclutas por sumar, luego reserva llena', () => {
    let s = withWorld(newState(0), week, 'w0');
    s = withReserve(s, { troops: 60, t: T, rDay: day, rToday: 0 });
    expect(conquestAlert(s, T, day)).toBe('⚔️ ¡Reserva llena!');
    s = addRecruits(s, 5, day);
    expect(conquestAlert(s, T, day)).toBe('🎖️ +5 reclutas');
    s = applyReports(s, [{ by: 'b', name: 'Bruno', tile: '1_0', at: 9 }]).s;
    expect(conquestAlert(s, T, day)).toBe('📜 1 parte de batalla');
    s = { ...s, conquest: { ...s.conquest, unread: 0, recruits: 0 } };
    s = withReserve(s, { troops: 10, t: T, rDay: day, rToday: 0 });
    expect(conquestAlert(s, T, day)).toBeNull();
    // La foto de la reserva solo cambia si cambió algo
    expect(withReserve(s, { troops: 10, t: T, rDay: day, rToday: 0 })).toBe(s);
  });
});

describe('Conquista: partes de batalla y premios', () => {
  it('los partes nuevos se guardan una sola vez, los más recientes primero', () => {
    const s = newState(0);
    const r1 = { by: 'b', name: 'Bruno', tile: '-4_3', at: 100 };
    const r2 = { by: 'c', name: 'Caro', tile: '-3_3', at: 200 };
    const a = applyReports(s, [r1, r2]);
    expect(a.fresh.map((r) => r.at)).toEqual([200, 100]);
    expect(a.s.conquest).toMatchObject({ seenAt: 200, lost: 2 });
    expect(applyReports(a.s, [r1, r2]).fresh).toEqual([]);
  });

  it('el premio pide rivales para el podio', () => {
    expect(seasonPrize(1, 5, 12)).toEqual({ gems: 5 + 12 + 45, tickets: 3, win: true, podium: true });
    expect(seasonPrize(2, 5, 30)).toEqual({ gems: 20 + 25, tickets: 2, win: false, podium: true });
    expect(seasonPrize(3, 3, 4)).toEqual({ gems: 9, tickets: 0, win: false, podium: false });
    // Solo en el mundo: participación, sin victoria
    expect(seasonPrize(1, 1, 20)).toEqual({ gems: 20, tickets: 0, win: false, podium: false });
  });

  it('una temporada se cobra una vez y queda en el palmarés y en la ciudad pública', () => {
    let s = withWorld(newState(0), '2026-09-28', 'w0');
    const r = applySeason(s, '2026-09-28', 1, 4, 10)!;
    expect(r.prize.win).toBe(true);
    s = r.s;
    expect(s.gems).toBe(60);
    expect(s.tickets).toBe(newState(0).tickets + 3);
    expect(s.conquest).toMatchObject({ claimed: '2026-09-28', wins: 1, podiums: 1, history: [{ week: '2026-09-28', rank: 1, size: 4, points: 10, gems: 60 }] });
    expect(applySeason(s, '2026-09-28', 1, 4, 10)).toBeNull();
    expect(citySnapshot(s).conq).toBe(1);
    expect(citySnapshot(newState(0)).conq).toBeUndefined();
  });

  it('al pasar a la temporada nueva, la anterior sin cobrar se recuerda en prev', () => {
    const old = withWorld(newState(0), '2026-09-21', 'w0');
    const s = withWorld(old, '2026-09-28', 'w3');
    expect(s.conquest).toMatchObject({ week: '2026-09-28', w: 'w3', prev: { week: '2026-09-21', w: 'w0' } });
    expect(pendingSeason(s.conquest, '2026-09-28')).toEqual({ week: '2026-09-21', w: 'w0' });
    // Sin apuntar aún la nueva, la pendiente es la semana actual (ya vieja)
    expect(pendingSeason(old.conquest, '2026-09-28')).toEqual({ week: '2026-09-21', w: 'w0' });
    expect(pendingSeason(old.conquest, '2026-09-21')).toBeNull();
    // Cambiar de mundo dentro de la misma semana no apunta nada
    expect(withWorld(old, '2026-09-21', 'w1').conquest.prev).toBeNull();
  });

  it('si la anterior ya se cobró, no se guarda en prev', () => {
    let s = withWorld(newState(0), '2026-09-21', 'w0');
    s = applySeason(s, '2026-09-21', 2, 4, 6)!.s;
    s = withWorld(s, '2026-09-28', 'w3');
    expect(s.conquest.prev).toBeNull();
    expect(pendingSeason(s.conquest, '2026-09-28')).toBeNull();
  });

  it('cobrar (o cerrar sin premio) la temporada recordada borra prev', () => {
    const s = withWorld(withWorld(newState(0), '2026-09-21', 'w0'), '2026-09-28', 'w3');
    const paid = applySeason(s, '2026-09-21', 1, 4, 10)!.s;
    expect(paid.conquest).toMatchObject({ claimed: '2026-09-21', prev: null, week: '2026-09-28', w: 'w3' });
    expect(pendingSeason(paid.conquest, '2026-09-28')).toBeNull();
    const skipped = withSeasonSkipped(s, '2026-09-21');
    expect(skipped.conquest).toMatchObject({ claimed: '2026-09-21', prev: null, wins: 0, history: [] });
    expect(skipped.gems).toBe(s.gems);
    expect(pendingSeason(skipped.conquest, '2026-09-28')).toBeNull();
    // prev se normaliza (vale null si falta o es raro)
    expect(conquestState({ prev: { week: 5 } }).prev).toBeNull();
    expect(conquestState({ prev: { week: '2026-09-21', w: 'w0' } }).prev).toEqual({ week: '2026-09-21', w: 'w0' });
  });
});

describe('Conquista: asalto, ley Militar, Generala y logro (F3)', () => {
  it('el bono del asalto multiplica la fuerza con tope x1,5, redondeando hacia abajo', () => {
    expect(attackPower(10)).toBe(10);
    expect(attackPower(10, 1.25)).toBe(12);
    expect(attackPower(10, 1.5)).toBe(15);
    expect(attackPower(10, 3)).toBe(15);
    expect(attackPower(10, 0.5)).toBe(10);
    // Siempre dentro de lo que aceptan las reglas: p * 2 <= enviados * 3
    for (let n = 1; n < 80; n++) for (const m of [1, 1.05, 1.2, 1.35, 1.45, 1.5]) expect(attackPower(n, m) * 2).toBeLessThanOrEqual(n * 3);
  });

  it('con bono bastan menos soldados, y nunca menos de los justos', () => {
    expect(soldiersFor(11)).toBe(11);
    expect(soldiersFor(11, 1.5)).toBe(8);
    for (let need = 1; need < 70; need++)
      for (const m of [1, 1.1, 1.25, 1.4, 1.5]) {
        const n = soldiersFor(need, m);
        expect(attackPower(n, m)).toBeGreaterThanOrEqual(need);
        if (n > 1) expect(attackPower(n - 1, m)).toBeLessThan(need);
      }
  });

  it('un bono cada 10 min (más el margen de reloj)', () => {
    expect(assaultWaitMs({ aAt: 0 }, 5)).toBe(0);
    expect(assaultWaitMs({ aAt: 1000 }, 1000)).toBe(ASSAULT_COOLDOWN_MS + SKEW_MS);
    expect(assaultWaitMs({ aAt: 1000 }, 1000 + ASSAULT_COOLDOWN_MS + SKEW_MS)).toBe(0);
  });

  it('la ley Militar dobla los reclutas y sube el tope a 45; la Generala los multiplica', () => {
    const day = '2026-10-02';
    const militar: GameState = { ...newState(0), law: 'militar' };
    expect(recruitCap(newState(0))).toBe(RECRUITS_DAY);
    expect(recruitCap(militar)).toBe(RECRUITS_MAX);
    expect(addRecruits(militar, 5, day).conquest.recruits).toBe(10);
    let s = militar;
    for (let i = 0; i < 10; i++) s = addRecruits(s, 5, day);
    expect(s.conquest.recruits).toBe(RECRUITS_MAX);
    // Si cambia la ley a mitad del día, no se pierde lo ganado
    expect(addRecruits({ ...s, law: null }, 5, day).conquest.recruits).toBe(RECRUITS_MAX);
    const base = newState(0);
    const general = { ...base, advisors: { ...base.advisors, copies: { valeria: 1 }, seats: ['valeria'] } };
    expect(addRecruits(general, 5, day).conquest.recruits).toBe(8);
  });

  it('cada conquista cuenta para el logro Señor de la guerra', () => {
    let s = newState(0);
    expect(s.conquest.captured).toBe(0);
    s = withCapture(withCapture(s));
    expect(s.conquest.captured).toBe(2);
    expect(conquestState({ captured: 7.9 }).captured).toBe(7);
  });
});
