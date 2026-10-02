import { useEffect, useState } from 'react';
import { track } from '../../firebase';
import {
  CASINO_SHOP,
  DAILY_BUY_MAX,
  PACK_CHIPS,
  VIP,
  WELCOME_CHIPS,
  buyPacks,
  buyShopItem,
  casinoToday,
  claimBonus,
  claimWelcome,
  dailyBonus,
  maxBet,
  packPrice,
  packsLeft,
  settleRocket,
  vipIndex,
  type ShopId,
} from '../../game/casino';
import { msUntilTomorrow, now } from '../../game/clock';
import { CARDS } from '../../game/cup';
import { fmt, fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { sfx, vibrate } from '../../ui/haptics';
import { GameScreen } from '../../ui/Modal';
import { BlackjackGame } from './BlackjackGame';
import { HiLoGame } from './HiLoGame';
import { RocketGame } from './RocketGame';
import { RouletteGame } from './RouletteGame';
import { ScratchGame } from './ScratchGame';
import { SlotsGame } from './SlotsGame';
import { act, chips, fmtChips } from './common';
import './casino.css';

type CasinoGame = 'slots' | 'blackjack' | 'roulette' | 'rocket' | 'scratch' | 'hilo';

const GAMES: { id: CasinoGame; emoji: string; name: string; desc: string }[] = [
  { id: 'slots', emoji: '🎰', name: 'Tragaperras', desc: 'Avenida de la suerte' },
  { id: 'blackjack', emoji: '🃏', name: 'Blackjack', desc: 'Llega a 21' },
  { id: 'roulette', emoji: '🎡', name: 'Ruleta', desc: 'Europea, un cero' },
  { id: 'rocket', emoji: '🚀', name: 'Cohete', desc: 'Cobra antes de que explote' },
  { id: 'scratch', emoji: '🎟️', name: 'Raspa y gana', desc: 'Uno gratis al día' },
  { id: 'hilo', emoji: '🔼', name: 'Más alto o más bajo', desc: 'Encadena aciertos' },
];

export function CasinoScreen({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.s);
  const c = s.casino;
  const [game, setGame] = useState<CasinoGame | null>(null);
  const t = now();
  const today = casinoToday(c, t);

  // Al entrar: cierra un vuelo del cohete que terminó mientras no se miraba
  useEffect(() => {
    const r = act((x) => settleRocket(x, now()));
    if (r) useGame.getState().toast(r.win > 0 ? `🚀 Cobro automático: +${chips(r.win)}` : `🚀 Tu cohete explotó en x${r.run.crash.toFixed(2)}`);
    track('casino_open');
  }, []);

  const vip = vipIndex(c);
  const next = VIP[vip + 1];
  const progress = next ? (c.wagered - VIP[vip].at) / (next.at - VIP[vip].at) : 1;
  const price = packPrice(s, t);
  const left = packsLeft(s, t);

  const welcome = () => {
    const r = act(claimWelcome);
    if (r) {
      sfx('win');
      vibrate([20, 40, 60]);
      useGame.getState().toast(`🎰 ¡Bienvenido al casino! +${chips(r.chips)}`);
    }
  };

  const bonus = () => {
    const r = act((x) => claimBonus(x, now()));
    if (r) {
      sfx('win');
      useGame.getState().toast(`🎁 Bono diario: +${chips(r.chips)}`);
    }
  };

  const buy = (packs: number) => {
    const r = act((x) => buyPacks(x, now(), packs));
    if (r) {
      sfx('buy');
      track('casino_buy', { packs });
      useGame.getState().toast(`+${chips(r.chips)} por ${fmt(r.cost)} 🪙`);
    }
  };

  const shop = (id: ShopId) => {
    const r = act((x) => buyShopItem(x, id, now(), Math.random));
    if (!r) return;
    sfx('buy');
    track('casino_shop', { item: id });
    const item = CASINO_SHOP.find((i) => i.id === id)!;
    useGame.getState().toast(r.card ? `${CARDS[r.card].emoji} Carta de la Copa: ${CARDS[r.card].name}` : `${item.emoji} ${item.name}: ${item.desc}`);
  };

  const info = game ? GAMES.find((g) => g.id === game)! : null;

  return (
    <GameScreen title={info ? `${info.emoji} ${info.name}` : '🎰 Casino'} right={chips(c.chips)} onClose={info ? () => setGame(null) : onClose}>
      <div className="cas-scroll">
        {game === 'slots' && <SlotsGame />}
        {game === 'blackjack' && <BlackjackGame />}
        {game === 'roulette' && <RouletteGame />}
        {game === 'rocket' && <RocketGame />}
        {game === 'scratch' && <ScratchGame />}
        {game === 'hilo' && <HiLoGame />}

        {!game && (
          <div className="cas-lobby">
            <div className="cas-hero">
              <div className="cas-neon">CASINO</div>
              <div className="cas-hero-chips">{chips(c.chips)}</div>
              <div className="cas-vip">
                <span>
                  {VIP[vip].emoji} Socio {VIP[vip].name} · apuesta máx. {chips(maxBet(c))}
                </span>
                {next && (
                  <>
                    <div className="cas-vip-bar">
                      <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
                    </div>
                    <small>
                      Apuesta {fmtChips(next.at - c.wagered)} más para {next.emoji} {next.name}
                    </small>
                  </>
                )}
              </div>
            </div>

            {!c.welcome ? (
              <button className="btn primary big cas-gift" onClick={welcome}>
                🎁 Regalo de bienvenida · +{chips(WELCOME_CHIPS)}
              </button>
            ) : (
              <button className="btn primary big cas-gift" disabled={today.bonus} onClick={bonus}>
                {today.bonus ? `Bono de hoy cobrado · vuelve en ${fmtTime(msUntilTomorrow(t) / 1000)}` : `🎁 Bono diario · +${chips(dailyBonus(s))}`}
              </button>
            )}

            <div className="cas-games">
              {GAMES.map((g) => (
                <button key={g.id} className={`cas-tile ${g.id}`} onClick={() => setGame(g.id)}>
                  <span className="cas-tile-emoji">{g.emoji}</span>
                  <b>{g.name}</b>
                  <small>
                    {g.id === 'scratch' && !today.freeScratch
                      ? '¡Gratis hoy!'
                      : (g.id === 'blackjack' && c.bj && !c.bj.result) || (g.id === 'hilo' && c.hilo && !c.hilo.result) || (g.id === 'rocket' && c.rocket)
                        ? 'Partida a medias'
                        : g.desc}
                  </small>
                </button>
              ))}
            </div>

            <div className="section-head">
              <h2>Cambio</h2>
              <small className="muted">
                Hoy: {fmtChips(today.bought)}/{fmtChips(DAILY_BUY_MAX)} 🎰
              </small>
            </div>
            <div className="card cas-exchange">
              <div>
                <b>{chips(PACK_CHIPS)}</b>
                <small className="muted"> por {fmt(price)} 🪙 (10 min de producción)</small>
              </div>
              <div className="btn-row">
                <button className="btn" disabled={left < 1 || s.coins < price} onClick={() => buy(1)}>
                  Comprar 1
                </button>
                <button className="btn" disabled={left < 5 || s.coins < price * 5} onClick={() => buy(5)}>
                  Comprar 5
                </button>
              </div>
              <small className="muted">Las fichas no se pueden volver a cambiar por monedas: se gastan en la tienda del casino.</small>
            </div>

            <div className="section-head">
              <h2>Tienda del casino</h2>
            </div>
            <div className="cas-shop">
              {CASINO_SHOP.map((i) => (
                <button key={i.id} className="cas-shop-item" disabled={c.chips < i.price} onClick={() => shop(i.id)}>
                  <span className="cas-shop-emoji">{i.emoji}</span>
                  <span className="cas-shop-info">
                    <b>{i.name}</b>
                    <small>{i.desc}</small>
                  </span>
                  <span className="cas-shop-price">{chips(i.price)}</span>
                </button>
              ))}
            </div>

            <p className="hint cas-rules">
              Juego con fichas de mentira: no se puede pagar ni cobrar dinero real. Partidas jugadas: {fmt(c.hands)} · mayor premio: {chips(c.best)}.
            </p>
          </div>
        )}
      </div>
    </GameScreen>
  );
}
