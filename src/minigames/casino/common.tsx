import { useEffect, useRef, type ReactNode } from 'react';
import { MIN_BET } from '../../game/casino';
import { saveLocal } from '../../game/cloud';
import { fmt } from '../../game/format';
import type { GameState } from '../../game/state';
import { useGame } from '../../game/store';
import { cardLabel, type Card } from './cards';

/**
 * Aplica una jugada del casino y la guarda en el dispositivo en el acto: así, recargar la página
 * justo después de ver una mala carta no la deshace (la apuesta ya está cobrada y guardada).
 */
export function act<R extends { s: GameState }>(fn: (s: GameState) => R | null): R | null {
  const r = fn(useGame.getState().s);
  if (!r) return null;
  useGame.setState({ s: r.s });
  saveLocal(r.s);
  return r;
}

/** Cantidad de fichas: con separador de miles hasta el millón (1.000 se lee mejor que 1.00K). */
export const fmtChips = (n: number) => (n < 1e6 ? Math.floor(n).toLocaleString('es-ES', { useGrouping: 'always' } as Intl.NumberFormatOptions) : fmt(n));

export const chips = (n: number) => `${fmtChips(n)} 🎰`;

const STEPS = [5, 10, 25, 50, 100, 250, 500, 1000];

/** Apuesta: botones − y +, y atajos. Se ajusta sola si deja de caber (pocas fichas o mesa más baja). */
export function BetPicker({ value, onChange, max, disabled }: { value: number; onChange: (v: number) => void; max: number; disabled?: boolean }) {
  const top = Math.max(MIN_BET, max);
  const clamped = Math.max(MIN_BET, Math.min(value, top));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (clamped !== value) onChangeRef.current(clamped);
  }, [clamped, value]);
  const down = [...STEPS].reverse().find((x) => x < clamped) ?? MIN_BET;
  const up = STEPS.find((x) => x > clamped && x <= top) ?? top;
  return (
    <div className="cas-bet">
      <span className="cas-bet-label">Apuesta</span>
      <button className="cas-bet-btn" disabled={disabled || clamped <= MIN_BET} onClick={() => onChange(down)} aria-label="Bajar apuesta">
        −
      </button>
      <b className="cas-bet-value">{chips(clamped)}</b>
      <button className="cas-bet-btn" disabled={disabled || clamped >= top} onClick={() => onChange(up)} aria-label="Subir apuesta">
        +
      </button>
      <button className="cas-bet-max" disabled={disabled || clamped >= top} onClick={() => onChange(top)}>
        Máx
      </button>
    </div>
  );
}

export function PlayingCard({ card, hidden, delay = 0, small }: { card: Card; hidden?: boolean; delay?: number; small?: boolean }) {
  const { rank, suit, red } = cardLabel(card);
  return (
    <div className={`cas-card${hidden ? ' back' : ''}${red ? ' red' : ''}${small ? ' small' : ''}`} style={{ animationDelay: `${delay}s` }}>
      {!hidden && (
        <>
          <span className="cas-card-rank">{rank}</span>
          <span className="cas-card-suit">{suit}</span>
        </>
      )}
    </div>
  );
}

/** Mensaje de resultado bajo la mesa. */
export function Outcome({ tone, children }: { tone: 'win' | 'lose' | 'push'; children: ReactNode }) {
  return <div className={`cas-outcome ${tone}`}>{children}</div>;
}
