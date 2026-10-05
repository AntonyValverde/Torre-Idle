import { useState } from 'react';
import { useGame } from '../game/store';
import { installMode, isStandalone, promptInstall, useInstall } from './install';

/** Tarjeta de 👤 Perfil para instalar el juego en el móvil. Desde la app ya instalada no sale. */
export function InstallCard({ guest }: { guest: boolean }) {
  const event = useInstall((st) => st.event);
  const installed = useInstall((st) => st.installed);
  const toast = useGame((st) => st.toast);
  const [steps, setSteps] = useState(false);
  const mode = installMode(event, installed);

  if (mode === 'installed') {
    if (isStandalone()) return null;
    return (
      <div className="card install-card">
        <b>📲 App instalada</b>
        <p className="muted">Ya la tienes: ábrela desde el icono de Infinite City en tu pantalla de inicio.</p>
      </div>
    );
  }

  const install = async () => {
    if (mode !== 'prompt') {
      setSteps(!steps);
      return;
    }
    if (await promptInstall()) toast('📲 ¡Instalada! Búscala en tu pantalla de inicio');
  };

  const mobile = isTouch();
  return (
    <div className="card install-card">
      <b>📲 Juega desde la app</b>
      <p className="muted">Instálala en tu móvil: se abre a pantalla completa desde su icono, como cualquier app, y sin pasar por ninguna tienda.</p>
      <button className="btn primary" onClick={install} aria-expanded={mode === 'prompt' ? undefined : steps}>
        📲 Instalar la app
      </button>
      {steps && mode === 'ios' && (
        <>
          <ol className="install-steps">
            <li>
              Abre el juego en <b>Safari</b> y toca <b>Compartir</b> (el cuadrado con la flecha ⬆️).
            </li>
            <li>
              Elige <b>«Añadir a pantalla de inicio»</b>.
            </li>
            <li>
              Toca <b>«Añadir»</b> y abre el juego desde su icono.
            </li>
          </ol>
          {guest && <small className="muted">⚠️ En iPhone la app no comparte datos con Safari: vincula antes tu cuenta con Google y entra con ella en la app.</small>}
        </>
      )}
      {steps && mode === 'manual' && (
        <ol className="install-steps">
          {mobile ? (
            <>
              <li>
                Abre el menú del navegador (<b>⋮</b>).
              </li>
              <li>
                Elige <b>«Instalar app»</b> o <b>«Añadir a pantalla de inicio»</b>.
              </li>
            </>
          ) : (
            <>
              <li>
                Abre <b>{location.host}</b> en el navegador de tu móvil.
              </li>
              <li>
                Toca <b>«Instalar app»</b> o <b>«Añadir a pantalla de inicio»</b> en su menú.
              </li>
              {guest && <li>Vincula tu cuenta con Google aquí y entra con ella en el móvil para seguir con la misma ciudad.</li>}
            </>
          )}
        </ol>
      )}
    </div>
  );
}

function isTouch(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
