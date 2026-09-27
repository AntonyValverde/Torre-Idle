import { Component, type ErrorInfo, type ReactNode } from 'react';
import { saveLocal } from '../game/cloud';
import { useGame } from '../game/store';

/** Si algo de la interfaz falla, guarda la partida y ofrece recargar en vez de dejar la pantalla en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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
