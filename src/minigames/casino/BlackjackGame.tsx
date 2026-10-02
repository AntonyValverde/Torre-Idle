import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { MIN_BET, blackjackMove, maxBet, startBlackjack } from '../../game/casino';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { canDouble, handValue, type BjHand } from './blackjack';
import { BetPicker, Outcome, PlayingCard, act, chips } from './common';

function resultText(h: BjHand): { tone: 'win' | 'lose' | 'push'; text: string } {
  switch (h.result) {
    case 'blackjack':
      return { tone: 'win', text: `🃏 ¡Blackjack! +${chips(h.paid)}` };
    case 'win':
      return { tone: 'win', text: `¡Ganas! +${chips(h.paid)}` };
    case 'push':
      return { tone: 'push', text: `Empate: recuperas ${chips(h.paid)}` };
    case 'bust':
      return { tone: 'lose', text: 'Te pasaste de 21' };
    default:
      return { tone: 'lose', text: 'Gana la banca' };
  }
}

export function BlackjackGame() {
  const c = useGame((st) => st.s.casino);
  const hand = c.bj;
  const [bet, setBet] = useState(hand?.bet ?? MIN_BET);
  // Cartas del crupier que había al plantarse: las nuevas salen de una en una
  const revealFrom = useRef(2);
  const playing = !!hand && !hand.result;

  // Sonido al terminar una mano (no al abrir la mesa con la mano anterior a la vista)
  const doneKey = hand?.result ? `${hand.seed}:${hand.result}` : '';
  const heard = useRef(doneKey);
  useEffect(() => {
    if (!doneKey || doneKey === heard.current || !hand) return;
    heard.current = doneKey;
    const won = hand.result === 'win' || hand.result === 'blackjack';
    if (won) {
      sfx('win');
      vibrate([20, 40, 60]);
    } else if (hand.result !== 'push') tone(180, 0.18, 'sawtooth', 0.04);
  }, [doneKey, hand]);

  const deal = () => {
    revealFrom.current = 2;
    const r = act((s) => startBlackjack(s, bet, Math.random));
    if (r) {
      track('casino_play', { game: 'blackjack', bet });
      sfx('buy');
    }
  };

  const move = (m: 'hit' | 'stand' | 'double') => {
    if (hand) revealFrom.current = hand.dealer.length;
    if (act((s) => blackjackMove(s, m))) tone(700, 0.04, 'triangle', 0.05);
  };

  const max = Math.min(maxBet(c), c.chips);
  const pv = hand ? handValue(hand.player) : null;
  const dv = hand ? handValue(playing ? hand.dealer.slice(0, 1) : hand.dealer) : null;
  const out = hand?.result ? resultText(hand) : null;

  return (
    <div className="cas-game">
      <div className="cas-felt">
        <div className="cas-hand">
          <div className="cas-hand-label">
            Banca {dv && <b>{playing ? `${dv.total} + ?` : dv.total}</b>}
          </div>
          <div className="cas-cards">
            {hand ? (
              hand.dealer.map((card, i) => (
                <PlayingCard
                  key={`${hand.seed}-d${i}`}
                  card={card}
                  hidden={playing && i === 1}
                  delay={!playing && i >= revealFrom.current ? (i - revealFrom.current + 1) * 0.35 : 0}
                />
              ))
            ) : (
              <div className="cas-empty">La banca se planta con 17</div>
            )}
          </div>
        </div>
        <div className="cas-felt-text">BLACKJACK PAGA 3 A 2</div>
        <div className="cas-hand">
          <div className="cas-cards">
            {hand ? (
              hand.player.map((card, i) => <PlayingCard key={`${hand.seed}-p${i}`} card={card} />)
            ) : (
              <div className="cas-empty">Acércate a 21 sin pasarte</div>
            )}
          </div>
          <div className="cas-hand-label">
            Tú {pv && <b>{pv.soft && pv.total < 21 && playing ? `${pv.total - 10}/${pv.total}` : pv.total}</b>}
            {hand?.doubled && <small> · doblado</small>}
          </div>
        </div>
      </div>

      <div className="cas-result-slot">{out && <Outcome tone={out.tone}>{out.text}</Outcome>}</div>

      {playing ? (
        <div className="btn-row">
          <button className="btn" onClick={() => move('hit')}>
            Pedir
          </button>
          <button className="btn" onClick={() => move('stand')}>
            Plantarse
          </button>
          <button className="btn" disabled={!canDouble(hand) || c.chips < hand.bet} onClick={() => move('double')}>
            Doblar
          </button>
        </div>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} max={max} />
          <button className="btn primary big cas-play" disabled={c.chips < bet || bet < MIN_BET} onClick={deal}>
            {c.chips < MIN_BET ? 'Sin fichas' : `Repartir · ${chips(bet)}`}
          </button>
        </>
      )}
      <p className="hint cas-rules">
        Doblar: apuestas otro tanto y recibes una sola carta. Devuelve ≈99% jugando bien (pide con 16 o menos si la banca enseña 7 o más).
      </p>
    </div>
  );
}
