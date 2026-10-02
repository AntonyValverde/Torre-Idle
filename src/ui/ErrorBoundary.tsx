import { Component, type ErrorInfo, type ReactNode } from 'react';
import { saveLocal } from '../game/cloud';
import { useGame } from '../game/store';
import { GameScreen } from './Modal';

/**
 * Si algo de la interfaz falla, guarda la partida y ofrece recargar en vez de dejar la pantalla en blanco.
 * Con `onClose` protege una pantalla superpuesta (minijuego, visita, Copa, panel): si falla, solo se cierra
 * esa pantalla y el resto del juego sigue funcionando.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onClose?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error en la interfaz', error, info.componentStack);
    const { ready, s } = useGame.getState();
    if (ready) saveLocal(s);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { onClose } = this.props;
    if (onClose) {
      return (
        <GameScreen title="¡Ups! Algo falló" onClose={onClose}>
          <div className="splash">
            <div className="splash-logo">🚧</div>
            <p className="muted" style={{ textAlign: 'center', maxWidth: 300, margin: 0 }}>
              Esta pantalla no se pudo abrir. Tu partida está guardada.
            </p>
            <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={onClose}>
              Volver a la ciudad
            </button>
          </div>
        </GameScreen>
      );
    }
    return (
      <div className="splash">
        <div className="splash-logo">🚧</div>
        <div className="splash-title">¡Ups! Algo falló</div>
        <p className="muted" style={{ textAlign: 'center', maxWidth: 300, margin: 0 }}>
          Tu partida está guardada. Recarga para seguir jugando.
        </p>
        <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    );
  }
}
