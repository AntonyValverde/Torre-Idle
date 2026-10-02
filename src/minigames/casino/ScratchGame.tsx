import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { buyScratch, casinoToday, clearTicket } from '../../game/casino';
import { msUntilTomorrow, now } from '../../game/clock';
import { fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { Outcome, act, chips } from './common';
import { SCRATCH_PRICE, SCRATCH_PRIZES, scratchRtp, type ScratchTicket } from './scratch';

export function ScratchGame() {
  const c = useGame((st) => st.s.casino);
  useGame((st) => st.s.lastTick);
  // El boleto a medio rascar se guarda en la partida; el ya rascado se queda solo en pantalla
  const [ticket, setTicket] = useState<ScratchTicket | null>(c.ticket);
  const [open, setOpen] = useState<boolean[]>(() => Array(9).fill(false));
  const [odds, setOdds] = useState(false);
  const done = !!ticket && open.every(Boolean);
  const finished = useRef(false);

  const t = now();
  const freeLeft = !casinoToday(c, t).freeScratch;

  useEffect(() => {
    if (!done || finished.current || !ticket) return;
    finished.current = true;
    act((s) => ({ s: clearTicket(s) }));
    if (ticket.win > 0) {
      sfx('win');
      vibrate([20, 40, 60]);
    } else tone(220, 0.12, 'triangle', 0.04);
  }, [done, ticket]);

  const buy = (free: boolean) => {
    const r = act((s) => buyScratch(s, now(), free, Math.random));
    if (!r) return;
    track('casino_play', { game: 'scratch', free });
    finished.current = false;
    setTicket(r.ticket);
    setOpen(Array(9).fill(false));
    sfx('buy');
  };

  const reveal = (i: number) => {
    if (!ticket || open[i]) return;
    tone(900 + i * 30, 0.03, 'square', 0.025);
    vibrate(4);
    setOpen((o) => o.map((x, k) => x || k === i));
  };

  const prize = ticket && ticket.prize >= 0 ? SCRATCH_PRIZES[ticket.prize] : null;

  return (
    <div className="cas-game">
      <div className="cas-scratch">
        <div className="cas-scratch-title">RASPA Y GANA</div>
        <small className="cas-scratch-sub">Tres iguales y te llevas su premio</small>
        <div className="cas-scratch-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <button
              key={i}
              className={`cas-cell${open[i] ? ' open' : ''}${done && prize && ticket?.cells[i] === prize.emoji ? ' win' : ''}`}
              disabled={!ticket || open[i]}
              onClick={() => reveal(i)}
              aria-label={open[i] && ticket ? ticket.cells[i] : 'Casilla sin rascar'}
            >
              {ticket && open[i] ? ticket.cells[i] : ticket ? '' : '🎰'}
            </button>
          ))}
        </div>
      </div>

      <div className="cas-result-slot">
        {done && ticket && (ticket.win > 0 ? <Outcome tone="win">¡Tres {prize?.emoji}! +{chips(ticket.win)}</Outcome> : <Outcome tone="lose">Sin premio esta vez</Outcome>)}
      </div>

      {ticket && !done ? (
        <button className="btn big cas-play" onClick={() => setOpen(Array(9).fill(true))}>
          Rascar todo
        </button>
      ) : (
        <div className="btn-row">
          <button className="btn primary big" disabled={!freeLeft} onClick={() => buy(true)}>
            {freeLeft ? '🎁 Rasca gratis' : `Gratis en ${fmtTime(msUntilTomorrow(t) / 1000)}`}
          </button>
          <button className="btn big" disabled={c.chips < SCRATCH_PRICE} onClick={() => buy(false)}>
            Boleto · {chips(SCRATCH_PRICE)}
          </button>
        </div>
      )}

      <button className="link-btn" onClick={() => setOdds((v) => !v)}>
        {odds ? 'Ocultar premios' : 'Ver premios y probabilidades'}
      </button>
      {odds && (
        <ul className="odds cas-odds">
          {SCRATCH_PRIZES.map((p) => (
            <li key={p.emoji}>
              <span>
                {p.emoji}
                {p.emoji}
                {p.emoji} · {chips(SCRATCH_PRICE * p.mult)}
              </span>
              <b>{(p.p * 100).toFixed(1)}%</b>
            </li>
          ))}
          <li className="cas-rtp">
            <span>Devuelve a la larga</span>
            <b>{(scratchRtp() * 100).toFixed(1)}%</b>
          </li>
        </ul>
      )}
    </div>
  );
}
