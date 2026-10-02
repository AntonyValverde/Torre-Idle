import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloudEnabled, track } from '../../firebase';
import { now } from '../../game/clock';
import { currentUid } from '../../game/cloud';
import {
  CARDS,
  CARD_IDS,
  CUP_GAME_INFO,
  FANS_FINAL,
  FANS_GROUPS,
  GROUP_SLOTS,
  PICK_STAKES,
  SIGNUP_DAYS,
  TRAINING_BONUS,
  TRAINING_MAX,
  TROPHY_INFO,
  activeDays,
  attemptsFor,
  buildCup,
  cardSlots,
  cupEvents,
  cupPhase,
  cupRewards,
  cupStart,
  outcomeOf,
  pendingCup,
  pendingSeason,
  pickPayout,
  rivalOf,
  seasonOf,
  seasonReward,
  seasonStandings,
  seasonWeeks,
  trainingCost,
  unsyncedBest,
  type CardId,
  type CupEntry,
  type CupGame,
  type CupPhase,
  type CupResult,
  type CupSlot,
  type CupSummary,
  type CupView,
  type SeasonRow,
  type StandingRow,
} from '../../game/cup';
import { cupEntryCount, fetchCupEntries, fetchCupResults, fetchCupSummary, fetchSeason, registerCup, syncCupBest } from '../../game/cupCloud';
import { productionPerSec } from '../../game/economy';
import { fmt, fmtTime } from '../../game/format';
import { useGame } from '../../game/store';
import { celebrate } from '../celebrate';
import { sfx } from '../haptics';
import { GameScreen, Modal } from '../Modal';
import { CupPlay } from './CupPlay';

const PHASES: { id: CupPhase; label: string; when: string }[] = [
  { id: 'signup', label: 'Inscripción', when: 'Lun–Vie' },
  { id: 'groups', label: 'Grupos', when: 'Sábado' },
  { id: 'final', label: 'Final', when: 'Domingo' },
];

type Section = 'week' | 'prep' | 'season';

const shortWeek = (week: string) => {
  const [, m, d] = week.split('-').map(Number);
  return `${d}/${m}`;
};

const DAY_NAMES = ['L', 'M', 'X', 'J', 'V'];

/** Copas de un jugador junto a su nombre. */
export function Trophies({ e }: { e: Pick<CupEntry, 'gold' | 'silver' | 'bronze'> }) {
  if (!e.gold && !e.silver && !e.bronze) return null;
  return (
    <span className="cup-trophies">
      {e.gold > 0 && <span>🏆{e.gold > 1 ? e.gold : ''}</span>}
      {e.silver > 0 && <span>🥈{e.silver > 1 ? e.silver : ''}</span>}
      {e.bronze > 0 && <span>🥉{e.bronze > 1 ? e.bronze : ''}</span>}
    </span>
  );
}

/**
 * Inscritos y resultados de una semana, ya convertidos en grupos y clasificaciones. Con `poll` se
 * recargan cada 30 s (solo mientras se juega: una Copa terminada ya no cambia).
 */
function useCupData(week: string, enabled: boolean, poll: boolean) {
  const [view, setView] = useState<CupView | null>(null);
  const [results, setResults] = useState<Map<string, CupResult> | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      if (!enabled || !cloudEnabled) return;
      setError(false);
      try {
        const [entries, res] = await Promise.all([fetchCupEntries(week), fetchCupResults(week, fresh)]);
        setView(buildCup(entries, res, week));
        setResults(res);
      } catch (e) {
        console.warn('Copa', e);
        setError(true);
      }
    },
    [week, enabled],
  );

  // Siempre resultados recientes al abrir (la caché solo evita lecturas repetidas en pocos segundos)
  useEffect(() => {
    load(true);
    if (!enabled || !poll) return;
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load, enabled, poll]);

  return { view, results, error, reload: load };
}

export function CupScreen({ onClose, onVisit }: { onClose: () => void; onVisit: (uid: string) => void }) {
  useGame((st) => st.s.lastTick); // refresca la cuenta atrás
  const cup = useGame((st) => st.s.cup);
  const info = cupPhase(now());
  const pending = pendingCup(cup, info.week);
  const season = pending ? null : pendingSeason(cup, info.week);
  const [section, setSection] = useState<Section>('week');
  // La semana y la prueba se fijan al empezar: si a mitad de partida cambia la semana, no cambia el juego
  const [playing, setPlaying] = useState<{ week: string; slot: CupSlot; game: CupGame; card: CardId | null } | null>(null);
  const [ceremony, setCeremony] = useState<string | null>(null);
  const [seasonCeremony, setSeasonCeremony] = useState<number | null>(null);
  const events = cupEvents(info.week);
  const data = useCupData(info.week, info.phase !== 'signup', true);

  if (playing) {
    return (
      <CupPlay
        week={playing.week}
        slot={playing.slot}
        game={playing.game}
        final={playing.slot === 'f'}
        card={playing.card}
        onClose={() => {
          setPlaying(null);
          data.reload(true);
        }}
      />
    );
  }

  const trophies = cup.gold + cup.silver + cup.bronze;

  return (
    <GameScreen title="Copa de Alcaldes" right={trophies ? `🏆 ${trophies}` : null} onClose={onClose}>
      <div className="cup-wrap">
        <div className="card cup-hero">
          <div className="cup-hero-top">
            <span className="cup-hero-emoji">🏆</span>
            <div>
              <b>
                Semana del {shortWeek(info.week)} · Temporada {seasonOf(info.week) + 1}
              </b>
              <small className="muted">
                {PHASES.find((p) => p.id === info.phase)!.label} · termina en {fmtTime((info.endsAt - now()) / 1000)}
              </small>
            </div>
          </div>
          <ol className="cup-timeline">
            {PHASES.map((p) => (
              <li key={p.id} className={p.id === info.phase ? 'on' : PHASES.findIndex((x) => x.id === p.id) < PHASES.findIndex((x) => x.id === info.phase) ? 'done' : ''}>
                <b>{p.label}</b>
                <small>{p.when}</small>
              </li>
            ))}
          </ol>
        </div>

        {pending && (
          <button className="game-card cup-pending" onClick={() => setCeremony(pending)}>
            <span className="game-emoji">🎉</span>
            <div className="game-info">
              <b>Resultados de la Copa del {shortWeek(pending)}</b>
              <small>Mira el podio y cobra tus premios.</small>
            </div>
          </button>
        )}
        {season !== null && (
          <button className="game-card cup-pending" onClick={() => setSeasonCeremony(season)}>
            <span className="game-emoji">📅</span>
            <div className="game-info">
              <b>Fin de la temporada {season + 1}</b>
              <small>Mira la clasificación final y cobra tu premio.</small>
            </div>
          </button>
        )}

        {!cloudEnabled && <p className="empty">La Copa necesita conexión con Firebase.</p>}

        <div className="segmented cup-tabs">
          <button className={section === 'week' ? 'active' : ''} onClick={() => setSection('week')}>
            🏆 Semana
          </button>
          <button className={section === 'prep' ? 'active' : ''} onClick={() => setSection('prep')}>
            🏋️ Preparación
          </button>
          <button className={section === 'season' ? 'active' : ''} onClick={() => setSection('season')}>
            📅 Temporada
          </button>
        </div>

        {section === 'week' && (
          <WeekSection
            phase={info.phase}
            week={info.week}
            events={events}
            data={data}
            onPlay={(slot, card) => setPlaying({ week: info.week, slot, game: events[slot], card })}
            onVisit={onVisit}
            onPrep={() => setSection('prep')}
          />
        )}
        {section === 'prep' && <PrepSection phase={info.phase} week={info.week} />}
        {section === 'season' && <SeasonSection week={info.week} onVisit={onVisit} />}
      </div>
      {ceremony && <CupCeremony week={ceremony} onDone={() => setCeremony(null)} />}
      {seasonCeremony !== null && <SeasonCeremony season={seasonCeremony} onDone={() => setSeasonCeremony(null)} />}
    </GameScreen>
  );
}

// ---------------------------------------------------------------------
// Esta semana
// ---------------------------------------------------------------------

function WeekSection({
  phase,
  week,
  events,
  data,
  onPlay,
  onVisit,
  onPrep,
}: {
  phase: CupPhase;
  week: string;
  events: Record<CupSlot, CupGame>;
  data: ReturnType<typeof useCupData>;
  onPlay: (slot: CupSlot, card: CardId | null) => void;
  onVisit: (uid: string) => void;
  onPrep: () => void;
}) {
  const cup = useGame((st) => st.s.cup);
  const toast = useGame((st) => st.toast);
  const registered = cup.week === week;
  const uid = currentUid();
  // Con una Copa anterior sin cobrar no se puede inscribir en otra (su premio se perdería)
  const pending = pendingCup(cup, week);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [groupIdx, setGroupIdx] = useState<number | null>(null);
  const synced = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (phase !== 'signup' || !cloudEnabled) return;
    cupEntryCount(week)
      .then(setCount)
      .catch(() => {});
  }, [phase, week, registered]);

  // Si el servidor tiene una marca peor que la del móvil (una subida que se perdió), se vuelve a subir
  const { results, reload } = data;
  useEffect(() => {
    if (!registered || !uid || !results || !cloudEnabled) return;
    const missing = unsyncedBest(cup.best, results.get(uid), phase);
    const key = `${week}:${JSON.stringify(missing)}`;
    if (key === `${week}:{}`) return;
    // Como mucho un intento por minuto con las mismas marcas (la subida normal puede estar en camino)
    if (synced.current?.key === key && Date.now() - synced.current.at < 60_000) return;
    synced.current = { key, at: Date.now() };
    syncCupBest(week, missing, useGame.getState().s.name)
      .then(() => reload(true))
      .catch((e) => console.warn('Copa: no se pudo resincronizar la marca', e));
  }, [registered, uid, results, cup.best, phase, week, reload]);

  const view = data.view;
  const myGroup = view?.standings.findIndex((g) => g.some((r) => r.entry.uid === uid)) ?? -1;
  const shownGroup = groupIdx ?? (myGroup >= 0 ? myGroup : 0);
  const rows = view?.standings[shownGroup] ?? [];
  const finalist = !!uid && !!view?.finalists.some((e) => e.uid === uid);

  const register = async () => {
    if (pendingCup(useGame.getState().s.cup, week)) return;
    setBusy(true);
    try {
      await registerCup(week, useGame.getState().s);
      useGame.getState().cupRegister(week);
      track('cup_register', { week });
      sfx('win');
      toast('🏆 ¡Inscrito en la Copa de Alcaldes!');
      setCount((n) => (n === null ? n : n + 1));
    } catch (e) {
      console.warn(e);
      toast('⚠️ No se pudo completar la inscripción. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  };

  const play = (slot: CupSlot, card: CardId | null) => {
    const store = useGame.getState();
    if (card && card !== 'extra' && !store.s.cup.loadout.includes(card)) card = null;
    if (!store.cupAttempt(slot)) return;
    if (card) store.cupUseCard(card, slot);
    track('minigame_start', { game: events[slot], cup: 1 });
    onPlay(slot, card);
  };

  if (phase === 'signup') {
    return (
      <>
        <div className="card">
          {registered ? (
            <>
              <b>✅ Estás inscrito</b>
              <small className="muted">El sábado se forman los grupos de hasta 8 alcaldes de nivel parecido. Mientras, prepárate: entrena, equipa cartas y juega cada día para tener afición.</small>
              <button className="btn" onClick={onPrep}>
                🏋️ Ir a la preparación
              </button>
            </>
          ) : (
            <>
              <b>Inscríbete gratis</b>
              <small className="muted">La inscripción cierra el viernes a medianoche (hora de Costa Rica). Después ya no se puede entrar.</small>
              {pending && <small className="warn">Antes cobra los premios de la Copa del {shortWeek(pending)} (arriba).</small>}
              <button className="btn primary" onClick={register} disabled={busy || !cloudEnabled || !!pending}>
                {busy ? 'Inscribiendo…' : '🏆 Inscribirme en la Copa'}
              </button>
            </>
          )}
          {count !== null && <small className="muted">{count === 1 ? '1 alcalde inscrito' : `${count} alcaldes inscritos`}</small>}
        </div>
        <div className="section-head">
          <h2>Pruebas del sábado</h2>
          <small className="muted">3 intentos cada una</small>
        </div>
        <EventList events={events} slots={GROUP_SLOTS} />
        <div className="card cup-surprise">
          <b>🎁 Final del domingo: prueba sorpresa</b>
          <small className="muted">Se revela el domingo, solo para los finalistas.</small>
        </div>
        <ul className="cup-rules">
          <li>Cada prueba reparte puntos según tu puesto en el grupo: 10, 8, 6, 5, 4, 3, 2, 1.</li>
          <li>Cuenta tu mejor intento. Las pruebas de la Copa no gastan tickets.</li>
          <li>Pasan a la final los 2 primeros de cada grupo (4 si solo hay un grupo).</li>
          <li>Premios: gemas, tickets y una carta para todos los que juegan; copas de oro, plata y bronce para el podio, que se ven en tu ciudad.</li>
          <li>El sábado cualquiera puede apostar gemas a quién ganará la Copa.</li>
        </ul>
        <p className="hint">Practica ahora las pruebas en la pestaña Juegos: el sábado cada intento cuenta.</p>
      </>
    );
  }

  if (!cloudEnabled) return null;

  return (
    <>
      {!registered && <p className="hint">Las inscripciones cerraron. Puedes seguir la Copa como espectador{phase === 'groups' ? ' y hacer tu pronóstico' : ''}.</p>}
      {data.error && <p className="empty">No se pudo cargar la Copa. Revisa tu conexión.</p>}
      {!view && !data.error && <p className="empty">Cargando la Copa…</p>}
      {view && view.groups.length === 0 && <p className="empty">Nadie se inscribió esta semana.</p>}

      {view && phase === 'final' && (
        <FinalView view={view} uid={uid} week={week} game={events.f} finalist={finalist} onPlay={(card) => play('f', card)} onVisit={onVisit} />
      )}

      {view && phase === 'groups' && view.groups.length > 0 && <PickCard week={week} view={view} />}
      {view && phase === 'final' && cup.pick?.week === week && <PickStatus view={view} />}

      {view && view.groups.length > 0 && (
        <>
          <div className="section-head">
            <h2>{phase === 'groups' ? 'Fase de grupos' : 'Así quedaron los grupos'}</h2>
            <button className="link-btn" onClick={() => data.reload(true)}>
              ↻ Actualizar
            </button>
          </div>
          {view.groups.length > 1 && (
            <div className="chip-row">
              {view.groups.map((_, i) => (
                <button key={i} className={`chip${i === shownGroup ? ' active' : ''}`} onClick={() => setGroupIdx(i)}>
                  Grupo {i + 1}
                  {i === myGroup ? ' (tú)' : ''}
                </button>
              ))}
            </div>
          )}
          {phase === 'groups' && registered && shownGroup === myGroup && <RivalBar group={view.groups[shownGroup]} rows={rows} uid={uid} />}
          <GroupTable rows={rows} uid={uid} events={events} perGroup={view.groups.length === 1 ? 4 : 2} onVisit={onVisit} />
          {phase === 'groups' && registered && (
            <>
              <div className="section-head">
                <h2>Tus pruebas</h2>
                <small className="muted">Cuenta tu mejor intento</small>
              </div>
              <EventList events={events} slots={GROUP_SLOTS} week={week} onPlay={play} />
            </>
          )}
        </>
      )}
    </>
  );
}

/** Cartas equipadas que se pueden usar en una prueba. */
function CardPicker({ slot, armed, onArm }: { slot: CupSlot; armed: CardId | null; onArm: (c: CardId | null) => void }) {
  const loadout = useGame((st) => st.s.cup.loadout);
  const usable = loadout.filter((c) => !CARDS[c].finalOnly || slot === 'f');
  if (!usable.length) return null;
  const useExtra = () => {
    if (useGame.getState().cupUseCard('extra', slot)) {
      sfx('buy');
      useGame.getState().toast('🎟️ +1 intento en esta prueba');
    }
  };
  return (
    <div className="cup-cards-inline">
      {[...new Set(usable)].map((c) =>
        c === 'extra' ? (
          <button key={c} className="chip" onClick={useExtra} title={CARDS[c].desc}>
            {CARDS[c].emoji} +1 intento
          </button>
        ) : (
          <button key={c} className={`chip${armed === c ? ' active' : ''}`} onClick={() => onArm(armed === c ? null : c)} title={CARDS[c].desc}>
            {CARDS[c].emoji} {CARDS[c].name}
            {armed === c ? ' ✓' : ''}
          </button>
        ),
      )}
    </div>
  );
}

function EventList({
  events,
  slots,
  week,
  onPlay,
}: {
  events: Record<CupSlot, CupGame>;
  slots: CupSlot[];
  week?: string;
  onPlay?: (slot: CupSlot, card: CardId | null) => void;
}) {
  const cup = useGame((st) => st.s.cup);
  const [armed, setArmed] = useState<Partial<Record<CupSlot, CardId | null>>>({});
  return (
    <div className="cup-events">
      {slots.map((slot, i) => {
        const g = CUP_GAME_INFO[events[slot]];
        const total = week ? attemptsFor(cup, week, slot) : 0;
        const left = total - cup.used[slot];
        return (
          <div key={slot} className="cup-event">
            <div className="cup-event-row">
              <span className="cup-event-emoji">{g.emoji}</span>
              <div className="cup-event-info">
                <small className="muted">Prueba {i + 1}</small>
                <b>{g.name}</b>
                {onPlay && (
                  <small>
                    Tu mejor: {cup.best[slot]} {g.unit}
                  </small>
                )}
              </div>
              {onPlay && (
                <button className="btn small primary" disabled={left < 1} onClick={() => onPlay(slot, armed[slot] ?? null)}>
                  {left > 0 ? `Jugar · ${left}/${total}` : 'Sin intentos'}
                </button>
              )}
            </div>
            {onPlay && left > 0 && <CardPicker slot={slot} armed={armed[slot] ?? null} onArm={(c) => setArmed((a) => ({ ...a, [slot]: c }))} />}
          </div>
        );
      })}
    </div>
  );
}

function RivalBar({ group, rows, uid }: { group: CupEntry[]; rows: StandingRow[]; uid: string | null }) {
  const me = rows.find((r) => r.entry.uid === uid);
  const rivalEntry = uid ? rivalOf(group, uid) : null;
  const rival = rivalEntry ? rows.find((r) => r.entry.uid === rivalEntry.uid) : null;
  if (!me || !rival) return null;
  const total = Math.max(1, me.points + rival.points);
  const ahead = me.rank < rival.rank;
  return (
    <div className="card cup-rival">
      <div className="cup-rival-head">
        <b>⚔️ Tu rival: {rival.entry.name}</b>
        <small className={ahead ? 'good' : 'warn'}>{ahead ? '¡Vas por delante!' : me.points === rival.points ? 'Empatados' : `Te faltan ${rival.points - me.points} pts`}</small>
      </div>
      <div className="cup-rival-bar">
        <div className="me" style={{ width: `${(me.points / total) * 100}%` }} />
        <div className="them" style={{ width: `${(rival.points / total) * 100}%` }} />
      </div>
      <div className="cup-rival-legend">
        <span>Tú {me.points} pts</span>
        <span>
          {rival.points} pts {rival.entry.name}
        </span>
      </div>
    </div>
  );
}

function GroupTable({
  rows,
  uid,
  events,
  perGroup,
  onVisit,
}: {
  rows: StandingRow[];
  uid: string | null;
  events: Record<CupSlot, CupGame>;
  perGroup: number;
  onVisit: (uid: string) => void;
}) {
  return (
    <div className="cup-table-wrap">
      <table className="cup-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Alcalde</th>
            {GROUP_SLOTS.map((s) => (
              <th key={s} className="num" title={CUP_GAME_INFO[events[s]].name}>
                {CUP_GAME_INFO[events[s]].emoji}
              </th>
            ))}
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.uid} className={`${r.entry.uid === uid ? 'me' : ''}${r.rank <= perGroup && r.played ? ' qualifies' : ''}`} onClick={() => onVisit(r.entry.uid)}>
              <td>{r.rank}</td>
              <td className="cup-name">
                {r.entry.name}
                <Trophies e={r.entry} />
              </td>
              {r.scores.map((x, k) => (
                <td key={k} className={`num${r.places[k] === 1 ? ' win' : ''}`}>
                  {x || '–'}
                </td>
              ))}
              <td className="num">
                <b>{r.points}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="muted">Los {perGroup} primeros pasan a la final (marcados en verde). Toca a un alcalde para visitar su ciudad.</small>
    </div>
  );
}

function FinalView({
  view,
  uid,
  week,
  game,
  finalist,
  onPlay,
  onVisit,
}: {
  view: CupView;
  uid: string | null;
  week: string;
  game: CupGame;
  finalist: boolean;
  onPlay: (card: CardId | null) => void;
  onVisit: (uid: string) => void;
}) {
  const cup = useGame((st) => st.s.cup);
  const [armed, setArmed] = useState<CardId | null>(null);
  const g = CUP_GAME_INFO[game];
  const mine = view.standings.flat().find((r) => r.entry.uid === uid);
  const total = attemptsFor(cup, week, 'f');
  const left = total - cup.used.f;
  return (
    <>
      <div className="card cup-final">
        <b>
          🎁 Prueba de la final: {g.emoji} {g.name}
        </b>
        {finalist ? (
          <>
            <small>
              ¡Estás en la final! Tu mejor: {cup.best.f} {g.unit}
            </small>
            <button className="btn primary" disabled={left < 1} onClick={() => onPlay(armed)}>
              {left > 0 ? `Jugar la final · ${left}/${total}` : 'Ya usaste tus intentos'}
            </button>
            {left > 0 && <CardPicker slot="f" armed={armed} onArm={setArmed} />}
          </>
        ) : (
          <small className="muted">{mine ? `Quedaste ${mine.rank}º en tu grupo. ¡Sigue la final!` : 'Sigue la final en directo.'}</small>
        )}
      </div>
      <div className="section-head">
        <h2>Final</h2>
        <small className="muted">{view.final.length} finalistas</small>
      </div>
      {view.final.length === 0 ? (
        <p className="empty">Nadie jugó la fase de grupos.</p>
      ) : (
        <ol className="ranking">
          {view.final.map((r) => (
            <li key={r.entry.uid} className={`clickable${r.entry.uid === uid ? ' me' : ''}`} onClick={() => onVisit(r.entry.uid)}>
              <span className="pos">{r.score > 0 && r.rank <= 3 ? ['🏆', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
              <span className="name">
                {r.entry.name}
                <Trophies e={r.entry} />
              </span>
              <span className="val">{r.score ? `${r.score} ${g.unit}` : 'sin jugar'}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Pronóstico del sábado: a quién apuestas que ganará la Copa. */
function PickCard({ week, view }: { week: string; view: CupView }) {
  const cup = useGame((st) => st.s.cup);
  const gems = useGame((st) => st.s.gems);
  const toast = useGame((st) => st.toast);
  const [choice, setChoice] = useState<string | null>(null);
  const [stake, setStake] = useState(PICK_STAKES[0]);
  const rows = useMemo(() => view.standings.flat().filter((r) => r.played).sort((a, b) => b.points - a.points), [view]);
  const pick = cup.pick?.week === week ? cup.pick : null;
  // Un pronóstico anterior sin cobrar se perdería: primero se cobra
  const pending = pick ? null : pendingCup(cup, week);

  if (pending) {
    return (
      <div className="card cup-pick">
        <b>🔮 ¿Quién ganará la Copa?</b>
        <small className="muted">Antes de apostar, cobra los premios de la Copa del {shortWeek(pending)} (arriba).</small>
      </div>
    );
  }

  if (pick) {
    return (
      <div className="card cup-pick">
        <b>🔮 Tu pronóstico: {pick.name}</b>
        <small className="muted">
          Apostaste {pick.stake} 💎. Si gana la Copa: +{pick.stake * 5} 💎 · si sube al podio: +{pick.stake * 2} 💎 · si llega a la final, recuperas la apuesta.
        </small>
      </div>
    );
  }

  const confirm = () => {
    const r = rows.find((x) => x.entry.uid === choice);
    if (!r) return;
    if (useGame.getState().cupPredict(week, r.entry.uid, r.entry.name, stake)) {
      sfx('buy');
      track('cup_pick', { stake });
      toast(`🔮 Apostaste ${stake} 💎 a ${r.entry.name}`);
    }
  };

  return (
    <div className="card cup-pick">
      <b>🔮 ¿Quién ganará la Copa?</b>
      <small className="muted">Apuesta hoy, antes de la final del domingo. ×5 si aciertas el campeón, ×2 si sube al podio y recuperas la apuesta si llega a la final.</small>
      {rows.length === 0 ? (
        <small className="muted">Aún nadie ha jugado: vuelve en un rato.</small>
      ) : (
        <>
          <div className="cup-pick-list">
            {rows.slice(0, 24).map((r) => (
              <button key={r.entry.uid} className={`chip${choice === r.entry.uid ? ' active' : ''}`} onClick={() => setChoice(r.entry.uid)}>
                {r.entry.name} · {r.points} pts
              </button>
            ))}
          </div>
          <div className="cup-pick-stakes">
            {PICK_STAKES.map((n) => (
              <button key={n} className={`chip${stake === n ? ' active' : ''}`} disabled={gems < n} onClick={() => setStake(n)}>
                {n} 💎
              </button>
            ))}
            <button className="btn small primary" disabled={!choice || gems < stake} onClick={confirm}>
              Apostar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PickStatus({ view }: { view: CupView }) {
  const pick = useGame((st) => st.s.cup.pick)!;
  const inFinal = view.final.some((r) => r.entry.uid === pick.uid);
  return (
    <div className="card cup-pick">
      <b>🔮 Tu pronóstico: {pick.name}</b>
      <small className="muted">
        {inFinal ? `¡Está en la final! Apostaste ${pick.stake} 💎: si gana, te llevas ${pick.stake * 5} 💎.` : `No llegó a la final: esta vez perdiste los ${pick.stake} 💎.`}
      </small>
    </div>
  );
}

// ---------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------

function PrepSection({ phase, week }: { phase: CupPhase; week: string }) {
  const s = useGame((st) => st.s);
  const toast = useGame((st) => st.toast);
  const cup = s.cup;
  const registered = cup.week === week;
  const canEquip = phase === 'signup' && registered;
  const slots = cardSlots(cup.training);
  const cost = trainingCost(cup.training, productionPerSec(s, s.lastTick, false));
  const days = activeDays(cup, week);
  const todayIdx = phase === 'signup' ? Math.floor((now() - cupStart(week)) / 86_400_000) : SIGNUP_DAYS;

  const train = () => {
    const paid = useGame.getState().cupTrain();
    if (paid) {
      sfx('win');
      toast(`🏋️ Centro de entrenamiento nivel ${useGame.getState().s.cup.training}`);
    }
  };

  return (
    <>
      <div className="card cup-prep">
        <div className="cup-prep-head">
          <span className="cup-prep-emoji">🏋️</span>
          <div>
            <b>
              Centro de entrenamiento · nivel {cup.training}/{TRAINING_MAX}
            </b>
            <small className="muted">
              +{Math.round(cup.training * TRAINING_BONUS * 100)}% en tus marcas de la Copa · {slots} {slots === 1 ? 'hueco' : 'huecos'} para cartas
            </small>
          </div>
        </div>
        {cup.training < TRAINING_MAX ? (
          <button className="btn primary" disabled={s.coins < cost} onClick={train}>
            Mejorar a nivel {cup.training + 1} · {fmt(cost)} 🪙
          </button>
        ) : (
          <small className="good">¡Nivel máximo!</small>
        )}
        <small className="muted">Cada nivel da +2%. Los niveles 2 y 4 añaden un hueco para cartas.</small>
      </div>

      <div className="card">
        <b>🎺 Afición de la semana</b>
        <div className="cup-days">
          {DAY_NAMES.map((d, i) => (
            <span key={d} className={`cup-day${days && cup.activity.week === week && cup.activity.days & (1 << i) ? ' on' : ''}${i === todayIdx ? ' today' : ''}`}>
              {d}
            </span>
          ))}
        </div>
        <small className="muted">
          Juega entre semana: con {FANS_GROUPS} días tienes +1 intento en cada prueba del sábado; con {FANS_FINAL}, también en la final. El fin de semana tu afición sale a la calle.
        </small>
        <small className={days >= FANS_GROUPS ? 'good' : ''}>
          {days} {days === 1 ? 'día' : 'días'} jugados ·{' '}
          {days >= FANS_FINAL ? '+1 intento en todas las pruebas' : days >= FANS_GROUPS ? '+1 intento el sábado' : `faltan ${FANS_GROUPS - days} para el primer premio`}
        </small>
      </div>

      <div className="card">
        <b>
          🃏 Cartas equipadas ({cup.loadout.length}/{slots})
        </b>
        <div className="cup-loadout">
          {Array.from({ length: slots }, (_, i) => {
            const c = cup.loadout[i];
            return c ? (
              <button key={i} className="cup-slot full" disabled={!canEquip} onClick={() => useGame.getState().cupUnequip(i)} title={canEquip ? 'Quitar' : undefined}>
                <span>{CARDS[c].emoji}</span>
                <small>{CARDS[c].name}</small>
              </button>
            ) : (
              <div key={i} className="cup-slot">
                <small className="muted">Libre</small>
              </div>
            );
          })}
        </div>
        <small className="muted">
          {canEquip
            ? 'Equipa ahora las cartas que llevarás a la Copa: el fin de semana solo podrás usar estas.'
            : phase === 'signup'
              ? 'Inscríbete en la Copa para equipar cartas.'
              : 'Las cartas se equipan de lunes a viernes. Úsalas en cada prueba antes de jugar.'}
        </small>
      </div>

      <div className="section-head">
        <h2>Tu colección</h2>
      </div>
      <div className="cup-collection">
        {CARD_IDS.map((id) => (
          <div key={id} className="cup-card-item">
            <span className="cup-card-emoji">{CARDS[id].emoji}</span>
            <div>
              <b>
                {CARDS[id].name} <span className="muted">×{cup.cards[id]}</span>
              </b>
              <small className="muted">{CARDS[id].desc}</small>
            </div>
            <button
              className="btn small"
              disabled={!canEquip || cup.cards[id] < 1 || cup.loadout.length >= slots}
              onClick={() => useGame.getState().cupEquip(id) && sfx('buy')}
            >
              Equipar
            </button>
          </div>
        ))}
      </div>
      <p className="hint">Las cartas salen del cofre del día, las misiones semanales, a veces de los retos diarios y de cada Copa que juegas.</p>
    </>
  );
}

// ---------------------------------------------------------------------
// Temporada y salón de la fama
// ---------------------------------------------------------------------

function SeasonSection({ week, onVisit }: { week: string; onVisit: (uid: string) => void }) {
  const season = seasonOf(week);
  const uid = currentUid();
  const [rows, setRows] = useState<SeasonRow[] | null>(null);
  const [hall, setHall] = useState<{ seasons: { season: number; row: SeasonRow }[]; weeks: CupSummary[] } | null>(null);
  const [error, setError] = useState(false);
  const weeks = seasonWeeks(season);
  const end = cupStart(weeks[weeks.length - 1]) + 7 * 86_400_000;

  useEffect(() => {
    if (!cloudEnabled) return;
    let alive = true;
    (async () => {
      try {
        const current = seasonStandings(await fetchSeason(season));
        if (alive) setRows(current);
        // Salón de la fama: temporadas anteriores y campeones de cada Copa terminada
        const past = await Promise.all(Array.from({ length: season }, (_, k) => fetchSeason(k)));
        const finished = [...past.flat(), ...(await fetchSeason(season))].filter((x) => cupStart(x.week) + 7 * 86_400_000 <= now());
        if (alive)
          setHall({
            seasons: past.flatMap((sums, k) => {
              const top = seasonStandings(sums)[0];
              return top ? [{ season: k, row: top }] : [];
            }),
            weeks: finished.filter((x) => x.podium.length > 0).reverse(),
          });
      } catch (e) {
        console.warn('Temporada', e);
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [season]);

  const me = rows?.find((r) => r.uid === uid);

  return (
    <>
      <div className="card">
        <b>
          📅 Temporada {season + 1} · semanas del {shortWeek(weeks[0])} al {shortWeek(weeks[weeks.length - 1])}
        </b>
        <small className="muted">Termina en {fmtTime((end - now()) / 1000)}. Cada Copa suma puntos: jugar 5, puesto en el grupo hasta 20, finalista 30 y podio 50, 70 o 100.</small>
        <ul className="cup-season-prizes">
          <li>🥇 100 💎 + 🚩 bandera de campeón en tu ayuntamiento</li>
          <li>🥈 60 💎 · 🥉 40 💎 · del 4º al 10º 15 💎</li>
        </ul>
        {me && (
          <small className="good">
            Vas {me.rank}º con {me.pts} pts
          </small>
        )}
      </div>
      {error && <p className="empty">No se pudo cargar la temporada.</p>}
      {!rows && !error && <p className="empty">Cargando la temporada…</p>}
      {rows && rows.length === 0 && <p className="empty">Aún no se ha jugado ninguna Copa esta temporada.</p>}
      {rows && rows.length > 0 && (
        <ol className="ranking">
          {rows.slice(0, 20).map((r) => (
            <li key={r.uid} className={`clickable${r.uid === uid ? ' me' : ''}`} onClick={() => onVisit(r.uid)}>
              <span className="pos">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
              <span className="name">
                {r.name}
                {r.cups > 0 && <span className="cup-trophies">🏆{r.cups > 1 ? r.cups : ''}</span>}
              </span>
              <span className="val">{r.pts} pts</span>
            </li>
          ))}
        </ol>
      )}

      <div className="section-head">
        <h2>🏛️ Salón de la fama</h2>
      </div>
      {!hall && !error && <p className="empty">Cargando…</p>}
      {hall && hall.seasons.length === 0 && hall.weeks.length === 0 && <p className="empty">Aún no hay campeones. ¡El primero puedes ser tú!</p>}
      {hall && hall.seasons.length > 0 && (
        <div className="card">
          <b>Campeones de temporada</b>
          <ul className="cup-history">
            {hall.seasons
              .slice()
              .reverse()
              .map(({ season: k, row }) => (
                <li key={k}>
                  <span>Temporada {k + 1}</span>
                  <span>🚩 {row.name}</span>
                  <span>{row.pts} pts</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      {hall && hall.weeks.length > 0 && (
        <div className="card">
          <b>Campeones de cada Copa</b>
          <ul className="cup-history">
            {hall.weeks.map((w) => (
              <li key={w.week}>
                <span>Semana del {shortWeek(w.week)}</span>
                <span>🏆 {w.podium[0].name}</span>
                <span className="muted">{w.podium.slice(1).map((p) => p.name).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Ceremonias
// ---------------------------------------------------------------------

/** Podio de una Copa terminada y cobro de premios (una sola vez). */
function CupCeremony({ week, onDone }: { week: string; onDone: () => void }) {
  const uid = currentUid();
  const pick = useGame((st) => (st.s.cup.pick?.week === week ? st.s.cup.pick : null));
  const { view, error, reload } = useCupData(week, true, false);
  const outcome = useMemo(() => (view && uid ? outcomeOf(view, uid) : null), [view, uid]);
  const reward = outcome ? cupRewards(outcome) : null;
  const payout = view ? pickPayout(pick, view) : { mult: 0, gems: 0 };
  const podium = view?.final.filter((r) => r.score > 0).slice(0, 3) ?? [];
  const game = CUP_GAME_INFO[cupEvents(week).f];

  const claim = () => {
    if (!outcome || !view) return;
    const r = useGame.getState().cupClaim(week, outcome, payout.gems);
    if (r) {
      sfx('win');
      if (r.trophy) celebrate(10);
      useGame.getState().toast(r.gems ? `🏆 Copa cobrada: +${r.gems} 💎${r.tickets ? ` +${r.tickets} 🎟️` : ''}` : '🏆 Copa cerrada');
      track('cup_claim', { week, gems: r.gems, trophy: r.trophy ?? 'none' });
      // Guarda el resumen (para la temporada y el salón de la fama) ahora que ya está cargado
      fetchCupSummary(week).catch(() => {});
    }
    onDone();
  };

  const total = (reward?.gems ?? 0) + payout.gems;

  return (
    <Modal>
      <div className="result cup-ceremony">
        <div className="big-emoji">🏆</div>
        <div className="result-label">Copa de Alcaldes · semana del {shortWeek(week)}</div>
        {error && <p>No se pudieron cargar los resultados. Revisa tu conexión: los premios te esperan.</p>}
        {!view && !error && <p className="muted">Cargando resultados…</p>}
        {!view && (
          // Sin resultados no se cobra nada: se puede salir y volver más tarde
          <div className="btn-row">
            <button className="btn" onClick={onDone}>
              Cerrar
            </button>
            {error && (
              <button className="btn primary" onClick={() => reload(true)}>
                Reintentar
              </button>
            )}
          </div>
        )}
        {view && (
          <>
            {podium.length > 0 ? (
              <div className="podium">
                {[1, 0, 2].map((i) =>
                  podium[i] ? (
                    <div key={i} className={`podium-step p${i + 1}`}>
                      <span className="podium-medal">{['🏆', '🥈', '🥉'][i]}</span>
                      <b>{podium[i].entry.name}</b>
                      <small>
                        {podium[i].score} {game.unit}
                      </small>
                      <div className="podium-block">{i + 1}</div>
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <p className="muted">Nadie jugó la final.</p>
            )}
            {outcome && outcome.groupRank !== null && (
              <p>
                Quedaste {outcome.groupRank}º de {outcome.groupSize} en tu grupo
                {outcome.finalRank ? ` y ${outcome.finalRank}º en la final.` : outcome.finalist ? ' y llegaste a la final.' : '.'}
              </p>
            )}
            {reward && reward.trophy && <div className="badge-gold">¡{TROPHY_INFO[reward.trophy].name}! Se verá en tu ciudad</div>}
            <ul className="reward-list">
              {reward?.lines.map((l) => <li key={l}>{l}</li>)}
              {pick && <li className={payout.gems ? 'rare' : 'muted'}>{payout.gems ? `🔮 Pronóstico (${pick.name}): +${payout.gems} 💎` : `🔮 Pronóstico (${pick.name}): esta vez no hubo suerte`}</li>}
              {outcome?.played && <li>🃏 Una carta para la próxima Copa</li>}
              {!outcome?.played && !pick && <li className="muted">No jugaste ninguna prueba: esta vez no hay premio.</li>}
            </ul>
            <button className="btn primary" onClick={claim}>
              {total > 0 ? 'Cobrar premios' : 'Cerrar'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function SeasonCeremony({ season, onDone }: { season: number; onDone: () => void }) {
  const uid = currentUid();
  const [rows, setRows] = useState<SeasonRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetchSeason(season)
      .then((s) => setRows(seasonStandings(s)))
      .catch(() => setError(true));
  }, [season]);
  useEffect(load, [load]);

  const me = rows?.find((r) => r.uid === uid) ?? null;
  const reward = me ? seasonReward(me.rank) : null;

  const claim = () => {
    const r = useGame.getState().seasonClaim(season, me?.rank ?? Infinity);
    if (r) {
      sfx('win');
      if (r.flag) celebrate(12);
      if (r.gems) useGame.getState().toast(`📅 Temporada cobrada: +${r.gems} 💎`);
    }
    onDone();
  };

  return (
    <Modal>
      <div className="result cup-ceremony">
        <div className="big-emoji">📅</div>
        <div className="result-label">Fin de la temporada {season + 1}</div>
        {error && <p>No se pudo cargar la clasificación. Revisa tu conexión: el premio te espera.</p>}
        {!rows && !error && <p className="muted">Cargando…</p>}
        {!rows && (
          // Sin clasificación no se cobra nada: se puede salir y volver más tarde
          <div className="btn-row">
            <button className="btn" onClick={onDone}>
              Cerrar
            </button>
            {error && (
              <button className="btn primary" onClick={load}>
                Reintentar
              </button>
            )}
          </div>
        )}
        {rows && (
          <>
            <ul className="reward-list">
              {rows.slice(0, 3).map((r) => (
                <li key={r.uid} className={r.uid === uid ? 'rare' : ''}>
                  {['🥇', '🥈', '🥉'][r.rank - 1]} {r.name} · {r.pts} pts
                </li>
              ))}
            </ul>
            <p>{me ? `Terminaste ${me.rank}º de ${rows.length} con ${me.pts} pts.` : 'No sumaste puntos esta temporada.'}</p>
            {reward ? <div className="badge-gold">{reward.line}</div> : <p className="muted">El premio es para los 10 primeros. ¡A por la próxima!</p>}
            <button className="btn primary" onClick={claim}>
              {reward ? 'Cobrar premio' : 'Cerrar'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
