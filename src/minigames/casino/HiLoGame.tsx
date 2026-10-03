import { useState } from 'react';
import { track } from '../../firebase';
import { MIN_BET, hiloMove, maxBet, startHiLo } from '../../game/casino';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { rankOf } from './cards';
import { BetPicker, Outcome, PlayingCard, act, chips } from './common';
import { HILO_MAX, canCash, current, stepMult, winChance, type HiLoGuess } from './hilo';

export function HiLoGame() {
  const c = useGame((st) => st.s.casino);
  const run = c.hilo;
  const [bet, setBet] = useState(run?.bet ?? MIN_BET);
  const playing = !!run && !run.result;

  const start = () => {
    if (act((s) => startHiLo(s, bet, Math.random))) {
      track('casino_play', { game: 'hilo', bet });
      sfx('buy');
    }
  };

  const guess = (g: HiLoGuess) => {
    const r = act((s) => hiloMove(s, g));
    if (!r) return;
    if (r.run.result === 'lose') {
      tone(180, 0.18, 'sawtooth', 0.04);
      vibrate(40);
    } else if (r.run.result === 'cash') sfx('win');
    else tone(600 + r.run.cards.length * 40, 0.06, 'triangle', 0.05);
  };

  const cash = () => {
    if (act((s) => hiloMove(s, 'cash'))) {
      sfx('win');
      vibrate([20, 40, 60]);
    }
  };

  const max = Math.min(maxBet(c), c.chips);
  const rank = run ? rankOf(current(run)) : 0;

  return (
    <div className="cas-game">
      <div className="cas-felt cas-hilo">
        {run ? (
          <>
            <div className="cas-hilo-trail">
              {run.cards.slice(-7, -1).map((card, i) => (
                <PlayingCard key={`${run.id}-${Math.max(0, run.cards.length - 7) + i}`} card={card} small />
              ))}
            </div>
            <PlayingCard key={`${run.id}-${run.cards.length}`} card={current(run)} />
            <div className="cas-hilo-mult">
              x{run.mult.toFixed(2)} <small>· {chips(Math.floor(run.bet * run.mult))}</small>
            </div>
          </>
        ) : (
          <div className="cas-empty">¿La siguiente carta será más alta o más baja? Si es igual, pierdes. El as es la más baja.</div>
        )}
      </div>

      <div className="cas-result-slot">
        {run?.result === 'lose' && <Outcome tone="lose">Fallaste: la racha termina</Outcome>}
        {run?.result === 'cash' && <Outcome tone="win">Cobras x{run.mult.toFixed(2)} · +{chips(run.paid)}</Outcome>}
      </div>

      {playing ? (
        <>
          <div className="btn-row">
            {(['hi', 'lo'] as const).map((g) => {
              const m = stepMult(rank, g);
              return (
                <button key={g} className="btn cas-guess" disabled={m <= 0} onClick={() => guess(g)}>
                  {g === 'hi' ? '▲ Más alta' : '▼ Más baja'}
                  <small>{m > 0 ? `x${m.toFixed(2)} · ${Math.round(winChance(rank, g) * 100)}%` : 'imposible'}</small>
                </button>
              );
            })}
          </div>
          <button className="btn primary big cas-play" disabled={!canCash(run)} onClick={cash}>
            {canCash(run) ? `Cobrar ${chips(Math.floor(run.bet * run.mult))}` : 'Acierta una para poder cobrar'}
          </button>
        </>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} max={max} />
          <button className="btn primary big cas-play" disabled={c.chips < bet || bet < MIN_BET} onClick={start}>
            {c.chips < MIN_BET ? 'Sin fichas' : `Empezar · ${chips(bet)}`}
          </button>
        </>
      )}
      <p className="hint cas-rules">Cada acierto multiplica según lo difícil que era (3% para la casa). Se cobra solo al llegar a x{HILO_MAX}.</p>
    </div>
  );
}
