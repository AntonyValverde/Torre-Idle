import { describe, expect, it } from 'vitest';
import { tutorialFunnel, type Player } from '../admin/metrics';
import { bump } from './missions';
import { newState, normalize, type GameState } from './state';
import { useGame } from './store';
import { TIPS, bubbleTip, seeTip, tipAvailable, tipsState } from './tips';
import {
  TUTORIAL,
  TUTORIAL_DONE,
  TUTORIAL_SINCE,
  TUTORIAL_VERSION,
  currentStep,
  isUnlocked,
  stepsCompleted,
  tutorialDone,
  tutorialLater,
  tutorialNext,
  tutorialProgress,
  tutorialReplay,
  tutorialSkip,
} from './tutorial';

const at = (id: string) => TUTORIAL.findIndex((x) => x.id === id);
const onStep = (id: string, extra: Partial<GameState> = {}): GameState => ({
  ...newState(0),
  ...extra,
  tutorial: { step: at(id), p: 0, v: TUTORIAL_VERSION },
});
const done = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), ...extra, tutorial: { step: TUTORIAL_DONE, p: 0, v: TUTORIAL_VERSION } });

describe('tutorial de Clara', () => {
  it('una partida nueva empieza en el primer paso con casi todo cerrado', () => {
    const s = newState(0);
    expect(s.tutorial).toEqual({ step: 0, p: 0, v: TUTORIAL_VERSION });
    expect(s.tips).toEqual({});
    expect(currentStep(s)?.id).toBe('hola');
    for (const f of ['upgrades', 'games', 'decrees', 'missions', 'ranking', 'profile', 'cup', 'stocks', 'shops'] as const) {
      expect(isUnlocked(s, f)).toBe(false);
    }
  });

  it('los pasos tienen ids únicos y los que se pueden dejar para más tarde tienen evento', () => {
    expect(new Set(TUTORIAL.map((x) => x.id)).size).toBe(TUTORIAL.length);
    for (const step of TUTORIAL) {
      if (step.later) expect(step.event).not.toBeNull();
      if (step.event === null) expect(step.cta).toBeTruthy();
      for (const id of step.tips ?? []) expect(TIPS.some((t) => t.id === id)).toBe(true);
    }
  });

  it('las partidas guardadas antes del tutorial no lo ven', () => {
    const s = normalize({ coins: 500, buildings: { choza: 3 } }, 0);
    expect(tutorialDone(s)).toBe(true);
    expect(isUnlocked(s, 'ranking')).toBe(true);
    // Valores raros: se acotan sin romper la partida
    expect(normalize({ tutorial: { step: 99, p: -5, v: 2 } }, 0).tutorial).toEqual({ step: TUTORIAL_DONE, p: 0, v: TUTORIAL_VERSION });
    expect(normalize({ tutorial: { step: 2.7, p: 4, skip: 'x', v: 2 } }, 0).tutorial).toEqual({ step: 2, p: 4, v: TUTORIAL_VERSION });
    expect(normalize({ tutorial: 'roto' }, 0).tutorial.step).toBe(TUTORIAL_DONE);
  });

  it('las partidas de la primera versión (9 pasos) se traducen por id', () => {
    // Terminado en la v1 (paso 9): sigue terminado aunque ahora haya más pasos
    expect(normalize({ tutorial: { step: 9, p: 0 } }, 0).tutorial).toEqual({ step: TUTORIAL_DONE, p: 0, v: TUTORIAL_VERSION });
    // A medias: el mismo paso, con su progreso
    expect(normalize({ tutorial: { step: 1, p: 7 } }, 0).tutorial).toEqual({ step: at('tap'), p: 7, v: TUTORIAL_VERSION });
    expect(normalize({ tutorial: { step: 7, p: 0 } }, 0).tutorial.step).toBe(at('missions'));
    expect(normalize({ tutorial: { step: 8, p: 0 } }, 0).tutorial.step).toBe(at('fin'));
    // Saltado en la v1: se traduce también dónde se saltó (para el embudo)
    expect(normalize({ tutorial: { step: 9, p: 0, skip: 3 } }, 0).tutorial).toEqual({
      step: TUTORIAL_DONE,
      p: 0,
      v: TUTORIAL_VERSION,
      skip: at('upgrade'),
    });
    // Ya traducida, no se vuelve a traducir al guardar y cargar
    const s = normalize({ tutorial: { step: 7, p: 0 } }, 0);
    expect(normalize(JSON.parse(JSON.stringify(s)), 0).tutorial).toEqual(s.tutorial);
  });

  it('los pasos de botón avanzan con tutorialNext y los de evento no', () => {
    const s = tutorialNext(newState(0));
    expect(currentStep(s)?.id).toBe('tap');
    expect(tutorialNext(s)).toBe(s);
    // Un paso de evento sin "más tarde" no se puede dejar
    expect(tutorialLater(s)).toBe(s);
  });

  it('los eventos del juego (vía bump) hacen avanzar el paso y dan su premio', () => {
    let s = onStep('tap');
    for (let i = 0; i < 14; i++) s = bump(s, 'tap');
    expect(s.tutorial).toEqual({ step: at('tap'), p: 14, v: TUTORIAL_VERSION });
    // Un evento que no es del paso no cuenta
    expect(bump(s, 'build')).toBe(s);
    s = bump(s, 'tap');
    expect(currentStep(s)?.id).toBe('build');
    expect(s.coins).toBe(100);
    expect(s.totalEarned).toBe(100);
    expect(s.allTimeEarned).toBe(100);
    // Comprar varios edificios de golpe cuenta todos
    s = bump(s, 'build', 10);
    expect(currentStep(s)?.id).toBe('upgrade');
    expect(s.coins).toBe(250);
    expect(s.tips.basics).toBe(1);
    expect(isUnlocked(s, 'upgrades')).toBe(true);
    expect(isUnlocked(s, 'decrees')).toBe(false);
  });

  it('se abre todo en orden y al final se cobra el premio grande', () => {
    let s = onStep('upgrade');
    s = bump(s, 'upgrade');
    expect(isUnlocked(s, 'decrees')).toBe(true);
    expect(isUnlocked(s, 'games')).toBe(false);
    s = bump(s, 'decree');
    expect(isUnlocked(s, 'games')).toBe(true);
    const tickets = s.tickets;
    s = bump(s, 'wheel');
    expect(s.tickets).toBe(tickets + 1);
    s = bump(s, 'arcade');
    expect(s.tips.games).toBe(1);
    // Cualquiera de los tres retos diarios vale
    expect(currentStep(s)?.id).toBe('daily');
    s = bump(s, 'puzzle');
    expect(currentStep(s)?.id).toBe('council');
    expect(isUnlocked(s, 'shops')).toBe(true);
    expect(isUnlocked(s, 'missions')).toBe(false);
    s = tutorialProgress(s, 'advisor', 1);
    expect(isUnlocked(s, 'missions')).toBe(true);
    s = tutorialProgress(s, 'mission', 1);
    expect(isUnlocked(s, 'profile')).toBe(true);
    expect(isUnlocked(s, 'ranking')).toBe(false);
    s = tutorialProgress(s, 'name', 1);
    expect(currentStep(s)?.id).toBe('fin');
    expect(isUnlocked(s, 'ranking')).toBe(true);
    const gems = s.gems;
    s = tutorialNext(s);
    expect(tutorialDone(s)).toBe(true);
    expect(s.gems).toBe(gems + 10);
    expect(stepsCompleted(s.tutorial)).toBe(TUTORIAL_DONE);
    for (const id of ['council', 'missions', 'daily', 'decree', 'upgrades']) expect(s.tips[id]).toBe(1);
    // Terminado, ya nada lo mueve
    expect(tutorialProgress(s, 'tap', 1)).toBe(s);
    expect(tutorialNext(s)).toBe(s);
    expect(tutorialLater(s)).toBe(s);
  });

  it('el sobre, la misión y el nombre avanzan el tutorial desde el store', () => {
    const st = useGame.getState();
    st.init(onStep('council'));
    expect(useGame.getState().openAdvisorPack()).not.toBeNull();
    expect(currentStep(useGame.getState().s)?.id).toBe('missions');

    // Una misión diaria cumplida (el primer grupo siempre es de la ciudad)
    const s = useGame.getState().s;
    const slot = s.missions.daily[0];
    useGame.setState({ s: { ...s, missions: { ...s.missions, daily: [{ ...slot, p: 1e9 }, ...s.missions.daily.slice(1)] } } });
    const gems = useGame.getState().s.gems;
    expect(useGame.getState().claimMission('daily', 0)).not.toBeNull();
    expect(currentStep(useGame.getState().s)?.id).toBe('name');
    expect(useGame.getState().s.gems).toBeGreaterThan(gems);

    expect(useGame.getState().setName('Alcaldesa Ana')).toBeNull();
    expect(currentStep(useGame.getState().s)?.id).toBe('fin');
  });

  it('"más tarde" pasa al siguiente paso sin premio y queda apuntado', () => {
    const s = onStep('daily');
    const later = tutorialLater(s);
    expect(currentStep(later)?.id).toBe('council');
    expect(later.gems).toBe(s.gems);
    expect(later.tutorial.later).toEqual(['daily']);
    // El consejo que explica el paso no se da por visto: saldrá en su sitio
    expect(later.tips.daily).toBeUndefined();
    // El consejo no se puede dejar: hay que abrir el sobre de regalo
    expect(tutorialLater(later)).toBe(later);
    expect(normalize(JSON.parse(JSON.stringify(later)), 0).tutorial.later).toEqual(['daily']);
  });

  it('saltarlo abre todo, sin premios, y recuerda dónde se saltó', () => {
    const s = onStep('build');
    const skipped = tutorialSkip(s);
    expect(tutorialDone(skipped)).toBe(true);
    expect(isUnlocked(skipped, 'shops')).toBe(true);
    expect(skipped.gems).toBe(s.gems);
    expect(skipped.tutorial.skip).toBe(at('build'));
    expect(stepsCompleted(skipped.tutorial)).toBe(at('build'));
    expect(tutorialSkip(skipped)).toBe(skipped);
    // Se conserva al guardar y cargar
    expect(normalize(JSON.parse(JSON.stringify(skipped)), 0).tutorial).toEqual(skipped.tutorial);
  });

  it('el repaso no da premios, no cierra nada y no cambia el embudo', () => {
    const skipped = tutorialSkip(onStep('wheel'));
    const mid = onStep('wheel');
    expect(tutorialReplay(mid)).toBe(mid);
    let s = tutorialReplay(skipped);
    expect(currentStep(s)?.id).toBe('hola');
    expect(s.tutorial.replay).toBe(true);
    for (const f of ['upgrades', 'games', 'ranking', 'profile', 'cup', 'shops'] as const) expect(isUnlocked(s, f)).toBe(true);
    expect(stepsCompleted(s.tutorial)).toBe(at('wheel'));
    s = tutorialNext(s);
    for (let i = 0; i < 15; i++) s = bump(s, 'tap');
    expect(currentStep(s)?.id).toBe('build');
    expect(s.coins).toBe(skipped.coins);
    // Cualquier paso con evento se puede pasar (el sobre de regalo, por ejemplo, ya se abrió)
    s = tutorialLater(s);
    expect(currentStep(s)?.id).toBe('upgrade');
    expect(s.tutorial.later).toBeUndefined();
    // Terminarlo antes de tiempo no toca dónde se saltó la primera vez
    const ended = tutorialSkip(s);
    expect(tutorialDone(ended)).toBe(true);
    expect(ended.tutorial.replay).toBeUndefined();
    expect(ended.tutorial.skip).toBe(at('wheel'));
    // Y al recorrerlo entero tampoco
    let full = tutorialReplay(done());
    while (!tutorialDone(full)) full = currentStep(full)!.event ? tutorialLater(full) : tutorialNext(full);
    expect(full.gems).toBe(done().gems);
    expect(full.tutorial.replay).toBeUndefined();
    expect(stepsCompleted(full.tutorial)).toBe(TUTORIAL_DONE);
  });

  it('el embudo del panel solo cuenta partidas nuevas y no confunde saltar con completar', () => {
    const p = (uid: string, s: GameState): Player => ({ uid, name: uid, savedAt: null, s });
    const fresh = { createdAt: TUTORIAL_SINCE + 1000 };
    const players = [
      p('vieja', done()),
      p('nueva', { ...onStep('build'), ...fresh }),
      p('lista', done(fresh)),
      p('salto', { ...done(fresh), tutorial: { step: TUTORIAL_DONE, p: 0, v: TUTORIAL_VERSION, skip: 1 } }),
      p('tarde', { ...onStep('council', fresh), tips: { daily: 0, council: 1 }, tutorial: { step: at('council'), p: 0, v: TUTORIAL_VERSION, later: ['daily'] } }),
    ];
    const f = tutorialFunnel(players);
    expect(f.players).toBe(4);
    expect(f.skipped).toBe(1);
    expect(f.funnel[0].value).toBe(4);
    expect(f.funnel[1].value).toBe(3);
    expect(f.funnel[2].value).toBe(2);
    expect(f.funnel[TUTORIAL_DONE - 1].value).toBe(1);
    expect(f.later).toEqual([{ label: 'Reto diario', value: 1 }]);
    expect(f.tips.find((b) => b.label.endsWith('El consejo'))?.value).toBe(1);
  });
});

describe('consejos de Clara', () => {
  it('cada consejo tiene un id único y texto', () => {
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
    for (const t of TIPS) expect(t.text.length).toBeGreaterThan(40);
  });

  it('se guardan al cargar; las partidas que ya conocían el juego solo ven el de la cuenta', () => {
    const s = seeTip(done(), 'cup');
    expect(s.tips).toEqual({ cup: 1 });
    expect(seeTip(s, 'cup')).toBe(s);
    expect(seeTip(s, 'no-existe')).toBe(s);
    expect(normalize(JSON.parse(JSON.stringify(s)), 0).tips).toEqual({ cup: 1 });
    // Ids desconocidos fuera
    expect(normalize({ tips: { cup: 1, raro: 1 } }, 0).tips).toEqual({ cup: 1 });
    // Sin campo y con el tutorial terminado: todo visto menos la cuenta
    const old = normalize({ coins: 5 }, 0).tips;
    expect(old.google).toBeUndefined();
    expect(Object.keys(old).length).toBe(TIPS.length - 1);
    // Sin campo y a medias del tutorial: nada visto
    expect(tipsState(undefined, { step: 2, p: 0 })).toEqual({});
  });

  it('las burbujas no salen durante el tutorial y van por orden de urgencia', () => {
    const ctx = { incident: true, guest: true };
    expect(bubbleTip(onStep('tap', { buildings: { choza: 12 } }), ctx)).toBeNull();
    let s = done({ buildings: { choza: 12 } });
    expect(bubbleTip(s, ctx)).toBe('incident');
    s = seeTip(s, 'incident');
    expect(bubbleTip(s, ctx)).toBe('milestone');
    s = seeTip(s, 'milestone');
    // Sin estrellas ni progreso aún no hay nada que perder: no se insiste con la cuenta
    expect(bubbleTip(s, ctx)).toBeNull();
    s = { ...s, allTimeEarned: 1e12 };
    expect(bubbleTip(s, ctx)).toBe('star');
    s = seeTip(s, 'star');
    expect(bubbleTip(s, ctx)).toBe('google');
    expect(bubbleTip(s, { incident: false, guest: false })).toBeNull();
  });

  it('el store solo enseña una burbuja a la vez y la quita al verla', () => {
    useGame.getState().init(onStep('tap'));
    useGame.getState().showTip('balloon');
    expect(useGame.getState().tip).toBeNull();
    useGame.getState().init(done());
    useGame.getState().showTip('balloon');
    useGame.getState().showTip('star');
    expect(useGame.getState().tip).toBe('balloon');
    useGame.getState().seeTip('balloon');
    expect(useGame.getState().tip).toBeNull();
    expect(useGame.getState().s.tips.balloon).toBe(1);
    useGame.getState().showTip('balloon');
    expect(useGame.getState().tip).toBeNull();
  });

  it('la guía no destripa lo que aún no ha llegado', () => {
    const law = TIPS.find((t) => t.id === 'law')!;
    const cup = TIPS.find((t) => t.id === 'cup')!;
    expect(tipAvailable(done(), law)).toBe(false);
    expect(tipAvailable(done({ era: 2 }), law)).toBe(true);
    expect(tipAvailable(onStep('tap'), cup)).toBe(false);
    expect(tipAvailable(done(), cup)).toBe(true);
  });
});
