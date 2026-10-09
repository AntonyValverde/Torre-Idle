import { dateKey, isNewDay, msUntilTomorrow, now } from '../game/clock';
import { maxTickets, ticketRegenMs } from '../game/economy';
import { fmt, fmtClock, fmtTime } from '../game/format';
import { STOCKS, saleValue, stockPrice } from '../game/stocks';
import { useGame } from '../game/store';
import { currentStep, isUnlocked } from '../game/tutorial';
import { vipReady } from '../game/legacy';
import { CASINO_ERA, casinoOpen, casinoToday } from '../game/casino';
import { CupCard } from './cup/CupCard';
import { ClaraTip } from './ClaraTip';
import { WAR_GAMES, WAR_INFO, type ShooterGame, type WarGame } from '../game/war';

export type GameId =
  | 'stack'
  | 'merge'
  | 'daily'
  | 'roads'
  | 'parks'
  | 'wheel'
  | 'thief'
  | 'stocks'
  | 'traffic'
  | 'memory'
  | 'fire'
  | 'metro'
  | 'casino'
  | 'towers'
  | WarGame;

/** Juegos que cuestan un ticket al entrar. */
export const TICKET_GAMES: GameId[] = ['stack', 'merge', 'thief', 'traffic', 'memory', 'fire', 'metro', 'towers', ...WAR_GAMES];

const NEW_TAG = <span className="new-tag">NUEVO</span>;

/** Los shooters: qué se hace en cada uno y de qué tipo de juego es. */
const SHOOTERS: { id: ShooterGame; genre: string; text: string }[] = [
  { id: 'squadron', genre: 'Matamarcianos', text: 'Pilota el avión de la ciudad contra oleadas enemigas. Monedas, hangar y dirigibles jefe.' },
  { id: 'sentry', genre: 'Defensa de torre', text: 'Tu torre dispara sola: gasta monedas en mejoras sin parar y aguanta oleadas y jefes.' },
  { id: 'night', genre: 'Supervivencia', text: 'Patrulla la plaza de noche: tus armas disparan solas. Sube de nivel y aguanta al amanecer.' },
  { id: 'sewer', genre: 'Roguelite', text: 'Roguelite de salas: quieto disparas, moviéndote esquivas. Mejora tu taller con chatarra.' },
  { id: 'neon', genre: 'Dos joysticks', text: 'Twin-stick de neón: mueve con un pulgar, dispara con el otro y sube el multiplicador.' },
  { id: 'cannon', genre: 'Juego de mejoras', text: 'Lanza al alcalde con el cañón de la feria y mejora el taller para volar cada vez más lejos.' },
];

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
  // Pase VIP (legado): una partida de arcade gratis cada hora
  const vip = vipReady(s, t);
  const canPlay = vip || s.tickets >= 1;
  const portfolio = STOCKS.reduce((n, d) => n + (s.stocks[d.id] ? saleValue(s.stocks[d.id].u, stockPrice(d, s.lastTick)) : 0), 0);

  const tut = currentStep(s)?.id;

  return (
    <div className="tab">
      <ClaraTip id="games" />
      {isUnlocked(s, 'cup') && <CupCard onOpen={onCup} />}

      <div className="ticket-banner">
        <span className="ticket-big">🎟️ {s.tickets}/{max}</span>
        <span className="muted">{s.tickets >= max ? 'Tickets llenos: ¡juega ya!' : `Próximo ticket en ${fmtClock(nextTicket)}`}</span>
      </div>

      <div className={`section-head${tut === 'daily' ? ' tut-target' : ''}`}>
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

      <div className="section-head">
        <h2>Acción</h2>
        <small className="muted">{vip ? '🏆 Partida VIP gratis' : '1 🎟️ por partida'}</small>
      </div>

      {SHOOTERS.map((g) => (
        <button key={g.id} className={`game-card shooter ${g.id}`} disabled={!canPlay} onClick={() => onPlay(g.id)}>
          <span className="game-emoji">{WAR_INFO[g.id].emoji}</span>
          <div className="game-info">
            <b>
              {WAR_INFO[g.id].name} {NEW_TAG}
            </b>
            <small>{g.text}</small>
            <small className="game-meta">
              {g.genre} · 🏆 Récord: {s[WAR_INFO[g.id].best]} {WAR_INFO[g.id].unit}
            </small>
          </div>
          <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
        </button>
      ))}

      <div className={`section-head${tut === 'arcade' ? ' tut-target' : ''}`}>
        <h2>Arcade</h2>
        <small className="muted">{vip ? '🏆 Partida VIP gratis' : '1 🎟️ por partida'}</small>
      </div>

      <button className="game-card towers" disabled={!canPlay} onClick={() => onPlay('towers')}>
        <span className="game-emoji">🏰</span>
        <div className="game-info">
          <b>Guerra de torres {NEW_TAG}</b>
          <small>Arrastra de tu torre a otra vecina para enviar soldados. ¡Conquista todas las del rival!</small>
          <small className="game-meta">🏆 Récord: {s.towersBest} pts</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card flak" disabled={!canPlay} onClick={() => onPlay('flak')}>
        <span className="game-emoji">🛡️</span>
        <div className="game-info">
          <b>Defensa antiaérea {NEW_TAG}</b>
          <small>Toca el cielo para derribar lo que cae sobre tu ciudad. ¡Las explosiones encadenadas puntúan más!</small>
          <small className="game-meta">🏆 Récord: {s.flakBest} pts</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card artillery" disabled={!canPlay} onClick={() => onPlay('artillery')}>
        <span className="game-emoji">🎯</span>
        <div className="game-info">
          <b>Artillería {NEW_TAG}</b>
          <small>Apunta el cañón de la muralla y frena las máquinas de asedio. Ojo con el viento.</small>
          <small className="game-meta">🏆 Récord: {s.artilleryBest} pts</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card lanes" disabled={!canPlay} onClick={() => onPlay('lanes')}>
        <span className="game-emoji">🚧</span>
        <div className="game-info">
          <b>Defensa de calles {NEW_TAG}</b>
          <small>Construye torretas, barricadas y cañones para que no lleguen al ayuntamiento.</small>
          <small className="game-meta">🏆 Récord: {s.lanesBest} pts</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card duel" disabled={!canPlay} onClick={() => onPlay('duel')}>
        <span className="game-emoji">🎖️</span>
        <div className="game-info">
          <b>Duelo de generales {NEW_TAG}</b>
          <small>Infantería, arqueros o caballería: lee la manía de cada general y gana sus batallas.</small>
          <small className="game-meta">🏆 Récord: {s.duelBest} pts</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card fire" disabled={!canPlay} onClick={() => onPlay('fire')}>
        <span className="game-emoji">🚒</span>
        <div className="game-info">
          <b>Bomberos {NEW_TAG}</b>
          <small>Apaga los incendios antes de que se extiendan. ¡Cuida el agua!</small>
          <small className="game-meta">🏆 Récord: {s.fireBest}</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card metro" disabled={!canPlay} onClick={() => onPlay('metro')}>
        <span className="game-emoji">🚇</span>
        <div className="game-info">
          <b>Metro {NEW_TAG}</b>
          <small>Traza líneas entre estaciones y lleva a cada viajero a su destino. Gana un boost.</small>
          <small className="game-meta">🏆 Récord: {s.metroBest} viajeros</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card" disabled={!canPlay} onClick={() => onPlay('thief')}>
        <span className="game-emoji">🦹</span>
        <div className="game-info">
          <b>Atrapa al ladrón</b>
          <small>30 segundos de reflejos. ¡No toques a los vecinos!</small>
          <small className="game-meta">🏆 Récord: {s.thiefBest}</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card" disabled={!canPlay} onClick={() => onPlay('stack')}>
        <span className="game-emoji">🏗️</span>
        <div className="game-info">
          <b>Stack Tower</b>
          <small>Apila pisos con precisión. Gana monedas y un boost de producción.</small>
          <small className="game-meta">🏆 Récord: {s.stackBest} pisos</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card" disabled={!canPlay} onClick={() => onPlay('traffic')}>
        <span className="game-emoji">🚦</span>
        <div className="game-info">
          <b>Semáforo</b>
          <small>Cambia el semáforo para que los coches crucen sin chocar. Gana un boost de producción.</small>
          <small className="game-meta">🏆 Récord: {s.trafficBest} coches</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card" disabled={!canPlay} onClick={() => onPlay('memory')}>
        <span className="game-emoji">🧠</span>
        <div className="game-info">
          <b>Memoria de ventanas</b>
          <small>Repite la secuencia de luces. Si llegas lejos, recuperas hasta 4 tickets.</small>
          <small className="game-meta">🏆 Récord: {s.memoryBest} rondas</small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
      </button>

      <button className="game-card" disabled={!canPlay} onClick={() => onPlay('merge')}>
        <span className="game-emoji">🧱</span>
        <div className="game-info">
          <b>Fusión</b>
          <small>Combina materiales. Gana gemas y edificios raros.</small>
          <small className="game-meta">
            🏆 Récord: {fmt(s.mergeBest)} · Mejor: {s.mergeBestTile || '-'}
          </small>
        </div>
        <span className="game-cost">{vip ? 'VIP' : '🎟️1'}</span>
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

          <div className="section-head">
            <h2>Casino</h2>
            {casinoOpen(s) && <small className="muted">🎰 {fmt(s.casino.chips)} fichas</small>}
          </div>

          <button className="game-card casino" disabled={!casinoOpen(s)} onClick={() => onPlay('casino')}>
            <span className="game-emoji">🎰</span>
            <div className="game-info">
              <b>Casino de la ciudad {casinoOpen(s) && NEW_TAG}</b>
              <small>Tragaperras, blackjack, ruleta, cohete, rasca y gana y más alto o más bajo. Se juega con fichas.</small>
              <small className="game-meta">
                {!casinoOpen(s)
                  ? `🔒 Abre en la era ${CASINO_ERA}: refunda tu ciudad`
                  : !s.casino.welcome
                    ? '🎁 ¡Regalo de bienvenida!'
                    : !casinoToday(s.casino, t).bonus
                      ? '🎁 Bono diario disponible'
                      : 'Tienda de premios con tus fichas'}
              </small>
            </div>
            <span className="game-cost">{casinoOpen(s) ? 'FICHAS' : '🔒'}</span>
          </button>
        </>
      )}
    </div>
  );
}
