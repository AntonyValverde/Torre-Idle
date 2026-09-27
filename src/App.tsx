import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { track } from './firebase';
import { completeGoogleRedirect, loadBestState, loadLocal, saveLocal, startAutoSave, syncRankingName } from './game/cloud';
import { eraHue } from './game/economy';
import { newState } from './game/state';
import { claimTab } from './game/tabLock';
import { useGame } from './game/store';
import { DailyScreen } from './minigames/daily/DailyScreen';
import { MergeScreen } from './minigames/merge/MergeScreen';
import { StackScreen } from './minigames/stack/StackScreen';
import { StockScreen } from './minigames/stocks/StockScreen';
import { ThiefScreen } from './minigames/thief/ThiefScreen';
import { WheelScreen } from './minigames/wheel/WheelScreen';
import { BottomNav, type TabId } from './ui/BottomNav';
import { CityTab } from './ui/CityTab';
import { useDecreeScheduler } from './ui/DecreeCard';
import { GamesTab, TICKET_GAMES, type GameId } from './ui/GamesTab';
import { GoldenBalloon } from './ui/GoldenBalloon';
import { OfflineModal } from './ui/OfflineModal';
import { ProfileTab } from './ui/ProfileTab';
import { RankingTab, type BoardTab } from './ui/RankingTab';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { UpgradesTab } from './ui/UpgradesTab';
import { useUpdate } from './ui/update';

export default function App() {
  const ready = useGame((st) => st.ready);
  const era = useGame((st) => st.s.era);
  const updateReady = useUpdate((u) => u.ready);
  const applyUpdate = useUpdate((u) => u.apply);
  const [tab, setTab] = useState<TabId>('city');
  const [game, setGame] = useState<GameId | null>(null);
  const [rankingBoard, setRankingBoard] = useState<BoardTab>('daily');
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const onDecree = useCallback(() => {
    if (tabRef.current !== 'city') useGame.getState().toast('📜 ¡El consejo tiene una propuesta! Ve a Ciudad');
  }, []);
  useDecreeScheduler(onDecree);

  const [otherTab, setOtherTab] = useState(false);

  // Arranque: reclama la pestaña, carga la partida local y la de la nube (gana la de más progreso).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const shutdown = () => {
      clearInterval(tickTimer);
      stop?.();
      stop = undefined;
    };
    const lock = claimTab(() => {
      // Otra pestaña abrió el juego: guardamos y nos quedamos quietos
      if (useGame.getState().ready) saveLocal(useGame.getState().s);
      shutdown();
      setOtherTab(true);
    });
    (async () => {
      await lock.ready;
      if (cancelled) return;
      const state = await loadBestState(loadLocal());
      if (cancelled) return;
      useGame.getState().init(state);
      tickTimer = setInterval(() => useGame.getState().tick(), 200);
      stop = startAutoSave();
      syncRankingName(state.name);
      track('session_start');
      const linked = await completeGoogleRedirect();
      if (linked) useGame.getState().toast(linked === 'linked' ? '✅ Cuenta vinculada con Google' : '✅ Sesión iniciada con tu cuenta de Google');
    })().catch((e) => {
      console.error('Error al arrancar', e);
      if (!useGame.getState().ready) useGame.getState().init(loadLocal() ?? newState(Date.now()));
    });
    return () => {
      cancelled = true;
      lock.release();
      shutdown();
    };
  }, []);

  const play = (g: GameId) => {
    if (TICKET_GAMES.includes(g) && !useGame.getState().spendTicket()) return;
    track('minigame_start', { game: g });
    setGame(g);
  };

  const openRanking = (board: BoardTab) => {
    setGame(null);
    setRankingBoard(board);
    setTab('ranking');
  };

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
        <div className="splash-logo">🏛️</div>
        <div className="splash-title">Torre Idle</div>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="app" style={{ '--hue': eraHue(era) } as CSSProperties}>
      <TopBar />
      <main className="content" key={tab}>
        {tab === 'city' && <CityTab />}
        {tab === 'upgrades' && <UpgradesTab />}
        {tab === 'games' && <GamesTab onPlay={play} />}
        {tab === 'ranking' && <RankingTab key={rankingBoard} initial={rankingBoard} />}
        {tab === 'profile' && <ProfileTab />}
      </main>
      <BottomNav tab={tab} onTab={setTab} />

      {tab === 'city' && !game && <GoldenBalloon />}
      {game === 'stack' && <StackScreen onClose={() => setGame(null)} />}
      {game === 'merge' && <MergeScreen onClose={() => setGame(null)} />}
      {game === 'daily' && <DailyScreen onClose={() => setGame(null)} onRanking={() => openRanking('daily')} />}
      {game === 'wheel' && <WheelScreen onClose={() => setGame(null)} />}
      {game === 'thief' && <ThiefScreen onClose={() => setGame(null)} />}
      {game === 'stocks' && <StockScreen onClose={() => setGame(null)} />}
      {!game && <OfflineModal />}
      {!game && updateReady && (
        <button className="update-banner" onClick={applyUpdate}>
          🔄 Nueva versión disponible · <b>Actualizar</b>
        </button>
      )}
      <Toasts />
    </div>
  );
}
