import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { saveLocal } from './game/cloud';
import { useGame } from './game/store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { listenInstall } from './ui/install';
import { useUpdate } from './ui/update';
import './styles.css';

listenInstall();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    useUpdate.setState({
      ready: true,
      apply: () => {
        const { ready, s } = useGame.getState();
        if (ready) saveLocal(s);
        updateSW(true);
      },
    });
  },
  // El navegador solo busca versiones nuevas al cargar la página: la app instalada puede pasar días
  // abierta en segundo plano sin recargarse. Se comprueba cada hora y al volver a la app.
  onRegisteredSW(_url, r) {
    if (!r) return;
    let last = Date.now();
    const check = () => {
      if (r.installing || !navigator.onLine) return;
      last = Date.now();
      r.update().catch(() => {});
    };
    setInterval(check, 60 * 60_000);
    document.addEventListener('visibilitychange', () => {
      // Como mucho una vez cada 5 minutos al ir y volver de la app
      if (document.visibilityState === 'visible' && Date.now() - last > 5 * 60_000) check();
    });
  },
});

// Solo en desarrollo: acceso al estado desde la consola (window.__game.getState())
if (import.meta.env.DEV) {
  import('./game/store').then(({ useGame }) => {
    (window as unknown as { __game: typeof useGame }).__game = useGame;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
