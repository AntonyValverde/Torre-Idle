import { dateKey, isNewDay, msUntilTomorrow, now } from '../game/clock';
import { maxTickets, ticketRegenMs } from '../game/economy';
import { fmt, fmtClock, fmtTime } from '../game/format';
import { STOCKS, saleValue, stockPrice } from '../game/stocks';
import { useGame } from '../game/store';
import { currentStep, isUnlocked } from '../game/tutorial';
import { CupCard } from './cup/CupCard';

export type GameId = 'stack' | 'merge' | 'daily' | 'roads' | 'parks' | 'wheel' | 'thief' | 'stocks' | 'traffic' | 'memory' | 'fire' | 'metro';

/** Juegos que cuestan un ticket al entrar. */
export const TICKET_GAMES: GameId[] = ['stack', 'merge', 'thief', 'traffic', 'memory', 'fire', 'metro'];

const NEW_TAG = <span className="new-tag">NUEVO</span>;

export function GamesTab({ onPlay, onCup }: { onPlay: (g: GameId) => void; onCup: () => void }) {
  const s = useGame((st) => st.s);
  const max = maxTickets(s);
  // El día sale de la misma hora que usan los retos y la rueda al jugar (now()); lastTick puede ir
  // por delante si la partida venía "del futuro" y entonces mostraría "gratis" cuando no lo es
  const t = now();
  const today = dateKey(t);
  const dailyDone = !isNewDay(s.daily.last, today);
  const roadsDone = !isNewDay(s.roads.last, today);
  const parksDone = !isNewDay(s.parks.last, today);
  const wheelFree = isNewDay(s.wheelLast, today);
  const nextTicket = ticketRegenMs(s) - (s.lastTick - s.ticketTime);
  const untilTomorrow = fmtTime(msUntilTomorrow(t) / 1000);
  const portfolio = STOCKS.reduce((n, d) => n + (s.stocks[d.id] ? saleValue(s.stocks[d.id].u, stockPrice(d, s.lastTick)) : 0), 0);

  const tut = currentStep(s)?.id;

  return (
    <div className="tab">
      {isUnlocked(s, 'cup') && <CupCard onOpen={onCup} />}

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

      <button className={`game-card roads${roadsDone ? ' done' : ''}`} onClick={() => onPlay('roads')}>
        <span className="game-emoji">🛣️</span>
        <div className="game-info">
          <b>Conecta las calles</b>
          <small>Gira los tramos hasta unir las casas con el ayuntamiento. Mismo plano para todos.</small>
          <small className="game-meta">
            🔥 Racha {s.roads.streak} · {roadsDone ? `Nuevo en ${untilTomorrow}` : '¡Disponible!'}
          </small>
        </div>
        <span className="game-cost">{roadsDone ? '✅' : 'GRATIS'}</span>
      </button>

      <button className={`game-card parks${parksDone ? ' done' : ''}`} onClick={() => onPlay('parks')}>
        <span className="game-emoji">🌳</span>
        <div className="game-info">
          <b>Plan verde {NEW_TAG}</b>
          <small>Reparte casas y parques: mitad y mitad en cada fila y columna, sin tres iguales seguidos.</small>
          <small className="game-meta">
            🔥 Racha {s.parks.streak} · {parksDone ? `Nuevo en ${untilTomorrow}` : '¡Disponible!'}
          </small>
        </div>
        <span className="game-cost">{parksDone ? '✅' : 'GRATIS'}</span>
      </button>

      <button className={`game-card fortune${wheelFree ? '' : ' done'}${tut === 'wheel' ? ' tut-target' : ''}`} onClick={() => onPlay('wheel')}>
        <span className="game-emoji">🎡</span>
        <div className="game-info">
          <b>Rueda de la fortuna</b>
          <small>Un giro gratis cada día. Premios de monedas, gemas, boosts… ¡y edificios raros!</small>
          <small className="game-meta">{wheelFree ? '¡Giro gratis disponible!' : `Gratis de nuevo en ${untilTomorrow}`}</small>
        </div>
        <span className="game-cost">{wheelFree ? 'GRATIS' : '🎟️1'}</span>
      </button>

      <div className={`section-head${tut === 'arcade' ? ' tut-target' : ''}`}>
        <h2>Arcade</h2>
        <small className="muted">1 🎟️ por partida</small>
      </div>

      <button className="game-card fire" disabled={s.tickets < 1} onClick={() => onPlay('fire')}>
        <span className="game-emoji">🚒</span>
        <div className="game-info">
          <b>Bomberos {NEW_TAG}</b>
          <small>Apaga los incendios antes de que se extiendan. ¡Cuida el agua!</small>
          <small className="game-meta">🏆 Récord: {s.fireBest}</small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

      <button className="game-card metro" disabled={s.tickets < 1} onClick={() => onPlay('metro')}>
        <span className="game-emoji">🚇</span>
        <div className="game-info">
          <b>Metro {NEW_TAG}</b>
          <small>Traza líneas entre estaciones y lleva a cada viajero a su destino. Gana un boost.</small>
          <small className="game-meta">🏆 Récord: {s.metroBest} viajeros</small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

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

      <button className="game-card" disabled={s.tickets < 1} onClick={() => onPlay('traffic')}>
        <span className="game-emoji">🚦</span>
        <div className="game-info">
          <b>Semáforo</b>
          <small>Cambia el semáforo para que los coches crucen sin chocar. Gana un boost de producción.</small>
          <small className="game-meta">🏆 Récord: {s.trafficBest} coches</small>
        </div>
        <span className="game-cost">🎟️1</span>
      </button>

      <button className="game-card" disabled={s.tickets < 1} onClick={() => onPlay('memory')}>
        <span className="game-emoji">🧠</span>
        <div className="game-info">
          <b>Memoria de ventanas</b>
          <small>Repite la secuencia de luces. Si llegas lejos, recuperas hasta 4 tickets.</small>
          <small className="game-meta">🏆 Récord: {s.memoryBest} rondas</small>
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

      {isUnlocked(s, 'stocks') && (
        <>
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
        </>
      )}
    </div>
  );
}
