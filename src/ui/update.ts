import { create } from 'zustand';

// Nueva versión del juego lista (service worker). No se recarga sola para no cortar una partida:
// se muestra un aviso y el jugador decide cuándo actualizar.
export const useUpdate = create<{ ready: boolean; apply: () => void }>(() => ({ ready: false, apply: () => {} }));
