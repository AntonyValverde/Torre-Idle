// Rueda de la fortuna: un giro gratis al día y giros extra con tickets.

export type WheelPrize =
  | { kind: 'coins'; minutes: number }
  | { kind: 'gems'; amount: number }
  | { kind: 'tickets'; amount: number }
  | { kind: 'boost'; mult: number; seconds: number }
  | { kind: 'festival' }
  | { kind: 'rare' };

export interface WheelSegment {
  label: string;
  emoji: string;
  weight: number;
  color: string;
  prize: WheelPrize;
}

export const WHEEL: WheelSegment[] = [
  { label: '5 min', emoji: '🪙', weight: 20, color: '#f5b83d', prize: { kind: 'coins', minutes: 5 } },
  { label: '+2', emoji: '💎', weight: 14, color: '#4aa8ff', prize: { kind: 'gems', amount: 2 } },
  { label: 'x3 5m', emoji: '⚡', weight: 12, color: '#ff7a3d', prize: { kind: 'boost', mult: 3, seconds: 300 } },
  { label: '+2', emoji: '🎟️', weight: 12, color: '#ff5ea8', prize: { kind: 'tickets', amount: 2 } },
  { label: '20 min', emoji: '💰', weight: 13, color: '#e8a318', prize: { kind: 'coins', minutes: 20 } },
  { label: 'Fiesta', emoji: '🎉', weight: 10, color: '#b884ff', prize: { kind: 'festival' } },
  { label: '+6', emoji: '💎', weight: 6, color: '#2f7fb8', prize: { kind: 'gems', amount: 6 } },
  { label: '1 hora', emoji: '🤑', weight: 7, color: '#3ddc97', prize: { kind: 'coins', minutes: 60 } },
  { label: '+20', emoji: '💎', weight: 2.5, color: '#7ad7ff', prize: { kind: 'gems', amount: 20 } },
  { label: 'Raro', emoji: '🏛️', weight: 1.2, color: '#ffe066', prize: { kind: 'rare' } },
];

export function pickSegment(rand: () => number = Math.random): number {
  const total = WHEEL.reduce((a, s) => a + s.weight, 0);
  let r = rand() * total;
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i].weight;
    if (r <= 0) return i;
  }
  return WHEEL.length - 1;
}
