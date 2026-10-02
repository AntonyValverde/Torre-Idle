import type { MissionEvent } from './missions';
import type { GameState } from './state';

// Tutorial guiado por Clara, la consejera del alcalde. Cada paso se completa con un evento del juego
// (los mismos que cuentan para las misiones) o, si no tiene evento, con su botón. Las secciones del
// juego se van abriendo según avanza, para que un jugador nuevo no vea todo de golpe.

export type TutorialTab = 'city' | 'upgrades' | 'games';

export interface TutorialReward {
  coins?: number;
  gems?: number;
  tickets?: number;
}

export interface TutorialStep {
  id: string;
  /** Nombre corto (panel de administración). */
  label: string;
  /** Evento que hace avanzar el paso; null: se avanza con el botón. */
  event: MissionEvent | null;
  target: number;
  /** Pestaña donde se hace lo que pide el paso. */
  tab: TutorialTab;
  text: string;
  /** Texto del botón en los pasos sin evento. */
  cta?: string;
  /** Premio al completar el paso. */
  reward?: TutorialReward;
}

export const TUTORIAL: TutorialStep[] = [
  {
    id: 'hola',
    label: 'Bienvenida',
    event: null,
    target: 1,
    tab: 'city',
    text: '¡Hola, alcalde! Soy Clara, tu consejera. Esta aldea es tuya: vamos a convertirla en una ciudad infinita.',
    cta: '¡Vamos!',
  },
  {
    id: 'tap',
    label: 'Tocar',
    event: 'tap',
    target: 15,
    tab: 'city',
    text: 'Toca la ciudad para recaudar monedas. A veces sale un ¡CRÍTICO! que vale x10.',
    reward: { coins: 100 },
  },
  {
    id: 'build',
    label: 'Construir',
    event: 'build',
    target: 5,
    tab: 'city',
    text: 'Con monedas se construye. Compra 5 edificios en la lista de abajo: producen solos, aunque no toques.',
    reward: { coins: 150 },
  },
  {
    id: 'upgrade',
    label: 'Mejora',
    event: 'upgrade',
    target: 1,
    tab: 'upgrades',
    text: 'En ⬆️ Mejoras hay mejoras que duplican lo que ganas. Compra la primera.',
    reward: { gems: 2 },
  },
  {
    id: 'decree',
    label: 'Decreto',
    event: 'decree',
    target: 1,
    tab: 'city',
    text: 'El consejo de la ciudad te propondrá decretos de vez en cuando. Elige uno antes de que se acabe el tiempo.',
    reward: { gems: 2 },
  },
  {
    id: 'wheel',
    label: 'Rueda',
    event: 'wheel',
    target: 1,
    tab: 'games',
    text: 'En 🎮 Juegos hay retos diarios y minijuegos. Empieza con tu giro gratis en la Rueda de la fortuna.',
    reward: { tickets: 1 },
  },
  {
    id: 'arcade',
    label: 'Arcade',
    event: 'arcade',
    target: 1,
    tab: 'games',
    text: 'Los arcade cuestan un 🎟️ ticket, y los tickets se recargan solos. Juega una partida al que quieras.',
    reward: { gems: 3 },
  },
  {
    id: 'missions',
    label: 'Misiones',
    event: null,
    target: 1,
    tab: 'city',
    text: 'Cada día tienes 3 misiones nuevas, arriba en Ciudad. Complétalas para ganar gemas, tickets y abrir el cofre del día.',
    cta: 'Entendido',
  },
  {
    id: 'fin',
    label: 'Final',
    event: null,
    target: 1,
    tab: 'city',
    text: '¡Ya eres un alcalde de verdad! Ahora tienes también 🏆 Ranking, 🏅 Logros y la Copa de Alcaldes. Cuando ganes mucho, en ⬆️ Mejoras → Legado podrás refundar la ciudad en una era nueva.',
    cta: '¡A construir!',
    reward: { gems: 10, tickets: 2 },
  },
];

/** Paso que indica que el tutorial terminó (o se saltó). */
export const TUTORIAL_DONE = TUTORIAL.length;

/** Desde cuándo existe el tutorial: las partidas anteriores no lo vieron (para el embudo del panel). */
export const TUTORIAL_SINCE = Date.UTC(2026, 9, 2, 6);

export interface TutorialState {
  step: number;
  /** Progreso del paso actual (no pasa del objetivo). */
  p: number;
  /** Paso en el que se saltó el tutorial (para el embudo del panel). */
  skip?: number;
}

export function newTutorial(): TutorialState {
  return { step: 0, p: 0 };
}

/** Las partidas guardadas antes de que existiera el tutorial no lo ven. */
export function tutorialState(v: unknown): TutorialState {
  if (!v || typeof v !== 'object') return { step: TUTORIAL_DONE, p: 0 };
  const r = v as Partial<TutorialState>;
  const step = typeof r.step === 'number' && Number.isFinite(r.step) ? Math.max(0, Math.min(TUTORIAL_DONE, Math.floor(r.step))) : TUTORIAL_DONE;
  const p = typeof r.p === 'number' && Number.isFinite(r.p) ? Math.max(0, r.p) : 0;
  const skip = typeof r.skip === 'number' && Number.isFinite(r.skip) ? Math.max(0, Math.min(TUTORIAL_DONE, Math.floor(r.skip))) : undefined;
  return skip === undefined ? { step, p } : { step, p, skip };
}

/** Pasos que llegó a completar jugando (sin contar los que se saltó). */
export function stepsCompleted(t: TutorialState): number {
  return t.skip ?? t.step;
}

export function tutorialDone(s: GameState): boolean {
  return s.tutorial.step >= TUTORIAL_DONE;
}

export function currentStep(s: GameState): TutorialStep | null {
  return TUTORIAL[s.tutorial.step] ?? null;
}

function stepIndex(id: string): number {
  return TUTORIAL.findIndex((x) => x.id === id);
}

/** Secciones que se abren con el tutorial. */
export type Feature = 'upgrades' | 'games' | 'decrees' | 'missions' | 'ranking' | 'profile' | 'cup' | 'stocks' | 'shops';

const UNLOCK_AT: Record<Feature, string> = {
  upgrades: 'upgrade',
  decrees: 'decree',
  games: 'wheel',
  missions: 'missions',
  ranking: 'fin',
  profile: 'fin',
  cup: 'fin',
  stocks: 'fin',
  shops: 'fin',
};

export function isUnlocked(s: GameState, f: Feature): boolean {
  return s.tutorial.step >= stepIndex(UNLOCK_AT[f]);
}

function applyReward(s: GameState, r: TutorialReward | undefined): GameState {
  if (!r) return s;
  const coins = r.coins ?? 0;
  return {
    ...s,
    coins: s.coins + coins,
    totalEarned: s.totalEarned + coins,
    allTimeEarned: s.allTimeEarned + coins,
    gems: s.gems + (r.gems ?? 0),
    tickets: s.tickets + (r.tickets ?? 0),
  };
}

/** Pasa al siguiente paso cobrando el premio del actual. */
function completeStep(s: GameState): GameState {
  const step = TUTORIAL[s.tutorial.step];
  if (!step) return s;
  return { ...applyReward(s, step.reward), tutorial: { step: s.tutorial.step + 1, p: 0 } };
}

/** Suma progreso al paso actual si cuenta ese evento; al llegar al objetivo, pasa al siguiente. */
export function tutorialProgress(s: GameState, ev: MissionEvent, n: number): GameState {
  const step = TUTORIAL[s.tutorial.step];
  if (!step || step.event !== ev) return s;
  const p = Math.min(step.target, s.tutorial.p + n);
  if (p >= step.target) return completeStep(s);
  return p === s.tutorial.p ? s : { ...s, tutorial: { ...s.tutorial, p } };
}

/** Avanza un paso sin evento (los que se completan con su botón). */
export function tutorialNext(s: GameState): GameState {
  const step = TUTORIAL[s.tutorial.step];
  return step && step.event === null ? completeStep(s) : s;
}

export function tutorialSkip(s: GameState): GameState {
  return tutorialDone(s) ? s : { ...s, tutorial: { step: TUTORIAL_DONE, p: 0, skip: s.tutorial.step } };
}

export function rewardText(r: TutorialReward | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.coins) parts.push(`+${r.coins} 🪙`);
  if (r.gems) parts.push(`+${r.gems} 💎`);
  if (r.tickets) parts.push(`+${r.tickets} 🎟️`);
  return parts.join(' · ');
}
