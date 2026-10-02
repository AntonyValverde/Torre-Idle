import { beforeEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../minigames/rng';
import {
  ADVISORS,
  PACK_GEMS,
  advisorText,
  advisorsAlert,
  advisorsState,
  copiesForLevel,
  drawAdvisor,
  levelFor,
  seatCount,
} from './advisors';
import { now } from './clock';
import { buildingMultiplier, critChance, eventFrequency, offlineCapSeconds, productionPerSec, tapValue, ticketRegenMs } from './economy';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), buildings: { choza: 10, casa: 5 }, ...extra });
const seated = (id: string, copies: number, extra: Partial<GameState> = {}): GameState =>
  base({ advisors: { copies: { [id]: copies }, seats: [id], packs: 0, gift: true }, ...extra });

describe('consejeros', () => {
  beforeEach(() => useGame.getState().init(base()));

  it('el nivel crece con las copias: 1, 3, 6, 10…', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 15].map(levelFor)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 5]);
    for (let L = 1; L < 50; L++) {
      expect(levelFor(copiesForLevel(L))).toBe(L);
      expect(levelFor(copiesForLevel(L) - 1)).toBe(L - 1);
    }
  });

  it('las sillas crecen con las eras', () => {
    expect([1, 2, 3, 5, 6, 9, 10, 40].map((era) => seatCount(base({ era })))).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('los sobres respetan las rarezas', () => {
    const rand = mulberry32(42);
    const count = { comun: 0, rara: 0, epica: 0 };
    for (let i = 0; i < 6000; i++) count[drawAdvisor(rand).rarity]++;
    expect(count.comun / 6000).toBeCloseTo(0.6, 1);
    expect(count.rara / 6000).toBeCloseTo(0.3, 1);
    expect(count.epica / 6000).toBeCloseTo(0.1, 1);
  });

  it('primero el sobre de regalo, luego los guardados y después con gemas', () => {
    useGame.getState().init(base({ gems: 25 }));
    const r1 = useGame.getState().openAdvisorPack();
    expect(r1?.paid).toBe(0);
    expect(useGame.getState().s.advisors.gift).toBe(true);
    expect(useGame.getState().s.gems).toBe(25);
    useGame.setState({ s: { ...useGame.getState().s, advisors: { ...useGame.getState().s.advisors, packs: 1 } } });
    expect(useGame.getState().openAdvisorPack()?.paid).toBe(0);
    expect(useGame.getState().s.advisors.packs).toBe(0);
    expect(useGame.getState().openAdvisorPack()?.paid).toBe(PACK_GEMS);
    expect(useGame.getState().s.gems).toBe(25 - PACK_GEMS);
    // Sin gemas suficientes no se abre
    expect(useGame.getState().openAdvisorPack()).toBeNull();
    const copies = Object.values(useGame.getState().s.advisors.copies).reduce((n, c) => n + c, 0);
    expect(copies).toBe(3);
  });

  it('el cofre del día y las misiones semanales dan sobres', () => {
    const s = useGame.getState().s;
    const daily = s.missions.daily.map((x) => ({ ...x, c: true }));
    useGame.setState({ s: { ...s, missions: { ...s.missions, daily, chest: false } } });
    expect(useGame.getState().claimChest()).toContain('sobre de consejero');
    expect(useGame.getState().s.advisors.packs).toBe(1);
  });

  it('solo cuentan los sentados, y no más que las sillas', () => {
    useGame.getState().init(base({ advisors: { copies: { pilar: 1, kim: 1, aurelio: 1 }, seats: [], packs: 0, gift: true } }));
    const st = () => useGame.getState();
    expect(st().seatAdvisor('pilar')).toBe(true);
    expect(st().seatAdvisor('pilar')).toBe(false);
    expect(st().seatAdvisor('kim')).toBe(true);
    // Dos sillas en la era 1: la tercera no cabe
    expect(st().seatAdvisor('aurelio')).toBe(false);
    // Uno que no tienes no se sienta
    expect(st().seatAdvisor('zork')).toBe(false);
    st().unseatAdvisor('kim');
    expect(st().seatAdvisor('aurelio')).toBe(true);
    expect(st().s.advisors.seats).toEqual(['pilar', 'aurelio']);
  });

  it('cada efecto actúa donde dice, según el nivel', () => {
    const t = now();
    const none = base();
    // Pilar nivel 2 (3 copias): chozas y casas x3, el resto igual
    expect(buildingMultiplier(seated('pilar', 3), 'choza')).toBe(buildingMultiplier(none, 'choza') * 3);
    expect(buildingMultiplier(seated('pilar', 3), 'tienda')).toBe(buildingMultiplier(none, 'tienda'));
    // Sin sentar no hace nada
    expect(buildingMultiplier(base({ advisors: { copies: { pilar: 3 }, seats: [], packs: 0, gift: true } }), 'choza')).toBe(1);
    expect(tapValue(seated('kim', 1), t)).toBeCloseTo(tapValue(none, t) * 1.5);
    expect(productionPerSec(seated('aurelio', 6), t)).toBeCloseTo(productionPerSec(none, t) * 1.3);
    expect(offlineCapSeconds(seated('bruno', 1))).toBe(offlineCapSeconds(none) + 3600);
    expect(ticketRegenMs(seated('rosa', 3))).toBeCloseTo(ticketRegenMs(none) / 1.2);
    expect(critChance(seated('lucia', 1))).toBeCloseTo(critChance(none) + 0.02);
    expect(eventFrequency(seated('lucia', 1))).toBeCloseTo(1 / 1.1);
    // Se combina con la ley de la era
    expect(productionPerSec({ ...seated('aurelio', 1), era: 3, law: 'industrial' }, t)).toBeCloseTo(productionPerSec(none, t) * 1.1 * 1.75);
  });

  it('Nico sube las monedas de los arcade', () => {
    const normal = useGame.getState().rewardThief(40).coins;
    useGame.getState().init(seated('nico', 1));
    expect(useGame.getState().rewardThief(40).coins).toBe(Math.round(normal * 1.25));
  });

  it('carga con datos raros sin romperse', () => {
    const a = advisorsState({ copies: { pilar: 3, inventado: 5, kim: -1, zork: 'x' }, seats: ['pilar', 'pilar', 'kim', 'zork', 7], packs: 2.7, gift: 'si' });
    expect(a).toEqual({ copies: { pilar: 3 }, seats: ['pilar'], packs: 2, gift: false });
    expect(normalize({}, 0).advisors).toEqual({ copies: {}, seats: [], packs: 0, gift: false });
    const s = seated('vera', 4);
    expect(normalize(JSON.parse(JSON.stringify(s)), 0).advisors).toEqual(s.advisors);
  });

  it('textos y aviso', () => {
    expect(advisorText(ADVISORS[0], 2)).toBe('Chozas y Casas x3');
    expect(advisorText(ADVISORS.find((d) => d.id === 'lucia')!, 1)).toBe('+2% de críticos · Globos, decretos e incidentes 1.1 veces más rápido');
    expect(advisorsAlert(base())).toBe(true);
    expect(advisorsAlert(seated('kim', 1))).toBe(false);
    for (const d of ADVISORS) expect(advisorText(d, 1).length).toBeGreaterThan(5);
  });
});
