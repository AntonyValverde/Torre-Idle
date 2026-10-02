import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { track } from '../firebase';
import { availableStars, legacyLevel } from '../game/economy';
import { fmt } from '../game/format';
import {
  BRANCHES,
  KEYSTONE_GROUP,
  LEGACY_TREE,
  TIER_STARS,
  branchInvested,
  keystone,
  legacyBlock,
  respecCost,
  rivalChosen,
  tierOpen,
  type Branch,
  type LegacyNode,
} from '../game/legacy';
import { useGame } from '../game/store';
import { sfx, vibrate } from './haptics';
import { Modal } from './Modal';

/** Árbol de legado: tronco común y tres ramas con elecciones y piedra angular. */
export function LegacyTree() {
  const s = useGame((st) => st.s);
  const ks = keystone(s);
  const [branch, setBranch] = useState<Exclude<Branch, 'tronco'>>(() => (ks?.branch as Exclude<Branch, 'tronco'>) ?? 'magnate');
  const [confirm, setConfirm] = useState(false);
  const avail = availableStars(s);
  const def = BRANCHES.find((b) => b.id === branch)!;
  const invested = branchInvested(s, branch);
  const nodes = (b: Branch, tier: number) => LEGACY_TREE.filter((n) => n.branch === b && n.tier === tier);
  const cost = respecCost(s);

  const reset = () => {
    const st = useGame.getState();
    const spent = st.s.starsSpent;
    if (st.resetLegacy()) {
      st.toast(`🔄 Legado reorganizado: +${fmt(spent)} ⭐ para repartir${cost ? ` (−${cost} 💎)` : ''}`);
      sfx('win');
      vibrate([20, 40, 20]);
      track('legacy_respec', { stars: spent, gems: cost });
    }
    setConfirm(false);
  };

  return (
    <>
      <div className="section-head">
        <h2>Árbol de legado</h2>
        <small className="muted">⭐ {fmt(avail)} para gastar</small>
      </div>

      <div className="legacy-trunk">
        <small className="legacy-label">🌳 Tronco</small>
        <ul className="list">
          {nodes('tronco', 1).map((n) => (
            <NodeRow key={n.id} node={n} />
          ))}
        </ul>
      </div>

      <div className="segmented wide legacy-branches">
        {BRANCHES.map((b) => (
          <button key={b.id} className={branch === b.id ? 'active' : ''} onClick={() => setBranch(b.id)}>
            {b.emoji} {b.name}
            {ks?.branch === b.id && <span className="seg-badge">★</span>}
          </button>
        ))}
      </div>
      <p className="muted legacy-desc">
        {def.desc} · invertido en la rama: <b>{fmt(invested)} ⭐</b>
      </p>

      <TierBlock title="Nivel 1" open>
        {nodes(branch, 1).map((n) => (
          <NodeRow key={n.id} node={n} />
        ))}
      </TierBlock>

      <TierBlock title="Nivel 2 · elige una de las dos" open={tierOpen(s, branch, 2)} need={TIER_STARS[2]} invested={invested}>
        {nodes(branch, 2).map((n, i) => (
          <Fragment key={n.id}>
            {i > 0 && (
              <li className="legacy-or" aria-hidden="true">
                — o —
              </li>
            )}
            <NodeRow node={n} />
          </Fragment>
        ))}
      </TierBlock>

      <TierBlock title="Nivel 3 · piedra angular" open={tierOpen(s, branch, 3)} need={TIER_STARS[3]} invested={invested}>
        {nodes(branch, 3).map((n) => (
          <NodeRow key={n.id} node={n} />
        ))}
      </TierBlock>
      <small className="muted legacy-note">
        Solo puede haber una piedra angular en toda la ciudad{ks ? `: ahora es ${ks.emoji} ${ks.name}` : ''}.
      </small>

      <button className="btn legacy-respec" disabled={s.starsSpent <= 0 || s.gems < cost} onClick={() => setConfirm(true)}>
        🔄 Reorganizar el legado · {cost ? `${cost} 💎` : 'gratis'}
      </button>
      <small className="muted legacy-note">
        Devuelve todas las estrellas gastadas para repartirlas de nuevo. Es gratis una vez por era (se renueva al refundar).
      </small>

      {confirm && (
        <Modal onBackdrop={() => setConfirm(false)}>
          <div className="result">
            <div className="big-emoji">🔄</div>
            <div className="result-label">¿Reorganizar el legado?</div>
            <div className="result-score small">+{fmt(s.starsSpent)} ⭐</div>
            <p>Todas las mejoras de legado vuelven a nivel 0 y recuperas sus estrellas para repartirlas como quieras.</p>
            <p className="muted">{cost ? `Cuesta ${cost} 💎.` : 'Esta vez es gratis (una por era).'}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirm(false)}>
                Aún no
              </button>
              <button className="btn primary" onClick={reset}>
                Reorganizar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function TierBlock({
  title,
  open,
  need,
  invested = 0,
  children,
}: {
  title: string;
  open: boolean;
  need?: number;
  invested?: number;
  children: ReactNode;
}) {
  return (
    <div className={`legacy-tier${open ? '' : ' closed'}`}>
      <div className="legacy-tier-head">
        <small className="legacy-label">{open ? title : `🔒 ${title}`}</small>
        {!open && need && (
          <small className="muted">
            {fmt(invested)}/{need} ⭐ invertidas
          </small>
        )}
      </div>
      {!open && need && (
        <div className="progress legacy-progress">
          <div style={{ width: `${Math.min(100, (invested / need) * 100)}%` }} />
        </div>
      )}
      <ul className="list">{children}</ul>
    </div>
  );
}

function NodeRow({ node }: { node: LegacyNode }) {
  const s = useGame((st) => st.s);
  const buy = useGame((st) => st.buyLegacy);
  const lvl = legacyLevel(s, node.id);
  const maxed = lvl >= node.max;
  const block = maxed ? null : legacyBlock(s, node.id);
  const cost = node.cost(lvl);
  const budget = availableStars(s);
  const can = !block && !maxed && budget >= cost;
  const chosen = !!node.group && lvl > 0;
  const excluded = !!rivalChosen(s, node) && lvl === 0;

  return (
    <li className={`row${can ? ' can' : ''}${chosen ? ' legacy-chosen' : ''}${excluded ? ' legacy-excluded' : ''}`}>
      <span className="row-emoji">{node.emoji}</span>
      <div className="row-main">
        <b>
          {node.name} {node.max > 1 && <span className="owned">Nv {lvl}</span>}
          {chosen && node.group === KEYSTONE_GROUP && <span className="ms-chip">★ activa</span>}
        </b>
        <small>{node.desc}</small>
        {/* Si el nivel está cerrado, ya lo dice su cabecera */}
        {block && tierOpen(s, node.branch, node.tier) && <small className="legacy-block">{block}</small>}
      </div>
      <button
        className={`buy star${can ? ' can' : ''}`}
        style={{ '--p': `${maxed ? 100 : Math.min(100, (budget / cost) * 100)}%` } as CSSProperties}
        disabled={!can}
        onClick={() => {
          if (!buy(node.id)) return;
          sfx('win');
          vibrate(15);
          if (node.group) track('legacy_pick', { node: node.id });
        }}
      >
        {maxed ? (node.max === 1 ? '✔' : 'MÁX') : `${fmt(cost)} ⭐`}
      </button>
    </li>
  );
}
