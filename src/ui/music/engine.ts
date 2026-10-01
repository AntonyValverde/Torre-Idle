import { audio } from '../haptics';
import { nightAt, seasonAt, weatherAt } from '../weather';
import { CUP_STYLE, composeBar, eraStyle, withMood, type Mood, type Note, type Style, type Voice } from './compose';

// Reproductor de la música generativa. Programa cada compás por adelantado en el reloj de
// WebAudio (no en timers), así que no se desfasa aunque el hilo principal vaya cargado.

const MUSIC_KEY = 'torre-music';
const VOLUME_KEY = 'torre-music-vol';
/** Volumen máximo de la música: por debajo de los efectos para no taparlos. */
const MASTER = 0.55;
/** En los minijuegos normales la música de la era baja para no distraer. */
const DUCK_GAME = 0.35;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignorar */
  }
}

let musicOn = read(MUSIC_KEY) !== 'off';
let volume = (() => {
  const v = Number(read(VOLUME_KEY));
  return read(VOLUME_KEY) != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
})();

export type Scene = 'city' | 'game' | 'cup';
let era = 1;
let baseScene: Scene = 'city';
let cupDepth = 0;

export function isMusicOn() {
  return musicOn;
}

export function musicVolume() {
  return volume;
}

export function setMusicOn(on: boolean) {
  musicOn = on;
  write(MUSIC_KEY, on ? 'on' : 'off');
  if (on) start();
  else stop();
}

export function setMusicVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  write(VOLUME_KEY, String(volume));
  applyGain();
}

/** La app avisa de la era y de si hay un minijuego abierto. */
export function setMusicContext(nextEra: number, scene: Scene) {
  const before = currentId();
  era = nextEra;
  baseScene = scene;
  changed(before);
}

/** Mientras dure una prueba de la Copa suena su tema. Devuelve la función para quitarlo. */
export function pushCupMusic(): () => void {
  const before = currentId();
  cupDepth++;
  changed(before);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const prev = currentId();
    cupDepth--;
    changed(prev);
  };
}

function scene(): Scene {
  return cupDepth > 0 ? 'cup' : baseScene;
}

export function currentMood(ms = Date.now()): Mood {
  const d = new Date(ms);
  return { night: nightAt(d.getHours() + d.getMinutes() / 60), weather: weatherAt(ms), season: seasonAt(ms) };
}

function baseStyle(): Style {
  return scene() === 'cup' ? CUP_STYLE : eraStyle(era);
}

function currentId() {
  return baseStyle().id;
}

/** Estilo que suena ahora, con la hora y el clima aplicados. */
export function currentStyle(ms = Date.now()): Style {
  return scene() === 'cup' ? CUP_STYLE : withMood(eraStyle(era), currentMood(ms));
}

/** Texto para el perfil: "Flauta del valle · versión nocturna". */
export function nowPlaying(ms = Date.now()): string {
  const s = baseStyle();
  if (scene() === 'cup') return s.title;
  const m = currentMood(ms);
  const extra: string[] = [];
  if (m.night > 0.5) extra.push('versión nocturna');
  if (m.weather === 'rain' || m.weather === 'storm') extra.push('con lluvia');
  if (m.weather === 'snow' || m.season === 'christmas' || m.season === 'newyear') extra.push('con campanitas');
  if (m.season === 'halloween') extra.push('de Halloween');
  return [s.title, ...extra].join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Instrumentos
// ---------------------------------------------------------------------------------------------

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

type Env = { attack: number; release: number; peak: number; decay?: number };

/** Envolvente: ataque, mantiene hasta `end` (o decae si hay `decay`) y suelta. Devuelve cuándo parar. */
function envelope(g: AudioParam, t: number, end: number, e: Env): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(e.peak, t + e.attack);
  if (e.decay != null) {
    g.setTargetAtTime(0, t + e.attack, e.decay / 3);
    return t + e.attack + e.decay * 1.6;
  }
  g.setValueAtTime(e.peak, Math.max(t + e.attack, end));
  g.setTargetAtTime(0, Math.max(t + e.attack, end), e.release / 3);
  return Math.max(t + e.attack, end) + e.release * 1.6;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, out: AudioNode, t: number, stop: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(out);
  o.start(t);
  o.stop(stop);
  return o;
}

function gainNode(ctx: BaseAudioContext, out: AudioNode) {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(out);
  return g;
}

function lowpass(ctx: BaseAudioContext, freq: number, out: AudioNode, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(out);
  return f;
}

function vibrato(ctx: BaseAudioContext, o: OscillatorNode, t: number, stop: number, depth: number) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5;
  const amt = ctx.createGain();
  amt.gain.setValueAtTime(0, t);
  amt.gain.linearRampToValueAtTime(depth, t + 0.35);
  lfo.connect(amt).connect(o.frequency);
  lfo.start(t);
  lfo.stop(stop);
}

/** Toca una nota en `out`. `t` y `dur` en segundos del reloj de audio. */
export function playNote(ctx: BaseAudioContext, out: AudioNode, voice: Voice, midi: number, t: number, dur: number, vel: number) {
  const f = mtof(midi);
  const end = t + dur;
  switch (voice) {
    case 'pluck': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.005, release: 0, peak: 0.16 * vel, decay: Math.min(1.1, dur + 0.3) });
      osc(ctx, 'triangle', f, g, t, stop);
      break;
    }
    case 'flute': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.07, release: 0.2, peak: 0.11 * vel });
      const o = osc(ctx, 'sine', f, g, t, stop);
      vibrato(ctx, o, t, stop, f * 0.005);
      const g2 = gainNode(ctx, out);
      envelope(g2.gain, t, end, { attack: 0.05, release: 0.15, peak: 0.025 * vel });
      osc(ctx, 'triangle', f * 2, g2, t, stop);
      break;
    }
    case 'epiano': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.004, release: 0, peak: 0.09 * vel, decay: Math.min(1.8, dur + 0.6) });
      osc(ctx, 'sine', f, g, t, stop);
      const tine = gainNode(ctx, out);
      envelope(tine.gain, t, end, { attack: 0.002, release: 0, peak: 0.025 * vel, decay: 0.18 });
      osc(ctx, 'sine', f * 4, tine, t, t + 0.4);
      break;
    }
    case 'bass': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.01, release: 0.1, peak: 0.2 * vel });
      osc(ctx, 'triangle', f, lowpass(ctx, 800, g), t, stop);
      // Armónico para que se oiga en altavoces de móvil, que casi no dan graves
      const h = gainNode(ctx, out);
      envelope(h.gain, t, end, { attack: 0.01, release: 0.1, peak: 0.04 * vel });
      osc(ctx, 'sine', f * 2, h, t, stop);
      break;
    }
    case 'synthbass': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.005, release: 0.06, peak: 0.1 * vel });
      const lp = lowpass(ctx, 1400, g, 4);
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
      osc(ctx, 'sawtooth', f, lp, t, stop);
      break;
    }
    case 'pad': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: Math.min(0.8, dur / 3), release: 0.9, peak: 0.03 * vel });
      const lp = lowpass(ctx, 1100, g);
      osc(ctx, 'sawtooth', f, lp, t, stop, -8);
      osc(ctx, 'sawtooth', f, lp, t, stop, 8);
      break;
    }
    case 'choir': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: Math.min(0.5, dur / 3), release: 1, peak: 0.05 * vel });
      const lp = lowpass(ctx, 1500, g);
      osc(ctx, 'triangle', f, lp, t, stop, -6);
      osc(ctx, 'triangle', f, lp, t, stop, 6);
      break;
    }
    case 'arp': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.003, release: 0, peak: 0.04 * vel, decay: 0.18 });
      osc(ctx, 'square', f, lowpass(ctx, 2200, g), t, stop);
      break;
    }
    case 'lead': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.02, release: 0.12, peak: 0.045 * vel });
      const o = osc(ctx, 'square', f, lowpass(ctx, 2600, g), t, stop);
      vibrato(ctx, o, t, stop, f * 0.004);
      break;
    }
    case 'bell': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.003, release: 0, peak: 0.07 * vel, decay: 1.6 });
      osc(ctx, 'sine', f, g, t, stop);
      const p = gainNode(ctx, out);
      envelope(p.gain, t, end, { attack: 0.002, release: 0, peak: 0.02 * vel, decay: 0.45 });
      osc(ctx, 'sine', f * 2.76, p, t, t + 0.9);
      break;
    }
    case 'strings': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.02, release: 0.1, peak: 0.045 * vel });
      osc(ctx, 'sawtooth', f, lowpass(ctx, 2400, g), t, stop);
      break;
    }
    case 'kick': {
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.002, release: 0, peak: 0.32 * vel, decay: 0.25 });
      const o = osc(ctx, 'sine', 130, g, t, stop);
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      break;
    }
    case 'snare':
    case 'hat': {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = voice === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = voice === 'hat' ? 7000 : 1800;
      const g = gainNode(ctx, out);
      const stop = envelope(g.gain, t, end, { attack: 0.001, release: 0, peak: (voice === 'hat' ? 0.05 : 0.09) * vel, decay: voice === 'hat' ? 0.045 : 0.12 });
      src.connect(filter).connect(g);
      src.start(t, Math.random() * 0.3);
      src.stop(stop);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Mezcla: compás → eco → filtro (noche/lluvia) → volumen → compresor
// ---------------------------------------------------------------------------------------------

type Graph = { input: GainNode; filter: BiquadFilterNode; delay: DelayNode; wet: GainNode; bus: GainNode };

export function buildGraph(ctx: BaseAudioContext, dest: AudioNode = ctx.destination): Graph {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(dest);
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(comp);
  const filter = lowpass(ctx, 8000, bus);
  const input = ctx.createGain();
  input.connect(filter);
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const wet = ctx.createGain();
  wet.gain.value = 0;
  input.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(filter);
  return { input, filter, delay, wet, bus };
}

/** Programa un compás en su propio nodo de volumen (para poder cortarlo al cambiar de tema). */
export function scheduleBar(ctx: BaseAudioContext, g: Graph, style: Style, notes: Note[], t0: number): { gain: GainNode; end: number } {
  const spb = 60 / style.bpm;
  const barGain = ctx.createGain();
  barGain.gain.value = style.level;
  barGain.connect(g.input);
  g.filter.frequency.setTargetAtTime(style.brightness, t0, 1.5);
  g.delay.delayTime.setTargetAtTime(spb * 0.75, t0, 0.1);
  g.wet.gain.setTargetAtTime(style.echo * 0.6, t0, 0.5);
  let end = t0 + 4 * spb;
  for (const n of notes) {
    playNote(ctx, barGain, n.voice, n.midi, t0 + n.t * spb, n.dur * spb, n.vel);
    end = Math.max(end, t0 + (n.t + n.dur) * spb + 2);
  }
  return { gain: barGain, end };
}

// ---------------------------------------------------------------------------------------------
// Reproducción en vivo
// ---------------------------------------------------------------------------------------------

const session = Math.floor(Math.random() * 2 ** 31);
let graph: Graph | null = null;
let ctxRef: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let nextBar = 0;
let bar = 0;
let playingId = '';
let bars: { gain: GainNode; end: number }[] = [];

function targetGain() {
  const duck = scene() === 'game' ? DUCK_GAME : 1;
  return musicOn ? volume * MASTER * duck : 0;
}

function applyGain() {
  if (!graph || !ctxRef) return;
  graph.bus.gain.setTargetAtTime(targetGain(), ctxRef.currentTime, 0.4);
}

/** Corta con un fundido lo que ya estaba programado y empieza otra canción. */
function changed(beforeId: string) {
  applyGain();
  if (!ctxRef || currentId() === beforeId) return;
  const t = ctxRef.currentTime;
  for (const b of bars) {
    b.gain.gain.setTargetAtTime(0, t, 0.2);
  }
  nextBar = t + 0.5;
  bar = 0;
}

function tick() {
  const ctx = ctxRef;
  if (!ctx || !graph || !musicOn || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  // Tras una pausa larga (pestaña dormida) se retoma desde ahora, sin amontonar compases
  if (nextBar < now) nextBar = now + 0.1;
  while (nextBar < now + 0.6) {
    const style = currentStyle();
    if (style.id !== playingId) {
      playingId = style.id;
      bar = 0;
    }
    const b = scheduleBar(ctx, graph, style, composeBar(style, session, bar), nextBar);
    bars.push(b);
    nextBar += (4 * 60) / style.bpm;
    bar++;
  }
  // Suelta los compases que ya sonaron
  bars = bars.filter((b) => {
    if (b.end > now) return true;
    b.gain.disconnect();
    return false;
  });
}

function start() {
  if (!musicOn || typeof document === 'undefined' || document.visibilityState === 'hidden') return;
  try {
    ctxRef = audio();
  } catch {
    return;
  }
  graph ??= buildGraph(ctxRef);
  applyGain();
  if (timer == null) {
    nextBar = ctxRef.currentTime + 0.3;
    timer = setInterval(tick, 150);
    tick();
  }
}

function stop() {
  clearInterval(timer);
  timer = undefined;
  if (!ctxRef || !graph) return;
  const t = ctxRef.currentTime;
  graph.bus.gain.setTargetAtTime(0, t, 0.25);
  for (const b of bars) b.gain.gain.setTargetAtTime(0, t, 0.25);
  bars = [];
}

/** Estado para depurar desde la consola o las pruebas automáticas. */
export function musicDebug() {
  return {
    on: musicOn,
    running: timer != null,
    state: ctxRef?.state ?? 'none',
    playing: playingId,
    bar,
    scheduled: bars.length,
    scene: scene(),
    era,
    gain: graph ? Math.round(graph.bus.gain.value * 1000) / 1000 : 0,
  };
}

// El navegador solo deja sonar audio tras un toque del jugador
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (!musicOn) return;
    if (timer == null) start();
    else if (ctxRef?.state !== 'running') audio(); // iOS lo suspende tras una llamada
  };
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
    else if (ctxRef) start();
  });
}
