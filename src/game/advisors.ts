import type { GameState } from './state';

// Consejeros coleccionables. Salen en sobres (cofre del día, misiones semanales o gemas); las copias
// repetidas los suben de nivel sin límite. Solo dan su ventaja los que se sientan en el consejo, que
// tiene pocas sillas: elegir a quién sentar es la decisión.

export type Rarity = 'comun' | 'rara' | 'epica';

/** Claves de efecto compartidas con las leyes de era (ver economy.ts). */
export type AdvisorKey = 'prod' | 'tap' | 'crit' | 'offlineEff' | 'offlineHours' | 'arcadeCoins' | 'ticketRegen' | 'events' | 'recruits';

export type AdvisorEffect =
  /** Producción de unos edificios: x(1 + per·nivel). */
  | { type: 'buildings'; ids: string[]; per: number }
  /** Multiplicador: x(1 + per·nivel). */
  | { type: 'mult'; key: AdvisorKey; per: number }
  /** Divisor (tiempos de espera): ÷(1 + per·nivel). */
  | { type: 'div'; key: AdvisorKey; per: number }
  /** Sumando: +per·nivel. */
  | { type: 'add'; key: AdvisorKey; per: number };

export interface AdvisorDef {
  id: string;
  emoji: string;
  name: string;
  role: string;
  rarity: Rarity;
  effects: AdvisorEffect[];
}

const pair = (id: string, emoji: string, name: string, role: string, ids: [string, string]): AdvisorDef => ({
  id,
  emoji,
  name,
  role,
  rarity: 'comun',
  effects: [{ type: 'buildings', ids, per: 1 }],
});

export const ADVISORS: AdvisorDef[] = [
  pair('pilar', '👷‍♀️', 'Pilar', 'Maestra de obras', ['choza', 'casa']),
  pair('tomas', '🧑‍🔧', 'Tomás', 'Ingeniero', ['tienda', 'fabrica']),
  pair('ines', '👩‍💼', 'Inés', 'Banquera', ['banco', 'rascacielos']),
  pair('leo', '🧑‍🚀', 'Leo', 'Comandante', ['estadio', 'puerto']),
  pair('dimas', '🧙', 'Dimas', 'Mago dimensional', ['flotante', 'portal']),
  pair('vera', '🔭', 'Vera', 'Astrónoma', ['solar', 'ascensor']),
  pair('sol', '👩‍🔬', 'Sol', 'Doctora en energía', ['lunar', 'dyson']),
  pair('zork', '👽', 'Zork', 'Embajador galáctico', ['nexo', 'realidad']),
  {
    id: 'kim',
    emoji: '🥋',
    name: 'Kim',
    role: 'Entrenadora',
    rarity: 'rara',
    effects: [{ type: 'mult', key: 'tap', per: 0.5 }],
  },
  {
    id: 'bruno',
    emoji: '🦉',
    name: 'Bruno',
    role: 'Vigilante nocturno',
    rarity: 'rara',
    effects: [
      { type: 'mult', key: 'offlineEff', per: 0.1 },
      { type: 'add', key: 'offlineHours', per: 1 },
    ],
  },
  {
    id: 'nico',
    emoji: '🎮',
    name: 'Nico',
    role: 'Campeón de arcade',
    rarity: 'rara',
    effects: [{ type: 'mult', key: 'arcadeCoins', per: 0.25 }],
  },
  {
    id: 'rosa',
    emoji: '🎟️',
    name: 'Rosa',
    role: 'Taquillera',
    rarity: 'rara',
    effects: [{ type: 'div', key: 'ticketRegen', per: 0.1 }],
  },
  {
    id: 'valeria',
    emoji: '🎖️',
    name: 'Valeria',
    role: 'Generala',
    rarity: 'rara',
    effects: [{ type: 'mult', key: 'recruits', per: 0.5 }],
  },
  {
    id: 'aurelio',
    emoji: '🎩',
    name: 'Aurelio',
    role: 'Mecenas',
    rarity: 'epica',
    effects: [{ type: 'mult', key: 'prod', per: 0.1 }],
  },
  {
    id: 'lucia',
    emoji: '🍀',
    name: 'Lucía',
    role: 'Afortunada',
    rarity: 'epica',
    effects: [
      { type: 'add', key: 'crit', per: 0.02 },
      { type: 'div', key: 'events', per: 0.1 },
    ],
  },
];

export const ADVISOR_BY_ID = new Map(ADVISORS.map((a) => [a.id, a]));

export const RARITY: Record<Rarity, { name: string; weight: number }> = {
  comun: { name: 'Común', weight: 60 },
  rara: { name: 'Rara', weight: 30 },
  epica: { name: 'Épica', weight: 10 },
};

/** Precio de un sobre en la tienda. */
export const PACK_GEMS = 20;

export interface AdvisorsState {
  /** Copias conseguidas de cada consejero. */
  copies: Record<string, number>;
  /** Consejeros sentados en el consejo (ids, sin repetir). */
  seats: string[];
  /** Sobres sin abrir (de cofres y misiones). */
  packs: number;
  /** Ya se abrió el sobre de regalo. */
  gift: boolean;
}

export function newAdvisors(): AdvisorsState {
  return { copies: {}, seats: [], packs: 0, gift: false };
}

export function advisorsState(v: unknown): AdvisorsState {
  const base = newAdvisors();
  if (!v || typeof v !== 'object') return base;
  const r = v as Partial<AdvisorsState>;
  const copies: Record<string, number> = {};
  if (r.copies && typeof r.copies === 'object') {
    for (const [id, n] of Object.entries(r.copies)) {
      if (ADVISOR_BY_ID.has(id) && typeof n === 'number' && Number.isFinite(n) && n >= 1) copies[id] = Math.floor(n);
    }
  }
  const seats = Array.isArray(r.seats) ? [...new Set(r.seats.filter((id): id is string => typeof id === 'string' && !!copies[id]))] : [];
  const packs = typeof r.packs === 'number' && Number.isFinite(r.packs) ? Math.max(0, Math.floor(r.packs)) : 0;
  return { copies, seats, packs, gift: r.gift === true };
}

/** Nivel según las copias: 1 copia = nivel 1, 3 = nivel 2, 6 = nivel 3, 10 = nivel 4… */
export function levelFor(copies: number): number {
  if (!(copies >= 1)) return 0;
  return Math.floor((Math.sqrt(8 * copies + 1) - 1) / 2);
}

/** Copias totales necesarias para llegar a un nivel. */
export function copiesForLevel(level: number): number {
  return (level * (level + 1)) / 2;
}

export function advisorLevel(s: GameState, id: string): number {
  return levelFor(s.advisors.copies[id] ?? 0);
}

/** Sillas del consejo: 2, y una más en las eras 3, 6 y 10. */
export function seatCount(s: GameState): number {
  return 2 + [3, 6, 10].filter((e) => s.era >= e).length;
}

/** Consejeros que cuentan ahora: los sentados, como mucho tantos como sillas haya. */
function seated(s: GameState): { def: AdvisorDef; level: number }[] {
  const out: { def: AdvisorDef; level: number }[] = [];
  for (const id of s.advisors.seats.slice(0, seatCount(s))) {
    const def = ADVISOR_BY_ID.get(id);
    const level = advisorLevel(s, id);
    if (def && level > 0) out.push({ def, level });
  }
  return out;
}

export function advisorMult(s: GameState, key: AdvisorKey): number {
  let m = 1;
  for (const { def, level } of seated(s)) {
    for (const e of def.effects) {
      if (e.type === 'mult' && e.key === key) m *= 1 + e.per * level;
      else if (e.type === 'div' && e.key === key) m /= 1 + e.per * level;
    }
  }
  return m;
}

export function advisorAdd(s: GameState, key: AdvisorKey): number {
  let n = 0;
  for (const { def, level } of seated(s)) for (const e of def.effects) if (e.type === 'add' && e.key === key) n += e.per * level;
  return n;
}

export function advisorBuildingMult(s: GameState, buildingId: string): number {
  let m = 1;
  for (const { def, level } of seated(s)) {
    for (const e of def.effects) if (e.type === 'buildings' && e.ids.includes(buildingId)) m *= 1 + e.per * level;
  }
  return m;
}

const BUILDING_NAMES: Record<string, string> = {
  choza: 'Chozas',
  casa: 'Casas',
  tienda: 'Tiendas',
  fabrica: 'Fábricas',
  banco: 'Bancos',
  rascacielos: 'Rascacielos',
  estadio: 'Estadios',
  puerto: 'Puertos espaciales',
  flotante: 'Ciudades flotantes',
  portal: 'Portales',
  solar: 'Plantas solares',
  ascensor: 'Ascensores espaciales',
  lunar: 'Colonias lunares',
  dyson: 'Esferas Dyson',
  nexo: 'Nexos galácticos',
  realidad: 'Motores de realidad',
};

const KEY_TEXT: Record<AdvisorKey, string> = {
  prod: 'Producción',
  tap: 'Toques',
  crit: 'Críticos',
  offlineEff: 'Eficiencia offline',
  offlineHours: 'Tope offline',
  arcadeCoins: 'Monedas de arcade',
  ticketRegen: 'Recarga de tickets',
  events: 'Globos, decretos e incidentes',
  recruits: 'Reclutas de la Conquista',
};

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Qué hace un consejero a un nivel dado (nivel 1 si aún no lo tienes). */
export function advisorText(def: AdvisorDef, level: number): string {
  const L = Math.max(1, level);
  return def.effects
    .map((e) => {
      if (e.type === 'buildings') return `${e.ids.map((id) => BUILDING_NAMES[id] ?? id).join(' y ')} x${num(1 + e.per * L)}`;
      if (e.key === 'crit') return `+${num(e.per * L * 100)}% de críticos`;
      if (e.key === 'offlineHours') return `+${num(e.per * L)} h de tope offline`;
      if (e.type === 'div') return `${KEY_TEXT[e.key]} ${num(1 + e.per * L)} veces más rápido`;
      if (e.type === 'mult') return `${KEY_TEXT[e.key]} x${num(1 + e.per * L)}`;
      return `${KEY_TEXT[e.key]} +${num(e.per * L)}`;
    })
    .join(' · ');
}

/** Sortea el consejero de un sobre: primero la rareza, luego uno de esa rareza. */
export function drawAdvisor(rand: () => number): AdvisorDef {
  const total = Object.values(RARITY).reduce((n, r) => n + r.weight, 0);
  let r = rand() * total;
  let rarity: Rarity = 'comun';
  for (const [k, v] of Object.entries(RARITY) as [Rarity, { weight: number }][]) {
    r -= v.weight;
    if (r <= 0) {
      rarity = k;
      break;
    }
  }
  const pool = ADVISORS.filter((a) => a.rarity === rarity);
  return pool[Math.floor(rand() * pool.length)];
}

/** Hay algo que hacer en el consejo: un sobre sin abrir o el regalo. */
export function advisorsAlert(s: GameState): boolean {
  return s.advisors.packs > 0 || !s.advisors.gift;
}
