import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { track } from '../../firebase';
import { fmt } from '../../game/format';
import { STOCKS, STOCK_FEE, priceHistory, saleValue, stockInvestCap, stockPrice, type StockDef } from '../../game/stocks';
import { useGame } from '../../game/store';
import { sfx, vibrate } from '../../ui/haptics';
import { GameScreen } from '../../ui/Modal';
import { ClaraTip } from '../../ui/ClaraTip';

const RANGES = [
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '6h', label: '6 h', ms: 6 * 3_600_000 },
  { id: '24h', label: '24 h', ms: 24 * 3_600_000 },
] as const;

function pct(a: number, b: number) {
  return ((a - b) / b) * 100;
}

/** Cambio con flecha y signo: la dirección nunca depende solo del color. */
function Change({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`chg ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Sparkline({ points }: { points: { p: number }[] }) {
  const W = 80;
  const H = 28;
  const min = Math.min(...points.map((x) => x.p));
  const max = Math.max(...points.map((x) => x.p));
  const d = points
    .map((x, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - ((x.p - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`)
    .join('');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PriceChart({ def, now, span }: { def: StockDef; now: number; span: number }) {
  const W = 340;
  const H = 170;
  const PAD = { l: 4, r: 44, t: 10, b: 20 };
  const points = useMemo(() => priceHistory(def, now, span, 120), [def, now, span]);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const min = Math.min(...points.map((x) => x.p));
  const max = Math.max(...points.map((x) => x.p));
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - min) / (max - min || 1)) * (H - PAD.t - PAD.b);
  const line = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.p).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`;
  const grid = [0, 0.5, 1].map((k) => min + (max - min) * k);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const h = hover !== null ? points[hover] : null;
  const ago = h ? Math.round((now - h.t) / 60_000) : 0;

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Precio de ${def.name}: entre ${fmt(min)} y ${fmt(max)}`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-line)" stopOpacity={0.28} />
            <stop offset="1" stopColor="var(--chart-line)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="chart-grid" />
            <text x={W - PAD.r + 6} y={y(g) + 4} className="chart-label">
              {fmt(g)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#chart-fill)" />
        <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].p)} r={4} className="chart-dot" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="chart-cross" />
            <circle cx={x(hover)} cy={y(h.p)} r={5} className="chart-dot" />
          </g>
        )}
        <text x={PAD.l} y={H - 4} className="chart-label">
          hace {RANGES.find((r) => r.ms === span)?.label}
        </text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="chart-label">
          ahora
        </text>
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${Math.min(70, Math.max(5, (x(hover!) / W) * 100 - 15))}%` }}>
          <b>{fmt(h.p)}</b>
          <small>{ago === 0 ? 'ahora' : `hace ${ago >= 60 ? `${Math.floor(ago / 60)} h ${ago % 60} min` : `${ago} min`}`}</small>
        </div>
      )}
    </div>
  );
}

export function StockScreen({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.s);
  const buy = useGame((st) => st.buyStock);
  const sell = useGame((st) => st.sellStock);
  const [selected, setSelected] = useState<string>(STOCKS[0].id);
  const [range, setRange] = useState<number>(RANGES[0].ms);
  const now = s.lastTick;
  // Las minigráficas se recalculan cada 10 s; el precio actual en cada tick
  const sparkNow = Math.floor(now / 10_000) * 10_000;
  const sparks = useMemo(() => new Map(STOCKS.map((d) => [d.id, priceHistory(d, sparkNow, 7_200_000, 40)])), [sparkNow]);
  const chartNow = Math.floor(now / 5_000) * 5_000;

  let portfolio = 0;
  let invested = 0;
  for (const d of STOCKS) {
    const h = s.stocks[d.id];
    if (h) {
      portfolio += saleValue(h.u, stockPrice(d, now));
      invested += h.c;
    }
  }

  const cap = stockInvestCap(s, now);
  const room = Math.max(0, cap - invested);
  const def = STOCKS.find((d) => d.id === selected)!;
  const price = stockPrice(def, now);
  const holding = s.stocks[def.id];
  const holdValue = holding ? saleValue(holding.u, price) : 0;

  const doBuy = (fraction: number) => {
    const spent = buy(def.id, Math.min(s.coins, room) * fraction);
    if (spent > 0) {
      sfx('buy');
      vibrate(12);
      useGame.getState().toast(`📈 Compraste ${def.id} por ${fmt(spent)} 🪙`);
      track('stock_buy', { id: def.id });
    } else {
      sfx('error');
      useGame.getState().toast(room < 1 ? '⚠️ Llegaste al límite de inversión. Vende algo o haz crecer tu ciudad.' : '⚠️ No tienes monedas suficientes');
    }
  };
  const doSell = (fraction: number) => {
    const r = sell(def.id, fraction);
    if (!r) return;
    sfx(r.profit >= 0 ? 'win' : 'error');
    vibrate(r.profit >= 0 ? [15, 30, 15] : 40);
    useGame
      .getState()
      .toast(r.profit >= 0 ? `💰 Vendiste: +${fmt(r.value)} 🪙 (ganancia ${fmt(r.profit)})` : `📉 Vendiste: ${fmt(r.value)} 🪙 (pérdida ${fmt(-r.profit)})`);
    track('stock_sell', { id: def.id, profit: Math.round(r.profit) });
  };

  return (
    <GameScreen title="Bolsa de la ciudad" right={`🪙 ${fmt(s.coins)}`} onClose={onClose}>
      <div className="stock-wrap">
        <ClaraTip id="stocks" />
        <div className="portfolio">
          <div>
            <small>Tu cartera</small>
            <b>{fmt(portfolio)} 🪙</b>
          </div>
          <div>
            <small>Resultado</small>
            <b>{invested > 0 ? <Change value={pct(portfolio, invested)} /> : '—'}</b>
          </div>
          <div>
            <small>Balance en bolsa</small>
            <b>
              {s.stockProfit < 0 ? '-' : ''}
              {fmt(Math.abs(s.stockProfit))}
            </b>
          </div>
        </div>
        <div className="invest-cap">
          <div className="progress">
            <div style={{ width: `${Math.min(100, (invested / cap) * 100)}%` }} />
          </div>
          <small className="muted">
            Invertido {fmt(invested)} de {fmt(cap)} 🪙 (límite: 2 h de tu producción)
          </small>
        </div>

        <ul className="stock-list">
          {STOCKS.map((d) => {
            const p = stockPrice(d, now);
            const hour = stockPrice(d, now - 3_600_000);
            const h = s.stocks[d.id];
            return (
              <li key={d.id}>
                <button className={`stock-row${d.id === selected ? ' active' : ''}`} onClick={() => setSelected(d.id)}>
                  <span className="stock-emoji">{d.emoji}</span>
                  <span className="stock-name">
                    <b>{d.id}</b>
                    <small>{h ? `Tienes ${fmt(saleValue(h.u, p))} 🪙` : d.name}</small>
                  </span>
                  <Sparkline points={sparks.get(d.id)!} />
                  <span className="stock-price">
                    <b>{fmt(p)}</b>
                    <Change value={pct(p, hour)} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <section className="stock-detail">
          <div className="stock-detail-head">
            <div>
              <b>
                {def.emoji} {def.name}
              </b>
              <small>{def.desc}</small>
            </div>
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r.id} className={range === r.ms ? 'active' : ''} onClick={() => setRange(r.ms)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <PriceChart def={def} now={chartNow} span={range} />

          {holding && (
            <div className="holding">
              <span>
                Invertido <b>{fmt(holding.c)}</b> → vale <b>{fmt(holdValue)}</b>
              </span>
              <Change value={pct(holdValue, holding.c)} />
            </div>
          )}

          <div className="trade-row">
            <span>Comprar</span>
            {[0.1, 0.25, 0.5, 1].map((f) => (
              <button key={f} className="btn small" disabled={s.coins < 1} onClick={() => doBuy(f)}>
                {f === 1 ? 'Todo' : `${f * 100}%`}
              </button>
            ))}
          </div>
          <div className="trade-row">
            <span>Vender</span>
            {[0.25, 0.5, 1].map((f) => (
              <button key={f} className="btn small" disabled={!holding} onClick={() => doSell(f)}>
                {f === 1 ? 'Todo' : `${f * 100}%`}
              </button>
            ))}
          </div>
          <p className="hint">
            Los precios son iguales para todos los jugadores y se mueven aunque no juegues. Las buenas oportunidades duran horas o
            días: comprar y vender cada poco no compensa, porque cada operación cobra {STOCK_FEE * 100}% de comisión. Las ganancias de la
            bolsa no suman estrellas. Al refundar la ciudad pierdes las acciones: ¡vende antes!
          </p>
        </section>
      </div>
    </GameScreen>
  );
}
