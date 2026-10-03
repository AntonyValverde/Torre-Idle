import { advisorsAlert, seatCount } from '../game/advisors';
import { dateKey, isNewDay, prevDateKey } from '../game/clock';
import { CUP_GAME_INFO, cupEvents, cupPhase } from '../game/cup';
import { eraName, maxTickets, pendingStars } from '../game/economy';
import { fmt } from '../game/format';
import { lawPending } from '../game/laws';
import { DIVISIONS, chestReady } from '../game/missions';
import { PAPER_RECORDS, type PaperDelta } from '../game/paper';
import type { GameState } from '../game/state';
import { STOCKS, stockPrice, type StockDef } from '../game/stocks';
import { hashString, mulberry32 } from '../minigames/rng';
import { SEASON_LABEL, WEATHER_LABEL, seasonAt, weatherAt } from './weather';

// Contenido de "La Gaceta de Infinite City", el periódico diario. Todo sale de la partida, de la fecha
// o de fórmulas que son iguales para todos (bolsa, clima, Copa): no gasta lecturas de la base de datos.

const DAY = 86_400_000;
/** Día de la edición nº 1. */
export const EDITION_EPOCH = '2026-09-25';

export function editionNumber(today: string): number {
  const [y, m, d] = today.split('-').map(Number);
  const [y0, m0, d0] = EDITION_EPOCH.split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / DAY) + 1);
}

/** Fecha larga en español: "jueves, 1 de octubre de 2026". */
export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export interface Story {
  emoji: string;
  title: string;
  text: string;
}

/** Noticias de la ciudad del jugador, de la más importante a la menos. */
export function headlines(s: GameState, d: PaperDelta | null): Story[] {
  const mayor = s.name;
  if (!d) {
    return [
      {
        emoji: '📰',
        title: '¡Sale la primera edición de La Gaceta!',
        text: `Cada mañana te contaremos qué pasó en la ciudad del alcalde ${mayor}, cómo va la bolsa y qué hay en la agenda.`,
      },
    ];
  }
  const out: Story[] = [];
  if (d.eras > 0) {
    out.push({
      emoji: '🌅',
      title: `¡Nueva era! La ciudad ya es ${eraName(d.era)}`,
      text: `El alcalde ${mayor} refundó la ciudad${d.eras > 1 ? ` ${d.eras} veces` : ''} y suma +${fmt(d.stars)} ⭐ de legado.`,
    });
  }
  if (d.trophy) {
    const t = { gold: ['🏆', 'gana la Copa de Alcaldes'], silver: ['🥈', 'es subcampeón de la Copa'], bronze: ['🥉', 'sube al podio de la Copa'] }[d.trophy];
    out.push({ emoji: t[0], title: `¡${mayor} ${t[1]}!`, text: 'La plaza ya luce el trofeo. Los vecinos no hablan de otra cosa.' });
  }
  if ((d.conqWins ?? 0) > 0) {
    out.push({ emoji: '⚔️', title: `¡${mayor} gana la Conquista de la semana!`, text: 'Una nueva bandera azul ondea junto al ayuntamiento.' });
  }
  if ((d.conqTaken ?? 0) > 0) {
    out.push({
      emoji: '🏰',
      title: `Las tropas de ${mayor} toman ${d.conqTaken} ${d.conqTaken === 1 ? 'territorio' : 'territorios'}`,
      text: 'El mapa de la región se tiñe de azul. Los cronistas ya hablan de una campaña histórica.',
    });
  }
  if ((d.conqLost ?? 0) > 0) {
    out.push({
      emoji: '🏴',
      title: `La ciudad pierde ${d.conqLost} ${d.conqLost === 1 ? 'territorio' : 'territorios'} en la Conquista`,
      text: 'Los vecinos piden recuperarlos. Las tropas esperan en el Mapa del mundo → Conquista.',
    });
  }
  if (d.league >= 0) {
    const div = DIVISIONS[d.league];
    if (div) out.push({ emoji: div.emoji, title: `Ascenso histórico a la liga ${div.name}`, text: 'Mejor división de la liga semanal alcanzada hasta hoy.' });
  }
  for (const r of d.records) {
    const info = PAPER_RECORDS[r.key];
    out.push({
      emoji: info.emoji,
      title: `Nuevo récord en ${info.name}: ${fmt(r.value)} ${info.unit}`,
      text: 'Los vecinos lo celebraron hasta tarde.',
    });
  }
  if (d.gifts > 0) {
    out.push({
      emoji: '❤️',
      title: `${d.gifts} ${d.gifts === 1 ? 'alcalde te dejó un regalo' : 'alcaldes te dejaron regalos'}`,
      text: 'Tu ciudad cae bien en la región. Devuelve la visita desde el Mapa del mundo.',
    });
  }
  if (d.achievements > 0) {
    out.push({ emoji: '🏅', title: `${d.achievements} ${d.achievements === 1 ? 'logro nuevo' : 'logros nuevos'}`, text: 'El ayuntamiento amplía su vitrina.' });
  }
  if (d.earned > 0) {
    out.push({
      emoji: '💰',
      title: `La ciudad recauda ${fmt(d.earned)} monedas`,
      text: `${d.taps > 0 ? `${fmt(d.taps)} toques` : 'Sin un solo toque'}, ${d.balloons} globos dorados y ${d.missions} misiones cumplidas.`,
    });
  }
  if (!out.length) out.push({ emoji: '😴', title: 'Día tranquilo en la ciudad', text: 'Las calles echan de menos a su alcalde. ¡Hoy es un buen día para volver a construir!' });
  return out;
}

export interface Mover {
  def: StockDef;
  pct: number;
}

/** Las acciones que más subieron y más bajaron en las últimas 24 horas. */
export function marketMovers(t: number): { up: Mover; down: Mover } {
  const all = STOCKS.map((def) => ({ def, pct: stockPrice(def, t) / stockPrice(def, t - DAY) - 1 })).sort((a, b) => b.pct - a.pct);
  return { up: all[0], down: all[all.length - 1] };
}

/** Previsión del clima de hoy: mañana, tarde y noche. */
export function forecast(t: number): { label: string; weather: string }[] {
  const d = new Date(t);
  const at = (h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
  return [
    { label: 'Mañana', weather: WEATHER_LABEL[weatherAt(at(9))] },
    { label: 'Tarde', weather: WEATHER_LABEL[weatherAt(at(15))] },
    { label: 'Noche', weather: WEATHER_LABEL[weatherAt(at(21))] },
  ];
}

/** Lo que toca hoy en la ciudad. */
export function agenda(s: GameState, t: number): string[] {
  const out: string[] = [];
  const today = dateKey(t);
  const season = seasonAt(t);
  if (season) out.push(`${SEASON_LABEL[season]}: la ciudad está de fiesta.`);
  const info = cupPhase(t);
  const ev = cupEvents(info.week);
  if (info.phase === 'signup') {
    const games = (['g1', 'g2', 'g3'] as const).map((k) => `${CUP_GAME_INFO[ev[k]].emoji} ${CUP_GAME_INFO[ev[k]].name}`).join(', ');
    out.push(`🏆 Copa de Alcaldes: inscripciones abiertas. El sábado se juega ${games}.`);
  } else if (info.phase === 'groups') out.push('🏆 Hoy se juega la fase de grupos de la Copa de Alcaldes. ¡Mucha suerte!');
  else out.push(`🏆 Hoy es la gran final de la Copa: prueba sorpresa de ${CUP_GAME_INFO[ev.f].emoji} ${CUP_GAME_INFO[ev.f].name}.`);
  const puzzles = [s.daily, s.roads, s.parks].filter((r) => isNewDay(r.last, today)).length;
  if (puzzles > 0) out.push(`🧩 ${puzzles} ${puzzles === 1 ? 'reto diario te espera' : 'retos diarios te esperan'} en Juegos.`);
  if (isNewDay(s.wheelLast, today)) out.push('🎡 Tienes un giro gratis en la Rueda de la fortuna.');
  if (!s.missions.chest) out.push('🎁 Completa las 3 misiones del día para abrir el cofre.');
  return out;
}

const TIPS = [
  'Los hitos de cada edificio (25, 50, 100…) duplican su producción: a veces compensa comprar unos pocos más.',
  'Los incidentes de la ciudad se juegan gratis y pagan x1,5. ¡No los dejes escapar!',
  'Las copias repetidas de un consejero lo suben de nivel. Ningún sobre se desperdicia.',
  'Antes de refundar, vende tus acciones: la bolsa no pasa a la era nueva.',
  'La ley de cada era se combina con los consejeros: busca los que potencien lo mismo.',
  'Reorganizar el legado es gratis una vez por era: prueba otra rama sin miedo.',
  'Las misiones semanales dan sobres de consejero y cartas para la Copa.',
  'Jugar entre semana llena la grada de la Copa: con 3 días tienes un intento extra el sábado.',
];

/** Columna de Clara: un consejo que viene al caso, o uno del día. */
export function claraTip(s: GameState, t: number): string {
  if (lawPending(s)) return 'Tu era aún no tiene ley. Elige una en la Ciudad: cada una cambia la forma de jugar.';
  if (s.advisors.packs > 0 || advisorsAlert(s)) return 'Hay un sobre de consejero esperándote en Mejoras → Consejo.';
  const owned = Object.keys(s.advisors.copies).length;
  if (owned > s.advisors.seats.length && s.advisors.seats.length < seatCount(s)) return 'Tienes sillas libres en el consejo: siéntale a alguien, que solo cuentan los sentados.';
  if (s.tickets >= maxTickets(s)) return 'Tus tickets están llenos y ya no se recargan: gasta alguno en un arcade.';
  if (chestReady(s)) return 'El cofre del día ya está listo. ¡Ábrelo en la Ciudad!';
  const stars = pendingStars(s);
  if (stars >= Math.max(5, s.stars)) return `Refundar ahora te daría +${fmt(stars)} ⭐: duplicarías tus estrellas de legado.`;
  return TIPS[mulberry32(hashString('consejo:' + dateKey(t)))() * TIPS.length | 0];
}

const CLASSIFIEDS = [
  'SE VENDE choza con vistas al portal dimensional. Ideal para parejas. Abstenerse ladrones.',
  'BUSCO compañero de Stack Tower. Pulso firme imprescindible.',
  'PERDIDO globo dorado. Responde al nombre de "Brillitos". Se gratifica.',
  'OFREZCO clases de semáforo. Cero accidentes (casi).',
  'CAMBIO 3 cartas de escudo por una de estrella. Trato serio.',
  'ALQUILO plaza de aparcamiento junto al metro. Viajeros con prisa, no.',
  'VENDO acciones de OVNI Corp. Motivo: nervios.',
  'SE NECESITA bombero con experiencia. Agua no incluida.',
  'CLUB de fans de la Copa busca bombo y banderines.',
  'REGALO gato que se cree alcalde. Firma decretos él solo.',
  'SE BUSCA testigo del último incidente de tráfico. Llevaba prisa.',
  'CURSO intensivo: cómo memorizar ventanas sin perder la cabeza.',
  'VENDO consejero repetido. Bueno, no: ya sé que sube de nivel.',
  'ARQUITECTO jubilado construye torres de 50 pisos en 30 segundos.',
];

/** Dos anuncios por clasificados, distintos cada día e iguales para todos. */
export function classifieds(t: number): string[] {
  const rand = mulberry32(hashString('clasificados:' + dateKey(t)));
  const pool = CLASSIFIEDS.slice();
  return [pool.splice(Math.floor(rand() * pool.length), 1)[0], pool.splice(Math.floor(rand() * pool.length), 1)[0]];
}

/** "Ayer" o "desde el 28/9" si pasaron varios días desde la foto anterior. */
export function sinceLabel(d: PaperDelta, today: string): string {
  if (d.since === prevDateKey(today)) return 'Ayer en tu ciudad';
  const [, sm, sd] = d.since.split('-').map(Number);
  return `Desde tu última visita (${sd}/${sm})`;
}
