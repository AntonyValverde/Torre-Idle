// Decretos del consejo: cada pocos minutos la ciudad propone dos opciones y el jugador elige una.

export type DecreeId = 'festival' | 'obras' | 'recaudacion' | 'turistas' | 'loteria' | 'mina' | 'mecenas';

export interface DecreeDef {
  id: DecreeId;
  emoji: string;
  title: string;
  desc: string;
  /** Peso relativo al sortear las opciones. */
  weight: number;
}

export const DECREES: DecreeDef[] = [
  { id: 'festival', emoji: '🎉', title: 'Festival', desc: 'Toques x7 durante 45 s', weight: 3 },
  { id: 'obras', emoji: '🏗️', title: 'Horas extra', desc: 'Producción x2 durante 3 min', weight: 3 },
  { id: 'recaudacion', emoji: '💰', title: 'Recaudación', desc: '10 min de producción al instante', weight: 3 },
  { id: 'turistas', emoji: '🎟️', title: 'Turistas', desc: '+1 ticket de minijuego', weight: 2 },
  { id: 'loteria', emoji: '🎲', title: 'Lotería', desc: '50%: 40 min de producción… o nada', weight: 2 },
  { id: 'mina', emoji: '💎', title: 'Mina de gemas', desc: '+2 gemas', weight: 1 },
  { id: 'mecenas', emoji: '🎩', title: 'Mecenas', desc: 'Producción x5 durante 30 s', weight: 2 },
];

export const DECREE_BY_ID = new Map(DECREES.map((d) => [d.id, d]));

export function pickDecrees(rand: () => number = Math.random): [DecreeId, DecreeId] {
  const pick = (exclude?: DecreeId): DecreeId => {
    const pool = DECREES.filter((d) => d.id !== exclude);
    let r = rand() * pool.reduce((a, d) => a + d.weight, 0);
    for (const d of pool) {
      r -= d.weight;
      if (r <= 0) return d.id;
    }
    return pool[pool.length - 1].id;
  };
  const a = pick();
  return [a, pick(a)];
}
