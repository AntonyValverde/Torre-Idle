// Ruleta europea: un solo cero, así que todas las apuestas devuelven 36/37 ≈ 97,3%.

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Orden de los números en el cilindro. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

/** "n7" (pleno), "red", "black", "even", "odd", "low", "high", "d1".."d3" (docenas), "c1".."c3" (columnas). */
export type RouletteBet = string;

export const OUTSIDE_BETS: { id: RouletteBet; label: string }[] = [
  { id: 'low', label: '1-18' },
  { id: 'even', label: 'Par' },
  { id: 'red', label: 'Rojo' },
  { id: 'black', label: 'Negro' },
  { id: 'odd', label: 'Impar' },
  { id: 'high', label: '19-36' },
];

export const DOZENS: { id: RouletteBet; label: string }[] = [
  { id: 'd1', label: '1ª 12' },
  { id: 'd2', label: '2ª 12' },
  { id: 'd3', label: '3ª 12' },
];

export const COLUMNS: RouletteBet[] = ['c1', 'c2', 'c3'];

export function isValidBet(id: string): boolean {
  if (/^n(\d|[12]\d|3[0-6])$/.test(id)) return true;
  return ['red', 'black', 'even', 'odd', 'low', 'high', 'd1', 'd2', 'd3', 'c1', 'c2', 'c3'].includes(id);
}

/** Veces la apuesta que se cobra (incluida la apuesta) si sale `n`; 0 si se pierde. */
export function betReturn(id: RouletteBet, n: number): number {
  if (id.startsWith('n')) return Number(id.slice(1)) === n ? 36 : 0;
  if (n === 0) return 0;
  switch (id) {
    case 'red':
      return RED.has(n) ? 2 : 0;
    case 'black':
      return RED.has(n) ? 0 : 2;
    case 'even':
      return n % 2 === 0 ? 2 : 0;
    case 'odd':
      return n % 2 === 1 ? 2 : 0;
    case 'low':
      return n <= 18 ? 2 : 0;
    case 'high':
      return n >= 19 ? 2 : 0;
    case 'd1':
    case 'd2':
    case 'd3':
      return Math.ceil(n / 12) === Number(id[1]) ? 3 : 0;
    case 'c1':
    case 'c2':
    case 'c3':
      return ((n - 1) % 3) + 1 === Number(id[1]) ? 3 : 0;
  }
  return 0;
}

export function spinRoulette(rand: () => number): number {
  return Math.min(36, Math.floor(rand() * 37));
}

export function totalStake(bets: Record<string, number>): number {
  let t = 0;
  for (const v of Object.values(bets)) t += v;
  return t;
}

/** Lo que se cobra con todas las apuestas de la mesa. */
export function rouletteWin(bets: Record<string, number>, n: number): number {
  let w = 0;
  for (const [id, v] of Object.entries(bets)) w += v * betReturn(id, n);
  return w;
}

export function colorOf(n: number): 'green' | 'red' | 'black' {
  return n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
}
