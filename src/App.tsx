import { Suspense, lazy, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { track } from './firebase';
import { completeGoogleRedirect, loadBestState, loadLocal, saveLocal, startAutoSave, syncRankingName } from './game/cloud';
import { eraHue } from './game/economy';
import { newState } from './game/state';
import { claimTab } from './game/tabLock';
import { useGame } from './game/store';
import { cityFromUrl } from './game/cities';
import { BottomNav, type TabId } from './ui/BottomNav';
import { CityTab } from './ui/CityTab';
import { useIncidentScheduler } from './ui/CityIncident';
import { CityVisit } from './ui/CityVisit';
import { useDecreeScheduler } from './ui/DecreeCard';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { setMusicContext } from './ui/music/engine';
import { GamesTab, TICKET_GAMES, type GameId } from './ui/GamesTab';
import { GoldenBalloon } from './ui/GoldenBalloon';
import { OfflineModal } from './ui/OfflineModal';
import { ProfileTab } from './ui/ProfileTab';
import { RankingTab, type BoardTab } from './ui/RankingTab';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { TutorialBubble, useTutorialEffects } from './ui/Tutorial';
import { TUTORIAL_DONE } from './game/tutorial';
import { UpgradesTab } from './ui/UpgradesTab';
import { useUpdate } from './ui/update';

// El panel solo se descarga si lo abre el administrador
const AdminPanel = lazy(() => import('./admin/AdminPanel'));

// Los minijuegos y la Copa se descargan al abrirlos por primera vez, así el arranque pesa menos.
// La PWA los guarda igual con el resto de la versión, así que también funcionan sin conexión.
const DailyScreen = lazy(() => import('./minigames/daily/DailyScreen').then((m) => ({ default: m.DailyScreen })));
const FireScreen = lazy(() => import('./minigames/fire/FireScreen').then((m) => ({ default: m.FireScreen })));
const MemoryScreen = lazy(() => import('./minigames/memory/MemoryScreen').then((m) => ({ default: m.MemoryScreen })));
const MergeScreen = lazy(() => import('./minigames/merge/MergeScreen').then((m) => ({ default: m.MergeScreen })));
const MetroScreen = lazy(() => import('./minigames/metro/MetroScreen').then((m) => ({ default: m.MetroScreen })));
const ParksScreen = lazy(() => import('./minigames/parks/ParksScreen').then((m) => ({ default: m.ParksScreen })));
const RoadsScreen = lazy(() => import('./minigames/roads/RoadsScreen').then((m) => ({ default: m.RoadsScreen })));
const StackScreen = lazy(() => import('./minigames/stack/StackScreen').then((m) => ({ default: m.StackScreen })));
const StockScreen = lazy(() => import('./minigames/stocks/StockScreen').then((m) => ({ default: m.StockScreen })));
const ThiefScreen = lazy(() => import('./minigames/thief/ThiefScreen').then((m) => ({ default: m.ThiefScreen })));
const TrafficScreen = lazy(() => import('./minigames/traffic/TrafficScreen').then((m) => ({ default: m.TrafficScreen })));
const WheelScreen = lazy(() => import('./minigames/wheel/WheelScreen').then((m) => ({ default: m.WheelScreen })));
const CupScreen = lazy(() => import('./ui/cup/CupScreen').then((m) => ({ default: m.CupScreen })));
const CasinoScreen = lazy(() => import('./minigames/casino/CasinoScreen').then((m) => ({ default: m.CasinoScreen })));

const loading = (
  <div className="game-screen splash">
    <div className="spinner" />
  </div>
);

export default function App() {
  const ready = useGame((st) => st.ready);
  const era = useGame((st) => st.s.era);
  const updateReady = useUpdate((u) => u.ready);
  const applyUpdate = useUpdate((u) => u.apply);
  const [tab, setTab] = useState<TabId>('city');
  const [game, setGame] = useState<GameId | null>(null);
  const [rankingBoard, setRankingBoard] = useState<BoardTab>('league');
  const [admin, setAdmin] = useState(false);
  // Ciudad que se está visitando (desde el ranking, el perfil o un enlace ?ciudad=…)
  const [visit, setVisit] = useState<string | null>(() => cityFromUrl());
  const [cupOpen, setCupOpen] = useState(false);
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const onDecree = useCallback(() => {
    if (tabRef.current !== 'city') useGame.getState().toast('📜 ¡El consejo tiene una propuesta! Ve a Ciudad');
  }, []);
  useDecreeScheduler(onDecree);
  useTutorialEffects();

  // Incidentes: solo salen si el jugador está mirando la ciudad, sin nada encima
  const overlayRef = useRef(false);
  const canOfferIncident = useCallback(() => tabRef.current === 'city' && !overlayRef.current, []);
  useIncidentScheduler(canOfferIncident);
  const tutorialOn = useGame((st) => st.s.tutorial.step < TUTORIAL_DONE);

  // Música de la era: más baja mientras hay un minijuego abierto
  useEffect(() => {
    setMusicContext(era, game ? 'game' : 'city');
  }, [era, game]);

  const [otherTab, setOtherTab] = useState(false);

  // Arranque: reclama la pestaña, carga la partida local y la de la nube (gana la de más progreso).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    // Otra pestaña tomó el control: aunque el arranque siga a medias (cargando la nube), ya no debe
    // cargar la partida ni arrancar el tick ni el guardado automático (pisaría la de la otra pestaña)
    let lost = false;
    const stopped = () => cancelled || lost;
    const shutdown = () => {
      clearInterval(tickTimer);
      stop?.();
      stop = undefined;
    };
    const lock = claimTab(() => {
      // Otra pestaña abrió el juego: guardamos y nos quedamos quietos
      lost = true;
      if (useGame.getState().ready) saveLocal(useGame.getState().s);
      shutdown();
      setOtherTab(true);
    });
    (async () => {
      await lock.ready;
      if (stopped()) return;
      const state = await loadBestState(loadLocal());
      if (stopped()) return;
      useGame.getState().init(state);
      tickTimer = setInterval(() => useGame.getState().tick(), 200);
      stop = startAutoSave();
      syncRankingName(state.name);
      track('session_start');
      const linked = await completeGoogleRedirect();
      if (stopped()) return;
      if (linked) useGame.getState().toast(linked === 'linked' ? '✅ Cuenta vinculada con Google' : '✅ Sesión iniciada con tu cuenta de Google');
    })().catch((e) => {
      console.error('Error al arrancar', e);
      if (!stopped() && !useGame.getState().ready) useGame.getState().init(loadLocal() ?? newState(Date.now()));
    });
    return () => {
      cancelled = true;
      lock.release();
      shutdown();
    };
  }, []);

  const play = (g: GameId) => {
    // Los arcade cuestan un ticket, salvo la partida gratis del Pase VIP
    if (TICKET_GAMES.includes(g) && !useGame.getState().useVipPlay() && !useGame.getState().spendTicket()) return;
    track('minigame_start', { game: g });
    setGame(g);
  };

  // El minijuego de un incidente es gratis (sin ticket) y su premio lleva el extra
  const playIncident = () => {
    const kind = useGame.getState().takeIncident();
    if (!kind) return;
    track('minigame_start', { game: kind, incident: 1 });
    setGame(kind);
  };

  // Al cerrar el minijuego, el extra del incidente no pasa a la siguiente partida
  useEffect(() => {
    if (!game) useGame.getState().endIncidentPlay();
  }, [game]);

  const openRanking = (board: BoardTab) => {
    setGame(null);
    setRankingBoard(board);
    setTab('ranking');
  };

  const closeVisit = () => {
    setVisit(null);
    // Quita ?ciudad=… de la barra de direcciones para que al recargar no vuelva a abrirse
    if (cityFromUrl()) history.replaceState(null, '', location.pathname);
  };

  const overlay = !!game || !!visit || cupOpen || admin;
  overlayRef.current = overlay;

  if (otherTab) {
    return (
      <div className="splash">
        <div className="splash-logo">🗂️</div>
        <div className="splash-title">Abierto en otra pestaña</div>
        <p className="muted" style={{ textAlign: 'center', maxWidth: 300, margin: 0 }}>
          Para no mezclar partidas, el juego solo funciona en una pestaña a la vez.
        </p>
        <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={() => location.reload()}>
          Jugar aquí
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="splash">
        <img className="splash-logo" src="/icon.svg" alt="" />
        <div className="splash-title">Infinite City</div>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={`app${tutorialOn ? ' tutorial-on' : ''}`} style={{ '--hue': eraHue(era) } as CSSProperties}>
      <TopBar />
      <main className="content" key={tab}>
        {tab === 'city' && <CityTab paused={overlay} onIncident={playIncident} />}
        {tab === 'upgrades' && <UpgradesTab />}
        {tab === 'games' && <GamesTab onPlay={play} onCup={() => setCupOpen(true)} />}
        {tab === 'ranking' && <RankingTab key={rankingBoard} initial={rankingBoard} onVisit={setVisit} />}
        {tab === 'profile' && <ProfileTab onAdmin={() => setAdmin(true)} onVisit={setVisit} />}
      </main>
      {tutorialOn && <TutorialBubble tab={tab} onTab={setTab} />}
      <BottomNav tab={tab} onTab={setTab} />

      {tab === 'city' && !game && <GoldenBalloon />}
      {/* Cada pantalla superpuesta tiene su propia barrera de errores: si falla, se cierra solo esa pantalla */}
      {game && (
        <ErrorBoundary key={game} onClose={() => setGame(null)}>
          <Suspense fallback={loading}>
            {game === 'stack' && <StackScreen onClose={() => setGame(null)} />}
            {game === 'merge' && <MergeScreen onClose={() => setGame(null)} />}
            {game === 'daily' && <DailyScreen onClose={() => setGame(null)} onRanking={() => openRanking('daily')} />}
            {game === 'wheel' && <WheelScreen onClose={() => setGame(null)} />}
            {game === 'thief' && <ThiefScreen onClose={() => setGame(null)} />}
            {game === 'stocks' && <StockScreen onClose={() => setGame(null)} />}
            {game === 'roads' && <RoadsScreen onClose={() => setGame(null)} onRanking={() => openRanking('roads')} />}
            {game === 'traffic' && <TrafficScreen onClose={() => setGame(null)} />}
            {game === 'memory' && <MemoryScreen onClose={() => setGame(null)} />}
            {game === 'parks' && <ParksScreen onClose={() => setGame(null)} onRanking={() => openRanking('parks')} />}
            {game === 'fire' && <FireScreen onClose={() => setGame(null)} />}
            {game === 'metro' && <MetroScreen onClose={() => setGame(null)} />}
            {game === 'casino' && <CasinoScreen onClose={() => setGame(null)} />}
          </Suspense>
        </ErrorBoundary>
      )}
      {cupOpen && !game && (
        <ErrorBoundary onClose={() => setCupOpen(false)}>
          <Suspense fallback={loading}>
            <CupScreen onClose={() => setCupOpen(false)} onVisit={setVisit} />
          </Suspense>
        </ErrorBoundary>
      )}
      {visit && !game && !admin && (
        <ErrorBoundary key={visit} onClose={closeVisit}>
          <CityVisit uid={visit} onClose={closeVisit} />
        </ErrorBoundary>
      )}
      {admin && (
        <ErrorBoundary onClose={() => setAdmin(false)}>
          <Suspense fallback={loading}>
            <AdminPanel onClose={() => setAdmin(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {!game && !admin && !visit && !cupOpen && <OfflineModal />}
      {!game && updateReady && (
        <button className="update-banner" onClick={applyUpdate}>
          🔄 Nueva versión disponible · <b>Actualizar</b>
        </button>
      )}
      <Toasts />
    </div>
  );
}
