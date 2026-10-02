// Tragaperras "Avenida de la suerte": tres rodillos con los edificios de la ciudad.
// Premios (en veces la apuesta): tres iguales; si no, dos coronas; si no, los dos primeros
// iguales; si no, una corona devuelve la apuesta. Retorno al jugador ≈ 95,3% (ver la prueba).

export interface SlotSymbol {
  id: string;
  emoji: string;
  weight: number;
  /** Tres iguales. */
  three: number;
  /** Los dos primeros rodillos iguales (el tercero distinto). */
  two: number;
}

export const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'choza', emoji: '🛖', weight: 22, three: 5, two: 1 },
  { id: 'casa', emoji: '🏠', weight: 18, three: 10, two: 1 },
  { id: 'tienda', emoji: '🏪', weight: 15, three: 15, two: 2 },
  { id: 'fabrica', emoji: '🏭', weight: 12, three: 30, two: 3 },
  { id: 'banco', emoji: '🏦', weight: 9, three: 60, two: 5 },
  { id: 'cohete', emoji: '🚀', weight: 6, three: 150, two: 10 },
  { id: 'corona', emoji: '👑', weight: 4, three: 500, two: 0 },
];

export const CROWN = SLOT_SYMBOLS.length - 1;
export const CROWN_ONE = 1;
export const CROWN_TWO = 8;

const TOTAL = SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0);

export function pickSymbol(rand: () => number): number {
  let r = rand() * TOTAL;
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    r -= SLOT_SYMBOLS[i].weight;
    if (r < 0) return i;
  }
  return SLOT_SYMBOLS.length - 1;
}

/** Veces la apuesta que paga una tirada (0 si no hay premio). */
export function slotMultiplier(reels: [number, number, number]): number {
  const [a, b, c] = reels;
  const crowns = reels.filter((x) => x === CROWN).length;
  if (a === b && b === c) return SLOT_SYMBOLS[a].three;
  if (crowns === 2) return CROWN_TWO;
  if (a === b) return SLOT_SYMBOLS[a].two;
  if (crowns === 1) return CROWN_ONE;
  return 0;
}

export function spinSlots(rand: () => number): { reels: [number, number, number]; mult: number } {
  const reels: [number, number, number] = [pickSymbol(rand), pickSymbol(rand), pickSymbol(rand)];
  return { reels, mult: slotMultiplier(reels) };
}

/** Retorno teórico exacto (suma de todas las combinaciones). */
export function slotsRtp(): number {
  let rtp = 0;
  const n = SLOT_SYMBOLS.length;
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      for (let c = 0; c < n; c++) {
        const p = (SLOT_SYMBOLS[a].weight * SLOT_SYMBOLS[b].weight * SLOT_SYMBOLS[c].weight) / TOTAL ** 3;
        rtp += p * slotMultiplier([a, b, c]);
      }
  return rtp;
}
