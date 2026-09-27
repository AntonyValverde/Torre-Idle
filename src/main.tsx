import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { saveLocal } from './game/cloud';
import { useGame } from './game/store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useUpdate } from './ui/update';
import './styles.css';

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
