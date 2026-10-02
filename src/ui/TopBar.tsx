import { boostMultiplier, boostRemainingMs, maxTickets, productionPerSec, ticketRegenMs } from '../game/economy';
import { fmt, fmtClock } from '../game/format';
import { useGame } from '../game/store';

export function TopBar() {
  const s = useGame((st) => st.s);
  const t = s.lastTick;
  const pps = productionPerSec(s, t);
  const max = maxTickets(s);
  const nextTicket = ticketRegenMs(s) - (t - s.ticketTime);
  const boost = boostMultiplier(s, t);

  return (
    <header className="topbar">
      <div className="coins">
        <span className="coin-icon">🪙</span>
        <div className="coin-text">
          <div className="coin-value">{fmt(s.coins)}</div>
          <div className="coin-rate">
            {fmt(pps)}/s
            {boost > 1 && (
              <span className="boost-chip">
                ⚡x{fmt(boost)} {fmtClock(boostRemainingMs(s, t))}
              </span>
            )}
            {/* Daños de un incidente sin atender (y ningún boost que los compense) */}
            {boost < 1 && (
              <span className="boost-chip bad">
                🔻x{boost.toFixed(2)} {fmtClock(boostRemainingMs(s, t))}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="resources">
        <div className="res-row">
          {s.stars > 0 && <span className="pill star">⭐ {fmt(s.stars)}</span>}
          <span className="pill gem">💎 {fmt(s.gems)}</span>
        </div>
        <span className="pill">
          🎟️ {s.tickets}/{max}
          {s.tickets < max && <small> {fmtClock(nextTicket)}</small>}
        </span>
      </div>
    </header>
  );
}
