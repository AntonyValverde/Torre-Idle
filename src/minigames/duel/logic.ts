// "Duelo de generales": piedra, papel o tijera con ejércitos. La infantería gana a los arqueros, los
// arqueros a la caballería y la caballería a la infantería. Cada batalla son 5 rondas: los dos bandos
// tienen 5 unidades (a la vista del otro) y en cada ronda sacan una a la vez. Cada general rival tiene
// su manía, que se anuncia antes de empezar: leerla es la gracia. Ganar la batalla trae a otro general
// más listo; perder cuesta un estandarte y con tres perdidos se acaba la campaña. Desde la séptima
// batalla pueden salir alcaldes de verdad: juegan con el estilo que publicó su ciudad (qué unidades
// sacan más a menudo en sus duelos), sin que tengan que estar conectados.

export type Unit = 'inf' | 'arc' | 'cav';
export const UNITS: Unit[] = ['inf', 'arc', 'cav'];

export const UNIT_INFO: Record<Unit, { emoji: string; name: string; plural: string }> = {
  inf: { emoji: '🛡️', name: 'Infantería', plural: 'infantes' },
  arc: { emoji: '🏹', name: 'Arqueros', plural: 'arqueros' },
  cav: { emoji: '🐎', name: 'Caballería', plural: 'jinetes' },
};

/** A quién gana cada unidad. */
export const BEATS: Record<Unit, Unit> = { inf: 'arc', arc: 'cav', cav: 'inf' };
/** Quién gana a cada unidad. */
export const COUNTER: Record<Unit, Unit> = { inf: 'cav', arc: 'inf', cav: 'arc' };

export const HAND = 5;
export const ROUNDS = 5;
export const BANNERS = 3;
export const ROUND_POINTS = 1;

export type Hand = Record<Unit, number>;

export type Personality = 'bravo' | 'muro' | 'arquera' | 'zorro' | 'espejo' | 'calculo' | 'rival';

/** Estilo de un general: qué parte de las veces saca cada unidad (suma 1). */
export type Style = Record<Unit, number>;

/** Un alcalde de verdad contra el que se puede batallar. */
export interface Rival {
  name: string;
  style: Style;
}

/** Unidades sacadas antes de publicar un estilo (con menos no dice nada del jugador). */
export const STYLE_MIN_PICKS = 10;
/** Probabilidad de que un veterano sea un alcalde de verdad (si hay alguno). */
export const RIVAL_CHANCE = 0.5;

/** Estilo público ("40-35-25": % de infantería, arqueros y caballería), o null si aún jugó poco. */
export function styleString(picks: Hand): string | null {
  const n = handSize(picks);
  if (n < STYLE_MIN_PICKS) return null;
  return UNITS.map((u) => Math.round((picks[u] / n) * 100)).join('-');
}

/** Lee un estilo publicado; null si no es válido. */
export function parseStyle(v: unknown): Style | null {
  if (typeof v !== 'string' || !/^[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}$/.test(v)) return null;
  const [inf, arc, cav] = v.split('-').map(Number);
  const n = inf + arc + cav;
  if (inf > 100 || arc > 100 || cav > 100 || n <= 0) return null;
  return { inf: inf / n, arc: arc / n, cav: cav / n };
}

/** Lo que más saca un estilo, para el aviso ("🐎 45 %"). */
export function styleTell(s: Style): string {
  return `Alcalde de verdad. Suele sacar: ${UNITS.map((u) => `${UNIT_INFO[u].emoji} ${Math.round(s[u] * 100)} %`).join(' · ')}`;
}

export const GENERALS: Record<Personality, { name: string; emoji: string; tell: string }> = {
  bravo: { name: 'General Bravo', emoji: '🤠', tell: 'Le encanta cargar con la caballería.' },
  muro: { name: 'Generala Muralla', emoji: '🧱', tell: 'Confía en su infantería por encima de todo.' },
  arquera: { name: 'Capitana Flecha', emoji: '🎯', tell: 'Siempre que puede, saca a sus arqueros.' },
  zorro: { name: 'El Zorro', emoji: '🦊', tell: 'Cree que repetirás y saca lo que gana a tu última unidad.' },
  espejo: { name: 'Generala Espejo', emoji: '🪞', tell: 'Suele copiar la unidad que acabas de usar.' },
  calculo: { name: 'Mariscal Ábaco', emoji: '🧮', tell: 'Cuenta tus tropas y juega lo que más le conviene.' },
  rival: { name: 'Alcalde', emoji: '🏙️', tell: 'Juega como un alcalde de verdad.' },
};

/** Orden de los primeros rivales; después se repiten al azar y con más mano izquierda. */
export const ORDER: Personality[] = ['bravo', 'muro', 'arquera', 'zorro', 'espejo', 'calculo'];

export type Outcome = 'win' | 'lose' | 'tie';

export function outcome(mine: Unit, theirs: Unit): Outcome {
  if (mine === theirs) return 'tie';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

export interface Round {
  mine: Unit;
  theirs: Unit;
  result: Outcome;
}

export interface DuelGame {
  battle: number;
  general: Personality;
  /** El alcalde de verdad de esta batalla (solo con general 'rival'). */
  rival: Rival | null;
  /** Alcaldes que pueden salir como veteranos (se cargan de la nube al empezar). */
  rivals: Rival[];
  mine: Hand;
  theirs: Hand;
  rounds: Round[];
  banners: number;
  score: number;
  battlesWon: number;
  roundsWon: number;
  /** null = jugando la batalla; si no, cómo acabó. */
  result: Outcome | null;
  over: boolean;
}

/** Mano al azar de 5 unidades con al menos una de cada tipo. */
export function randomHand(rand: () => number): Hand {
  const h: Hand = { inf: 1, arc: 1, cav: 1 };
  for (let k = 3; k < HAND; k++) h[UNITS[Math.floor(rand() * 3)]]++;
  return h;
}

export function handSize(h: Hand): number {
  return h.inf + h.arc + h.cav;
}

/** Después de los seis primeros, solo vuelven los más listos. */
const VETERANS: Personality[] = ['zorro', 'espejo', 'calculo'];

export function generalFor(battle: number, rand: () => number): Personality {
  return battle <= ORDER.length ? ORDER[battle - 1] : VETERANS[Math.floor(rand() * VETERANS.length)];
}

/** Puntos de ganar una batalla (más cuanto más avanzada). */
export function battlePoints(battle: number): number {
  return 3 + Math.min(battle, 10);
}

export function newBattle(
  battle: number,
  rand: () => number,
  rivals: Rival[] = [],
): Pick<DuelGame, 'battle' | 'general' | 'rival' | 'mine' | 'theirs' | 'rounds' | 'result'> {
  const veteran = battle > ORDER.length && rivals.length > 0 && rand() < RIVAL_CHANCE;
  const rival = veteran ? rivals[Math.floor(rand() * rivals.length)] : null;
  return { battle, general: rival ? 'rival' : generalFor(battle, rand), rival, mine: randomHand(rand), theirs: randomHand(rand), rounds: [], result: null };
}

export function newDuel(rand: () => number): DuelGame {
  return { ...newBattle(1, rand), rivals: [], banners: BANNERS, score: 0, battlesWon: 0, roundsWon: 0, over: false };
}

/** Nombre, cara y manía del general de la batalla actual. */
export function generalInfo(g: Pick<DuelGame, 'general' | 'rival'>): { name: string; emoji: string; tell: string } {
  if (g.general === 'rival' && g.rival) return { name: g.rival.name, emoji: GENERALS.rival.emoji, tell: styleTell(g.rival.style) };
  return GENERALS[g.general];
}

/**
 * Cuánto se fía el general de su manía. Los seis primeros la cumplen cada vez más; los veteranos
 * la disimulan cada vez mejor (se parecen más a sacar al azar y son más difíciles de leer).
 */
export function focus(battle: number): number {
  if (battle <= ORDER.length) return 2.5 + battle * 0.35;
  return Math.max(1.4, 4.6 - (battle - ORDER.length) * 0.3);
}

/** Pesos con los que el general rival elige cada unidad que le queda. */
export function weights(g: Pick<DuelGame, 'general' | 'rival' | 'mine' | 'theirs' | 'rounds' | 'battle'>): Record<Unit, number> {
  const w: Record<Unit, number> = { inf: 0, arc: 0, cav: 0 };
  const last = g.rounds.length ? g.rounds[g.rounds.length - 1].mine : null;
  const f = focus(g.battle);
  const left = handSize(g.mine);
  for (const u of UNITS) {
    if (g.theirs[u] <= 0) continue;
    let x = g.theirs[u];
    switch (g.general) {
      case 'bravo':
        if (u === 'cav') x *= f;
        break;
      case 'muro':
        if (u === 'inf') x *= f;
        break;
      case 'arquera':
        if (u === 'arc') x *= f;
        break;
      case 'zorro':
        if (last && u === COUNTER[last]) x *= f;
        break;
      case 'espejo':
        if (last && u === last) x *= f;
        break;
      case 'rival':
        // Saca cada unidad tanto más cuanto más la usa ese alcalde en sus duelos
        if (g.rival) x *= 1 + g.rival.style[u] * f * 1.5;
        break;
      case 'calculo': {
        // Valor esperado contra lo que te queda (como si sacaras al azar)
        let ev = 0;
        for (const v of UNITS) {
          const p = left ? g.mine[v] / left : 0;
          const o = outcome(u, v);
          ev += p * (o === 'win' ? 1 : o === 'lose' ? -1 : 0);
        }
        x *= Math.exp(ev * f * 0.8);
        break;
      }
    }
    w[u] = x;
  }
  return w;
}

export function enemyPick(g: DuelGame, rand: () => number): Unit {
  const w = weights(g);
  const total = w.inf + w.arc + w.cav;
  let r = rand() * total;
  for (const u of UNITS) {
    if (w[u] <= 0) continue;
    r -= w[u];
    if (r <= 0) return u;
  }
  return UNITS.find((u) => g.theirs[u] > 0) ?? 'inf';
}

export interface PlayResult {
  round: Round;
  /** Acaba de terminar la batalla. */
  ended: boolean;
}

/** Juega una ronda con la unidad elegida. null si no se puede (no te queda o la batalla acabó). */
export function play(g: DuelGame, mine: Unit, rand: () => number): PlayResult | null {
  if (g.over || g.result || g.mine[mine] <= 0) return null;
  const theirs = enemyPick(g, rand);
  const round: Round = { mine, theirs, result: outcome(mine, theirs) };
  g.mine = { ...g.mine, [mine]: g.mine[mine] - 1 };
  g.theirs = { ...g.theirs, [theirs]: g.theirs[theirs] - 1 };
  g.rounds = [...g.rounds, round];
  if (round.result === 'win') {
    g.score += ROUND_POINTS;
    g.roundsWon++;
  }
  const ended = g.rounds.length >= ROUNDS;
  if (ended) {
    const won = g.rounds.filter((r) => r.result === 'win').length;
    const lost = g.rounds.filter((r) => r.result === 'lose').length;
    g.result = won > lost ? 'win' : won < lost ? 'lose' : 'tie';
    if (g.result === 'win') {
      g.score += battlePoints(g.battle);
      g.battlesWon++;
    } else if (g.result === 'lose') {
      g.banners--;
      if (g.banners <= 0) g.over = true;
    }
  }
  return { round, ended };
}

/** Pasa a la siguiente batalla (tras ganar o empatar se cambia de general; tras perder, también). */
export function nextBattle(g: DuelGame, rand: () => number) {
  if (g.over || !g.result) return;
  Object.assign(g, newBattle(g.battle + 1, rand, g.rivals));
}

export function tally(g: Pick<DuelGame, 'rounds'>): { won: number; lost: number } {
  return { won: g.rounds.filter((r) => r.result === 'win').length, lost: g.rounds.filter((r) => r.result === 'lose').length };
}
