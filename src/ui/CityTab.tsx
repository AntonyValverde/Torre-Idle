import { useState, type CSSProperties } from 'react';
import {
  BUILDINGS,
  autoTapsPerSec,
  boostMultiplier,
  buildingCost,
  buildingMultiplier,
  costDiscount,
  eraName,
  globalMultiplier,
  isBuildingEraLocked,
  isBuildingVisible,
  isTapBoosted,
  maxAffordable,
  milestoneCount,
  nextMilestone,
  prevMilestone,
  tapValue,
} from '../game/economy';
import { fmt, fmtClock } from '../game/format';
import { useGame } from '../game/store';
import { CityScene } from './CityScene';
import { DecreeCard } from './DecreeCard';
import { sfx, vibrate } from './haptics';
import { MissionsCard } from './MissionsCard';
import { SEASON_LABEL, WEATHER_LABEL, seasonAt, weatherAt } from './weather';

const AMOUNTS = [1, 10, -1] as const;

export function CityTab() {
  const s = useGame((st) => st.s);
  const buy = useGame((st) => st.buyBuilding);
  const [amount, setAmount] = useState<(typeof AMOUNTS)[number]>(1);
  const t = s.lastTick;
  const mult = globalMultiplier(s) * boostMultiplier(s, t);
  const discount = costDiscount(s);
  const auto = autoTapsPerSec(s);
  const festival = isTapBoosted(s, t);
  const season = seasonAt(t);

  // Primer edificio bloqueado por era: se muestra como teaser de la próxima era
  const nextEraBuilding = BUILDINGS.find((_, i) => isBuildingEraLocked(s, i));

  return (
    <div className="tab city-tab">
      <div className="scene-wrap">
        <CityScene />
        <div className="scene-badge">
          Era {s.era} · {eraName(s.era)}
        </div>
        <div className="scene-badge scene-weather">
          {WEATHER_LABEL[weatherAt(t)]}
          {season && ` · ${SEASON_LABEL[season]}`}
        </div>
        <div className="scene-stats">
          <span>👆 {fmt(tapValue(s, t))}</span>
          {auto > 0 && <span>🤖 {auto}/s</span>}
          {festival && <span className="hot">🎉 x{s.tapBoostMult} {fmtClock(s.tapBoostUntil - t)}</span>}
        </div>
      </div>

      <MissionsCard />

      <DecreeCard />

      <div className="section-head">
        <h2>Edificios</h2>
        <div className="segmented">
          {AMOUNTS.map((a) => (
            <button key={a} className={amount === a ? 'active' : ''} onClick={() => setAmount(a)}>
              {a === -1 ? 'Máx' : `x${a}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="list">
        {BUILDINGS.map((b, i) => {
          if (!isBuildingVisible(s, i)) {
            const prevVisible = i > 0 && isBuildingVisible(s, i - 1) && !isBuildingEraLocked(s, i);
            return prevVisible ? (
              <li key={b.id} className="row locked">
                <span className="row-emoji">❔</span>
                <div className="row-main">
                  <b>???</b>
                  <small>Sigue creciendo para descubrirlo</small>
                </div>
              </li>
            ) : null;
          }
          const owned = s.buildings[b.id] ?? 0;
          const n = amount === -1 ? Math.max(1, maxAffordable(b, owned, s.coins, discount)) : amount;
          const cost = buildingCost(b, owned, n, discount);
          const each = b.baseProd * buildingMultiplier(s, b.id) * mult;
          const can = s.coins >= cost;
          const next = nextMilestone(owned);
          const prev = prevMilestone(owned);
          const ms = milestoneCount(owned);
          const msPct = ((owned - prev) / (next - prev)) * 100;
          return (
            <li key={b.id} className={`row building${can ? ' can' : ''}`}>
              <span className="row-emoji">{b.emoji}</span>
              <div className="row-main">
                <b>
                  {b.name} <span className="owned">{owned}</span>
                  {ms > 0 && <span className="ms-chip">x{2 ** ms}</span>}
                </b>
                <small>+{fmt(each)}/s cada uno</small>
                <div className="ms-bar" title={`Hito en ${next}: producción x2`}>
                  <div style={{ width: `${msPct}%` }} />
                  <span>
                    {owned}/{next} → x2
                  </span>
                </div>
              </div>
              <button
                className={`buy${can ? ' can' : ''}`}
                style={{ '--p': `${Math.min(100, (s.coins / cost) * 100)}%` } as CSSProperties}
                disabled={!can}
                onClick={() => {
                  if (buy(b.id, amount === -1 ? -1 : n)) {
                    const after = useGame.getState().s.buildings[b.id] ?? 0;
                    if (milestoneCount(after) > ms) {
                      useGame.getState().toast(`🎯 ¡Hito! ${b.name} producen x2`);
                      sfx('win');
                    } else sfx('buy');
                    vibrate(10);
                  }
                }}
              >
                <small>x{n}</small>
                {fmt(cost)} 🪙
              </button>
            </li>
          );
        })}
        {nextEraBuilding && (
          <li className="row locked era-lock">
            <span className="row-emoji">🔒</span>
            <div className="row-main">
              <b>{nextEraBuilding.name}</b>
              <small>
                Se desbloquea en la era {nextEraBuilding.era} ({eraName(nextEraBuilding.era)}). Refunda tu ciudad en ⬆️ Mejoras → Legado.
              </small>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
