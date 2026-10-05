import { create } from 'zustand';
import { track } from '../firebase';

// Instalar el juego como app (PWA). Chrome/Edge/Samsung avisan con `beforeinstallprompt` y dejan abrir
// su ventana de instalación desde un botón; Safari en iPhone no lo tiene y hay que explicar los pasos.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Cómo se instala aquí: ya instalada, con el botón del navegador, o a mano (iPhone u otro navegador). */
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'manual';

export const useInstall = create<{ event: InstallPromptEvent | null; installed: boolean }>(() => ({ event: null, installed: false }));

/** Se está jugando desde la app instalada (no desde una pestaña del navegador). */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone o iPad (el iPad moderno dice ser un Mac, pero con pantalla táctil). */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function installMode(event: InstallPromptEvent | null, installed: boolean): InstallMode {
  if (installed || isStandalone()) return 'installed';
  if (event) return 'prompt';
  return isIos() ? 'ios' : 'manual';
}

/** Hay que escucharlo nada más arrancar: el navegador lo lanza una sola vez, al poco de cargar. */
export function listenInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin esto Chrome saca su propia barra; la ventana se abre desde 👤 Perfil
    e.preventDefault();
    useInstall.setState({ event: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstall.setState({ event: null, installed: true });
    track('app_installed');
  });
}

/** Abre la ventana de instalación del navegador. Cada aviso solo se puede usar una vez. */
export async function promptInstall(): Promise<boolean> {
  const { event } = useInstall.getState();
  if (!event) return false;
  useInstall.setState({ event: null });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    track('app_install_prompt', { outcome });
    return outcome === 'accepted';
  } catch {
    return false;
  }
}
