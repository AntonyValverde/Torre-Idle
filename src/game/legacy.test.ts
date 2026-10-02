import { beforeEach, describe, expect, it } from 'vitest';
import { now } from './clock';
import { LEGACY, buildingMultiplier, critChance, offlineCapSeconds, offlineEfficiency, productionPerSec, tapValue } from './economy';
import {
  KEYSTONE_GROUP,
  LEGACY_TREE,
  RESPEC_GEMS,
  TIER_STARS,
  VIP_EVERY_MS,
  affordableLegacy,
  branchInvested,
  keystone,
  legacyBlock,
  respecCost,
  spentOn,
  tierOpen,
  vipReady,
} from './legacy';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), buildings: { choza: 60, casa: 30 }, era: 2, ...extra });
/** Partida con estas mejoras de legado ya compradas (y las estrellas gastadas que cuestan). */
function withLegacy(levels: Record<string, number>, extra: Partial<GameState> = {}): GameState {
  let spent = 0;
  for (const [id, l] of Object.entries(levels)) spent += spentOn(LEGACY_TREE.find((n) => n.id === id)!, l);
  // Siempre las mismas estrellas: así dos partidas solo se diferencian en el legado
  return base({ legacy: levels, stars: 2000, starsSpent: spent, ...extra });
}

describe('árbol de legado', () => {
  beforeEach(() => useGame.getState().init(base({ stars: 1000 })));

  it('las ocho mejoras de antes siguen ahí con su id y su coste', () => {
    for (const id of ['productividad', 'capital', 'dedos', 'arquitecto', 'asistente', 'suerte', 'cielo', 'taquilla']) {
      expect(LEGACY.some((n) => n.id === id)).toBe(true);
    }
    expect(LEGACY_TREE.find((n) => n.id === 'productividad')!.cost(0)).toBe(3);
    expect(LEGACY_TREE.find((n) => n.id === 'taquilla')!.cost(2)).toBe(40);
    // Cada rama tiene 2 opciones en el nivel 2 (excluyentes) y una piedra angular
    for (const b of ['magnate', 'activo', 'jugador'] as const) {
      const t2 = LEGACY_TREE.filter((n) => n.branch === b && n.tier === 2);
      expect(t2).toHaveLength(2);
      expect(t2[0].group).toBe(t2[1].group);
      expect(LEGACY_TREE.filter((n) => n.branch === b && n.tier === 3 && n.group === KEYSTONE_GROUP)).toHaveLength(1);
    }
  });

  it('una partida antigua conserva sus niveles, y lo gastado cuenta para abrir la rama', () => {
    const s = normalize({ era: 4, stars: 80, starsSpent: 40, legacy: { dedos: 6, suerte: 2, productividad: 3 } }, 0);
    expect(s.legacy.dedos).toBe(6);
    expect(s.respecFree).toBe(true);
    expect(branchInvested(s, 'activo')).toBe(spentOn(LEGACY_TREE.find((n) => n.id === 'dedos')!, 6) + 3 + 5);
    expect(tierOpen(s, 'activo', 2)).toBe(true);
    expect(tierOpen(s, 'magnate', 2)).toBe(false);
  });

  it('los niveles 2 y 3 se abren invirtiendo estrellas en la rama', () => {
    const st = () => useGame.getState();
    expect(legacyBlock(st().s, 'golpeCritico')).toContain(`${TIER_STARS[2]} ⭐`);
    expect(st().buyLegacy('golpeCritico')).toBe(false);
    // El tronco no abre ramas
    for (let i = 0; i < 6; i++) st().buyLegacy('productividad');
    expect(tierOpen(st().s, 'activo', 2)).toBe(false);
    while (!tierOpen(st().s, 'activo', 2)) expect(st().buyLegacy('dedos')).toBe(true);
    expect(st().buyLegacy('golpeCritico')).toBe(true);
    expect(branchInvested(st().s, 'activo')).toBeGreaterThanOrEqual(TIER_STARS[2]);
  });

  it('en el nivel 2 solo se puede tener una de las dos', () => {
    useGame.getState().init(withLegacy({ dedos: 8 }));
    expect(useGame.getState().buyLegacy('fiestero')).toBe(true);
    expect(legacyBlock(useGame.getState().s, 'golpeCritico')).toContain('Elegiste');
    expect(useGame.getState().buyLegacy('golpeCritico')).toBe(false);
  });

  it('solo una piedra angular en toda la ciudad', () => {
    useGame.getState().init(withLegacy({ dedos: 12, taquilla: 4 }));
    expect(tierOpen(useGame.getState().s, 'activo', 3)).toBe(true);
    expect(tierOpen(useGame.getState().s, 'jugador', 3)).toBe(true);
    expect(useGame.getState().buyLegacy('toqueMaestro')).toBe(true);
    expect(keystone(useGame.getState().s)?.id).toBe('toqueMaestro');
    expect(useGame.getState().buyLegacy('paseVip')).toBe(false);
    expect(legacyBlock(useGame.getState().s, 'paseVip')).toContain('piedra angular');
  });

  it('reorganizar devuelve todo: gratis una vez por era, luego 50 gemas', () => {
    useGame.getState().init(withLegacy({ dedos: 8, fiestero: 1, productividad: 4 }, { gems: 60 }));
    const spent = useGame.getState().s.starsSpent;
    expect(spent).toBeGreaterThan(0);
    expect(respecCost(useGame.getState().s)).toBe(0);
    expect(useGame.getState().resetLegacy()).toBe(true);
    let s = useGame.getState().s;
    expect(s.starsSpent).toBe(0);
    expect(s.legacy).toEqual({});
    expect(s.gems).toBe(60);
    expect(respecCost(s)).toBe(RESPEC_GEMS);
    // Nada que devolver: no se cobra
    expect(useGame.getState().resetLegacy()).toBe(false);
    useGame.getState().buyLegacy('productividad');
    expect(useGame.getState().resetLegacy()).toBe(true);
    s = useGame.getState().s;
    expect(s.gems).toBe(60 - RESPEC_GEMS);
    // Sin gemas, no
    useGame.getState().buyLegacy('productividad');
    expect(useGame.getState().resetLegacy()).toBe(false);
    // Refundar da otra gratis
    useGame.setState({ s: { ...useGame.getState().s, allTimeEarned: 1e22, totalEarned: 1e22 } });
    expect(useGame.getState().prestige()).toBeGreaterThan(0);
    expect(useGame.getState().s.respecFree).toBe(true);
  });

  it('efectos de la rama Magnate', () => {
    const none = base();
    expect(offlineCapSeconds(withLegacy({ gerente: 3 }))).toBe(offlineCapSeconds(none) + 3 * 3600);
    expect(offlineEfficiency(withLegacy({ arquitecto: 5, turnoNoche: 2 }))).toBeCloseTo(offlineEfficiency(none) + 0.2);
    // Hitos x2.2: 60 chozas tienen 2 hitos (25 y 50)
    expect(buildingMultiplier(withLegacy({ hitosMayores: 1 }), 'choza')).toBeCloseTo(2.2 ** 2);
    expect(buildingMultiplier(none, 'choza')).toBe(4);
    const nd = withLegacy({ nuncaDuerme: 1 });
    expect(offlineEfficiency(nd)).toBe(1);
    expect(offlineCapSeconds(nd)).toBe(offlineCapSeconds(none) * 2);
  });

  it('efectos de la rama Activo', () => {
    const t = now();
    // Golpe crítico: un crítico vale x20
    useGame.getState().init(withLegacy({ golpeCritico: 1 }));
    let r = useGame.getState().tap();
    for (let i = 0; i < 2000 && !r.crit; i++) r = useGame.getState().tap();
    expect(r.crit).toBe(true);
    expect(r.amount).toBeCloseTo(tapValue(useGame.getState().s, now()) * 20, 5);
    // Toque maestro: +5% de la producción por toque
    const plain = withLegacy({});
    const master = withLegacy({ toqueMaestro: 1 });
    expect(tapValue(master, t) - tapValue(plain, t)).toBeCloseTo(productionPerSec(plain, t) * 0.05);
    expect(critChance(withLegacy({ suerte: 3 }))).toBeCloseTo(critChance(plain) + 0.03);
  });

  it('Fiestero: fiestas x10 y el doble de largas', () => {
    useGame.getState().init(withLegacy({ fiestero: 1 }));
    useGame.setState({ decree: { options: ['festival', 'mina'], expires: now() + 60_000 } });
    const t = now();
    useGame.getState().chooseDecree('festival');
    const s = useGame.getState().s;
    expect(s.tapBoostMult).toBe(10);
    expect(s.tapBoostUntil - t).toBeGreaterThanOrEqual(89_000);
  });

  it('efectos de la rama Jugador', () => {
    useGame.getState().init(withLegacy({}));
    const normal = useGame.getState().rewardThief(40).coins;
    useGame.getState().init(withLegacy({ profesional: 2 }));
    expect(useGame.getState().rewardThief(40).coins).toBe(Math.round(normal * 1.5));
    // Maratón: los boosts de los arcade duran +20% por nivel
    useGame.getState().init(withLegacy({ maraton: 5 }));
    const t = now();
    useGame.getState().rewardStack(20);
    const boost = useGame.getState().s.boosts.find((b) => b.k === 'stack')!;
    expect(boost.u - t).toBeGreaterThanOrEqual(20 * 15 * 2 * 1000 - 50);
  });

  it('Pase VIP: una partida gratis cada hora', () => {
    useGame.getState().init(withLegacy({ paseVip: 1 }, { tickets: 0, ticketTime: now() }));
    expect(vipReady(useGame.getState().s, now())).toBe(true);
    expect(useGame.getState().useVipPlay()).toBe(true);
    expect(useGame.getState().useVipPlay()).toBe(false);
    expect(useGame.getState().s.tickets).toBe(0);
    const s = useGame.getState().s;
    expect(vipReady(s, s.vipLast + VIP_EVERY_MS)).toBe(true);
    expect(vipReady(base(), now())).toBe(false);
  });

  it('los avisos solo cuentan lo que de verdad se puede comprar', () => {
    const s = base({ stars: 1000, starsSpent: 0 });
    // Con mil estrellas: todo el nivel 1 y el tronco, pero no los niveles cerrados
    expect(affordableLegacy(s)).toBe(LEGACY_TREE.filter((n) => n.tier === 1).length);
  });
});
