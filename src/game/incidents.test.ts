import { beforeEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../minigames/rng';
import { now } from './clock';
import { boostMultiplier } from './economy';
import { INCIDENT_BONUS, INCIDENT_KINDS, INCIDENT_LIFE_MS, INCIDENT_PENALTY, newIncident, nextIncidentDelay } from './incidents';
import { newState } from './state';
import { useGame } from './store';

function fresh() {
  const t = now();
  useGame.getState().init({ ...newState(t), tickets: 0, buildings: { choza: 10 } });
  useGame.setState({ incident: null, incidentPlay: null });
}

describe('incidentes en la ciudad', () => {
  beforeEach(fresh);

  it('salen en la escena, sin repetir el anterior y con 90 s para atenderlos', () => {
    const rand = mulberry32(7);
    let last = null;
    for (let i = 0; i < 50; i++) {
      const inc = newIncident(1000, rand, last);
      expect(INCIDENT_KINDS).toContain(inc.kind);
      expect(inc.kind).not.toBe(last);
      expect(inc.x).toBeGreaterThanOrEqual(18);
      expect(inc.x).toBeLessThanOrEqual(82);
      expect(inc.expires).toBe(1000 + INCIDENT_LIFE_MS);
      last = inc.kind;
    }
    expect(nextIncidentDelay(() => 0, 1)).toBe(360_000);
    expect(nextIncidentDelay(() => 1, 1)).toBe(600_000);
    expect(nextIncidentDelay(() => 1, 0.5)).toBe(300_000);
  });

  it('solo hay uno a la vez', () => {
    const st = useGame.getState();
    st.offerIncident();
    const first = useGame.getState().incident;
    useGame.getState().offerIncident();
    expect(useGame.getState().incident).toBe(first);
  });

  it('atenderlo abre su minijuego sin gastar ticket y paga x1.5 una sola vez', () => {
    // Misma partida sin incidente, para comparar el premio normal
    const normal = useGame.getState().rewardFire(50).coins;
    fresh();
    useGame.setState({ incident: { kind: 'fire', x: 50, expires: now() + 60_000 } });
    expect(useGame.getState().takeIncident()).toBe('fire');
    expect(useGame.getState().incident).toBeNull();
    expect(useGame.getState().s.tickets).toBe(0);
    const r = useGame.getState().rewardFire(50);
    expect(r.coins).toBe(Math.round(normal * INCIDENT_BONUS));
    // La siguiente partida ya es normal
    expect(useGame.getState().incidentPlay).toBeNull();
    expect(useGame.getState().rewardFire(50).coins).toBe(normal);
  });

  it('el extra solo vale para el minijuego del incidente y se pierde al cerrarlo', () => {
    useGame.setState({ incident: { kind: 'thief', x: 50, expires: now() + 60_000 } });
    useGame.getState().takeIncident();
    useGame.getState().endIncidentPlay();
    const normal = useGame.getState().rewardThief(40).coins;
    fresh();
    useGame.setState({ incident: { kind: 'thief', x: 50, expires: now() + 60_000 } });
    useGame.getState().takeIncident();
    // Otro minijuego no se lleva el extra
    expect(useGame.getState().rewardTraffic(30).coins).toBeGreaterThan(0);
    expect(useGame.getState().incidentPlay).toBeNull();
    expect(useGame.getState().rewardThief(40).coins).toBe(normal);
  });

  it('uno caducado ya no se puede atender', () => {
    useGame.setState({ incident: { kind: 'metro', x: 50, expires: now() - 1 } });
    expect(useGame.getState().takeIncident()).toBeNull();
  });

  it('si se ignora mientras se mira, la producción baja un rato', () => {
    useGame.setState({ incident: { kind: 'traffic', x: 50, expires: now() - 100 } });
    useGame.getState().tick();
    const st = useGame.getState();
    expect(st.incident).toBeNull();
    expect(boostMultiplier(st.s, now())).toBeCloseTo(INCIDENT_PENALTY.mult);
    // Otro descuido alarga la penalización, no la acumula
    useGame.setState({ incident: { kind: 'fire', x: 50, expires: now() - 100 } });
    useGame.getState().tick();
    expect(boostMultiplier(useGame.getState().s, now())).toBeCloseTo(INCIDENT_PENALTY.mult);
  });

  it('si venció con la app en segundo plano, desaparece sin daños', () => {
    useGame.setState({ incident: { kind: 'fire', x: 50, expires: now() - 60_000 } });
    useGame.getState().tick();
    expect(useGame.getState().incident).toBeNull();
    expect(boostMultiplier(useGame.getState().s, now())).toBe(1);
  });
});
