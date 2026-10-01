import { now } from '../../game/clock';
import { CUP_GAME_INFO, GROUP_SLOTS, attemptsFor, cupEvents, cupPhase, pendingCup, pendingSeason } from '../../game/cup';
import { fmtTime } from '../../game/format';
import type { GameState } from '../../game/state';
import { useGame } from '../../game/store';

/** ¿Hay algo que hacer en la Copa? (para el aviso de la pestaña Juegos) */
export function cupAlert(s: GameState, t: number): boolean {
  const info = cupPhase(t);
  if (pendingCup(s.cup, info.week) || pendingSeason(s.cup, info.week) !== null) return true;
  const registered = s.cup.week === info.week;
  if (info.phase === 'signup') return !registered;
  if (info.phase === 'groups') return registered && GROUP_SLOTS.some((k) => s.cup.used[k] < attemptsFor(s.cup, info.week, k));
  return false;
}

export function CupCard({ onOpen }: { onOpen: () => void }) {
  const s = useGame((st) => st.s);
  const t = now();
  const info = cupPhase(t);
  const events = cupEvents(info.week);
  const registered = s.cup.week === info.week;
  const pending = pendingCup(s.cup, info.week) || pendingSeason(s.cup, info.week) !== null;
  const left = fmtTime((info.endsAt - t) / 1000);
  const groupLeft = GROUP_SLOTS.reduce((n, k) => n + Math.max(0, attemptsFor(s.cup, info.week, k) - s.cup.used[k]), 0);

  let status: string;
  let cta: string;
  if (pending) {
    status = '¡Ya hay resultados! Mira el podio y cobra tus premios';
    cta = 'VER';
  } else if (info.phase === 'signup') {
    status = registered ? `Inscrito ✅ · Prepárate: los grupos empiezan en ${left}` : `Inscripción abierta · cierra en ${left}`;
    cta = registered ? 'PREPARAR' : 'APÚNTATE';
  } else if (info.phase === 'groups') {
    status = registered ? `¡Fase de grupos en juego! Te quedan ${groupLeft} intentos · ${left}` : `Fase de grupos · haz tu pronóstico · ${left}`;
    cta = registered ? 'JUGAR' : 'VER';
  } else {
    status = `¡Final en juego! Termina en ${left}`;
    cta = 'VER';
  }

  return (
    <button className="game-card cup-card" onClick={onOpen}>
      <span className="game-emoji">🏆</span>
      <div className="game-info">
        <b>Copa de Alcaldes</b>
        <small>
          Triatlón del sábado: {GROUP_SLOTS.map((k) => CUP_GAME_INFO[events[k]].emoji).join(' ')} · Final el domingo
        </small>
        <small className="game-meta">{status}</small>
      </div>
      <span className="game-cost">{cta}</span>
    </button>
  );
}
