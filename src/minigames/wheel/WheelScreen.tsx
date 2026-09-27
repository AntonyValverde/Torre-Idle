import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { dateKey, isNewDay, msUntilTomorrow } from '../../game/clock';
import { saveCloud } from '../../game/cloud';
import { fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { WHEEL } from '../../game/wheel';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';

const SEG = 360 / WHEEL.length;
const R = 150;
const SPIN_MS = 4800;

function slicePath(i: number): string {
  const a0 = ((i * SEG - 90) * Math.PI) / 180;
  const a1 = (((i + 1) * SEG - 90) * Math.PI) / 180;
  const x0 = R + R * Math.cos(a0);
  const y0 = R + R * Math.sin(a0);
  const x1 = R + R * Math.cos(a1);
  const y1 = R + R * Math.sin(a1);
  return `M${R},${R} L${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} Z`;
}

export function WheelScreen({ onClose }: { onClose: () => void }) {
  const wheelLast = useGame((st) => st.s.wheelLast);
  const tickets = useGame((st) => st.s.tickets);
  const lastTick = useGame((st) => st.s.lastTick);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ emoji: string; message: string } | null>(null);
  const [showOdds, setShowOdds] = useState(false);
  const groupRef = useRef<SVGGElement>(null);
  const angle = useRef(0);
  const raf = useRef(0);

  const free = isNewDay(wheelLast, dateKey(lastTick));
  const canSpin = !spinning && (free || tickets >= 1);
  const totalWeight = WHEEL.reduce((a, s) => a + s.weight, 0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const spin = () => {
    if (!canSpin) return;
    const r = useGame.getState().spinWheel();
    if (!r) return;
    setSpinning(true);
    setResult(null);
    track('wheel_spin', { free: r.free, index: r.index });

    // El premio ya está decidido (y aplicado): la rueda solo lo enseña
    const center = r.index * SEG + SEG / 2;
    const jitter = (Math.random() - 0.5) * SEG * 0.7;
    const from = angle.current;
    const base = from - (from % 360);
    const to = base + 360 * 6 + ((360 - center - jitter) % 360);
    const t0 = performance.now();
    let lastSeg = Math.floor(from / SEG);

    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / SPIN_MS);
      const eased = 1 - (1 - k) ** 4;
      const a = from + (to - from) * eased;
      angle.current = a;
      if (groupRef.current) groupRef.current.style.transform = `rotate(${a}deg)`;
      const seg = Math.floor(a / SEG);
      if (seg !== lastSeg) {
        lastSeg = seg;
        tone(1100, 0.02, 'square', 0.03);
        vibrate(3);
      }
      if (k < 1) {
        raf.current = requestAnimationFrame(frame);
      } else {
        setSpinning(false);
        setResult({ emoji: WHEEL[r.index].emoji, message: r.message });
        sfx('win');
        vibrate([20, 40, 20, 40, 60]);
        saveCloud(useGame.getState().s).catch(() => {});
      }
    };
    raf.current = requestAnimationFrame(frame);
  };

  return (
    <GameScreen title="Rueda de la fortuna" right={free ? '¡Gratis!' : `🎟️ ${tickets}`} onClose={onClose}>
      <div className="wheel-wrap">
        <p className="hint">
          {free ? 'Tienes un giro gratis hoy.' : `Giro gratis de nuevo en ${fmtTime(msUntilTomorrow(lastTick) / 1000)}. Giros extra: 🎟️1.`}
        </p>
        <div className="wheel">
          <div className="wheel-pointer" />
          <svg viewBox={`0 0 ${R * 2} ${R * 2}`} className="wheel-svg">
            <g ref={groupRef} style={{ transformOrigin: `${R}px ${R}px`, transform: `rotate(${angle.current}deg)` }}>
              {WHEEL.map((s, i) => (
                <g key={i}>
                  <path d={slicePath(i)} fill={s.color} stroke="#1a1433" strokeWidth={2} />
                  <g transform={`rotate(${i * SEG + SEG / 2} ${R} ${R})`}>
                    <text x={R} y={40} textAnchor="middle" fontSize={24}>
                      {s.emoji}
                    </text>
                    <text x={R} y={64} textAnchor="middle" fontSize={13} fontWeight={800} fill="#1a1433">
                      {s.label}
                    </text>
                  </g>
                </g>
              ))}
              <circle cx={R} cy={R} r={R - 2} fill="none" stroke="#ffe066" strokeWidth={4} />
            </g>
          </svg>
          <button className={`wheel-hub${canSpin ? ' ready' : ''}`} onClick={spin} disabled={!canSpin}>
            {spinning ? '…' : free ? 'GIRAR' : '🎟️1'}
          </button>
        </div>
        <button className="btn" onClick={spin} disabled={!canSpin}>
          {spinning ? 'Girando…' : free ? '¡Girar gratis!' : tickets >= 1 ? 'Girar otra vez · 🎟️1' : 'Sin tickets'}
        </button>
        <button className="link-btn" onClick={() => setShowOdds((v) => !v)}>
          {showOdds ? 'Ocultar probabilidades' : 'Ver probabilidades'}
        </button>
        {showOdds && (
          <ul className="odds">
            {WHEEL.map((s, i) => (
              <li key={i}>
                <span>
                  {s.emoji} {s.label}
                </span>
                <b>{((s.weight / totalWeight) * 100).toFixed(1)}%</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result && (
        <Modal onBackdrop={() => setResult(null)}>
          <div className="result">
            <div className="big-emoji">{result.emoji}</div>
            <div className="result-label">¡Premio!</div>
            <div className="result-score small">{result.message}</div>
            <div className="btn-row">
              <button className="btn" onClick={onClose}>
                Volver
              </button>
              <button
                className="btn primary"
                disabled={!free && tickets < 1}
                onClick={() => {
                  setResult(null);
                  spin();
                }}
              >
                {free ? 'Girar gratis' : 'Otra · 🎟️1'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </GameScreen>
  );
}
