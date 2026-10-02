import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { MIN_BET, maxBet, playSlots } from '../../game/casino';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { BetPicker, Outcome, act, chips } from './common';
import { CROWN_ONE, CROWN_TWO, SLOT_SYMBOLS, pickSymbol, slotsRtp } from './slots';

const STOP_MS = [650, 1050, 1450];

export function SlotsGame() {
  const c = useGame((st) => st.s.casino);
  const [bet, setBet] = useState(MIN_BET);
  const [reels, setReels] = useState<[number, number, number]>([6, 6, 6]);
  const [spinning, setSpinning] = useState(false);
  const [stopped, setStopped] = useState(3);
  const [result, setResult] = useState<{ mult: number; win: number } | null>(null);
  const [table, setTable] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pending = useRef<number | null>(null);
  const final = useRef<[number, number, number]>([6, 6, 6]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.forEach(clearInterval);
      if (pending.current) useGame.getState().toast(`🎰 Tragaperras: +${chips(pending.current)}`);
    },
    [],
  );

  const max = Math.min(maxBet(c), c.chips);
  const canSpin = !spinning && c.chips >= bet && bet >= MIN_BET;

  const spin = () => {
    if (!canSpin) return;
    const r = act((s) => playSlots(s, bet, Math.random));
    if (!r) return;
    track('casino_play', { game: 'slots', bet });
    pending.current = r.win > 0 ? r.win : null;
    final.current = r.reels;
    setSpinning(true);
    setResult(null);
    setStopped(0);
    const roll = setInterval(() => {
      setReels((cur) => cur.map(() => pickSymbol(Math.random)) as [number, number, number]);
    }, 70);
    timers.current = [roll];
    STOP_MS.forEach((ms, k) =>
      timers.current.push(
        setTimeout(() => {
          setStopped(k + 1);
          tone(500 + k * 160, 0.06, 'square', 0.04);
          vibrate(6);
          if (k === 2) {
            clearInterval(roll);
            setReels(r.reels);
            setSpinning(false);
            setResult({ mult: r.mult, win: r.win });
            pending.current = null;
            if (r.win > bet) {
              sfx('win');
              vibrate([20, 40, 20, 40, 60]);
            } else if (r.win > 0) sfx('buy');
          }
        }, ms),
      ),
    );
  };

  // Los rodillos que ya pararon enseñan su símbolo final
  const shown = (k: number) => (spinning && stopped > k ? final.current[k] : reels[k]);

  return (
    <div className="cas-game">
      <div className={`cas-slots${result && result.mult >= 30 ? ' jackpot' : ''}`}>
        <div className="cas-slots-top">AVENIDA DE LA SUERTE</div>
        <div className="cas-reels">
          {[0, 1, 2].map((k) => (
            <div key={k} className={`cas-reel${spinning && stopped <= k ? ' rolling' : ''}`}>
              <span>{SLOT_SYMBOLS[shown(k)].emoji}</span>
            </div>
          ))}
        </div>
        <div className="cas-slots-line" />
      </div>

      <div className="cas-result-slot">
        {result &&
          (result.win > 0 ? (
            <Outcome tone={result.win > bet ? 'win' : 'push'}>
              {result.mult >= 30 ? '🎉 ¡PREMIO GORDO! ' : ''}x{result.mult} · +{chips(result.win)}
            </Outcome>
          ) : (
            <Outcome tone="lose">Sin premio esta vez</Outcome>
          ))}
      </div>

      <BetPicker value={bet} onChange={setBet} max={max} disabled={spinning} />
      <button className="btn primary big cas-play" onClick={spin} disabled={!canSpin}>
        {spinning ? 'Girando…' : c.chips < MIN_BET ? 'Sin fichas' : `Tirar · ${chips(bet)}`}
      </button>

      <button className="link-btn" onClick={() => setTable((v) => !v)}>
        {table ? 'Ocultar premios' : 'Ver premios y probabilidades'}
      </button>
      {table && (
        <ul className="odds cas-odds">
          {SLOT_SYMBOLS.map((s) => (
            <li key={s.id}>
              <span>
                {s.emoji}
                {s.emoji}
                {s.emoji}
              </span>
              <b>x{s.three}</b>
            </li>
          ))}
          {SLOT_SYMBOLS.filter((s) => s.two > 0).map((s) => (
            <li key={'2' + s.id}>
              <span>
                {s.emoji}
                {s.emoji} en los dos primeros
              </span>
              <b>x{s.two}</b>
            </li>
          ))}
          <li>
            <span>👑👑 en cualquier sitio</span>
            <b>x{CROWN_TWO}</b>
          </li>
          <li>
            <span>Una 👑 en cualquier sitio</span>
            <b>x{CROWN_ONE}</b>
          </li>
          <li className="cas-rtp">
            <span>Devuelve a la larga</span>
            <b>{(slotsRtp() * 100).toFixed(1)}%</b>
          </li>
        </ul>
      )}
    </div>
  );
}
