import { describe, expect, it } from 'vitest';
import {
  ARCADE_BOARDS,
  addPendingDaily,
  clampDailyMoves,
  livePendingDaily,
  markSubmitted,
  nextResend,
  removePendingDaily,
} from './pending';
import { newState, normalize, type GameState } from './state';

const T = new Date(2026, 9, 1, 12).getTime();
const state = (extra: Partial<GameState> = {}): GameState => ({ ...newState(T), ...extra });

describe('récords pendientes de subir', () => {
  it('sin récords no hay nada que subir', () => {
    expect(nextResend(state())).toBeNull();
  });

  it('sube el récord local si es mayor que el ya subido', () => {
    expect(nextResend(state({ stackBest: 12 }))).toEqual({ board: 'stack', score: 12 });
    expect(nextResend(state({ stackBest: 12, submittedBest: { stack: 12 } }))).toBeNull();
    expect(nextResend(state({ stackBest: 12, submittedBest: { stack: 9 } }))).toEqual({ board: 'stack', score: 12 });
  });

  it('cubre todos los minijuegos con ranking y redondea hacia abajo', () => {
    const s = state({ mergeBest: 1500.7, thiefBest: 40, trafficBest: 33, memoryBest: 8, fireBest: 70, metroBest: 21, towersBest: 17 });
    const seen: string[] = [];
    let cur = s;
    for (let next = nextResend(cur); next; next = nextResend(cur)) {
      seen.push(`${next.board}:${next.score}`);
      cur = markSubmitted(cur, next.board, next.score);
    }
    expect(seen).toEqual(['merge:1500', 'thief:40', 'traffic:33', 'memory:8', 'fire:70', 'metro:21', 'towers:17']);
    expect(ARCADE_BOARDS).toHaveLength(8);
  });

  it('se salta los rankings que ya se están subiendo', () => {
    const s = state({ stackBest: 5, thiefBest: 30 });
    expect(nextResend(s, (b) => b === 'stack')).toEqual({ board: 'thief', score: 30 });
  });

  it('lo ya subido nunca baja', () => {
    const s = markSubmitted(state(), 'thief', 50);
    expect(s.submittedBest.thief).toBe(50);
    expect(markSubmitted(s, 'thief', 20)).toBe(s);
  });
});

describe('retos diarios pendientes de subir', () => {
  const p = { kind: 'roads' as const, date: '2026-10-01', moves: 30, timeMs: 60_000 };

  it('los movimientos se limitan a lo que aceptan las reglas (1-999)', () => {
    expect(clampDailyMoves(1500)).toBe(999);
    expect(clampDailyMoves(0)).toBe(1);
    expect(clampDailyMoves(Number.NaN)).toBe(1);
    expect(clampDailyMoves(42)).toBe(42);
  });

  it('un pendiente por reto y día (el nuevo sustituye al anterior)', () => {
    let s = addPendingDaily(state(), p);
    s = addPendingDaily(s, { ...p, moves: 31 });
    s = addPendingDaily(s, { ...p, kind: 'daily' });
    expect(s.pendingDaily).toHaveLength(2);
    expect(s.pendingDaily.find((x) => x.kind === 'roads')?.moves).toBe(31);
    s = removePendingDaily(s, 'roads', '2026-10-01');
    expect(s.pendingDaily.map((x) => x.kind)).toEqual(['daily']);
    expect(removePendingDaily(s, 'parks', '2026-10-01')).toBe(s);
  });

  it('solo se reintentan los de hoy y ayer', () => {
    const list = [
      { ...p, date: '2026-09-29' },
      { ...p, date: '2026-09-30' },
      { ...p, date: '2026-10-01' },
      { ...p, date: '2026-10-02' },
    ];
    expect(livePendingDaily(list, '2026-10-01').map((x) => x.date)).toEqual(['2026-09-30', '2026-10-01']);
    // Cambio de mes
    expect(livePendingDaily([{ ...p, date: '2026-09-30' }], '2026-10-01')).toHaveLength(1);
  });

  it('se conservan al guardar y cargar, descartando datos rotos', () => {
    const saved = JSON.parse(
      JSON.stringify({
        ...state({ submittedBest: { stack: 7 } }),
        pendingDaily: [p, { kind: 'otro', date: '2026-10-01', moves: 1, timeMs: 1 }, { ...p, date: 'ayer' }, { ...p, moves: 'x' }],
      }),
    );
    const s = normalize(saved, T);
    expect(s.submittedBest).toEqual({ stack: 7 });
    expect(s.pendingDaily).toEqual([p]);
    expect(normalize({}, T).pendingDaily).toEqual([]);
    expect(normalize({}, T).submittedBest).toEqual({});
  });
});
