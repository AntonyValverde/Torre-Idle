// Alcantarillas: mejoras permanentes del taller. Se pagan con chatarra (🔩), que se recoge en las
// partidas y se guarda aunque pierdas: así cada bajada a las alcantarillas te deja un poco más fuerte.

export type SewerMetaId = 'hp' | 'dmg' | 'speed' | 'pack' | 'luck' | 'revive';

export interface SewerMetaDef {
  id: SewerMetaId;
  emoji: string;
  name: string;
  /** Qué da cada nivel. */
  desc: string;
  costs: number[];
}

export const SEWER_META: SewerMetaDef[] = [
  { id: 'hp', emoji: '❤️', name: 'Corazón de hierro', desc: '+1 vida al empezar', costs: [40, 90, 160] },
  { id: 'dmg', emoji: '🔪', name: 'Afilador', desc: '+10 % de daño', costs: [30, 60, 100, 150, 220] },
  { id: 'speed', emoji: '👟', name: 'Botas de goma', desc: '+6 % de velocidad', costs: [25, 60, 110] },
  { id: 'pack', emoji: '🎒', name: 'Mochila', desc: 'Empiezas con un hallazgo al azar', costs: [120] },
  { id: 'luck', emoji: '🍀', name: 'Trébol', desc: 'Eliges entre 4 hallazgos en vez de 3', costs: [150] },
  { id: 'revive', emoji: '🪽', name: 'Segunda oportunidad', desc: 'Una vez por partida, vuelves con media vida', costs: [250] },
];

export const SEWER_META_IDS = SEWER_META.map((d) => d.id);

export type SewerLevels = Record<SewerMetaId, number>;

export function emptySewerLevels(): SewerLevels {
  return { hp: 0, dmg: 0, speed: 0, pack: 0, luck: 0, revive: 0 };
}

/** Precio del siguiente nivel, o null si ya está al máximo. */
export function sewerMetaCost(lv: SewerLevels, id: SewerMetaId): number | null {
  const d = SEWER_META.find((x) => x.id === id)!;
  return lv[id] < d.costs.length ? d.costs[lv[id]] : null;
}

/** Niveles guardados (de una partida vieja o manipulada) dentro de los límites. */
export function parseSewerLevels(raw: unknown): SewerLevels {
  const out = emptySewerLevels();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const d of SEWER_META) {
    const v = r[d.id];
    if (typeof v === 'number' && Number.isFinite(v)) out[d.id] = Math.max(0, Math.min(d.costs.length, Math.floor(v)));
  }
  return out;
}
