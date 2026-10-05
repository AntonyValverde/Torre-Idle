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
import { CASINO_ERA } from '../game/casino';
import { PASS_DECOS, SHOP_DECOS, ownsDeco, hasDeco, seasonDeco } from '../game/pass';
import { sfx, vibrate } from './haptics';
import { Council } from './Council';
import { LawCard } from './LawCard';
import { LegacyTree } from './LegacyTree';
import { Modal } from './Modal';
import { ClaraTip } from './ClaraTip';

type Section = 'upgrades' | 'council' | 'gems' | 'deco' | 'legacy';

export function UpgradesTab() {
  const s = useGame((st) => st.s);
  // En el paso del consejo del tutorial se abre directamente el Consejo
  const tutCouncil = currentStep(s)?.id === 'council';
  const [section, setSection] = useState<Section>(tutCouncil ? 'council' : 'upgrades');
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
      <div className="segmented wide four five">
        <button className={section === 'upgrades' ? 'active' : ''} onClick={() => setSection('upgrades')}>
          🪙 Mejoras{upgradesCount > 0 && <span className="seg-badge">{upgradesCount}</span>}
        </button>
        <button className={`${section === 'council' ? 'active' : ''}${tutCouncil && section !== 'council' ? ' tut-target' : ''}`} onClick={() => setSection('council')}>
          🧑‍💼 Consejo{advisorsAlert(s) && <span className="seg-badge">!</span>}
        </button>
        <button className={section === 'gems' ? 'active' : ''} onClick={() => setSection('gems')}>
          💎 Gemas
        </button>
        <button className={section === 'deco' ? 'active' : ''} onClick={() => setSection('deco')}>
          🎀 Decoración
        </button>
        <button className={section === 'legacy' ? 'active' : ''} onClick={() => setSection('legacy')}>
          ⭐ Legado{pendingStars(s) > 0 && <span className="seg-badge">!</span>}
        </button>
      </div>
      {section === 'upgrades' && <CoinUpgrades />}
      {section === 'council' && <Council />}
      {section === 'gems' && <GemShop />}
      {section === 'deco' && <DecoShop />}
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
      <ClaraTip id="gems" />
      <div className="currency-banner gem">
        <span className="big">💎 {fmt(s.gems)}</span>
        <small>Gana gemas en Fusión, el Apagón diario, logros, decretos y globos dorados. También compran sobres de consejeros en 🧑‍💼 Consejo.</small>
      </div>
      <ShopList items={GEM_SHOP} level={(id) => gemLevel(s, id)} budget={s.gems} currency="💎" onBuy={buyGem} />
    </>
  );
}

/** Cosméticos de temporada: los cuatro exclusivos del nivel 25 del pase, en el orden en que rotan. */
const SEASON_DECOS = [0, 1, 2, 3].map(seasonDeco);

/** Interruptor Visible/Oculto de un cosmético conseguido. */
function DecoToggle({ id }: { id: string }) {
  const pass = useGame((st) => st.s.pass);
  const toggle = useGame((st) => st.toggleDeco);
  const on = hasDeco(pass, id);
  return (
    <button
      type="button"
      className={`deco-toggle${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={`${PASS_DECOS[id].name}: ${on ? 'visible' : 'oculto'}`}
      onClick={() => {
        toggle(id);
        sfx('tap');
        vibrate(8);
      }}
    >
      <span className="deco-knob" />
      {on ? 'Visible' : 'Oculto'}
    </button>
  );
}

/** Tienda de Decoración: cosméticos de la ciudad con gemas y los exclusivos del pase de temporada. */
function DecoShop() {
  const s = useGame((st) => st.s);
  const pass = s.pass;
  const ownedShop = SHOP_DECOS.filter((id) => ownsDeco(pass, id)).length;
  const ownedSeason = SEASON_DECOS.filter((id) => ownsDeco(pass, id)).length;

  const buy = (id: string) => {
    const price = useGame.getState().buyDeco(id);
    if (!price) return;
    sfx('buy');
    vibrate(15);
    useGame.getState().toast(`🎀 ${PASS_DECOS[id].name} añadido a tu ciudad`);
    track('deco_buy', { id });
  };

  /** Texto de un cosmético de temporada que aún no se tiene: en qué temporada lo da el pase. */
  const seasonTag = (id: string) => {
    const at = [0, 1, 2, 3].map((k) => pass.season + k).find((n) => seasonDeco(n) === id) ?? pass.season;
    return at === pass.season ? 'Nivel 25 del pase de esta temporada' : `Nivel 25 del pase · Temporada ${at + 1}`;
  };

  return (
    <>
      <div className="currency-banner gem">
        <span className="big">💎 {fmt(s.gems)}</span>
        <small>Decora tu ciudad. Lo que compres se ve también cuando otros alcaldes te visitan.</small>
      </div>

      <div className="section-head">
        <h2>Tienda</h2>
        <small className="muted">
          {ownedShop}/{SHOP_DECOS.length}
        </small>
      </div>
      <ul className="list">
        {SHOP_DECOS.map((id) => {
          const d = PASS_DECOS[id];
          const price = d.price ?? 0;
          const owned = ownsDeco(pass, id);
          const can = !owned && s.gems >= price;
          return (
            <li key={id} className={`row${can ? ' can' : ''}`}>
              <span className="row-emoji">{d.emoji}</span>
              <div className="row-main">
                <b>
                  {d.name}
                  {owned && <span className="owned">✓</span>}
                </b>
                <small>{d.desc}</small>
              </div>
              {owned ? (
                <DecoToggle id={id} />
              ) : (
                <button
                  className={`buy gem${can ? ' can' : ''}`}
                  style={{ '--p': `${Math.min(100, (s.gems / price) * 100)}%` } as CSSProperties}
                  disabled={!can}
                  onClick={() => buy(id)}
                >
                  {fmt(price)} 💎
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="section-head">
        <h2>De temporada</h2>
        <small className="muted">
          {ownedSeason}/{SEASON_DECOS.length}
        </small>
      </div>
      <ul className="list">
        {SEASON_DECOS.map((id) => {
          const d = PASS_DECOS[id];
          const owned = ownsDeco(pass, id);
          return (
            <li key={id} className={`row${owned ? '' : ' locked'}`}>
              <span className="row-emoji">{d.emoji}</span>
              <div className="row-main">
                <b>
                  {d.name}
                  {owned && <span className="owned">✓</span>}
                </b>
                <small>{d.desc}</small>
                {!owned && <small className="deco-tag">🎫 {seasonTag(id)}</small>}
              </div>
              {owned && <DecoToggle id={id} />}
            </li>
          );
        })}
      </ul>
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
    if (ns.era === CASINO_ERA) st.toast('👩‍💼 Clara: ¡La ciudad ya tiene casino! Lo tienes en 🎮 Juegos, con un regalo de bienvenida.');
    track('prestige', { era: ns.era, stars: ns.stars });
    submitScore('stars', ns.stars, ns.name).catch(() => {});
    saveCloud(ns).catch(() => {});
  };

  return (
    <>
      <ClaraTip id="legacy" />
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
            {s.era + 1 === CASINO_ERA && ' y 🎰 el Casino de la ciudad'}
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
