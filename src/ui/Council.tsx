import { useState } from 'react';
import { track } from '../firebase';
import { ADVISORS, ADVISOR_BY_ID, PACK_GEMS, RARITY, advisorLevel, advisorText, copiesForLevel, seatCount, type AdvisorDef } from '../game/advisors';
import { useGame } from '../game/store';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';
import { Modal } from './Modal';
import { ClaraTip } from './ClaraTip';
import { currentStep } from '../game/tutorial';

const SEAT_ERAS = [3, 6, 10];

interface Reveal {
  def: AdvisorDef;
  level: number;
  isNew: boolean;
  levelUp: boolean;
}

/** Consejo del alcalde: sobres de consejeros, sillas y colección. */
export function Council() {
  const s = useGame((st) => st.s);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const a = s.advisors;
  const seats = seatCount(s);
  const nextSeatEra = SEAT_ERAS.find((e) => s.era < e);
  const owned = ADVISORS.filter((d) => a.copies[d.id]).length;
  const tut = currentStep(s)?.id === 'council';

  const open = () => {
    const st = useGame.getState();
    const r = st.openAdvisorPack();
    if (!r) return;
    sfx('win');
    vibrate(r.def.rarity === 'epica' ? [30, 50, 30, 50, 80] : [20, 40, 20]);
    if (r.def.rarity === 'epica' || r.isNew) celebrate(r.def.rarity === 'epica' ? 6 : 3);
    track('advisor_pack', { advisor: r.def.id, rarity: r.def.rarity, paid: r.paid, level: r.level });
    setReveal(r);
  };

  const toggleSeat = (def: AdvisorDef) => {
    const st = useGame.getState();
    if (st.s.advisors.seats.includes(def.id)) {
      st.unseatAdvisor(def.id);
      sfx('buy');
      return;
    }
    if (st.seatAdvisor(def.id)) {
      st.toast(`🪑 ${def.emoji} ${def.name} se sienta en el consejo`);
      sfx('win');
      vibrate(12);
    } else st.toast('🪑 El consejo está lleno: levanta a alguien primero');
  };

  const packLabel = !a.gift ? '🎁 Abrir sobre de regalo' : a.packs > 0 ? `🧑‍💼 Abrir sobre (${a.packs})` : `🧑‍💼 Comprar sobre · ${PACK_GEMS} 💎`;
  const canOpen = !a.gift || a.packs > 0 || s.gems >= PACK_GEMS;
  const revealSeated = reveal ? s.advisors.seats.includes(reveal.def.id) : false;

  return (
    <>
      <ClaraTip id="council" />
      <div className="council-card">
        <div className="council-head">
          <b>🏛️ Tu consejo</b>
          <small className="muted">
            {a.seats.length}/{seats} sillas{nextSeatEra ? ` · otra en la era ${nextSeatEra}` : ''}
          </small>
        </div>
        <div className="council-seats">
          {Array.from({ length: seats }, (_, i) => {
            const def = ADVISOR_BY_ID.get(a.seats[i] ?? '');
            if (!def) {
              return (
                <div key={`libre-${i}`} className="seat empty">
                  <span className="seat-emoji">🪑</span>
                  <small>Silla libre</small>
                </div>
              );
            }
            const level = advisorLevel(s, def.id);
            return (
              <button key={def.id} className={`seat r-${def.rarity}`} onClick={() => toggleSeat(def)} aria-label={`Levantar a ${def.name}`}>
                <span className="seat-emoji">{def.emoji}</span>
                <b>
                  {def.name} <span className="owned">Nv {level}</span>
                </b>
                <small>{advisorText(def, level)}</small>
              </button>
            );
          })}
        </div>
        <small className="muted">Solo dan su ventaja los consejeros sentados. Toca uno para sentarlo o levantarlo.</small>
        <button className={`btn primary big${tut ? " tut-target" : ""}`} disabled={!canOpen} onClick={open}>
          {packLabel}
        </button>
        <small className="muted council-note">Más sobres: cofre del día y misiones semanales. Las copias repetidas suben de nivel.</small>
      </div>

      <div className="section-head">
        <h2>Colección</h2>
        <small className="muted">
          {owned}/{ADVISORS.length}
        </small>
      </div>
      <div className="advisor-grid">
        {ADVISORS.map((def) => {
          const copies = a.copies[def.id] ?? 0;
          const level = advisorLevel(s, def.id);
          const seated = a.seats.includes(def.id);
          if (!copies) {
            return (
              <div key={def.id} className={`advisor-card locked r-${def.rarity}`}>
                <span className="advisor-emoji">❔</span>
                <b>{def.role}</b>
                <small className="rarity">{RARITY[def.rarity].name}</small>
                <small className="muted">{advisorText(def, 1)}</small>
              </div>
            );
          }
          const from = copiesForLevel(level);
          const to = copiesForLevel(level + 1);
          return (
            <button key={def.id} className={`advisor-card r-${def.rarity}${seated ? ' seated' : ''}`} onClick={() => toggleSeat(def)}>
              {seated && <span className="seated-tag">🪑 En el consejo</span>}
              <span className="advisor-emoji">{def.emoji}</span>
              <b>
                {def.name} <span className="owned">Nv {level}</span>
              </b>
              <small className="muted">{def.role}</small>
              <small className="advisor-fx">{advisorText(def, level)}</small>
              <div className="progress advisor-progress" title={`${copies - from}/${to - from} copias para el nivel ${level + 1}`}>
                <div style={{ width: `${((copies - from) / (to - from)) * 100}%` }} />
              </div>
              <small className="muted">
                {copies - from}/{to - from} para Nv {level + 1}
              </small>
            </button>
          );
        })}
      </div>

      {reveal && (
        <Modal onBackdrop={() => setReveal(null)}>
          <div className={`result advisor-reveal r-${reveal.def.rarity}`}>
            <small className="rarity">{RARITY[reveal.def.rarity].name}</small>
            <div className="big-emoji">{reveal.def.emoji}</div>
            <div className="result-label">{reveal.def.role}</div>
            <div className="result-score small">{reveal.def.name}</div>
            {reveal.isNew ? (
              <div className="badge-gold">¡Nuevo consejero!</div>
            ) : reveal.levelUp ? (
              <div className="badge-gold">¡Sube a nivel {reveal.level}!</div>
            ) : (
              <p className="muted">Copia repetida: le acerca al nivel {reveal.level + 1}</p>
            )}
            <p>{advisorText(reveal.def, reveal.level)}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setReveal(null)}>
                Seguir
              </button>
              {!revealSeated && (
                <button
                  className="btn primary"
                  disabled={a.seats.length >= seats}
                  onClick={() => {
                    toggleSeat(reveal.def);
                    setReveal(null);
                  }}
                >
                  {a.seats.length >= seats ? 'Consejo lleno' : '🪑 Sentarlo'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
