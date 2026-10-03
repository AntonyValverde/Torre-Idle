import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../firebase';
import { dateKey, now } from '../../game/clock';
import { currentUid } from '../../game/cloud';
import {
  ALL_TILES,
  CENTER,
  CENTER_VALUE,
  RECRUITS_DAY,
  SKEW_MS,
  TROOP_CAP,
  banditGarrison,
  garrisonAt,
  isCapitalSlot,
  nextTroopMs,
  ownerHue,
  parseTile,
  recruitsToSend,
  seasonOf,
  seasonPrize,
  standings,
  targetInfo,
  troopsAt,
  type TargetInfo,
} from '../../game/conquest';
import { joinConquest, myWorld, sendRecruits, sendTroops, watchWorld, type WorldData } from '../../game/conquestCloud';
import { fmtClock, fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { sfx, vibrate } from '../haptics';
import { celebrate } from '../celebrate';
import { ago } from '../../admin/metrics';

/** Tamaño de un hexágono en el dibujo (radio). */
const SIZE = 10;
const SQ3 = Math.sqrt(3);
const center = (id: string) => {
  const h = parseTile(id)!;
  return { x: SIZE * SQ3 * (h.q + h.r / 2), y: SIZE * 1.5 * h.r };
};
const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(SIZE * 0.96 * Math.cos(a)).toFixed(2)},${(SIZE * 0.96 * Math.sin(a)).toFixed(2)}`;
}).join(' ');
const VIEW = `${-SIZE * SQ3 * 4.6} ${-SIZE * 7.2} ${SIZE * SQ3 * 9.2} ${SIZE * 14.4}`;

/** Pestaña Conquista del Mapa del mundo: unirse a la temporada y jugarla. */
export function ConquestView({ onVisit }: { onVisit: (uid: string) => void }) {
  const [world, setWorld] = useState<string | null | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);
  const season = seasonOf(now());

  useEffect(() => {
    let alive = true;
    setWorld(undefined);
    myWorld(season.week).then(
      (w) => {
        if (w) useGame.getState().setConquestWorld(season.week, w);
        if (alive) setWorld(w);
      },
      (e) => {
        console.warn(e);
        if (alive) setWorld('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [season.week, attempt]);

  if (world === undefined) return <p className="empty">Buscando tu mundo…</p>;
  if (world === 'error')
    return (
      <div className="daily-done">
        <div className="big-emoji">📡</div>
        <h2>No se pudo cargar la conquista</h2>
        <p className="muted">Revisa tu conexión e inténtalo de nuevo.</p>
        <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={() => setAttempt((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  if (world === null) return <JoinCard week={season.week} endsAt={season.endsAt} onJoined={setWorld} />;
  return <WorldBoard week={season.week} w={world} endsAt={season.endsAt} onVisit={onVisit} />;
}

function JoinCard({ week, endsAt, onJoined }: { week: string; endsAt: number; onJoined: (w: string) => void }) {
  const name = useGame((st) => st.s.name);
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try {
      const w = await joinConquest(week, name);
      useGame.getState().setConquestWorld(week, w);
      track('conquest_join', { week, w });
      sfx('win');
      celebrate(3);
      onJoined(w);
    } catch (e) {
      console.warn(e);
      useGame.getState().toast('⚠️ No se pudo unir a la conquista. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="conquest-join">
      <div className="big-emoji">⚔️</div>
      <h2>Conquista de la semana</h2>
      <p className="muted">Termina en {fmtTime((endsAt - now()) / 1000)}. Cada lunes empieza una temporada nueva.</p>
      <ul className="conquest-rules">
        <li>🏰 Recibes una capital en el borde del mapa. Nadie te la puede quitar.</li>
        <li>⚔️ Envía tropas a un territorio vecino para quitárselo a los bandidos o a otros alcaldes.</li>
        <li>⏱️ Tu reserva se recarga sola (1 tropa cada 3 min, hasta {TROOP_CAP}) y las misiones, retos e incidentes te dan reclutas.</li>
        <li>👑 La Torre central vale {CENTER_VALUE} puntos. Gana quien tenga más territorio el domingo.</li>
      </ul>
      <button className="btn primary big" disabled={busy} onClick={join}>
        {busy ? 'Uniéndote…' : '⚔️ Unirme a la conquista'}
      </button>
      <ConquestHistory />
    </div>
  );
}

/** Palmarés: temporadas ganadas, podios y los últimos resultados. */
function ConquestHistory() {
  const c = useGame((st) => st.s.conquest);
  if (!c.history.length) return null;
  return (
    <div className="card conquest-history">
      <b>
        ⚔️ Tu palmarés: {c.wins} {c.wins === 1 ? 'victoria' : 'victorias'} · {c.podiums} {c.podiums === 1 ? 'podio' : 'podios'}
      </b>
      <ul>
        {c.history
          .slice()
          .reverse()
          .map((h) => (
            <li key={h.week}>
              <span>
                {h.rank === 1 && h.size >= 2 ? '🏆' : h.rank <= 3 && h.size > h.rank ? '🎖️' : '⚔️'} Semana del {h.week.slice(8)}/{h.week.slice(5, 7)}
              </span>
              <span className="muted">
                {h.rank}º de {h.size} · {h.points} pts · +{h.gems} 💎
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Partes de batalla: quién te quitó territorios. */
function ConquestReports() {
  const reports = useGame((st) => st.s.conquest.reports);
  const week = useGame((st) => st.s.conquest.week);
  const t = now();
  const recent = reports.filter((r) => seasonOf(r.at).week === week);
  if (!recent.length) return null;
  return (
    <div className="card conquest-reports">
      <b>📜 Partes de batalla</b>
      <ul>
        {recent.map((r) => (
          <li key={`${r.at}-${r.tile}`}>
            <span>
              ⚔️ <b>{r.name}</b> te quitó un territorio
            </span>
            <small className="muted">{ago(r.at, t)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorldBoard({ week, w, endsAt, onVisit }: { week: string; w: string; endsAt: number; onVisit: (uid: string) => void }) {
  const me = currentUid();
  const name = useGame((st) => st.s.name);
  const conquest = useGame((st) => st.s.conquest);
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState(now());
  const recruiting = useRef(false);

  useEffect(() => watchWorld(week, w, setData, (e) => (console.warn(e), setError(true))), [week, w]);
  // Los contadores (recarga, escudos, fin de temporada) avanzan cada segundo
  useEffect(() => {
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, []);

  const mine = data?.players.find((p) => p.uid === me) ?? null;

  // Reclutas ganados hoy jugando: se suman a la reserva al abrir la conquista
  useEffect(() => {
    if (!mine || recruiting.current) return;
    const day = dateKey(now());
    const n = recruitsToSend(useGame.getState().s, mine, day);
    if (n <= 0) return;
    recruiting.current = true;
    sendRecruits(week, w, mine, n, day, now())
      .then(() => useGame.getState().toast(`🎖️ +${n} reclutas para tu reserva`))
      .catch((e) => console.warn('No se pudieron sumar los reclutas', e))
      .finally(() => (recruiting.current = false));
  }, [mine, conquest, week, w]);

  const rows = useMemo(() => (data ? standings(data.tiles.values(), data.players) : []), [data]);
  const info: TargetInfo | null = sel && data && me ? targetInfo(sel, data.tiles, me, t) : null;
  const troops = mine ? troopsAt(mine, t - SKEW_MS) : 0;
  const can = Math.floor(troops);

  // Al elegir un territorio, propone lo justo para conquistarlo (o 5 para reforzar)
  useEffect(() => {
    if (!info) return;
    setAmount((a) => (info.kind === 'attack' ? Math.max(info.need, Math.min(a, can)) : Math.min(Math.max(a, 1), Math.max(1, Math.min(5, can)))));
    // Solo al cambiar de territorio: después manda el jugador
  }, [sel]);

  if (error) return <p className="empty">Se perdió la conexión con el mundo. Cierra y vuelve a abrir el mapa.</p>;
  if (!data || !me) return <p className="empty">Cargando el mundo…</p>;

  const send = async () => {
    if (!sel || !mine || !info || busy) return;
    setBusy(true);
    try {
      await sendTroops(week, w, mine, name, sel, amount, data, now());
      if (info.kind === 'attack') {
        sfx('win');
        vibrate([20, 40, 20]);
        track('conquest_capture', { bandits: info.bandits ? 1 : 0 });
        useGame.getState().toast(info.bandits ? '⚔️ ¡Territorio conquistado a los bandidos!' : '⚔️ ¡Territorio conquistado!');
      } else {
        sfx('buy');
        useGame.getState().toast(`🛡️ +${amount} de guarnición`);
      }
    } catch (e) {
      console.warn(e);
      const code = (e as { code?: string })?.code;
      useGame.getState().toast(code === 'permission-denied' ? '⚠️ El mapa cambió: vuelve a intentarlo' : `⚠️ ${(e as Error).message || 'No se pudo enviar'}`);
    } finally {
      setBusy(false);
    }
  };

  const tile = sel ? data.tiles.get(sel) : undefined;
  const ownerName = (uid: string) => data.players.find((p) => p.uid === uid)?.name ?? data.tiles.get(sel ?? '')?.name ?? '???';
  const min = info?.kind === 'attack' ? info.need : 1;
  const nextMs = mine ? nextTroopMs(mine, t) : 0;

  return (
    <div className="conquest">
      <div className="conquest-hud">
        <div>
          <small>Tropas</small>
          <b>
            ⚔️ {can}
            <span>/{TROOP_CAP}</span>
          </b>
          <small>{nextMs > 0 ? `+1 en ${fmtClock(nextMs)}` : 'Reserva llena'}</small>
        </div>
        <div>
          <small>Reclutas hoy</small>
          <b>
            🎖️ {mine && mine.rDay === dateKey(t) ? mine.rToday : 0}
            <span>/{RECRUITS_DAY}</span>
          </b>
          <small>Misiones, retos, incidentes</small>
        </div>
        <div>
          <small>Termina en</small>
          <b>⏳</b>
          <small>{fmtTime((endsAt - t) / 1000)}</small>
        </div>
      </div>

      <svg className="conquest-map" viewBox={VIEW} role="img" aria-label="Mapa de la conquista">
        {ALL_TILES.map((id) => {
          const c = center(id);
          const owned = data.tiles.get(id);
          const reserved = !owned && isCapitalSlot(id);
          const near = !owned || owned.owner !== me ? targetInfo(id, data.tiles, me, t).kind === 'attack' : false;
          const hue = owned ? ownerHue(owned.owner, me) : 0;
          const fill = owned ? `hsl(${hue} ${owned.owner === me ? 75 : 55}% ${owned.owner === me ? 48 : 40}%)` : reserved ? '#1a1f36' : id === CENTER ? '#5a4a1e' : '#343a58';
          const g = owned ? Math.floor(garrisonAt(owned, t)) : reserved ? null : banditGarrison(id);
          const shield = owned && !owned.capital && t < owned.ct + 30 * 60_000;
          const cls = ['conquest-hex', sel === id && 'sel', near && 'near', reserved && 'reserved', owned?.owner === me && 'mine'].filter(Boolean).join(' ');
          return (
            <g key={id} data-tile={id} className={cls} transform={`translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`} onClick={() => setSel(sel === id ? null : id)}>
              <polygon points={HEX_POINTS} fill={fill} />
              {owned?.capital && <text y={-3} fontSize={6} textAnchor="middle">🏰</text>}
              {id === CENTER && !owned?.capital && <text y={-3} fontSize={6} textAnchor="middle">👑</text>}
              {shield && <text x={5} y={-3} fontSize={4.5} textAnchor="middle">🛡️</text>}
              {g !== null && (
                <text y={owned?.capital || id === CENTER ? 5 : 2} fontSize={owned ? 5 : 4.4} textAnchor="middle" className={owned ? 'conquest-g' : 'conquest-g bandit'}>
                  {g}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sel && info ? (
        <div className="card conquest-panel">
          <b>
            {info.kind === 'reserved'
              ? '🏗️ Solar para una capital'
              : tile?.owner === me
                ? tile?.capital
                  ? '🏰 Tu capital'
                  : '🟦 Tu territorio'
                : tile
                  ? `${tile.capital ? '🏰 Capital' : '⚔️ Territorio'} de ${ownerName(tile.owner)}`
                  : sel === CENTER
                    ? '👑 Torre central (bandidos)'
                    : '🏴‍☠️ Bandidos'}
          </b>
          <small className="muted">
            {tile ? `Guarnición ${Math.floor(garrisonAt(tile, t))}` : info.kind === 'reserved' ? 'Aquí llegará la capital de un nuevo alcalde.' : `Guarnición ${banditGarrison(sel)}`}
            {sel === CENTER && ` · vale ${CENTER_VALUE} puntos`}
          </small>
          {info.kind === 'far' && <small>Necesitas un territorio vecino para atacarlo.</small>}
          {info.kind === 'capital' && <small>Las capitales no se pueden conquistar.</small>}
          {info.kind === 'shield' && <small>🛡️ Protegido otros {fmtClock(info.until - t)} tras su conquista.</small>}
          {(info.kind === 'attack' || info.kind === 'reinforce') && (
            <>
              <div className="conquest-amount">
                <button className="icon-btn" onClick={() => setAmount((a) => Math.max(min, a - 1))} aria-label="Menos">
                  −
                </button>
                <b>{amount}</b>
                <button className="icon-btn" onClick={() => setAmount((a) => Math.min(can, a + 1))} aria-label="Más">
                  +
                </button>
                <button className="btn" onClick={() => setAmount(Math.max(min, can))}>
                  Todo ({can})
                </button>
              </div>
              <button className="btn primary" disabled={busy || amount > can || amount < min} onClick={send}>
                {busy
                  ? 'Enviando…'
                  : amount > can
                    ? `Faltan ${amount - can} tropas`
                    : info.kind === 'attack'
                      ? `⚔️ Conquistar con ${amount} (mínimo ${info.need})`
                      : `🛡️ Reforzar con ${amount}`}
              </button>
            </>
          )}
          {tile && tile.owner !== me && (
            <button className="btn" onClick={() => onVisit(tile.owner)}>
              👀 Ver su ciudad
            </button>
          )}
        </div>
      ) : (
        <p className="hint">Toca un territorio vecino a los tuyos (con borde claro) para conquistarlo, o uno tuyo para reforzarlo.</p>
      )}

      <div className="card conquest-ranking">
        <b>Clasificación del mundo</b>
        <ol>
          {rows.map((r, i) => (
            <li key={r.uid} className={r.uid === me ? 'me' : ''}>
              <span className="conquest-dot" style={{ background: `hsl(${ownerHue(r.uid, me)} 65% 50%)` }} />
              <span className="conquest-name">
                {i + 1}. {r.name}
                {r.center && ' 👑'}
              </span>
              <span className="muted">
                {r.tiles} {r.tiles === 1 ? 'territorio' : 'territorios'} · <b>{r.points} pts</b>
              </span>
            </li>
          ))}
        </ol>
        <small className="muted">
          Cierra el domingo a medianoche (hora de Costa Rica) y el premio se cobra al volver a entrar: hasta {seasonPrize(1, 2, 15).gems} 💎 y 3 🎟️ para el
          1º, extra para el podio y, para todos, 5 💎 + 1 por punto (hasta 20).
        </small>
      </div>

      <ConquestReports />
      <ConquestHistory />
    </div>
  );
}
