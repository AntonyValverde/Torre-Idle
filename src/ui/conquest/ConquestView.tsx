import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../firebase';
import { dateKey, now } from '../../game/clock';
import { currentUid } from '../../game/cloud';
import {
  ALL_TILES,
  ASSAULT_COOLDOWN_MS,
  CENTER,
  CENTER_VALUE,
  SKEW_MS,
  TROOP_CAP,
  assaultWaitMs,
  attackPower,
  banditGarrison,
  garrisonAt,
  msUntilGarrison,
  nextTroopMs,
  ownerHue,
  recruitCap,
  recruitsToSend,
  seasonOf,
  seasonPrize,
  soldiersFor,
  standings,
  targetInfo,
  troopsAt,
  type TargetInfo,
  type Tile,
} from '../../game/conquest';
import { attackFrom, joinConquest, myWorld, reinforce, sendRecruits, watchWorld, type WorldData } from '../../game/conquestCloud';
import { fmtClock, fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { sfx, vibrate } from '../haptics';
import { ClaraTip } from '../ClaraTip';
import { celebrate } from '../celebrate';
import { ago } from '../../admin/metrics';
import { assaultLevel, fmtMult } from '../../minigames/towers/logic';
import { ConquestBoard } from './ConquestBoard';

const AssaultScreen = lazy(() => import('../../minigames/towers/AssaultScreen'));

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
  return (
    <>
      <ClaraTip id="conquest" cta="¡A conquistar!" />
      {world === null ? (
        <JoinCard week={season.week} endsAt={season.endsAt} onJoined={setWorld} />
      ) : (
        <WorldBoard week={season.week} w={world} endsAt={season.endsAt} onVisit={onVisit} />
      )}
    </>
  );
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
        <li>🏰 Recibes una capital en el borde del mapa. Nadie te la puede quitar. Genera 1 soldado cada 2 min.</li>
        <li>⚔️ Toca un territorio tuyo y luego uno vecino: lo atacas con sus soldados. Si mandas más de los que tiene, es tuyo.</li>
        <li>🏰 Asalto: antes de atacar, juega una batalla corta de la Guerra de torres. Si sale bien, tus soldados pegan hasta x1,5 (un bono cada 10 min).</li>
        <li>🛡️ Con la reserva (1 tropa cada 3 min, hasta {TROOP_CAP}, más los reclutas de misiones, retos e incidentes) refuerzas tus territorios.</li>
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
  // Último territorio propio tocado: desde él salen los ataques a sus vecinos
  const [src, setSrc] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState(now());
  // Asalto en juego y bono conseguido (vale para ese territorio hasta usarlo)
  const [assault, setAssault] = useState<{
    target: string;
    level: number;
    title: string;
  } | null>(null);
  const [bonus, setBonus] = useState<{ target: string; mult: number } | null>(null);
  // Cuándo se lanzó el último asalto a cada territorio: el tiempo de espera empieza al lanzarlo, no al
  // usar el bono, para que cerrar y volver a abrir el minijuego no sirva para repetirlo
  const assaultedAt = useRef<Map<string, number>>(new Map());
  const cap = useGame((st) => recruitCap(st.s));
  const recruiting = useRef(false);
  // Envío de reclutas que falló (día:cantidad): no se reintenta hasta que cambie
  const recruitsFailed = useRef('');

  useEffect(() => watchWorld(week, w, setData, (e) => (console.warn(e), setError(true))), [week, w]);
  // Los contadores (recarga, escudos, fin de temporada) avanzan cada segundo
  useEffect(() => {
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, []);

  const mine = data?.players.find((p) => p.uid === me) ?? null;

  // Foto de la reserva para los avisos de la tarjeta del Mapa del mundo, y partes de batalla vistos
  useEffect(() => {
    if (mine) useGame.getState().noteReserve(mine);
  }, [mine]);
  useEffect(() => {
    if (conquest.unread > 0) useGame.getState().readReports();
  }, [conquest.unread]);

  // Reclutas ganados hoy jugando: se suman a la reserva al abrir la conquista. Depende de los campos
  // sueltos (no del objeto `mine`, que es nuevo en cada foto del mundo) para no repetirse en bucle.
  const mineRDay = mine?.rDay;
  const mineRToday = mine?.rToday;
  useEffect(() => {
    const p = data?.players.find((x) => x.uid === me);
    if (!p || recruiting.current) return;
    const day = dateKey(now());
    const n = recruitsToSend(useGame.getState().s, p, day);
    if (n <= 0) return;
    const key = `${day}:${n}`;
    if (recruitsFailed.current === key) return;
    recruiting.current = true;
    sendRecruits(week, w, p, n, day, now())
      .then(() => useGame.getState().toast(`🎖️ +${n} reclutas para tu reserva`))
      .catch((e) => {
        recruitsFailed.current = key;
        console.warn('No se pudieron sumar los reclutas', e);
      })
      .finally(() => (recruiting.current = false));
  }, [mineRDay, mineRToday, conquest.day, conquest.recruits, week, w]);

  const rows = useMemo(() => (data ? standings(data.tiles.values(), data.players) : []), [data]);
  // Cada rival, el color de su casilla; tú, siempre azul
  const hueOf = useCallback((uid: string) => ownerHue(uid, me, data?.players.find((p) => p.uid === uid)?.slot), [data, me]);
  const ownSrc = src && data?.tiles.get(src)?.owner === me ? src : null;
  const info: TargetInfo | null = sel && data && me ? targetInfo(sel, data.tiles, me, t, ownSrc) : null;
  const reserve = Math.floor(mine ? troopsAt(mine, t - SKEW_MS) : 0);
  const fromTile = info?.kind === 'attack' ? data?.tiles.get(info.from) : undefined;
  // Soldados disponibles: los del territorio de origen (ataque) o los de la reserva (refuerzo)
  const can = info?.kind === 'attack' ? Math.floor(fromTile ? garrisonAt(fromTile, t - SKEW_MS) : 0) : reserve;
  const mult = bonus && bonus.target === sel ? bonus.mult : 1;
  // Soldados mínimos para conquistarlo (menos con el bono del asalto)
  const min = info?.kind === 'attack' ? soldiersFor(info.need, mult) : 1;

  // Al elegir un territorio, propone lo justo para conquistarlo (o 5 para reforzar)
  useEffect(() => {
    if (!info) return;
    setAmount(info.kind === 'attack' ? min : Math.max(1, Math.min(5, can)));
    // Solo al cambiar de territorio, de origen o de bono: después manda el jugador
  }, [sel, ownSrc, mult]);

  if (error) return <p className="empty">Se perdió la conexión con el mundo. Cierra y vuelve a abrir el mapa.</p>;
  if (!data || !me) return <p className="empty">Cargando el mundo…</p>;

  const tap = (id: string) => {
    if (data.tiles.get(id)?.owner === me) setSrc(id);
    setSel(sel === id ? null : id);
  };

  const send = async () => {
    if (!sel || !mine || !info || busy) return;
    setBusy(true);
    try {
      if (info.kind === 'attack') {
        await attackFrom(week, w, me, name, info.from, sel, amount, data, now(), mult);
        if (mult > 1) setBonus(null);
        useGame.getState().noteCapture();
        sfx('win');
        vibrate([20, 40, 20]);
        track('conquest_capture', {
          bandits: info.bandits ? 1 : 0,
          assault: mult > 1 ? 1 : 0,
        });
        useGame.getState().toast(info.bandits ? '⚔️ ¡Territorio conquistado a los bandidos!' : '⚔️ ¡Territorio conquistado!');
      } else {
        await reinforce(week, w, mine, name, sel, amount, data, now());
        sfx('buy');
        useGame.getState().toast(`🛡️ +${amount} soldados desde la reserva`);
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
  const nextMs = mine ? nextTroopMs(mine, t) : 0;
  // Espera para otro asalto: la de la nube (último bono usado) o la local (último asalto lanzado a este territorio)
  const localAssaultAt = sel ? (assaultedAt.current.get(sel) ?? 0) : 0;
  const assaultWait = Math.max(mine ? assaultWaitMs(mine, t) : 0, localAssaultAt ? localAssaultAt + ASSAULT_COOLDOWN_MS - t : 0);
  const recruitsToday = mine && mine.rDay === dateKey(t) ? mine.rToday : 0;
  // Territorios que se pueden atacar ahora: los vecinos del origen elegido, o de cualquier territorio tuyo
  const near = new Set<string>();
  for (const id of ALL_TILES) {
    const x = data.tiles.get(id);
    if (x && x.owner === me) continue;
    const tgt = targetInfo(id, data.tiles, me, t, ownSrc);
    if (tgt.kind === 'attack' && (!ownSrc || tgt.from === ownSrc)) near.add(id);
  }
  const tileLabel = (x: Tile | undefined) => (x?.capital ? 'tu capital 🏰' : 'tu territorio');
  const soldiers = (n: number) => `${n} ${n === 1 ? 'soldado' : 'soldados'}`;
  const growth = (x: Tile) => (x.capital ? '+1 cada 2 min' : '+1 cada 4 min');
  // Si al origen le faltan soldados: cuándo los tendrá (sin pasar del tope)
  const waitMs = info?.kind === 'attack' && fromTile && can < min ? msUntilGarrison(fromTile, min, t) + SKEW_MS : 0;

  const top = rows[0]?.points ?? 0;
  const chipEmoji = info?.kind === 'reserved' ? '🏗️' : tile?.capital ? '🏰' : sel === CENTER ? '👑' : tile ? (tile.owner === me ? '🛡️' : '⚔️') : '⛺';
  const chipColor = tile ? `hsl(${hueOf(tile.owner)} 60% 42%)` : sel === CENTER ? '#a67c1f' : info?.kind === 'reserved' ? '#1b2340' : '#5a3a2a';

  const startAssault = () => {
    if (!sel || info?.kind !== 'attack') return;
    const who = tile ? ownerName(tile.owner) : sel === CENTER ? 'la Torre central' : 'los bandidos';
    assaultedAt.current.set(sel, now());
    setAssault({
      target: sel,
      level: assaultLevel(info.need - 1),
      title: `Asalto a ${who}`,
    });
  };

  return (
    <div className="conquest">
      <div className="conquest-hud">
        <div className="cq-stat reserve">
          <small>🛡️ Reserva</small>
          <b>
            {reserve}
            <span>/{TROOP_CAP}</span>
          </b>
          <i className="cq-meter">
            <i
              style={{
                width: `${Math.min(100, (reserve / TROOP_CAP) * 100)}%`,
              }}
            />
          </i>
          <small>{nextMs > 0 ? `+1 en ${fmtClock(nextMs)}` : '¡Llena!'}</small>
        </div>
        <div className="cq-stat recruits">
          <small>🎖️ Reclutas hoy</small>
          <b>
            {recruitsToday}
            <span>/{cap}</span>
          </b>
          <i className="cq-meter">
            <i
              style={{
                width: `${Math.min(100, (recruitsToday / cap) * 100)}%`,
              }}
            />
          </i>
          <small>Por jugar al juego</small>
        </div>
        <div className="cq-stat season">
          <small>⏳ Termina en</small>
          <b className="cq-time">{fmtTime((endsAt - t) / 1000)}</b>
          <i className="cq-meter">
            <i
              style={{
                width: `${Math.max(0, Math.min(100, (1 - (endsAt - t) / (7 * 86_400_000)) * 100))}%`,
              }}
            />
          </i>
          <small>El domingo, el botín</small>
        </div>
      </div>

      <ConquestBoard
        tiles={data.tiles}
        me={me}
        t={t}
        sel={sel}
        src={ownSrc}
        near={near}
        arrow={info?.kind === 'attack' && sel ? { from: info.from, to: sel } : null}
        hueOf={hueOf}
        onTap={tap}
      />

      {sel && info ? (
        <div className="card conquest-panel">
          <div className="cq-panel-head">
            <span className="cq-chip" style={{ background: chipColor }}>
              {chipEmoji}
            </span>
            <div>
              <b>
                {info.kind === 'reserved'
                  ? 'Solar para una capital'
                  : tile?.owner === me
                    ? tile?.capital
                      ? 'Tu capital'
                      : 'Tu territorio'
                    : tile
                      ? `${tile.capital ? 'Capital' : 'Territorio'} de ${ownerName(tile.owner)}`
                      : sel === CENTER
                        ? 'Torre central (bandidos)'
                        : 'Campamento de bandidos'}
              </b>
              <small className="muted">
                {tile
                  ? `${soldiers(Math.floor(garrisonAt(tile, t)))}${tile.owner === me ? ` (${growth(tile)})` : ''}`
                  : info.kind === 'reserved'
                    ? 'Aquí llegará la capital de un nuevo alcalde.'
                    : `${banditGarrison(sel)} bandidos`}
                {sel === CENTER && ` · vale ${CENTER_VALUE} puntos`}
              </small>
            </div>
          </div>
          {info.kind === 'far' && <small>Está lejos: primero conquista un territorio que lo toque.</small>}
          {info.kind === 'capital' && <small>Las capitales no se pueden conquistar.</small>}
          {info.kind === 'shield' && <small>🛡️ Protegido otros {fmtClock(info.until - t)} tras su conquista.</small>}
          {info.kind === 'own' && <small>Toca un vecino con borde claro para atacarlo con los soldados de aquí, o refuérzalo desde la reserva:</small>}
          {info.kind === 'attack' && (
            <div className="cq-versus">
              <div className="cq-side me">
                <small>{mult > 1 ? `Tu fuerza (${fmtMult(mult)})` : 'Tus soldados'}</small>
                <b>{attackPower(Math.min(amount, Math.max(can, amount)), mult)}</b>
              </div>
              <span className="cq-vs">VS</span>
              <div className="cq-side foe">
                <small>{info.bandits ? 'Bandidos' : 'Defensores'}</small>
                <b>{info.need - 1}</b>
              </div>
              <i className={`cq-odds${attackPower(amount, mult) >= info.need ? ' win' : ''}`}>
                <i
                  style={{
                    width: `${Math.min(100, (attackPower(amount, mult) / (attackPower(amount, mult) + info.need - 1)) * 100)}%`,
                  }}
                />
              </i>
            </div>
          )}
          {info.kind === 'attack' && (
            <small>
              Atacas desde {tileLabel(fromTile)} ({soldiers(can)}).{' '}
              {mult > 1 ? `Con el bono ${fmtMult(mult)} bastan ${min} (fuerza ${attackPower(min, mult)} de ${info.need}).` : `Necesitas ${info.need}.`}
            </small>
          )}
          {info.kind === 'attack' &&
            (mult > 1 ? (
              <small className="conquest-bonus">🏰 Bono de asalto {fmtMult(mult)} listo para este ataque</small>
            ) : (
              <button className="btn conquest-assault" disabled={busy || assaultWait > 0} onClick={startAssault}>
                {assaultWait > 0 ? `🏰 Próximo asalto en ${fmtClock(assaultWait)}` : '🏰 Asalto: más fuerza, hasta x1,5'}
              </button>
            ))}
          {(info.kind === 'attack' || info.kind === 'own') && (
            <>
              <div className="conquest-amount">
                <button className="icon-btn" onClick={() => setAmount((a) => Math.max(min, a - 1))} aria-label="Menos">
                  −
                </button>
                <b>{amount}</b>
                <button className="icon-btn" onClick={() => setAmount((a) => Math.min(Math.max(min, can), a + 1))} aria-label="Más">
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
                    ? info.kind === 'attack'
                      ? Number.isFinite(waitMs)
                        ? `Tendrá ${min} soldados en ${fmtTime(waitMs / 1000)}`
                        : `No le caben ${min}: refuérzalo desde la reserva`
                      : `Te faltan ${amount - can} en la reserva`
                    : info.kind === 'attack'
                      ? `⚔️ Atacar con ${amount}`
                      : `🛡️ Reforzar con ${amount} de la reserva`}
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
        <p className="hint">Cada número son los soldados de un territorio. Toca uno tuyo y luego un vecino que brille para atacarlo con sus soldados.</p>
      )}

      <div className="card conquest-ranking">
        <b>Clasificación del mundo</b>
        <ol>
          {rows.map((r, i) => (
            <li
              key={r.uid}
              className={r.uid === me ? 'me' : ''}
              style={{
                ['--w' as string]: `${top > 0 ? Math.max(4, (r.points / top) * 100) : 0}%`,
                ['--c' as string]: `hsl(${hueOf(r.uid)} 65% 50%)`,
              }}
            >
              <span className="cq-rank">{i < 3 && r.points > 0 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              <span className="conquest-dot" style={{ background: `hsl(${hueOf(r.uid)} 65% 50%)` }} />
              <span className="conquest-name">
                {r.name}
                {r.center && ' 👑'}
              </span>
              <span className="muted">
                {r.tiles} {r.tiles === 1 ? 'territorio' : 'territorios'} · <b>{r.points} pts</b>
              </span>
            </li>
          ))}
        </ol>
        <small className="muted">
          Cierra el domingo a medianoche (hora de Costa Rica) y el premio se cobra al volver a entrar: hasta {seasonPrize(1, 2, 15).gems} 💎 y 3 🎟️ para el 1º,
          extra para el podio y, para todos, 5 💎 + 1 por punto (hasta 20).
        </small>
      </div>

      <ConquestReports />
      <ConquestHistory />

      {assault &&
        createPortal(
          <Suspense fallback={null}>
            <AssaultScreen
              title={assault.title}
              level={assault.level}
              onClose={() => setAssault(null)}
              onDone={(m) => {
                if (m > 1) setBonus({ target: assault.target, mult: m });
                setAssault(null);
              }}
            />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}
