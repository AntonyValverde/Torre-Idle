import type { MissionEvent } from './missions';
import type { GameState } from './state';

// Tutorial guiado por Clara, la consejera del alcalde. Cada paso se completa con un evento del juego
// (los mismos que cuentan para las misiones, más unos pocos propios) o, si no tiene evento, con su botón.
// Las secciones del juego se van abriendo según avanza, para que un jugador nuevo no vea todo de golpe.
// Lo que no cabe aquí lo cuentan los consejos de Clara (tips.ts) la primera vez que aparece.

export type TutorialTab = 'city' | 'upgrades' | 'games' | 'ranking' | 'profile';

/** Eventos que hacen avanzar un paso: los de las misiones y los propios del tutorial. */
export type TutorialEvent = MissionEvent | 'advisor' | 'mission' | 'name';

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
  event: TutorialEvent | null;
  target: number;
  /** Pestaña donde se hace lo que pide el paso. */
  tab: TutorialTab;
  text: string;
  /** Texto del botón en los pasos sin evento. */
  cta?: string;
  /** Pasos con evento que se pueden dejar para más tarde (sin premio): texto de ese botón. */
  later?: string;
  /** Premio al completar el paso. */
  reward?: TutorialReward;
  /** Consejos de Clara que este paso ya explica: al completarlo no vuelven a salir. */
  tips?: string[];
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
    tips: ['basics'],
  },
  {
    id: 'upgrade',
    label: 'Mejora',
    event: 'upgrade',
    target: 1,
    tab: 'upgrades',
    text: 'En ⬆️ Mejoras hay mejoras que multiplican lo que ganas. Compra la primera.',
    reward: { gems: 2 },
    tips: ['upgrades'],
  },
  {
    id: 'decree',
    label: 'Decreto',
    event: 'decree',
    target: 1,
    tab: 'city',
    text: 'El consejo de la ciudad te propondrá decretos de vez en cuando. Elige uno antes de que se acabe el tiempo.',
    reward: { gems: 2 },
    tips: ['decree'],
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
    tips: ['games'],
  },
  {
    id: 'daily',
    label: 'Reto diario',
    event: 'puzzle',
    target: 1,
    tab: 'games',
    text: 'Arriba, en Diarios, hay tres retos gratis: uno de cada al día, el mismo para todos. Dan gemas y racha. Completa uno.',
    later: 'Más tarde',
    reward: { gems: 2 },
    tips: ['daily'],
  },
  {
    id: 'council',
    label: 'Consejo',
    event: 'advisor',
    target: 1,
    tab: 'upgrades',
    text: 'Tu ciudad necesita consejeros. En ⬆️ Mejoras → 🧑‍💼 Consejo te espera un sobre de regalo: ábrelo para conocer a tu primer consejero. Solo ayudan los que se sientan en el consejo.',
    tips: ['council'],
  },
  {
    id: 'missions',
    label: 'Misiones',
    event: 'mission',
    target: 1,
    tab: 'city',
    text: 'Cada día tienes 3 misiones nuevas, arriba en Ciudad. Cobra una que ya esté cumplida: dan gemas, tickets y puntos de liga.',
    later: 'Más tarde',
    reward: { gems: 2 },
    tips: ['missions'],
  },
  {
    id: 'name',
    label: 'Nombre',
    event: 'name',
    target: 1,
    tab: 'profile',
    text: 'Los demás alcaldes verán tu nombre en los rankings. En 👤 Perfil puedes cambiarlo por el que quieras.',
    later: 'Me quedo con este',
    reward: { gems: 3 },
  },
  {
    id: 'fin',
    label: 'Final',
    event: null,
    target: 1,
    tab: 'city',
    text: '¡Ya eres un alcalde de verdad! Se abre todo: 🏆 Ranking, 🏅 Logros, la Copa, el Mundo y más. La primera vez que veas cada cosa te la explicaré, y en 👤 Perfil → 📖 Guía de Clara puedes repasarlo todo.',
    cta: '¡A construir!',
    reward: { gems: 10, tickets: 2 },
  },
];

/** Paso que indica que el tutorial terminó (o se saltó). */
export const TUTORIAL_DONE = TUTORIAL.length;

/** Versión de la lista de pasos: el paso se guarda como posición, así que al cambiar la lista hay que traducirlo. */
export const TUTORIAL_VERSION = 2;

/** Pasos de la primera versión (partidas guardadas sin `v`), para traducir su posición a la lista actual. */
const V1_STEPS = ['hola', 'tap', 'build', 'upgrade', 'decree', 'wheel', 'arcade', 'missions', 'fin'];

/** Desde cuándo existe el tutorial: las partidas anteriores no lo vieron (para el embudo del panel). */
export const TUTORIAL_SINCE = Date.UTC(2026, 9, 2, 6);

export interface TutorialState {
  step: number;
  /** Progreso del paso actual (no pasa del objetivo). */
  p: number;
  /** Versión de la lista de pasos con la que se guardó (sin ella: la primera). */
  v?: number;
  /** Paso en el que se saltó el tutorial (para el embudo del panel). */
  skip?: number;
  /** Pasos que dejó para más tarde (para el panel). */
  later?: string[];
  /** Repaso desde la Guía de Clara: sin premios y con todo abierto. */
  replay?: boolean;
}

export function newTutorial(): TutorialState {
  return { step: 0, p: 0, v: TUTORIAL_VERSION };
}

function stepIndex(id: string): number {
  return TUTORIAL.findIndex((x) => x.id === id);
}

/** Las partidas guardadas antes de que existiera el tutorial no lo ven; las de la versión 1 se traducen. */
export function tutorialState(v: unknown): TutorialState {
  if (!v || typeof v !== 'object') return { step: TUTORIAL_DONE, p: 0, v: TUTORIAL_VERSION };
  const r = v as Partial<TutorialState>;
  const v1 = r.v === undefined;
  const index = (x: unknown): number | undefined => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    const n = Math.max(0, Math.floor(x));
    if (!v1) return Math.min(TUTORIAL_DONE, n);
    return n >= V1_STEPS.length ? TUTORIAL_DONE : stepIndex(V1_STEPS[n]);
  };
  const step = index(r.step) ?? TUTORIAL_DONE;
  const p = typeof r.p === 'number' && Number.isFinite(r.p) ? Math.max(0, r.p) : 0;
  const skip = index(r.skip);
  const ids = new Set(TUTORIAL.map((x) => x.id));
  const later = Array.isArray(r.later) ? [...new Set(r.later.filter((x): x is string => typeof x === 'string' && ids.has(x)))] : [];
  const out: TutorialState = { step, p, v: TUTORIAL_VERSION };
  if (skip !== undefined) out.skip = skip;
  if (later.length) out.later = later;
  if (r.replay === true && step < TUTORIAL_DONE) out.replay = true;
  return out;
}

/** Pasos que llegó a completar jugando (sin contar los que se saltó). El repaso no cuenta. */
export function stepsCompleted(t: TutorialState): number {
  return t.skip ?? (t.replay ? TUTORIAL_DONE : t.step);
}

export function tutorialDone(s: GameState): boolean {
  return s.tutorial.step >= TUTORIAL_DONE;
}

export function currentStep(s: GameState): TutorialStep | null {
  return TUTORIAL[s.tutorial.step] ?? null;
}

/** Secciones que se abren con el tutorial. */
export type Feature = 'upgrades' | 'games' | 'decrees' | 'missions' | 'ranking' | 'profile' | 'cup' | 'stocks' | 'shops';

const UNLOCK_AT: Record<Feature, string> = {
  upgrades: 'upgrade',
  decrees: 'decree',
  games: 'wheel',
  shops: 'council',
  missions: 'missions',
  profile: 'name',
  ranking: 'fin',
  cup: 'fin',
  stocks: 'fin',
};

export function isUnlocked(s: GameState, f: Feature): boolean {
  return !!s.tutorial.replay || s.tutorial.step >= stepIndex(UNLOCK_AT[f]);
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

/** Pasa al siguiente paso: cobra el premio del actual (salvo en el repaso o si se dejó para más tarde). */
function advance(s: GameState, paid: boolean): GameState {
  const step = TUTORIAL[s.tutorial.step];
  if (!step) return s;
  const t = s.tutorial;
  const next = t.step + 1;
  const tutorial: TutorialState = { ...t, step: next, p: 0 };
  if (next >= TUTORIAL_DONE) delete tutorial.replay;
  if (!paid && !t.replay) tutorial.later = [...(t.later ?? []), step.id];
  // Lo que se deja para más tarde no se da por explicado: su consejo saldrá en su sitio
  const tips = paid && step.tips?.length ? { ...s.tips, ...Object.fromEntries(step.tips.map((id) => [id, 1])) } : s.tips;
  return { ...(paid && !t.replay ? applyReward(s, step.reward) : s), tutorial, tips };
}

/** Suma progreso al paso actual si cuenta ese evento; al llegar al objetivo, pasa al siguiente. */
export function tutorialProgress(s: GameState, ev: TutorialEvent, n: number): GameState {
  const step = TUTORIAL[s.tutorial.step];
  if (!step || step.event !== ev) return s;
  const p = Math.min(step.target, s.tutorial.p + n);
  if (p >= step.target) return advance(s, true);
  return p === s.tutorial.p ? s : { ...s, tutorial: { ...s.tutorial, p } };
}

/** Avanza un paso sin evento (los que se completan con su botón). */
export function tutorialNext(s: GameState): GameState {
  const step = TUTORIAL[s.tutorial.step];
  return step && step.event === null ? advance(s, true) : s;
}

/** Deja el paso actual para más tarde, sin premio. En el repaso vale para cualquier paso con evento. */
export function tutorialLater(s: GameState): GameState {
  const step = TUTORIAL[s.tutorial.step];
  return step && step.event !== null && (step.later || s.tutorial.replay) ? advance(s, false) : s;
}

export function tutorialSkip(s: GameState): GameState {
  if (tutorialDone(s)) return s;
  const t = s.tutorial;
  // En el repaso no se toca dónde se saltó la primera vez
  const tutorial: TutorialState = t.replay ? { ...t, step: TUTORIAL_DONE, p: 0 } : { ...t, step: TUTORIAL_DONE, p: 0, skip: t.step };
  delete tutorial.replay;
  return { ...s, tutorial };
}

/** Vuelve a empezar el tutorial como repaso: sin premios y sin cerrar nada de lo que ya estaba abierto. */
export function tutorialReplay(s: GameState): GameState {
  return tutorialDone(s) ? { ...s, tutorial: { ...s.tutorial, step: 0, p: 0, replay: true } } : s;
}

export function rewardText(r: TutorialReward | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.coins) parts.push(`+${r.coins} 🪙`);
  if (r.gems) parts.push(`+${r.gems} 💎`);
  if (r.tickets) parts.push(`+${r.tickets} 🎟️`);
  return parts.join(' · ');
}
