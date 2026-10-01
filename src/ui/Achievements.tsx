import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BONUS,
  achievementClaimed,
  achievementGems,
  achievementReached,
  totalAchievements,
} from '../game/economy';
import { fmt } from '../game/format';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';

export function Achievements() {
  const s = useGame((st) => st.s);
  const claim = useGame((st) => st.claimAchievement);
  const total = totalAchievements(s);

  // Primero los que se pueden reclamar, luego por progreso
  const rows = ACHIEVEMENTS.map((a) => {
    const claimed = achievementClaimed(s, a.id);
    const reached = achievementReached(a, s);
    const target = a.threshold(claimed);
    const prevT = claimed > 0 ? a.threshold(claimed - 1) : 0;
    const value = Math.max(0, a.stat(s));
    // Logro con niveles finitos ya completado
    const maxed = !Number.isFinite(target);
    const pct = reached > claimed || maxed ? 100 : Math.max(0, Math.min(100, ((value - prevT) / (target - prevT)) * 100));
    let gems = 0;
    for (let k = claimed; k < reached; k++) gems += achievementGems(k);
    return { a, claimed, reached, target, value, pct, gems, order: maxed ? -1 : pct };
  }).sort((x, y) => Number(y.reached > y.claimed) - Number(x.reached > x.claimed) || y.order - x.order);

  return (
    <>
      <div className="currency-banner">
        <span className="big">🏅 {total}</span>
        <small>Cada logro da +{Math.round(ACHIEVEMENT_BONUS * 100)}% de producción para siempre. Total: +{fmt(Math.round(total * ACHIEVEMENT_BONUS * 100))}%</small>
      </div>
      <ul className="list">
        {rows.map(({ a, claimed, reached, target, value, pct, gems }) => {
          const ready = reached > claimed;
          return (
            <li key={a.id} className={`row ach${ready ? ' ready' : ''}`}>
              <span className="row-emoji">{a.emoji}</span>
              <div className="row-main">
                <b>
                  {a.name} <span className="owned">Nv {claimed}</span>
                </b>
                <small>{a.desc(target)}</small>
                <div className="ms-bar">
                  <div style={{ width: `${pct}%` }} />
                  <span>{Number.isFinite(target) ? `${fmt(Math.min(value, target))}/${fmt(target)}` : 'Completado'}</span>
                </div>
              </div>
              {ready ? (
                <button
                  className="buy can"
                  onClick={() => {
                    const g = claim(a.id);
                    if (g) useGame.getState().toast(`🏅 ${a.name}: +${g} 💎`);
                    sfx('win');
                    vibrate([15, 30, 15]);
                  }}
                >
                  <small>Reclamar</small>+{gems} 💎
                </button>
              ) : (
                <span className="ach-lock">{Number.isFinite(target) ? `${Math.floor(pct)}%` : '✅'}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
