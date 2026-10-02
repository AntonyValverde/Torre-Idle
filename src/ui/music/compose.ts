import { hashString, mulberry32 } from '../../minigames/rng';
import type { Season, Weather } from '../weather';

// Música generativa: cada era tiene un estilo (escala, tempo, instrumentos) y las melodías se
// componen compás a compás con una semilla. Sin archivos de audio: lo toca WebAudio (engine.ts).
// Estructura de cada canción: 16 compases en forma AABA, así que la melodía se repite lo justo
// para reconocerla y luego cambia.

export type Voice =
  | 'pluck'
  | 'flute'
  | 'epiano'
  | 'bass'
  | 'synthbass'
  | 'pad'
  | 'choir'
  | 'arp'
  | 'lead'
  | 'bell'
  | 'strings'
  | 'kick'
  | 'snare'
  | 'hat';

/** Nota de un compás: `t` y `dur` en pulsos (4 por compás), `vel` de 0 a 1. */
export type Note = { t: number; dur: number; midi: number; voice: Voice; vel: number };

type Drums = 'none' | 'shaker' | 'soft' | 'beat' | 'half';

export type Style = {
  id: string;
  /** Ajuste de volumen para que todas las eras suenen parecido de fuerte. */
  level: number;
  title: string;
  bpm: number;
  /** Nota central de los acordes (MIDI). La melodía va una octava encima y el bajo dos debajo. */
  root: number;
  scale: number[];
  /** Acordes por grado de la escala (0 = tónica), uno por compás. */
  progressions: number[][];
  sevenths?: boolean;
  lead: Voice | null;
  /** Probabilidad de nota en cada corchea de la melodía. */
  density: number;
  /** Grados de la escala que la melodía evita en tiempos débiles (sabor pentatónico). */
  avoid?: number[];
  bass: { voice: Voice; pattern: 'root2' | 'long' | 'walk' | 'eighths' };
  chords?: { voice: Voice; pattern: 'hold' | 'stabs' };
  arp?: { voice: Voice; rate: 1 | 2 | 4 };
  drums: Drums;
  /** Campanitas sueltas en el agudo. */
  sparkle?: boolean;
  /** Cantidad de eco (0 a 1). */
  echo: number;
  /** Corte del filtro general en Hz: lo bajan la noche y la lluvia. */
  brightness: number;
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];

const ERA_STYLES: Style[] = [
  {
    id: 'aldea',
    level: 0.62,
    title: 'Flauta del valle',
    bpm: 76,
    root: 62,
    scale: MAJOR,
    progressions: [
      [0, 3, 4, 0],
      [0, 5, 3, 4],
      [0, 3, 0, 4],
    ],
    lead: 'flute',
    density: 0.4,
    avoid: [3, 6],
    bass: { voice: 'bass', pattern: 'root2' },
    arp: { voice: 'pluck', rate: 1 },
    drums: 'none',
    echo: 0.18,
    brightness: 7000,
  },
  {
    id: 'pueblo',
    level: 0.74,
    title: 'Plaza del mercado',
    bpm: 90,
    root: 55,
    scale: MAJOR,
    progressions: [
      [0, 4, 5, 3],
      [0, 3, 4, 4],
      [0, 0, 3, 4],
    ],
    lead: 'pluck',
    density: 0.55,
    avoid: [3, 6],
    bass: { voice: 'bass', pattern: 'root2' },
    arp: { voice: 'pluck', rate: 2 },
    drums: 'shaker',
    echo: 0.1,
    brightness: 8000,
  },
  {
    id: 'ciudad',
    level: 0.83,
    title: 'Café de la esquina',
    bpm: 94,
    root: 53,
    scale: MAJOR,
    progressions: [
      [0, 5, 1, 4],
      [0, 3, 1, 4],
      [2, 5, 1, 4],
    ],
    sevenths: true,
    lead: 'epiano',
    density: 0.5,
    bass: { voice: 'bass', pattern: 'walk' },
    chords: { voice: 'epiano', pattern: 'stabs' },
    drums: 'soft',
    echo: 0.12,
    brightness: 7000,
  },
  {
    id: 'metropolis',
    level: 0.83,
    title: 'Jazz de avenida',
    bpm: 100,
    root: 62,
    scale: DORIAN,
    progressions: [
      [0, 3, 0, 3],
      [0, 3, 4, 3],
      [5, 6, 0, 0],
    ],
    sevenths: true,
    lead: 'bell',
    density: 0.45,
    bass: { voice: 'bass', pattern: 'walk' },
    chords: { voice: 'epiano', pattern: 'stabs' },
    drums: 'soft',
    echo: 0.2,
    brightness: 6000,
  },
  {
    id: 'megalopolis',
    level: 1.2,
    title: 'Neón y autopistas',
    bpm: 116,
    root: 64,
    scale: MINOR,
    progressions: [
      [0, 5, 2, 6],
      [0, 6, 5, 6],
      [0, 3, 5, 4],
    ],
    lead: 'lead',
    density: 0.5,
    bass: { voice: 'synthbass', pattern: 'eighths' },
    chords: { voice: 'pad', pattern: 'hold' },
    arp: { voice: 'arp', rate: 4 },
    drums: 'beat',
    echo: 0.2,
    brightness: 9000,
  },
  {
    id: 'orbital',
    level: 1.3,
    title: 'Anillos de luz',
    bpm: 104,
    root: 57,
    scale: LYDIAN,
    progressions: [
      [0, 1, 0, 1],
      [0, 1, 4, 3],
      [3, 1, 0, 0],
    ],
    lead: 'bell',
    density: 0.4,
    bass: { voice: 'synthbass', pattern: 'root2' },
    chords: { voice: 'pad', pattern: 'hold' },
    arp: { voice: 'arp', rate: 4 },
    drums: 'soft',
    sparkle: true,
    echo: 0.35,
    brightness: 8000,
  },
  {
    id: 'lunar',
    level: 0.65,
    title: 'Silencio lunar',
    bpm: 64,
    root: 60,
    scale: DORIAN,
    progressions: [
      [0, 6, 5, 6],
      [0, 3, 0, 6],
    ],
    lead: 'bell',
    density: 0.22,
    bass: { voice: 'bass', pattern: 'long' },
    chords: { voice: 'pad', pattern: 'hold' },
    drums: 'none',
    sparkle: true,
    echo: 0.55,
    brightness: 5000,
  },
  {
    id: 'solar',
    level: 0.55,
    title: 'Corona del sol',
    bpm: 74,
    root: 62,
    scale: MAJOR,
    progressions: [
      [0, 4, 5, 3],
      [0, 3, 5, 4],
    ],
    lead: 'flute',
    density: 0.35,
    bass: { voice: 'bass', pattern: 'long' },
    chords: { voice: 'choir', pattern: 'hold' },
    arp: { voice: 'pluck', rate: 2 },
    drums: 'none',
    echo: 0.45,
    brightness: 7000,
  },
  {
    id: 'galactica',
    level: 0.64,
    title: 'Himno de las estrellas',
    bpm: 84,
    root: 57,
    scale: MINOR,
    progressions: [
      [0, 5, 2, 6],
      [0, 5, 3, 4],
      [0, 6, 5, 4],
    ],
    lead: 'lead',
    density: 0.3,
    bass: { voice: 'bass', pattern: 'root2' },
    chords: { voice: 'choir', pattern: 'hold' },
    arp: { voice: 'strings', rate: 2 },
    drums: 'half',
    echo: 0.3,
    brightness: 8000,
  },
  {
    id: 'multiverso',
    level: 1.06,
    title: 'Ecos de otros mundos',
    bpm: 80,
    root: 61,
    scale: PHRYGIAN_DOM,
    progressions: [
      [0, 1, 0, 6],
      [0, 1, 5, 4],
      [0, 3, 1, 0],
    ],
    lead: 'lead',
    density: 0.4,
    bass: { voice: 'synthbass', pattern: 'long' },
    chords: { voice: 'pad', pattern: 'hold' },
    arp: { voice: 'bell', rate: 4 },
    drums: 'soft',
    sparkle: true,
    echo: 0.5,
    brightness: 7000,
  },
];

/** Tema de las pruebas de la Copa: rápido, en menor armónica y con ritmo marcado. */
export const CUP_STYLE: Style = {
  id: 'copa',
  level: 1.22,
  title: 'Tema de la Copa',
  bpm: 132,
  root: 64,
  scale: HARMONIC,
  progressions: [
    [0, 5, 3, 4],
    [0, 0, 5, 4],
    [0, 3, 4, 0],
  ],
  lead: 'lead',
  density: 0.55,
  bass: { voice: 'synthbass', pattern: 'eighths' },
  arp: { voice: 'strings', rate: 2 },
  drums: 'beat',
  echo: 0.1,
  brightness: 10000,
};

/** Tema del casino: lounge de noche en menor armónica, con bajo caminante y piano eléctrico. */
export const CASINO_STYLE: Style = {
  id: 'casino',
  level: 0.9,
  title: 'Noche de casino',
  bpm: 112,
  root: 57,
  scale: HARMONIC,
  progressions: [
    [0, 3, 4, 0],
    [0, 5, 3, 4],
    [0, 3, 0, 4],
  ],
  sevenths: true,
  lead: 'lead',
  density: 0.42,
  bass: { voice: 'bass', pattern: 'walk' },
  chords: { voice: 'epiano', pattern: 'stabs' },
  drums: 'soft',
  sparkle: true,
  echo: 0.18,
  brightness: 8000,
};

export const ERA_STYLE_COUNT = ERA_STYLES.length;

/** Estilo de una era. Pasado el Multiverso se repite su estilo, cada vez en otra tonalidad. */
export function eraStyle(era: number): Style {
  const e = Math.max(1, Math.floor(era));
  if (e <= ERA_STYLES.length) return ERA_STYLES[e - 1];
  const extra = e - ERA_STYLES.length;
  const base = ERA_STYLES[ERA_STYLES.length - 1];
  // Sube por quintas: recorre las 12 tonalidades entre 55 y 66
  const root = 55 + ((base.root - 55 + extra * 5) % 12);
  return { ...base, id: `${base.id}-${extra}`, root };
}

export type Mood = { night: number; weather: Weather; season: Season };

const SOFTER: Record<Drums, Drums> = { none: 'none', shaker: 'none', soft: 'none', beat: 'soft', half: 'soft' };

/**
 * Ajusta el estilo de la era a la hora y al clima: de noche más lenta, suave y apagada; con
 * lluvia más apagada; nieve y Navidad añaden campanitas; Halloween pasa a menor armónica.
 */
export function withMood(style: Style, mood: Mood): Style {
  const night = Math.min(1, Math.max(0, mood.night));
  const s: Style = {
    ...style,
    bpm: Math.round(style.bpm * (1 - 0.12 * night)),
    density: style.density * (1 - 0.35 * night),
    brightness: style.brightness * (1 - 0.5 * night),
    drums: night > 0.6 ? SOFTER[style.drums] : style.drums,
  };
  if (mood.weather === 'rain' || mood.weather === 'storm') {
    s.brightness *= 0.5;
    s.density *= 0.85;
  } else if (mood.weather === 'cloudy') {
    s.brightness *= 0.8;
  } else if (mood.weather === 'snow') {
    s.brightness *= 0.8;
    s.sparkle = true;
  }
  if (mood.season === 'christmas' || mood.season === 'newyear') {
    s.sparkle = true;
    if (s.drums === 'none') s.drums = 'shaker';
  } else if (mood.season === 'halloween' && (style.scale === MAJOR || style.scale === LYDIAN)) {
    s.scale = HARMONIC;
  }
  s.brightness = Math.max(1800, Math.round(s.brightness));
  return s;
}

/** Nota MIDI de un grado de la escala (los grados siguen subiendo por octavas). */
export function degreeMidi(scale: number[], root: number, d: number): number {
  const n = scale.length;
  const o = Math.floor(d / n);
  return root + o * 12 + scale[((d % n) + n) % n];
}

function chordOf(style: Style, deg: number): number[] {
  const c = [deg, deg + 2, deg + 4];
  if (style.sevenths) c.push(deg + 6);
  return c;
}

/** Grado más cercano a `d` que sea nota del acorde. */
function snapToChord(d: number, chord: number[], n: number): number {
  let best = d;
  let bestDist = Infinity;
  for (const c of chord) {
    const k = ((c % n) + n) % n;
    for (let x = d - n; x <= d + n; x++) {
      if (((x % n) + n) % n !== k) continue;
      const dist = Math.abs(x - d);
      if (dist < bestDist) {
        best = x;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** Junta las notas del acorde en una octava alrededor de la raíz para que no salten. */
function voiced(style: Style, chord: number[], base: number): number[] {
  return chord
    .map((c) => {
      let m = degreeMidi(style.scale, base, c);
      while (m > base + 9) m -= 12;
      return m;
    })
    .sort((a, b) => a - b);
}

/**
 * Compone un compás. Determinista: la misma sesión, el mismo estilo y el mismo número de compás
 * dan siempre las mismas notas.
 */
export function composeBar(style: Style, session: number, bar: number): Note[] {
  const notes: Note[] = [];
  const n = style.scale.length;
  const song = Math.floor(bar / 16);
  const pos = bar % 16;
  const section = Math.floor(pos / 4);
  const letter = section === 2 ? 'B' : 'A';
  const inSec = pos % 4;
  const songRng = mulberry32(hashString(`${style.id}:${session}:${song}`));
  const pi = Math.floor(songRng() * style.progressions.length);
  const prog = style.progressions[pi];
  const bridge = style.progressions[(pi + 1) % style.progressions.length];
  const progOf = letter === 'B' ? bridge : prog;
  const deg = progOf[inSec];
  const chord = chordOf(style, deg);
  const songEnd = pos === 15;
  const root = style.root;
  const add = (t: number, dur: number, midi: number, voice: Voice, vel: number) => notes.push({ t, dur, midi, voice, vel });

  // Bajo
  const bassRoot = root - 24;
  const b = style.bass;
  if (b.pattern === 'long' || songEnd) {
    add(0, 4, degreeMidi(style.scale, bassRoot, deg), b.voice, 0.8);
  } else if (b.pattern === 'root2') {
    add(0, 2, degreeMidi(style.scale, bassRoot, deg), b.voice, 0.85);
    add(2, 2, degreeMidi(style.scale, bassRoot, deg + 4), b.voice, 0.7);
  } else if (b.pattern === 'walk') {
    const next = progOf[(inSec + 1) % 4];
    const steps = [deg, deg + 2, deg + 4, next + (next > deg ? -1 : 1)];
    steps.forEach((d, i) => add(i, 0.9, degreeMidi(style.scale, bassRoot, d), b.voice, i === 0 ? 0.85 : 0.65));
  } else {
    for (let i = 0; i < 8; i++) {
      const up = i === 3 || i === 7;
      add(i * 0.5, 0.42, degreeMidi(style.scale, bassRoot, deg + (up ? n : 0)), b.voice, i % 2 === 0 ? 0.85 : 0.6);
    }
  }

  // Acordes
  if (style.chords) {
    const tones = voiced(style, chord, root);
    const v = style.chords.voice;
    if (style.chords.pattern === 'hold' || songEnd) {
      for (const m of tones) add(0, 4, m, v, 0.7);
    } else {
      const second = inSec % 2 === 0 ? 2.5 : 1.5;
      for (const m of tones) {
        add(0, 1.4, m, v, 0.6);
        add(second, 1, m, v, 0.45);
      }
    }
  }

  // Arpegio
  if (style.arp && !songEnd) {
    const tones = voiced(style, chord, root + 12);
    const up = [...tones, ...tones.map((m) => m + 12)];
    const cycle = [...up, ...up.slice(1, -1).reverse()];
    const r = style.arp.rate;
    for (let i = 0; i < 4 * r; i++) {
      add(i / r, 0.9 / r, cycle[i % cycle.length], style.arp.voice, i % r === 0 ? 0.6 : 0.42);
    }
  }

  // Melodía: los compases 1 y 3 de cada frase comparten motivo, y las frases A se repiten
  if (style.lead) {
    const motif = mulberry32(hashString(`${style.id}:${session}:${song}:${letter}:${inSec === 2 ? 0 : inSec}`));
    const on: boolean[] = [];
    on[0] = motif() < 0.85;
    for (let i = 1; i < 8; i++) on[i] = motif() < style.density * (i % 2 === 0 ? 1.15 : 0.6);
    if (inSec === 3) {
      // Final de frase: una nota al principio y otra larga en el tercer pulso
      for (let i = 0; i < 8; i++) on[i] = i === 0 || i === 4;
    }
    if (songEnd) for (let i = 0; i < 8; i++) on[i] = i === 0;
    let d = n + Math.floor(motif() * 3) - 1;
    const slots = on.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    slots.forEach((i, k) => {
      const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(motif() * 7)];
      d = Math.min(2 * n, Math.max(n - 4, d + step));
      if (i % 4 === 0 || inSec === 3) d = snapToChord(d, chord, n);
      else if (style.avoid?.includes(((d % n) + n) % n)) d += 1;
      const end = k + 1 < slots.length ? slots[k + 1] : 8;
      const dur = Math.min(4, (end - i) * 0.5) * 0.92;
      add(i * 0.5, dur, degreeMidi(style.scale, root, d), style.lead!, i % 4 === 0 ? 0.85 : 0.65 + motif() * 0.15);
    });
  }

  // Campanitas
  if (style.sparkle) {
    const sp = mulberry32(hashString(`brillo:${style.id}:${session}:${bar}`));
    if (sp() < 0.6) {
      const tones = voiced(style, chord, root + 24);
      add(Math.floor(sp() * 8) * 0.5, 1.5, tones[Math.floor(sp() * tones.length)], 'bell', 0.35);
    }
  }

  // Percusión
  switch (style.drums) {
    case 'shaker':
      for (let i = 0; i < 8; i++) add(i * 0.5, 0.1, 0, 'hat', i % 2 === 0 ? 0.3 : 0.18);
      break;
    case 'soft':
      add(0, 0.2, 0, 'kick', 0.5);
      for (let i = 0; i < 4; i++) add(i + 0.5, 0.1, 0, 'hat', 0.35);
      break;
    case 'beat':
      add(0, 0.2, 0, 'kick', 0.8);
      add(2, 0.2, 0, 'kick', 0.75);
      if (inSec === 3) add(2.5, 0.2, 0, 'kick', 0.6);
      add(1, 0.2, 0, 'snare', 0.6);
      add(3, 0.2, 0, 'snare', 0.6);
      for (let i = 0; i < 8; i++) add(i * 0.5, 0.1, 0, 'hat', i % 2 === 0 ? 0.4 : 0.25);
      break;
    case 'half':
      add(0, 0.2, 0, 'kick', 0.75);
      add(2.5, 0.2, 0, 'kick', 0.5);
      add(2, 0.2, 0, 'snare', 0.55);
      for (let i = 0; i < 4; i++) add(i, 0.1, 0, 'hat', 0.25);
      break;
  }

  return notes;
}
