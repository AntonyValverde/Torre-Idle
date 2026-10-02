import { beforeEach, describe, expect, it } from 'vitest';
import { now } from './clock';
import {
  UPGRADES,
  buildingCost,
  costDiscount,
  critChance,
  eventFrequency,
  offlineCapSeconds,
  offlineEfficiency,
  productionPerSec,
  tapValue,
  ticketRegenMs,
  upgradeCost,
  BUILDINGS,
} from './economy';
import { LAWS, LAW_BY_ID, currentLaw, lawOptions, lawPending } from './laws';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';

const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), era: 3, buildings: { choza: 10, casa: 5 }, ...extra });
const withLaw = (id: string) => base({ law: id });

describe('leyes de era', () => {
  beforeEach(() => useGame.getState().init(base()));

  it('cada era ofrece tres leyes distintas, las mismas para todos', () => {
    for (let era = 2; era < 40; era++) {
      const ids = lawOptions(era).map((l) => l.id);
      expect(new Set(ids).size).toBe(3);
      expect(lawOptions(era).map((l) => l.id)).toEqual(ids);
    }
    // No siempre salen las mismas tres
    expect(new Set(Array.from({ length: 20 }, (_, i) => lawOptions(i + 2).map((l) => l.id).join())).size).toBeGreaterThan(5);
  });

  it('se elige desde la era 2, una vez por era, entre sus opciones', () => {
    expect(lawPending(base({ era: 1 }))).toBe(false);
    expect(lawPending(base())).toBe(true);
    const st = useGame.getState();
    const other = LAWS.find((l) => !lawOptions(3).includes(l))!;
    expect(st.chooseLaw(other.id)).toBe(false);
    const pick = lawOptions(3)[1];
    expect(useGame.getState().chooseLaw(pick.id)).toBe(true);
    expect(currentLaw(useGame.getState().s)?.id).toBe(pick.id);
    expect(lawPending(useGame.getState().s)).toBe(false);
    // Ya elegida: no se cambia
    expect(useGame.getState().chooseLaw(lawOptions(3)[0].id)).toBe(false);
  });

  it('en la era 1 no se puede elegir ley', () => {
    useGame.getState().init(base({ era: 1 }));
    expect(useGame.getState().chooseLaw(lawOptions(1)[0].id)).toBe(false);
  });

  it('al refundar, la era nueva vuelve a elegir', () => {
    useGame.getState().init(base({ law: 'industrial', allTimeEarned: 1e12, totalEarned: 1e12 }));
    expect(useGame.getState().prestige()).toBeGreaterThan(0);
    const s = useGame.getState().s;
    expect(s.law).toBeNull();
    expect(lawPending(s)).toBe(true);
  });

  it('una ley desconocida al cargar se descarta', () => {
    expect(normalize({ era: 4, law: 'inventada' }, 0).law).toBeNull();
    expect(normalize({ era: 4, law: 'feria' }, 0).law).toBe('feria');
    expect(normalize({ era: 4 }, 0).law).toBeNull();
  });

  it('cada efecto actúa donde dice', () => {
    const t = now();
    const none = base();
    expect(productionPerSec(withLaw('industrial'), t)).toBeCloseTo(productionPerSec(none, t) * 1.75);
    expect(tapValue(withLaw('industrial'), t)).toBeCloseTo(tapValue(none, t) * 0.5);
    expect(tapValue(withLaw('activa'), t)).toBeCloseTo(tapValue(none, t) * 5);
    expect(critChance(withLaw('activa'))).toBeCloseTo(critChance(none) + 0.05);
    expect(eventFrequency(withLaw('turistica'))).toBeCloseTo(0.5);
    expect(costDiscount(withLaw('constructora'))).toBeCloseTo(0.75);
    expect(buildingCost(BUILDINGS[0], 0, 1, costDiscount(withLaw('turistica')))).toBeCloseTo(15 * 1.15);
    const u = UPGRADES[0];
    expect(upgradeCost(withLaw('tecnologica'), u)).toBeCloseTo(u.cost * 0.25);
    expect(upgradeCost(withLaw('constructora'), u)).toBeCloseTo(u.cost * 2);
    expect(ticketRegenMs(withLaw('feria'))).toBeCloseTo(ticketRegenMs(none) * 0.5);
    expect(offlineCapSeconds(withLaw('nocturna'))).toBe(offlineCapSeconds(none) + 4 * 3600);
    expect(offlineEfficiency(withLaw('nocturna'))).toBeCloseTo(0.75);
    expect(offlineEfficiency(withLaw('activa'))).toBeCloseTo(0.25);
    // La eficiencia offline nunca pasa del 100%
    expect(offlineEfficiency({ ...withLaw('nocturna'), gemLevels: { offlineEff: 5 } })).toBe(1);
  });

  it('la ley lúdica dobla las monedas de los arcade', () => {
    const normal = useGame.getState().rewardThief(40).coins;
    useGame.getState().init(withLaw('ludica'));
    expect(useGame.getState().rewardThief(40).coins).toBe(normal * 2);
  });

  it('las mejoras se compran a su precio con ley', () => {
    const u = UPGRADES.find((x) => x.id === 'choza-0')!;
    useGame.getState().init({ ...withLaw('tecnologica'), coins: u.cost * 0.3 });
    expect(useGame.getState().buyUpgrade(u.id)).toBe(true);
    expect(useGame.getState().s.coins).toBeCloseTo(u.cost * 0.05);
    useGame.getState().init({ ...withLaw('constructora'), coins: u.cost * 1.5 });
    expect(useGame.getState().buyUpgrade(u.id)).toBe(false);
  });

  it('todas las leyes tienen ventaja y desventaja', () => {
    for (const l of LAWS) {
      expect(LAW_BY_ID.get(l.id)).toBe(l);
      expect(l.pro.length).toBeGreaterThan(5);
      expect(l.con.length).toBeGreaterThan(5);
      expect(Object.keys(l.fx).length).toBeGreaterThanOrEqual(2);
    }
  });
});
