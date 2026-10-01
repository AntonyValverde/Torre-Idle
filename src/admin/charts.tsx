import { useState } from 'react';
import type { Bucket } from './metrics';

// Gráficas del panel: una sola serie, color --chart (validado contra la superficie oscura),
// barras finas con el extremo redondeado y la base recta, rejilla de 1 px y tooltip al tocar.

/** Techo "limpio" para el eje: 1, 2, 5, 10, 20, 50… */
export function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function ColumnChart({
  data,
  formatLabel,
  unit,
}: {
  data: Bucket[];
  formatLabel: (label: string) => string;
  unit: (n: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 320;
  const H = 150;
  const left = 26;
  const top = 18;
  const bottom = 22;
  const plotH = H - top - bottom;
  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const slot = (W - left) / data.length;
  const bw = Math.min(24, slot * 0.62);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const labelled = new Set([peak, data.length - 1]);
  const ticks = [0, max / 2, max].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);

  if (table) {
    return (
      <div className="chart-wrap">
        <table className="admin-table">
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{formatLabel(d.label)}</td>
                <td className="num">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link-btn" onClick={() => setTable(false)}>
          Ver gráfica
        </button>
      </div>
    );
  }

  return (
    <div className="chart-wrap" onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="admin-chart" role="img" aria-label="Gráfica de columnas">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" className="chart-label">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const h = (d.value / max) * plotH;
          return (
            <g key={d.label}>
              {h > 0 && <path d={columnPath(x, y(d.value), bw, h)} className={`chart-bar${active === i ? ' on' : ''}`} />}
              {labelled.has(i) && d.value > 0 && (
                <text x={x + bw / 2} y={y(d.value) - 5} textAnchor="middle" className="chart-value">
                  {d.value}
                </text>
              )}
              {(i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="chart-label">
                  {formatLabel(d.label)}
                </text>
              )}
              {/* Zona táctil más grande que la barra */}
              <rect
                x={left + i * slot}
                y={top}
                width={slot}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <div className="chart-tip admin-tip" style={{ left: `${((left + (active + 0.5) * slot) / W) * 100}%` }}>
          <small>{formatLabel(data[active].label)}</small>
          <b>{unit(data[active].value)}</b>
        </div>
      )}
      <button className="link-btn" onClick={() => setTable(true)}>
        Ver tabla
      </button>
    </div>
  );
}

/** Barras horizontales con el valor en la punta (y % del total si se indica). */
export function BarList({ data, total }: { data: Bucket[]; total?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="bar-list">
      {data.map((d) => {
        const pct = total ? Math.round((d.value / Math.max(1, total)) * 100) : null;
        return (
          <li key={d.label} title={`${d.label}: ${d.value}${pct !== null ? ` (${pct}%)` : ''}`}>
            <span className="bar-label">{d.label}</span>
            <span className="bar-track">
              {/* Hasta el 78% del ancho: el resto queda para el valor */}
              {d.value > 0 && <span className="bar-fill" style={{ width: `${(d.value / max) * 78}%` }} />}
              <span className="bar-value">
                {d.value}
                {pct !== null && <span className="muted"> · {pct}%</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
