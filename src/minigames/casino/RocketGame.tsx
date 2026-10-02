import { useEffect, useRef, useState } from 'react';
import { track } from '../../firebase';
import { MIN_BET, cashRocket, launchRocket, maxBet, settleRocket } from '../../game/casino';
import { now } from '../../game/clock';
import { useGame } from '../../game/store';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { BetPicker, Outcome, act, chips } from './common';
import { ROCKET_EDGE, cashMultAt, rocketMult } from './rocket';

const AUTO = [0, 1.5, 2, 3, 5, 10];

type Last = { kind: 'cash'; mult: number; win: number } | { kind: 'crash'; crash: number } | { kind: 'auto'; mult: number; win: number; crash: number };

export function RocketGame() {
  const c = useGame((st) => st.s.casino);
  const run = c.rocket;
  const [bet, setBet] = useState(run?.bet ?? MIN_BET);
  const [auto, setAuto] = useState(run?.auto ?? 0);
  const [mult, setMult] = useState(1);
  const [last, setLast] = useState<Last | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const raf = useRef(0);

  // Vuelo en curso: el multiplicador sale de la hora, así que sigue aunque se cierre la pantalla
  useEffect(() => {
    if (!run) return;
    let lastTone = 0;
    const frame = () => {
      const t = now();
      const settled = act((s) => settleRocket(s, t));
      if (settled) {
        const { run: r, win } = settled;
        setHistory((h) => [r.crash, ...h].slice(0, 8));
        if (win > 0) {
          setLast({ kind: 'auto', mult: r.auto, win, crash: r.crash });
          sfx('win');
        } else {
          setLast({ kind: 'crash', crash: r.crash });
          tone(120, 0.3, 'sawtooth', 0.05);
          vibrate([60, 30, 60]);
        }
        return;
      }
      const m = rocketMult(t - run.start);
      setMult(m);
      if (t - lastTone > 400) {
        lastTone = t;
        tone(300 + Math.min(900, m * 60), 0.03, 'sine', 0.025);
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [run]);

  const launch = () => {
    setLast(null);
    if (act((s) => launchRocket(s, bet, auto, now(), Math.random))) {
      track('casino_play', { game: 'rocket', bet, auto });
      setMult(1);
      sfx('buy');
    }
  };

  const cash = () => {
    const crashAt = run?.crash ?? 0;
    const r = act((s) => cashRocket(s, now()));
    if (!r) return;
    setHistory((h) => [crashAt, ...h].slice(0, 8));
    setLast({ kind: 'cash', mult: r.mult, win: r.win });
    sfx('win');
    vibrate([20, 40, 60]);
  };

  const max = Math.min(maxBet(c), c.chips);
  const flying = !!run;
  const shownMult = flying ? mult : last?.kind === 'crash' ? last.crash : last ? last.mult : 1;
  const exploded = !flying && last?.kind === 'crash';
  // Altura del cohete: escala logarítmica hasta x100
  const height = Math.min(1, Math.log(shownMult) / Math.log(20));
  const cashable = run ? cashMultAt(run, now()) : null;

  return (
    <div className="cas-game">
      <div className={`cas-sky${exploded ? ' boom' : ''}${flying ? ' flying' : ''}`}>
        <div className="cas-sky-stars" />
        <div className="cas-rocket" style={{ bottom: `${8 + height * 70}%`, left: `${10 + height * 62}%` }}>
          {exploded ? '💥' : '🚀'}
        </div>
        <div className={`cas-rocket-mult${exploded ? ' boom' : ''}`}>x{shownMult.toFixed(2)}</div>
        {history.length > 0 && (
          <div className="cas-rocket-history">
            {history.map((h, i) => (
              <span key={i} className={h >= 2 ? 'hi' : ''}>
                x{h.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="cas-result-slot">
        {last?.kind === 'cash' && (
          <Outcome tone="win">
            Cobraste en x{last.mult.toFixed(2)} · +{chips(last.win)}
          </Outcome>
        )}
        {last?.kind === 'auto' && (
          <Outcome tone="win">
            Cobro automático en x{last.mult} · +{chips(last.win)} <small>(llegó a x{last.crash.toFixed(2)})</small>
          </Outcome>
        )}
        {last?.kind === 'crash' && <Outcome tone="lose">💥 Explotó en x{last.crash.toFixed(2)}</Outcome>}
      </div>

      {flying ? (
        <button className="btn primary big cas-play cas-cashout" onClick={cash} disabled={cashable === null}>
          Cobrar {chips(Math.floor(run.bet * (cashable ?? mult)))}
          {run.auto > 1 && <small> · auto en x{run.auto}</small>}
        </button>
      ) : (
        <>
          <div className="cas-auto">
            <span className="cas-bet-label">Cobro automático</span>
            <div className="segmented">
              {AUTO.map((a) => (
                <button key={a} className={auto === a ? 'active' : ''} onClick={() => setAuto(a)}>
                  {a ? `x${a}` : 'No'}
                </button>
              ))}
            </div>
          </div>
          <BetPicker value={bet} onChange={setBet} max={max} />
          <button className="btn primary big cas-play" disabled={c.chips < bet || bet < MIN_BET} onClick={launch}>
            {c.chips < MIN_BET ? 'Sin fichas' : `Despegar · ${chips(bet)}`}
          </button>
        </>
      )}
      <p className="hint cas-rules">
        El multiplicador sube hasta que el cohete explota: cobra antes. Llega a x2 casi la mitad de las veces y devuelve ≈{Math.round(ROCKET_EDGE * 100)}% a la larga.
      </p>
    </div>
  );
}
