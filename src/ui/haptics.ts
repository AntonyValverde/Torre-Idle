const SOUND_KEY = 'torre-sound';

let soundOn = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
})();

export function isSoundOn() {
  return soundOn;
}

export function setSoundOn(on: boolean) {
  soundOn = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* ignorar */
  }
}

export function vibrate(pattern: number | number[]) {
  if (soundOn && 'vibrate' in navigator) navigator.vibrate(pattern);
}

let ctx: AudioContext | null = null;

type Sfx = 'tap' | 'crit' | 'buy' | 'win' | 'error';

const NOTES: Record<Sfx, { f: number[]; d: number; type: OscillatorType; vol: number }> = {
  tap: { f: [520], d: 0.05, type: 'triangle', vol: 0.05 },
  crit: { f: [660, 990], d: 0.08, type: 'square', vol: 0.05 },
  buy: { f: [440, 660], d: 0.07, type: 'triangle', vol: 0.07 },
  win: { f: [523, 659, 784, 1047], d: 0.1, type: 'triangle', vol: 0.08 },
  error: { f: [200], d: 0.12, type: 'sawtooth', vol: 0.04 },
};

/**
 * Devuelve el contexto de audio listo para sonar. En iOS/Android arranca suspendido y se
 * vuelve a suspender tras una llamada o al pasar a segundo plano, así que se reanuda siempre.
 * Lo comparten los efectos y la música.
 */
export function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

// En móviles solo ciertos eventos (touchend, click) cuentan como gesto que permite activar el audio
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (!soundOn) return;
    try {
      audio();
    } catch {
      /* sin audio */
    }
  };
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    // En segundo plano se suspende el audio para no gastar batería (la música ya se paró);
    // al volver se reanuda, y si el navegador exige un toque, lo hará el siguiente toque.
    if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
    else unlock();
  });
}

/** Nota suelta (para escalas que suben con los combos). */
export function tone(freq: number, dur = 0.09, type: OscillatorType = 'triangle', vol = 0.07) {
  if (!soundOn) return;
  try {
    const ctx = audio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur * 2.2);
  } catch {
    /* audio no disponible */
  }
}

/** Roce de papel al pasar una página: un golpe de ruido filtrado que barre hacia los agudos. */
export function rustle() {
  if (!soundOn) return;
  try {
    const ctx = audio();
    const dur = 0.28;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    const t0 = ctx.currentTime;
    filter.frequency.setValueAtTime(900, t0);
    filter.frequency.exponentialRampToValueAtTime(3200, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  } catch {
    /* audio no disponible */
  }
}

export function sfx(kind: Sfx) {
  if (!soundOn) return;
  try {
    const ctx = audio();
    const n = NOTES[kind];
    const t0 = ctx.currentTime;
    n.f.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx!.createGain();
      osc.type = n.type;
      osc.frequency.value = freq;
      const start = t0 + i * n.d;
      gain.gain.setValueAtTime(n.vol, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d * 1.8);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + n.d * 2);
    });
  } catch {
    /* audio no disponible */
  }
}
