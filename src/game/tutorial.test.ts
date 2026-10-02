import { describe, expect, it } from 'vitest';
import { tutorialFunnel, type Player } from '../admin/metrics';
import { bump } from './missions';
import { newState, normalize, type GameState } from './state';
import {
  TUTORIAL,
  TUTORIAL_DONE,
  TUTORIAL_SINCE,
  currentStep,
  isUnlocked,
  stepsCompleted,
  tutorialDone,
  tutorialNext,
  tutorialProgress,
  tutorialSkip,
} from './tutorial';

const at = (id: string) => TUTORIAL.findIndex((x) => x.id === id);
const onStep = (id: string, extra: Partial<GameState> = {}): GameState => ({ ...newState(0), ...extra, tutorial: { step: at(id), p: 0 } });

describe('tutorial de Clara', () => {
  it('una partida nueva empieza en el primer paso con casi todo cerrado', () => {
    const s = newState(0);
    expect(s.tutorial).toEqual({ step: 0, p: 0 });
    expect(currentStep(s)?.id).toBe('hola');
    for (const f of ['upgrades', 'games', 'decrees', 'missions', 'ranking', 'profile', 'cup', 'stocks', 'shops'] as const) {
      expect(isUnlocked(s, f)).toBe(false);
    }
  });

  it('las partidas guardadas antes del tutorial no lo ven', () => {
    const s = normalize({ coins: 500, buildings: { choza: 3 } }, 0);
    expect(tutorialDone(s)).toBe(true);
    expect(isUnlocked(s, 'ranking')).toBe(true);
    // Valores raros: se acotan sin romper la partida
    expect(normalize({ tutorial: { step: 99, p: -5 } }, 0).tutorial).toEqual({ step: TUTORIAL_DONE, p: 0 });
    expect(normalize({ tutorial: { step: 2.7, p: 4, skip: 'x' } }, 0).tutorial).toEqual({ step: 2, p: 4 });
    expect(normalize({ tutorial: 'roto' }, 0).tutorial.step).toBe(TUTORIAL_DONE);
  });

  it('los pasos de botón avanzan con tutorialNext y los de evento no', () => {
    const s = tutorialNext(newState(0));
    expect(currentStep(s)?.id).toBe('tap');
    expect(tutorialNext(s)).toBe(s);
  });

  it('los eventos del juego (vía bump) hacen avanzar el paso y dan su premio', () => {
    let s = onStep('tap');
    for (let i = 0; i < 14; i++) s = bump(s, 'tap');
    expect(s.tutorial).toEqual({ step: at('tap'), p: 14 });
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
    expect(isUnlocked(s, 'missions')).toBe(true);
    expect(isUnlocked(s, 'ranking')).toBe(false);
    s = tutorialNext(s);
    expect(currentStep(s)?.id).toBe('fin');
    expect(isUnlocked(s, 'ranking')).toBe(true);
    const gems = s.gems;
    s = tutorialNext(s);
    expect(tutorialDone(s)).toBe(true);
    expect(s.gems).toBe(gems + 10);
    expect(stepsCompleted(s.tutorial)).toBe(TUTORIAL_DONE);
    // Terminado, ya nada lo mueve
    expect(tutorialProgress(s, 'tap', 1)).toBe(s);
    expect(tutorialNext(s)).toBe(s);
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

  it('el embudo del panel solo cuenta partidas nuevas y no confunde saltar con completar', () => {
    const p = (uid: string, s: GameState): Player => ({ uid, name: uid, savedAt: null, s });
    const fresh = { createdAt: TUTORIAL_SINCE + 1000 };
    const players = [
      p('vieja', { ...newState(0), tutorial: { step: TUTORIAL_DONE, p: 0 } }),
      p('nueva', { ...onStep('build'), ...fresh }),
      p('lista', { ...newState(0), ...fresh, tutorial: { step: TUTORIAL_DONE, p: 0 } }),
      p('salto', { ...newState(0), ...fresh, tutorial: { step: TUTORIAL_DONE, p: 0, skip: 1 } }),
    ];
    const f = tutorialFunnel(players);
    expect(f.players).toBe(3);
    expect(f.skipped).toBe(1);
    expect(f.funnel[0].value).toBe(3);
    expect(f.funnel[1].value).toBe(2);
    expect(f.funnel[2].value).toBe(1);
    expect(f.funnel[TUTORIAL_DONE - 1].value).toBe(1);
  });
});
