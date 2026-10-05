import { useEffect, useRef, useState } from 'react';
import { fetchDuelRivals } from '../../game/cloud';
import { useGame } from '../../game/store';
import { celebrate } from '../../ui/celebrate';
import { sfx, tone, vibrate } from '../../ui/haptics';
import { WarScreen, type WarSummary, type WarViewProps } from '../war/WarScreen';
import {
  BANNERS,
  BEATS,
  ROUNDS,
  UNITS,
  UNIT_INFO,
  battlePoints,
  generalInfo,
  newDuel,
  nextBattle,
  play,
  tally,
  type DuelGame,
  type Hand,
  type Round,
} from './logic';

/** Pausa para ver el choque antes de poder sacar otra unidad. */
const CLASH_MS = 650;

const summary = (g: DuelGame): WarSummary => ({
  score: g.score,
  detail: `${g.battlesWon} ${g.battlesWon === 1 ? 'batalla ganada' : 'batallas ganadas'} · ${g.roundsWon} ${g.roundsWon === 1 ? 'ronda' : 'rondas'}`,
});

function HandRow({ hand, label }: { hand: Hand; label: string }) {
  return (
    <div className="duel-hand" aria-label={`${label}: ${UNITS.map((u) => `${hand[u]} ${UNIT_INFO[u].plural}`).join(', ')}`}>
      {UNITS.map((u) => (
        <span key={u} className={hand[u] ? '' : 'none'}>
          {UNIT_INFO[u].emoji}
          <b>×{hand[u]}</b>
        </span>
      ))}
    </div>
  );
}

const MARK: Record<Round['result'], string> = { win: '✅', lose: '❌', tie: '➖' };

export function DuelGameView({ onOver, onScore }: WarViewProps) {
  const [g0] = useState<DuelGame>(() => newDuel(Math.random));
  const game = useRef<DuelGame>(g0);
  const [, setFrame] = useState(0);
  const [busyUntil, setBusyUntil] = useState(0);
  const cb = useRef({ onOver, onScore });
  useEffect(() => {
    cb.current = { onOver, onScore };
  });
  const redraw = () => setFrame((f) => f + 1);

  // Alcaldes de verdad para las batallas avanzadas (si no hay conexión, solo salen los inventados)
  useEffect(() => {
    let alive = true;
    fetchDuelRivals()
      .then((r) => {
        if (alive) game.current.rivals = r;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Al perder el último estandarte, se enseña la derrota un momento y se cobra
  const g = game.current;
  useEffect(() => {
    if (!g.over) return;
    const id = setTimeout(() => cb.current.onOver(summary(game.current)), 1600);
    return () => clearTimeout(id);
  }, [g.over]);

  // Desbloquea los botones cuando termina el choque
  useEffect(() => {
    if (!busyUntil) return;
    const id = setTimeout(() => setBusyUntil(0), Math.max(0, busyUntil - performance.now()));
    return () => clearTimeout(id);
  }, [busyUntil]);

  const choose = (u: (typeof UNITS)[number]) => {
    if (busyUntil) return;
    const r = play(game.current, u, Math.random);
    if (!r) return;
    useGame.getState().noteDuelPick(u);
    const res = r.round.result;
    if (res === 'win') {
      tone(880, 0.08, 'triangle', 0.05);
      vibrate(10);
    } else if (res === 'lose') {
      tone(160, 0.15, 'sawtooth', 0.04);
      vibrate([30, 30, 30]);
    } else tone(440, 0.06, 'square', 0.03);
    if (r.ended) {
      const end = game.current.result;
      if (end === 'win') {
        sfx('win');
        celebrate(2);
      } else if (end === 'lose') vibrate([80, 50, 160]);
    }
    cb.current.onScore(summary(game.current));
    setBusyUntil(performance.now() + CLASH_MS);
    redraw();
  };

  const next = () => {
    nextBattle(game.current, Math.random);
    redraw();
  };

  const general = generalInfo(g);
  const last = g.rounds[g.rounds.length - 1];
  const { won, lost } = tally(g);

  return (
    <div className="war-wrap duel-wrap">
      <div className="thief-hud">
        <div>
          <small>Puntos</small>
          <b>{g.score}</b>
        </div>
        <div>
          <small>Batalla</small>
          <b>{g.battle}</b>
        </div>
        <div>
          <small>Estandartes</small>
          <b className="war-hearts" aria-label={`${g.banners} de ${BANNERS} estandartes`}>
            {'🚩'.repeat(g.banners)}
            {'🏳️'.repeat(BANNERS - g.banners)}
          </b>
        </div>
      </div>

      <div className="duel-general">
        <span className="duel-face">{general.emoji}</span>
        <div>
          <b>{general.name}</b>
          <small>{general.tell}</small>
        </div>
      </div>
      <HandRow hand={g.theirs} label="Tropas rivales" />

      <div className="duel-arena" aria-live="polite">
        {last ? (
          <div key={g.rounds.length + g.battle * 10} className={`duel-clash ${last.result}`}>
            <span className="duel-unit mine">{UNIT_INFO[last.mine].emoji}</span>
            <span className="duel-vs">{last.result === 'win' ? '>' : last.result === 'lose' ? '<' : '='}</span>
            <span className="duel-unit theirs">{UNIT_INFO[last.theirs].emoji}</span>
            <small>
              {last.result === 'win'
                ? `¡Tus ${UNIT_INFO[last.mine].plural} ganan la ronda!`
                : last.result === 'lose'
                  ? `Sus ${UNIT_INFO[last.theirs].plural} ganan la ronda`
                  : 'Empate: las dos se retiran'}
            </small>
          </div>
        ) : (
          <div className="duel-clash idle">
            <small>Ronda 1 de {ROUNDS}: elige qué unidad sacas</small>
          </div>
        )}
        <div className="duel-rounds" aria-label={`Rondas: ganadas ${won}, perdidas ${lost}`}>
          {Array.from({ length: ROUNDS }, (_, i) => (
            <span key={i} className={i === g.rounds.length && !g.result ? 'now' : ''}>
              {g.rounds[i] ? MARK[g.rounds[i].result] : '·'}
            </span>
          ))}
        </div>
      </div>

      {g.result ? (
        <div className={`duel-result ${g.result}`}>
          <b>
            {g.result === 'win'
              ? `🏆 ¡Victoria! +${battlePoints(g.battle)} puntos`
              : g.result === 'lose'
                ? g.over
                  ? '🏳️ Sin estandartes: fin de la campaña'
                  : '💥 Derrota: pierdes un estandarte'
                : '🤝 Empate: nadie cede terreno'}
          </b>
          {!g.over && (
            <button className="btn primary" onClick={next} autoFocus>
              Siguiente batalla
            </button>
          )}
        </div>
      ) : (
        <>
          <HandRow hand={g.mine} label="Tus tropas" />
          <div className="duel-picks">
            {UNITS.map((u) => (
              <button
                key={u}
                className="duel-pick"
                disabled={!g.mine[u] || !!busyUntil}
                onClick={() => choose(u)}
                aria-label={`${UNIT_INFO[u].name}: te quedan ${g.mine[u]}, gana a ${UNIT_INFO[BEATS[u]].plural}`}
              >
                <span>{UNIT_INFO[u].emoji}</span>
                <b>{UNIT_INFO[u].name}</b>
                <small>gana a {UNIT_INFO[BEATS[u]].emoji}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="hint">
        🛡️ gana a 🏹, 🏹 gana a 🐎 y 🐎 gana a 🛡️. Ves cuántas tropas le quedan al rival: cuéntalas y lee su manía. Ganas la batalla si ganas más rondas que él.
      </p>
    </div>
  );
}

export function DuelScreen({ onClose }: { onClose: () => void }) {
  return <WarScreen game="duel" label="Puntos de campaña" view={(p) => <DuelGameView {...p} />} onClose={onClose} />;
}
