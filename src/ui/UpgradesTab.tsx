import { useState, type CSSProperties } from 'react';
import { track } from '../firebase';
import { celebrate } from './celebrate';
import { saveCloud, submitScore } from '../game/cloud';
import {
  BUILDINGS,
  GEM_SHOP,
  RARE,
  STAR_BONUS,
  availableUpgrades,
  earnedForStars,
  eraName,
  gemLevel,
  pendingStars,
  startingCapital,
  starsPotential,
  upgradeCost,
  type ShopItemDef,
} from '../game/economy';
import { fmt } from '../game/format';
import { useGame } from '../game/store';
import { currentStep, isUnlocked } from '../game/tutorial';
import { advisorsAlert } from '../game/advisors';
import { sfx, vibrate } from './haptics';
import { Council } from './Council';
import { LawCard } from './LawCard';
import { LegacyTree } from './LegacyTree';
import { Modal } from './Modal';

type Section = 'upgrades' | 'council' | 'gems' | 'legacy';

export function UpgradesTab() {
  const [section, setSection] = useState<Section>('upgrades');
  const s = useGame((st) => st.s);
  const upgradesCount = availableUpgrades(s).filter((u) => s.coins >= upgradeCost(s, u)).length;

  // Durante el tutorial solo están las mejoras con monedas; Gemas y Legado llegan al terminarlo
  if (!isUnlocked(s, 'shops')) {
    return (
      <div className="tab">
        <CoinUpgrades />
      </div>
    );
  }

  return (
    <div className="tab">
      <div className="segmented wide four">
        <button className={section === 'upgrades' ? 'active' : ''} onClick={() => setSection('upgrades')}>
          🪙 Mejoras{upgradesCount > 0 && <span className="seg-badge">{upgradesCount}</span>}
        </button>
        <button className={section === 'council' ? 'active' : ''} onClick={() => setSection('council')}>
          🧑‍💼 Consejo{advisorsAlert(s) && <span className="seg-badge">!</span>}
        </button>
        <button className={section === 'gems' ? 'active' : ''} onClick={() => setSection('gems')}>
          💎 Gemas
        </button>
        <button className={section === 'legacy' ? 'active' : ''} onClick={() => setSection('legacy')}>
          ⭐ Legado{pendingStars(s) > 0 && <span className="seg-badge">!</span>}
        </button>
      </div>
      {section === 'upgrades' && <CoinUpgrades />}
      {section === 'council' && <Council />}
      {section === 'gems' && <GemShop />}
      {section === 'legacy' && <Legacy />}
    </div>
  );
}

function CoinUpgrades() {
  const s = useGame((st) => st.s);
  const buyUpgrade = useGame((st) => st.buyUpgrade);
  const upgrades = availableUpgrades(s).slice(0, 15);
  const tutStep = currentStep(s)?.id === 'upgrade';

  return (
    <>
      {upgrades.length === 0 && <p className="empty">Compra más edificios para desbloquear mejoras.</p>}
      <ul className="list">
        {upgrades.map((u, i) => {
          const cost = upgradeCost(s, u);
          const can = s.coins >= cost;
          return (
            <li key={u.id} className={`row${can ? ' can' : ''}${tutStep && i === 0 ? ' tut-target' : ''}`}>
              <span className="row-emoji">{u.emoji}</span>
              <div className="row-main">
                <b>{u.name}</b>
                <small>{u.desc}</small>
              </div>
              <button
                className={`buy${can ? ' can' : ''}`}
                style={{ '--p': `${Math.min(100, (s.coins / cost) * 100)}%` } as CSSProperties}
                disabled={!can}
                onClick={() => {
                  if (!buyUpgrade(u.id)) return;
                  sfx('buy');
                  vibrate(12);
                }}
              >
                {fmt(cost)} 🪙
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ShopList({
  items,
  level,
  budget,
  currency,
  onBuy,
}: {
  items: ShopItemDef[];
  level: (id: string) => number;
  budget: number;
  currency: string;
  onBuy: (id: string) => boolean;
}) {
  return (
    <ul className="list">
      {items.map((g) => {
        const lvl = level(g.id);
        const maxed = lvl >= g.max;
        const cost = g.cost(lvl);
        const can = !maxed && budget >= cost;
        return (
          <li key={g.id} className={`row${can ? ' can' : ''}`}>
            <span className="row-emoji">{g.emoji}</span>
            <div className="row-main">
              <b>
                {g.name} <span className="owned">Nv {lvl}</span>
              </b>
              <small>{g.desc}</small>
            </div>
            <button
              className={`buy ${currency === '⭐' ? 'star' : 'gem'}${can ? ' can' : ''}`}
              style={{ '--p': `${maxed ? 100 : Math.min(100, (budget / cost) * 100)}%` } as CSSProperties}
              disabled={!can}
              onClick={() => {
                if (!onBuy(g.id)) return;
                sfx('win');
                vibrate(15);
              }}
            >
              {maxed ? 'MÁX' : `${fmt(cost)} ${currency}`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function GemShop() {
  const s = useGame((st) => st.s);
  const buyGem = useGame((st) => st.buyGemItem);
  return (
    <>
      <div className="currency-banner gem">
        <span className="big">💎 {fmt(s.gems)}</span>
        <small>Gana gemas en Fusión, el Apagón diario, logros, decretos y globos dorados. También compran sobres de consejeros en 🧑‍💼 Consejo.</small>
      </div>
      <ShopList items={GEM_SHOP} level={(id) => gemLevel(s, id)} budget={s.gems} currency="💎" onBuy={buyGem} />
    </>
  );
}

function Legacy() {
  const s = useGame((st) => st.s);
  const [confirm, setConfirm] = useState(false);
  const pending = pendingStars(s);
  const potential = starsPotential(s.allTimeEarned);
  const nextAt = earnedForStars(potential + 1);
  const prevAt = earnedForStars(potential);
  const pct = ((s.allTimeEarned - prevAt) / (nextAt - prevAt)) * 100;
  const nextEraUnlock = BUILDINGS.find((b) => b.era === s.era + 1);

  const doPrestige = () => {
    const st = useGame.getState();
    const gained = st.prestige();
    setConfirm(false);
    if (!gained) return;
    const ns = useGame.getState().s;
    celebrate(10);
    sfx('win');
    vibrate([30, 50, 30, 50, 80]);
    st.toast(`🌅 ¡Bienvenido a la era ${ns.era}: ${eraName(ns.era)}! +${gained} ⭐ · Elige la ley de la era ⚖️`);
    track('prestige', { era: ns.era, stars: ns.stars });
    submitScore('stars', ns.stars, ns.name).catch(() => {});
    saveCloud(ns).catch(() => {});
  };

  return (
    <>
      <div className="era-card">
        <div className="era-title">
          <small>Era {s.era}</small>
          <b>{eraName(s.era)}</b>
        </div>
        <div className="era-stars">
          <span>⭐ {fmt(s.stars)}</span>
          <small>+{fmt(Math.round(s.stars * STAR_BONUS * 100))}% producción</small>
        </div>
      </div>

      <div className="prestige-card">
        <h3>🌅 Refundar la ciudad</h3>
        <p>
          Empiezas una <b>nueva era</b> desde cero, pero con estrellas de legado que multiplican todo. Conservas gemas, estrellas, legado,
          logros, edificios raros y récords.
        </p>
        <div className="prestige-gain">
          <span>Ganarías</span>
          <b>+{fmt(pending)} ⭐</b>
        </div>
        <div className="progress">
          <div style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <small className="muted">
          Próxima estrella al llegar a {fmt(nextAt)} 🪙 ganadas en total (llevas {fmt(s.allTimeEarned)})
        </small>
        {nextEraUnlock && (
          <small className="unlock-hint">
            🔓 La era {s.era + 1} desbloquea: {nextEraUnlock.emoji} {nextEraUnlock.name}
          </small>
        )}
        <button className="btn primary big" disabled={pending < 1} onClick={() => setConfirm(true)}>
          {pending < 1 ? 'Necesitas al menos 1 ⭐' : `Refundar y ganar ${fmt(pending)} ⭐`}
        </button>
      </div>

      <LawCard showCurrent />

      <LegacyTree />

      <div className="section-head">
        <h2>Edificios raros</h2>
        <small className="muted">Consíguelos en Fusión</small>
      </div>
      <div className="rare-grid">
        {RARE.map((r) => {
          const has = s.rare.includes(r.id);
          return (
            <div key={r.id} className={`rare-card${has ? ' owned' : ''}`}>
              <span className="rare-emoji">{has ? r.emoji : '🔒'}</span>
              <b>{r.name}</b>
              <small>+{Math.round(r.bonus * 100)}% producción</small>
              {!has && <small className="muted">Fusiona hasta {r.tile}</small>}
            </div>
          );
        })}
      </div>

      {confirm && (
        <Modal onBackdrop={() => setConfirm(false)}>
          <div className="result">
            <div className="big-emoji">🌅</div>
            <div className="result-label">¿Refundar la ciudad?</div>
            <div className="result-score small">+{fmt(pending)} ⭐</div>
            <p>
              Perderás monedas, edificios y mejoras de esta era. Tu producción tendrá <b>+{fmt(Math.round((s.stars + pending) * STAR_BONUS * 100))}%</b>{' '}
              permanente.
              {startingCapital(s) > 0 && ` Empezarás con ${fmt(startingCapital(s))} 🪙.`}
            </p>
            {Object.keys(s.stocks).length > 0 && <p className="warn">⚠️ Tienes acciones en bolsa: se perderán. Véndelas antes de refundar.</p>}
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirm(false)}>
                Aún no
              </button>
              <button className="btn primary" onClick={doPrestige}>
                ¡Refundar!
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
