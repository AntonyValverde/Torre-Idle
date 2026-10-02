import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { track } from '../../firebase';
import { MIN_BET, maxBet, playRoulette } from '../../game/casino';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { Outcome, act, chips } from './common';
import { COLUMNS, DOZENS, OUTSIDE_BETS, WHEEL_ORDER, colorOf, totalStake } from './roulette';

const CHIP_VALUES = [1, 5, 10, 25, 50, 100];
const SPIN_MS = 4200;
const R = 100;
const SEG = 360 / WHEEL_ORDER.length;
const COLORS = { green: '#1f9d55', red: '#d23b3b', black: '#1c1c28' };

function slice(i: number): string {
  const a0 = ((i * SEG - 90 - SEG / 2) * Math.PI) / 180;
  const a1 = (((i + 1) * SEG - 90 - SEG / 2) * Math.PI) / 180;
  return `M${R},${R} L${R + R * Math.cos(a0)},${R + R * Math.sin(a0)} A${R},${R} 0 0 1 ${R + R * Math.cos(a1)},${R + R * Math.sin(a1)} Z`;
}

/** Números de la mesa: 3 filas (de arriba abajo: 3, 6… / 2, 5… / 1, 4…) por 12 columnas. */
const ROWS = [3, 2, 1].map((top) => Array.from({ length: 12 }, (_, k) => top + 3 * k));

export function RouletteGame() {
  const c = useGame((st) => st.s.casino);
  const [bets, setBets] = useState<Record<string, number>>({});
  const [lastBets, setLastBets] = useState<Record<string, number> | null>(null);
  const [chip, setChip] = useState(5);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ n: number; win: number; total: number } | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const wheel = useRef<SVGGElement>(null);
  const angle = useRef(0);
  const raf = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (pending.current) useGame.getState().toast(`🎡 Ruleta: +${chips(pending.current)}`);
    },
    [],
  );

  const total = totalStake(bets);
  const limit = Math.min(maxBet(c), c.chips);

  const place = (id: string) => {
    if (spinning) return;
    const add = Math.min(chip, limit - total);
    if (add <= 0) {
      useGame.getState().toast(total >= maxBet(c) ? `Máximo de la mesa: ${chips(maxBet(c))}` : 'No te quedan fichas');
      return;
    }
    tone(800, 0.03, 'triangle', 0.04);
    setResult(null);
    setBets((b) => ({ ...b, [id]: (b[id] ?? 0) + add }));
  };

  const spin = () => {
    if (spinning || total < MIN_BET) return;
    const r = act((s) => playRoulette(s, bets, Math.random));
    if (!r) return;
    track('casino_play', { game: 'roulette', bet: r.total });
    pending.current = r.win > 0 ? r.win : null;
    setLastBets(bets);
    setSpinning(true);
    setResult(null);
    // El número ya salió: la rueda gira hasta dejarlo bajo la flecha
    const idx = WHEEL_ORDER.indexOf(r.n);
    const from = angle.current;
    const target = 360 - idx * SEG;
    const to = from - (from % 360) + 360 * 5 + target + (Math.random() - 0.5) * SEG * 0.6;
    const t0 = performance.now();
    let lastSeg = 0;
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / SPIN_MS);
      const a = from + (to - from) * (1 - (1 - k) ** 4);
      angle.current = a;
      if (wheel.current) wheel.current.style.transform = `rotate(${a}deg)`;
      const seg = Math.floor(a / SEG);
      if (seg !== lastSeg) {
        lastSeg = seg;
        tone(1300, 0.012, 'square', 0.02);
      }
      if (k < 1) raf.current = requestAnimationFrame(frame);
      else {
        pending.current = null;
        setSpinning(false);
        setResult({ n: r.n, win: r.win, total: r.total });
        setHistory((h) => [r.n, ...h].slice(0, 10));
        setBets({});
        if (r.win > r.total) {
          sfx('win');
          vibrate([20, 40, 60]);
        } else if (r.win === 0) tone(200, 0.15, 'triangle', 0.04);
      }
    };
    raf.current = requestAnimationFrame(frame);
  };

  const repeat = () => {
    if (!lastBets || spinning) return;
    const t = totalStake(lastBets);
    if (t > limit) {
      useGame.getState().toast('No te alcanza para repetir la apuesta');
      return;
    }
    setResult(null);
    setBets(lastBets);
  };

  const cell = (id: string, label: string, extra = '', style?: CSSProperties) => (
    <button key={id} className={`cas-rl-cell ${extra}`} style={style} onClick={() => place(id)} disabled={spinning}>
      {label}
      {bets[id] ? <span className="cas-chip">{bets[id]}</span> : null}
    </button>
  );

  return (
    <div className="cas-game">
      <div className="cas-roulette-top">
        <div className="cas-wheel">
          <div className="cas-wheel-pointer" />
          <svg viewBox={`0 0 ${R * 2} ${R * 2}`}>
            <g ref={wheel} style={{ transformOrigin: `${R}px ${R}px`, transform: `rotate(${angle.current}deg)` }}>
              {WHEEL_ORDER.map((n, i) => (
                <g key={n}>
                  <path d={slice(i)} fill={COLORS[colorOf(n)]} stroke="#c9a227" strokeWidth={0.6} />
                  <text
                    x={R}
                    y={14}
                    transform={`rotate(${i * SEG} ${R} ${R})`}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={800}
                    fill="#fff"
                  >
                    {n}
                  </text>
                </g>
              ))}
              <circle cx={R} cy={R} r={R * 0.62} fill="#3a2414" stroke="#c9a227" strokeWidth={2} />
              <circle cx={R} cy={R} r={R * 0.18} fill="#c9a227" />
            </g>
          </svg>
        </div>
        <div className="cas-roulette-side">
          {result ? (
            <div className={`cas-rl-ball ${colorOf(result.n)}`}>{result.n}</div>
          ) : (
            <div className="cas-rl-ball empty">{spinning ? '…' : '?'}</div>
          )}
          <div className="cas-rl-history">
            {history.map((n, i) => (
              <span key={i} className={colorOf(n)}>
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="cas-result-slot">
        {result &&
          (result.win > 0 ? (
            <Outcome tone={result.win > result.total ? 'win' : 'push'}>
              Sale el {result.n} · +{chips(result.win)}
            </Outcome>
          ) : (
            <Outcome tone="lose">Sale el {result.n}: gana la banca</Outcome>
          ))}
      </div>

      <div className="cas-rl-board">
        {cell('n0', '0', 'green', { gridColumn: 1, gridRow: '1 / 4' })}
        {ROWS.map((row, r) =>
          row.map((n, k) => cell(`n${n}`, String(n), colorOf(n), { gridColumn: k + 2, gridRow: r + 1 })),
        )}
        {COLUMNS.map((id, r) => cell(id, '2:1', 'col', { gridColumn: 14, gridRow: 3 - r }))}
        {DOZENS.map((d, k) => cell(d.id, d.label, 'outside', { gridColumn: `${2 + k * 4} / span 4`, gridRow: 4 }))}
        {OUTSIDE_BETS.map((o, k) =>
          cell(o.id, o.label, `outside ${o.id === 'red' ? 'red' : o.id === 'black' ? 'black' : ''}`, { gridColumn: `${2 + k * 2} / span 2`, gridRow: 5 }),
        )}
      </div>

      <div className="cas-chips-row">
        {CHIP_VALUES.map((v) => (
          <button key={v} className={`cas-chip-pick${chip === v ? ' active' : ''}`} onClick={() => setChip(v)} disabled={spinning}>
            {v}
          </button>
        ))}
      </div>

      <div className="btn-row">
        <button className="btn" disabled={spinning || total === 0} onClick={() => setBets({})}>
          Borrar
        </button>
        <button className="btn" disabled={spinning || !lastBets || total > 0} onClick={repeat}>
          Repetir
        </button>
        <button className="btn primary" disabled={spinning || total < MIN_BET} onClick={spin}>
          {spinning ? 'Girando…' : total ? `Girar · ${chips(total)}` : `Mín. ${MIN_BET}`}
        </button>
      </div>
      <p className="hint cas-rules">
        Pleno paga 35 a 1; docenas y columnas, 2 a 1; colores, par/impar y mitades, 1 a 1. Con un solo cero devuelve 97,3%. Máximo de la mesa: {chips(maxBet(c))}.
      </p>
    </div>
  );
}
