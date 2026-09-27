import { dateKey, isNewDay, msUntilTomorrow } from '../game/clock';
import { maxTickets, ticketRegenMs } from '../game/economy';
import { fmt, fmtClock, fmtTime } from '../game/format';
import { STOCKS, saleValue, stockPrice } from '../game/stocks';
import { useGame } from '../game/store';

export type GameId = 'stack' | 'merge' | 'daily' | 'wheel' | 'thief' | 'stocks';

/** Juegos que cuestan un ticket al entrar. */
export const TICKET_GAMES: GameId[] = ['stack', 'merge', 'thief'];

export function GamesTab({ onPlay }: { onPlay: (g: GameId) => void }) {
  const s = useGame((st) => st.s);
  const max = maxTickets(s);
  const today = dateKey(s.lastTick);
  const dailyDone = !isNewDay(s.daily.last, today);
  const wheelFree = isNewDay(s.wheelLast, today);
  const nextTicket = ticketRegenMs(s) - (s.lastTick - s.ticketTime);
  const untilTomorrow = fmtTime(msUntilTomorrow(s.lastTick) / 1000);
  const portfolio = STOCKS.reduce((n, d) => n + (s.stocks[d.id] ? saleValue(s.stocks[d.id].u, stockPrice(d, s.lastTick)) : 0), 0);

  return (
    <div className="tab">
      <div className="ticket-banner">
        <span className="ticket-big">🎟️ {s.tickets}/{max}</span>
        <span className="muted">{s.tickets >= max ? 'Tickets llenos: ¡juega ya!' : `Próximo ticket en ${fmtClock(nextTicket)}`}</span>
      </div>

      <div className="section-head">
        <h2>Diarios</h2>
      </div>

      <button className={`game-card daily${dailyDone ? ' done' : ''}`} onClick={() => onPlay('daily')}>
        <span className="game-emoji">🌃</span>
        <div className="game-info">
          <b>Apagón diario</b>
          <small>Enciende todas las ventanas. Mismo reto para todos.</small>
          <small className="game-meta">
            🔥 Racha {s.daily.streak} · {dailyDone ? `Nuevo en ${untilTomorrow}` : '¡Disponible!'}
          </small>
        </div>
        <span className="game-cost">{dailyDone ? '✅' : 'GRATIS'}</span>
      </button>

      <button className={`game-card fortune${wheelFree ? '' : ' done'}`} onClick={() => onPlay('wheel')}>
        <span className="game-emoji">🎡</span>
        <div className="game-info">
          <b>Rueda de la fortuna</b>
          <small>Un giro gratis cada día. Premios de monedas, gemas, boosts… ¡y edificios raros!</small>
          <small className="game-meta">{wheelFree ? '¡Giro gratis disponible!' : `Gratis de nuevo en ${untilTomorrow}`}</small>
        </div>
        <span className="game-cost">{wheelFree ? 'GRATIS' : '🎟️1'}</span>
      </button>

      <div className="section-head">
        <h2>Arcade</h2>
        <small className="muted">1 🎟️ por partida</small>
      </div>

      <button className="game-card" disabled={s.tickets < 1} onClick={() => onPlay('thief')}>
        <span className="game-emoji">🦹</span>
        <div className="game-info">
          <b>Atrapa al ladrón</b>
          <small>30 segundos de reflejos. ¡No toques a los vecinos!</small>
          <small className="game-meta">🏆 Récord: {s.thiefBest}</small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

      <button className="game-card" disabled={s.tickets < 1} onClick={() => onPlay('stack')}>
        <span className="game-emoji">🏗️</span>
        <div className="game-info">
          <b>Stack Tower</b>
          <small>Apila pisos con precisión. Gana monedas y un boost de producción.</small>
          <small className="game-meta">🏆 Récord: {s.stackBest} pisos</small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

      <button className="game-card" disabled={s.tickets < 1} onClick={() => onPlay('merge')}>
        <span className="game-emoji">🧱</span>
        <div className="game-info">
          <b>Fusión</b>
          <small>Combina materiales. Gana gemas y edificios raros.</small>
          <small className="game-meta">
            🏆 Récord: {fmt(s.mergeBest)} · Mejor: {s.mergeBestTile || '-'}
          </small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

      <div className="section-head">
        <h2>Estrategia</h2>
      </div>

      <button className="game-card stocks" onClick={() => onPlay('stocks')}>
        <span className="game-emoji">📈</span>
        <div className="game-info">
          <b>Bolsa de la ciudad</b>
          <small>Compra barato, vende caro. El mercado es el mismo para todos los jugadores.</small>
          <small className="game-meta">{portfolio > 0 ? `Tu cartera: ${fmt(portfolio)} 🪙` : 'Invierte tus monedas'}</small>
        </div>
        <span className="game-cost">LIBRE</span>
      </button>
    </div>
  );
}
