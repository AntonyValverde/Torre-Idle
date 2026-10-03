import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_TILES,
  CAPITAL_SLOTS,
  CENTER,
  GROW_MS,
  RECRUITS_DAY,
  SHIELD_MS,
  SKEW_MS,
  TILE_CAP,
  TROOP_CAP,
  TROOP_MS,
  addRecruits,
  adjacent,
  applyReports,
  applySeason,
  newConquest,
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
import { newState, normalize } from './state';

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
    expect(rules).toContain(`/ ${GROW_MS}`);
    expect(rules).toContain(`x <= ${TROOP_CAP}`);
    expect(rules).toContain(`duration.value(${SHIELD_MS / 60_000}, 'm')`);
    expect(rules).toContain(`d.rToday <= ${RECRUITS_DAY}`);
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

  it('la guarnición crece hasta su tope (la capital más) y lo que lo pasa se queda', () => {
    expect(garrisonAt({ g: 1, t: 0, capital: false }, 3600_000)).toBe(7);
    expect(garrisonAt({ g: 1, t: 0, capital: false }, 1e9)).toBe(TILE_CAP);
    expect(garrisonAt({ g: 1, t: 0, capital: true }, 1e9)).toBe(50);
    expect(garrisonAt({ g: 45, t: 0, capital: false }, 1e9)).toBe(45);
  });
});

describe('Conquista: qué se puede hacer con un territorio', () => {
  const T = 1_000_000_000;
  const tiles = map(tile('-4_4', 'yo', { capital: true }), tile('-4_3', 'yo'), tile('-3_2', 'otro', { g: 5, t: T, ct: T - SHIELD_MS - 60_000 }), tile('4_-4', 'otro', { capital: true }));

  it('bandidos vecinos: hace falta uno más que su guarnición', () => {
    expect(targetInfo('-3_3', tiles, 'yo', T)).toEqual({ kind: 'attack', need: 8, bandits: true });
  });

  it('un territorio lejano, un solar de capital o una capital no se atacan', () => {
    expect(targetInfo('0_0', tiles, 'yo', T).kind).toBe('far');
    expect(targetInfo('-3_4', tiles, 'yo', T).kind).toBe('reserved');
    expect(targetInfo('4_-4', tiles, 'yo', T).kind).toBe('capital');
  });

  it('lo tuyo se refuerza', () => {
    expect(targetInfo('-4_3', tiles, 'yo', T).kind).toBe('reinforce');
  });

  it('a otro alcalde se le ataca contando la guarnición con margen de reloj', () => {
    const info = targetInfo('-3_2', tiles, 'yo', T);
    expect(info).toEqual({ kind: 'attack', need: Math.floor(5 + SKEW_MS / GROW_MS) + 1, bandits: false });
    // Recién conquistado: escudo
    const fresh = map(...tiles.values(), tile('-3_2', 'otro', { ct: T - 60_000 }));
    expect(targetInfo('-3_2', fresh, 'yo', T)).toEqual({ kind: 'shield', until: T - 60_000 + SHIELD_MS });
  });

  it('las tropas salen del territorio propio vecino con más guarnición', () => {
    const t2 = map(tile('-4_4', 'yo', { capital: true, g: 30 }), tile('-4_3', 'yo', { g: 2 }));
    expect(sourceFor('-3_3', t2, 'yo')).toBe('-4_4');
    expect(sourceFor('0_0', t2, 'yo')).toBeNull();
    // Un refuerzo sale del propio territorio, aunque no tenga vecinos tuyos
    expect(sourceFor('-4_4', map(tile('-4_4', 'yo', { capital: true })), 'yo')).toBe('-4_4');
  });
});

describe('Conquista: clasificación, colores y temporada', () => {
  it('cuenta territorios y la Torre central vale triple', () => {
    const rows = standings(
      [tile('-4_4', 'a', { capital: true }), tile(CENTER, 'b'), tile('4_-4', 'b', { capital: true }), tile('-4_3', 'a'), tile('-3_3', 'a')],
      [
        { uid: 'a', name: 'Ana', slot: 0, troops: 0, t: 0, rDay: '', rToday: 0 },
        { uid: 'b', name: 'Beto', slot: 1, troops: 0, t: 0, rDay: '', rToday: 0 },
        { uid: 'c', name: 'Caro', slot: 2, troops: 0, t: 0, rDay: '', rToday: 0 },
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
      recruits: RECRUITS_DAY,
      wins: 0,
      reports: [{ by: 'b', name: 'Bruno', tile: '1_0', at: 5 }],
    });
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
});
