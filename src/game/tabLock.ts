// Evita tener el juego abierto en dos pestañas a la vez: cada una tendría su propia copia
// de la partida y se pisarían al guardar. La pestaña más reciente toma el control, y la
// anterior guarda su partida antes de cederlo para que la nueva cargue lo último.

const CHANNEL = 'torre-idle-tabs';

type Msg = { type: 'claim' | 'released'; id: string };

/**
 * Reclama esta pestaña. `onLost` se llama (y debe guardar la partida) si otra pestaña la reclama después.
 * `ready` resuelve cuando la pestaña anterior confirmó que soltó el control (o a los 400 ms si no había otra).
 */
export function claimTab(onLost: () => void): { ready: Promise<void>; release: () => void } {
  if (typeof BroadcastChannel === 'undefined') return { ready: Promise.resolve(), release: () => {} };
  const id = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(CHANNEL);
  const ready = new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    const timer = setTimeout(done, 400);
    ch.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (!m || m.id === id) return;
      if (m.type === 'claim') {
        onLost();
        ch.postMessage({ type: 'released', id } satisfies Msg);
        ch.close();
      } else if (m.type === 'released') {
        clearTimeout(timer);
        done();
      }
    };
    ch.postMessage({ type: 'claim', id } satisfies Msg);
  });
  return { ready, release: () => ch.close() };
}
