// Raspa y gana: 9 casillas; si salen tres símbolos iguales se gana su premio. El premio se decide
// al comprar el boleto y las casillas se colocan para enseñarlo. Retorno ≈ 88,5%.

export const SCRATCH_PRICE = 25;

export interface ScratchPrize {
  emoji: string;
  /** Veces el precio del boleto. */
  mult: number;
  /** Probabilidad de que el boleto tenga este premio. */
  p: number;
}

export const SCRATCH_PRIZES: ScratchPrize[] = [
  { emoji: '🪙', mult: 1, p: 0.2 },
  { emoji: '💰', mult: 2, p: 0.12 },
  { emoji: '💎', mult: 5, p: 0.045 },
  { emoji: '🏆', mult: 20, p: 0.006 },
  { emoji: '👑', mult: 100, p: 0.001 },
];

export interface ScratchTicket {
  cells: string[];
  /** Índice en SCRATCH_PRIZES, o -1 si no hay premio. */
  prize: number;
  /** Fichas que paga (precio x multiplicador). */
  win: number;
}

export function scratchRtp(): number {
  return SCRATCH_PRIZES.reduce((a, p) => a + p.mult * p.p, 0);
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newTicket(rand: () => number): ScratchTicket {
  let r = rand();
  let prize = -1;
  for (let i = 0; i < SCRATCH_PRIZES.length; i++) {
    r -= SCRATCH_PRIZES[i].p;
    if (r < 0) {
      prize = i;
      break;
    }
  }
  const emojis = SCRATCH_PRIZES.map((p) => p.emoji);
  const cells: string[] = [];
  if (prize >= 0) cells.push(emojis[prize], emojis[prize], emojis[prize]);
  // El resto: como mucho dos de cada símbolo, para que no haya otro trío
  const fill = shuffle(
    emojis.filter((_, i) => i !== prize).flatMap((e) => [e, e]),
    rand,
  );
  while (cells.length < 9) cells.push(fill.pop()!);
  return { cells: shuffle(cells, rand), prize, win: prize >= 0 ? SCRATCH_PRICE * SCRATCH_PRIZES[prize].mult : 0 };
}
