import { describe, expect, it } from 'vitest';
import { FIRST_DAY, daysBetween, mondaysBetween } from './accountData';

describe('fechas que se limpian al eliminar una cuenta', () => {
  it('daysBetween incluye los dos extremos y cruza meses', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(daysBetween('2026-10-02', '2026-10-02')).toEqual(['2026-10-02']);
    expect(daysBetween('2026-10-03', '2026-10-02')).toEqual([]);
  });

  it('daysBetween no repite ni salta días en el cambio de año', () => {
    const days = daysBetween('2026-12-30', '2027-01-02');
    expect(days).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('mondaysBetween empieza en el lunes de la primera semana', () => {
    // 2026-09-26 es sábado: su semana empieza el lunes 21
    expect(mondaysBetween(FIRST_DAY, '2026-10-02')).toEqual(['2026-09-21', '2026-09-28']);
    expect(mondaysBetween('2026-09-28', '2026-10-12')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
  });

  it('un año de historial cabe de sobra en pocos lotes', () => {
    expect(daysBetween(FIRST_DAY, '2027-09-26')).toHaveLength(366);
    expect(mondaysBetween(FIRST_DAY, '2027-09-26')).toHaveLength(53);
  });
});
