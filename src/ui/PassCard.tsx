import { useEffect, useRef } from 'react';
import { cupStart, seasonWeeks } from '../game/cup';
import {
  PASS_DECOS,
  PASS_LEVELS,
  PASS_MAX,
  passClaimable,
  passProgress,
  passRewardAt,
  passRewardText,
  seasonDeco,
  type PassReward,
} from '../game/pass';
import { useGame } from '../game/store';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';

const DAY = 86_400_000;

/** Fin de la temporada del pase: el lunes siguiente a su última semana de Copa. */
function seasonEnd(season: number): number {
  const weeks = seasonWeeks(season);
  return cupStart(weeks[weeks.length - 1]) + 7 * DAY;
}

/** Emoji (y cantidad) de un premio para la ficha de su nivel. */
function rewardChip(r: PassReward): { emoji: string; n?: number } {
  switch (r.kind) {
    case 'gems':
      return { emoji: '💎', n: r.n };
    case 'tickets':
      return { emoji: '🎟️', n: r.n };
    case 'card':
      return { emoji: '🃏' };
    case 'pack':
      return { emoji: '📜' };
    case 'chips':
      return { emoji: '🎰', n: r.n };
    case 'deco':
      return { emoji: r.deco ? PASS_DECOS[r.deco].emoji : '🎁' };
  }
}

/** Pase de temporada gratuito: pista de 25 niveles que se recorre con los puntos del juego. */
export function PassCard() {
  const s = useGame((st) => st.s);
  const p = s.pass;
  const trackRef = useRef<HTMLDivElement>(null);
  const { level, into, cost } = passProgress(p);
  const claimable = passClaimable(p);
  const complete = level >= PASS_MAX;
  const daysLeft = Math.max(0, Math.ceil((seasonEnd(p.season) - s.lastTick) / DAY));
  const next = claimable > 0 ? p.claimed + 1 : 0;
  const nextReward = next ? passRewardAt(next, p.season) : null;
  const deco = PASS_DECOS[seasonDeco(p.season)];

  // La pista se centra en el nivel que toca (el siguiente por cobrar o el que se está subiendo)
  const focus = Math.min(PASS_MAX, (next || level) + (next ? 0 : 1));
  useEffect(() => {
    const track = trackRef.current;
    const el = track?.children[focus - 1] as HTMLElement | undefined;
    if (!track || !el) return;
    track.scrollLeft = el.offsetLeft - track.clientWidth / 2 + el.offsetWidth / 2;
  }, [focus]);

  const claim = () => {
    const r = useGame.getState().claimPass();
    if (!r) return;
    useGame.getState().toast(`🎫 Nivel ${r.level} del pase: ${r.text}`);
    sfx('win');
    vibrate(r.level === PASS_MAX ? [20, 40, 20, 40, 60] : [15, 30, 15]);
    if (r.level === PASS_MAX) celebrate(8);
  };

  return (
    <div className={`card pass-card${claimable > 0 ? ' ready' : ''}`}>
      <div className="pass-head">
        <b>🎫 Pase de temporada</b>
        <small className="muted">
          Temporada {p.season + 1} · {daysLeft > 0 ? `termina en ${daysLeft}d` : 'termina hoy'}
        </small>
      </div>

      <div className="pass-progress">
        <span className="pass-lvl">
          Nivel <b>{level}</b>/{PASS_MAX}
        </span>
        <div className="ms-bar pass-bar">
          <div style={{ width: `${complete ? 100 : (into / cost) * 100}%` }} />
          <span>{complete ? '¡Pase completo!' : `${into}/${cost} pts`}</span>
        </div>
      </div>

      <div className="pass-track" ref={trackRef}>
        {PASS_LEVELS.map((_, i) => {
          const lvl = i + 1;
          const chip = rewardChip(passRewardAt(lvl, p.season));
          const state = lvl <= p.claimed ? 'done' : lvl <= level ? 'ready' : 'locked';
          return (
            <div key={lvl} className={`pass-level ${state}${lvl === PASS_MAX ? ' last' : ''}`} title={passRewardText(passRewardAt(lvl, p.season))}>
              <small>{lvl}</small>
              <span className="pass-emoji">{chip.emoji}</span>
              <small className="pass-n">{state === 'done' ? '✓' : chip.n != null ? chip.n : ' '}</small>
            </div>
          );
        })}
      </div>

      {nextReward && (
        <button className="btn primary pass-claim" onClick={claim}>
          Cobrar nivel {next} · {passRewardText(nextReward)}
        </button>
      )}

      <small className="muted">
        Suma puntos con misiones, cofre, retos diarios, Copa y Conquista. Al nivel {PASS_MAX}: {deco.emoji} {deco.name}.
      </small>

      {p.decos.length > 0 && (
        <small className="pass-decos">Cosméticos: {p.decos.map((id) => `${PASS_DECOS[id].emoji} ${PASS_DECOS[id].name}`).join(' · ')}</small>
      )}
    </div>
  );
}
