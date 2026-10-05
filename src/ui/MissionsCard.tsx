import { useState } from 'react';
import { msUntilNextWeek, msUntilTomorrow } from '../game/clock';
import { fmtTime } from '../game/format';
import {
  CHEST_REWARD,
  DAILY_REWARD,
  MISSION_BY_ID,
  WEEKLY_REWARD,
  chestReady,
  claimableMissions,
  divisionOf,
  isDone,
  nextDivision,
  type MissionSlot,
} from '../game/missions';
import { useGame } from '../game/store';
import { currentStep } from '../game/tutorial';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';

const OPEN_KEY = 'torre-missions-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Si el panel de misiones está desplegado (se recuerda entre visitas). */
export function useMissionsOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* ignorar */
    }
  };
  return [open, toggle];
}

/** Mosaico de la fila de accesos de la Ciudad: abre y cierra el panel de misiones. */
export function MissionsTile({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const s = useGame((st) => st.s);
  const claimable = claimableMissions(s);
  const dailyDone = s.missions.daily.filter((x) => x.c).length;
  const ready = claimable > 0 || !!s.league.prev || chestReady(s);
  const tut = currentStep(s)?.id === 'missions';
  return (
    <button className={`hub-tile hub-missions${open ? ' open' : ''}${ready ? ' ready' : ''}${tut ? ' tut-target' : ''}`} onClick={onToggle} aria-expanded={open}>
      {claimable > 0 && <span className="hub-badge">{claimable}</span>}
      <span className="hub-icon">📋</span>
      <b>Misiones</b>
      <small>
        {dailyDone}/3 hoy {open ? '▴' : '▾'}
      </small>
    </button>
  );
}

export function MissionsCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const s = useGame((st) => st.s);
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const m = s.missions;
  const lg = s.league;
  const div = divisionOf(lg.points);
  const next = nextDivision(lg.points);
  const claimable = claimableMissions(s);
  const dailyDone = m.daily.filter((x) => x.c).length;

  // Cerrado solo asoma el premio de la liga, que no debe pasar desapercibido
  if (!open && !lg.prev) return null;

  const claim = (kind: 'daily' | 'weekly', i: number) => {
    const msg = useGame.getState().claimMission(kind, i);
    if (!msg) return;
    useGame.getState().toast(`📋 ¡Misión cumplida! ${msg}`);
    sfx('win');
    vibrate([15, 30, 15]);
  };

  const claimChest = () => {
    const msg = useGame.getState().claimChest();
    if (!msg) return;
    useGame.getState().toast(`🎁 ¡Cofre del día! ${msg}`);
    celebrate(5);
    sfx('win');
    vibrate([20, 40, 20, 40, 60]);
  };

  const claimLeague = () => {
    const r = useGame.getState().claimLeague();
    if (!r) return;
    const extra = r.division.tickets ? ` · +${r.division.tickets} 🎟️` : '';
    useGame.getState().toast(`${r.division.emoji} Liga ${r.division.name} con ${r.points} pts: +${r.division.gems} 💎${extra}`);
    celebrate(8);
    sfx('win');
    vibrate([20, 40, 20, 40, 60]);
  };

  const list = tab === 'daily' ? m.daily : m.weekly;
  const reward =
    tab === 'daily'
      ? `+${DAILY_REWARD.gems} 💎 +${DAILY_REWARD.tickets} 🎟️ · +${DAILY_REWARD.points} pts`
      : `+${WEEKLY_REWARD.gems} 💎 · +${WEEKLY_REWARD.points} pts`;

  return (
    <div className={`card missions${claimable > 0 || lg.prev ? ' ready' : ''}`}>
      {lg.prev && (
        <button className="league-prize" onClick={claimLeague}>
          <span className="league-prize-emoji">{divisionOf(lg.prev.points).emoji}</span>
          <span>
            <b>¡Terminó la liga de la semana!</b>
            <small>
              Quedaste en {divisionOf(lg.prev.points).name} con {lg.prev.points} pts. Toca para cobrar.
            </small>
          </span>
        </button>
      )}

      {open && (
        <button className="missions-head" onClick={onToggle} aria-expanded={open}>
          <b>📋 Misiones</b>
          <small className="muted">{dailyDone}/3 hoy</small>
          {claimable > 0 && <span className="seg-badge">{claimable}</span>}
          <span className="league-chip" title="Puntos de la liga de esta semana">
            {div.emoji} {lg.points} pts
          </span>
          <span className="chev">▴</span>
        </button>
      )}

      {open && (
        <>
          <div className="segmented">
            <button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}>
              Hoy · {fmtTime(msUntilTomorrow(s.lastTick) / 1000)}
            </button>
            <button className={tab === 'weekly' ? 'active' : ''} onClick={() => setTab('weekly')}>
              Semana · {fmtTime(msUntilNextWeek(s.lastTick) / 1000)}
            </button>
          </div>
          <ul className="mission-list">
            {list.map((x, i) => (
              <Mission key={x.id} slot={x} reward={reward} onClaim={() => claim(tab, i)} />
            ))}
          </ul>
          {tab === 'daily' && (
            <button className={`chest${chestReady(s) ? ' can' : ''}`} disabled={!chestReady(s)} onClick={claimChest}>
              <span className="chest-emoji">{m.chest ? '📭' : '🎁'}</span>
              <span>
                <b>{m.chest ? 'Cofre abierto' : 'Cofre del día'}</b>
                <small>
                  {m.chest
                    ? 'Vuelve mañana por más misiones'
                    : `Completa las 3: +${CHEST_REWARD.gems} 💎, producción x${CHEST_REWARD.boost} ${CHEST_REWARD.boostSeconds / 60} min y +${CHEST_REWARD.points} pts`}
                </small>
              </span>
            </button>
          )}
          <small className="muted league-next">
            {next ? `Liga semanal: ${next.min - lg.points} pts para ${next.emoji} ${next.name}` : `Liga semanal: ¡estás en ${div.emoji} ${div.name}!`} · Ver en 🏆 Ranking
          </small>
        </>
      )}
    </div>
  );
}

function Mission({ slot, reward, onClaim }: { slot: MissionSlot; reward: string; onClaim: () => void }) {
  const def = MISSION_BY_ID.get(slot.id);
  if (!def) return null;
  const done = isDone(slot);
  const pct = Math.min(100, (slot.p / def.target) * 100);
  return (
    <li className={`mission${slot.c ? ' claimed' : done ? ' done' : ''}`}>
      <span className="mission-emoji">{def.emoji}</span>
      <div className="row-main">
        <b>{def.text}</b>
        <div className="ms-bar">
          <div style={{ width: `${pct}%` }} />
          <span>
            {Math.min(slot.p, def.target)}/{def.target}
          </span>
        </div>
      </div>
      {slot.c ? (
        <span className="mission-state">✅</span>
      ) : done ? (
        <button className="buy can" onClick={onClaim}>
          <small>Reclamar</small>
          {reward.split(' · ')[0]}
        </button>
      ) : (
        <small className="mission-reward muted">{reward}</small>
      )}
    </li>
  );
}
