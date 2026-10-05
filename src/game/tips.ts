import { casinoOpen } from './casino';
import { pendingStars } from './economy';
import { INCIDENT_LIFE_MS, INCIDENT_PENALTY } from './incidents';
import type { GameState } from './state';
import { TUTORIAL_DONE, isUnlocked, tutorialDone, type Feature, type TutorialState, type TutorialTab } from './tutorial';

// Consejos de Clara: lo que el tutorial no cuenta, explicado la primera vez que aparece.
// - inline: tarjeta dentro de la pantalla o sección de la que habla (al abrirla por primera vez).
// - bubble: burbuja de Clara abajo, cuando pasa algo (un incidente, la primera estrella…).
// - guide: solo en la Guía de Clara (lo que ya enseña el tutorial; sirve a quien lo saltó).
// Todos se pueden repasar en 👤 Perfil → 📖 Guía de Clara.

export type TipPlace = 'inline' | 'bubble' | 'guide';

export interface TipDef {
  id: string;
  emoji: string;
  title: string;
  text: string;
  place: TipPlace;
  /** Burbujas: pestaña a la que lleva su botón "Ir a…". */
  tab?: TutorialTab;
  /** En la guía sale con candado hasta que se abre esta sección… */
  feature?: Feature;
  /** …o hasta que se cumple esto. */
  available?: (s: GameState) => boolean;
}

export const TIPS: TipDef[] = [
  {
    id: 'basics',
    emoji: '👆',
    title: 'Recaudar y construir',
    text: 'Toca la ciudad para recaudar monedas; a veces sale un ¡CRÍTICO! que vale x10. Con las monedas compras edificios, que producen solos aunque no toques. Cada edificio del mismo tipo cuesta un poco más que el anterior.',
    place: 'guide',
  },
  {
    id: 'milestone',
    emoji: '🎯',
    title: 'Hitos: producción x2',
    text: 'Bajo cada edificio hay una barra: al llegar a 25, 50 y 100 (y después cada 100) ese edificio produce el doble. Muchas veces sale más a cuenta completar un hito que comprar un edificio nuevo.',
    place: 'bubble',
    tab: 'city',
  },
  {
    id: 'upgrades',
    emoji: '⬆️',
    title: 'Mejoras',
    text: 'En ⬆️ Mejoras hay mejoras que multiplican lo que producen tus edificios o tus toques. Salen nuevas a medida que construyes, así que conviene pasarse a menudo.',
    place: 'guide',
    feature: 'upgrades',
  },
  {
    id: 'decree',
    emoji: '📜',
    title: 'Decretos del consejo',
    text: 'Cada pocos minutos el consejo te propone dos ventajas: un festival, una lotería, horas extra… Elige una antes de que se acabe el tiempo; si no, se pierde.',
    place: 'guide',
    feature: 'decrees',
  },
  {
    id: 'games',
    emoji: '🎮',
    title: 'Juegos y tickets',
    text: 'Los arcade cuestan un 🎟️ ticket, y los tickets se recargan solos con el tiempo. La rueda tiene un giro gratis al día, y los tres retos diarios son gratis. Los minijuegos dan monedas, gemas y boosts de producción.',
    place: 'inline',
    feature: 'games',
  },
  {
    id: 'daily',
    emoji: '🌃',
    title: 'Retos diarios',
    text: 'Apagón, Conecta las calles y Plan verde: uno de cada al día, gratis y el mismo para todos. Dan gemas y puntos de liga, y la racha suma más gemas por cada día seguido (hasta 7). Si fallas un día, la racha vuelve a empezar.',
    place: 'guide',
    feature: 'games',
  },
  {
    id: 'council',
    emoji: '🧑‍💼',
    title: 'El consejo',
    text: 'Los consejeros salen en sobres: el primero es de regalo, y hay más en el cofre del día y en las misiones semanales (o por 20 💎). Solo ayudan los que sientas en el consejo, que empieza con 2 sillas. Las copias repetidas los suben de nivel.',
    place: 'inline',
    feature: 'shops',
  },
  {
    id: 'missions',
    emoji: '📋',
    title: 'Misiones y liga',
    text: 'Cada día hay 3 misiones nuevas y cada semana 3 más largas. Dan gemas, tickets y puntos de liga, y con las tres diarias se abre el cofre del día. La liga se reinicia cada lunes y paga según la división a la que llegues.',
    place: 'inline',
    feature: 'missions',
  },
  {
    id: 'offline',
    emoji: '🌙',
    title: 'Mientras no estás',
    text: 'Tu ciudad sigue produciendo con el juego cerrado, hasta un máximo de horas. Al volver lo recoges, o lo doblas por un 🎟️ ticket. El 🌙 Gerente nocturno de la tienda de 💎 Gemas y la rama 💤 Magnate del Legado amplían ese máximo.',
    place: 'inline',
  },
  {
    id: 'incident',
    emoji: '🚨',
    title: 'Incidentes',
    text: `¡Algo pasa en la ciudad! Toca el aviso de la escena para resolverlo con un minijuego gratis, sin ticket, y con monedas x1,5. Si lo ignoras ${INCIDENT_LIFE_MS / 1000} s, la producción baja un ${Math.round((1 - INCIDENT_PENALTY.mult) * 100)} % durante ${INCIDENT_PENALTY.seconds / 60} minutos.`,
    place: 'bubble',
    tab: 'city',
    available: tutorialDone,
  },
  {
    id: 'balloon',
    emoji: '🎈',
    title: 'Globo dorado',
    text: 'De vez en cuando cruza la ciudad un globo dorado. ¡Tócalo antes de que se vaya! Trae un buen puñado de monedas y, a veces, una gema.',
    place: 'bubble',
    tab: 'city',
  },
  {
    id: 'achievements',
    emoji: '🏅',
    title: 'Logros',
    text: 'Cada nivel de logro da +2 % de producción para siempre y unas gemas. Casi todos siguen subiendo sin límite. Cuando la pestaña 🏅 muestre un número, ven a reclamarlos.',
    place: 'inline',
    feature: 'profile',
  },
  {
    id: 'ranking',
    emoji: '🏆',
    title: 'Rankings y liga',
    text: 'Aquí te mides con los demás alcaldes. En la liga semanal solo cuentan las misiones y los retos diarios, así que un novato compite igual que un veterano. También hay récords de cada minijuego. Toca a un jugador para visitar su ciudad.',
    place: 'inline',
    feature: 'ranking',
  },
  {
    id: 'pass',
    emoji: '🎫',
    title: 'Pase de temporada',
    text: 'El pase es gratis: una pista de 25 niveles que subes con los mismos puntos de la liga, la Copa y la Conquista, durante las 4 semanas de cada temporada. Cobra cada nivel en 👤 Perfil; si se te olvida, al cambiar de temporada se pagan solos. El último nivel da un adorno exclusivo para tu ciudad.',
    place: 'inline',
    feature: 'profile',
  },
  {
    id: 'gems',
    emoji: '💎',
    title: 'Tienda de gemas',
    text: 'Las gemas compran mejoras permanentes: no se pierden al refundar la ciudad. Se ganan con misiones, retos diarios, logros, minijuegos y la Copa.',
    place: 'inline',
    feature: 'shops',
  },
  {
    id: 'star',
    emoji: '⭐',
    title: 'Tu primera estrella',
    text: 'Tu ciudad ya vale estrellas de legado. En ⬆️ Mejoras → ⭐ Legado puedes refundarla en una era nueva: empiezas de cero, pero cada estrella da +3 % de producción y se invierte en el árbol de legado. Cuanto más esperes, más estrellas.',
    place: 'bubble',
    tab: 'upgrades',
    available: (s) => s.stars > 0 || pendingStars(s) > 0,
  },
  {
    id: 'legacy',
    emoji: '🌳',
    title: 'Legado y eras',
    text: 'Refundar sube de era: se pierden monedas, edificios y mejoras, pero ganas ⭐ estrellas (+3 % de producción cada una) y se abren edificios nuevos. Las estrellas se invierten en el árbol: Magnate, Activo o Jugador. Reorganizarlo es gratis una vez por era.',
    place: 'inline',
    feature: 'shops',
  },
  {
    id: 'google',
    emoji: '🔐',
    title: 'Guarda tu ciudad',
    text: 'Juegas como invitado: si borras los datos del navegador o cambias de móvil, perderías la ciudad. En 🏅 Logros → 👤 Perfil puedes vincularla con tu cuenta de Google en un momento.',
    place: 'bubble',
    tab: 'profile',
    feature: 'profile',
  },
  {
    id: 'install',
    emoji: '📲',
    title: 'Juega desde la app',
    text: 'Puedes tener la ciudad como una app más del móvil, sin pasar por ninguna tienda: en 🏅 Logros → 👤 Perfil toca 📲 Instalar la app. En iPhone se hace desde Safari: Compartir → «Añadir a pantalla de inicio». Si juegas como invitado, vincula antes tu cuenta con Google para no perder la ciudad por el camino.',
    place: 'guide',
    feature: 'profile',
  },
  {
    id: 'law',
    emoji: '⚖️',
    title: 'Leyes de era',
    text: 'Desde la era 2, cada era se rige por una ley que eliges entre tres. Todas tienen una ventaja y una desventaja, y rigen hasta que vuelvas a refundar. Elige la que encaje con tu forma de jugar: más toques, más offline, más minijuegos…',
    place: 'inline',
    available: (s) => s.era >= 2,
  },
  {
    id: 'casino',
    emoji: '🎰',
    title: 'Casino',
    text: 'El casino juega con 🎰 fichas, aparte de las monedas: se compran con monedas (con un tope al día) o llegan gratis con el bono diario, y nunca vuelven a ser monedas. Lo que ganes se canjea en la tienda del casino. A la larga la casa siempre gana: juega con cabeza.',
    place: 'inline',
    available: casinoOpen,
  },
  {
    id: 'cup',
    emoji: '🏆',
    title: 'Copa de Alcaldes',
    text: 'Torneo semanal: te inscribes gratis de lunes a viernes, el sábado juegas la fase de grupos (3 pruebas con 3 intentos, sin tickets) y el domingo la final. Entre semana, en 🏋️ Preparación, mejora el centro de entrenamiento y equipa cartas de ventaja.',
    place: 'inline',
    feature: 'cup',
  },
  {
    id: 'world',
    emoji: '🌍',
    title: 'Mapa del mundo',
    text: 'Aquí están las ciudades de todos los alcaldes. Toca una para visitarla y dejarle un 🎁 regalo: tú ganas 1 💎 y su alcalde un ticket. En ⚔️ Conquista os disputáis la región cada semana.',
    place: 'inline',
    feature: 'ranking',
  },
  {
    id: 'conquest',
    emoji: '⚔️',
    title: 'Conquista',
    text: 'Las ciudades vecinas se disputan la región cada semana. Es como la Guerra de torres: tus territorios generan soldados. Toca uno tuyo y luego uno vecino para atacarlo con sus soldados. Antes de atacar puedes lanzar un asalto, una batalla corta que les da más fuerza. Con la reserva refuerzas lo que ya es tuyo. ¡El domingo se reparte el botín!',
    place: 'inline',
    feature: 'ranking',
  },
  {
    id: 'stocks',
    emoji: '📈',
    title: 'Bolsa',
    text: 'Compra acciones con monedas y véndelas cuando suban: los precios cambian solos con el tiempo. Lo que ganes aquí no cuenta para estrellas ni rankings, y hay un límite de inversión.',
    place: 'inline',
    feature: 'stocks',
  },
];

export const TIP_BY_ID = new Map(TIPS.map((t) => [t.id, t]));

export function tipSeen(s: GameState, id: string): boolean {
  return !!s.tips[id];
}

/** Se puede leer en la guía (lo demás sale con candado, para no destripar lo que llega más tarde). */
export function tipAvailable(s: GameState, t: TipDef): boolean {
  if (t.feature && !isUnlocked(s, t.feature)) return false;
  return t.available ? t.available(s) : true;
}

/** Marca un consejo como visto. */
export function seeTip(s: GameState, id: string): GameState {
  return !TIP_BY_ID.has(id) || s.tips[id] ? s : { ...s, tips: { ...s.tips, [id]: 1 } };
}

/** Lo que la partida no sabe por sí sola y deciden las burbujas. */
export interface TipContext {
  /** Hay un incidente en la escena. */
  incident: boolean;
  /** Juega como invitado (sin Google) con la nube activa. */
  guest: boolean;
}

/**
 * Burbuja que toca enseñar ahora (o null), por orden de urgencia. Durante el tutorial no sale ninguna.
 * El globo dorado no está aquí: lo pide el propio globo al aparecer.
 */
export function bubbleTip(s: GameState, ctx: TipContext): string | null {
  if (!tutorialDone(s)) return null;
  const want = (id: string, cond: boolean) => cond && !s.tips[id];
  if (want('incident', ctx.incident)) return 'incident';
  if (want('milestone', Object.values(s.buildings).some((n) => n >= 10 && n < 25))) return 'milestone';
  if (want('star', s.era === 1 && pendingStars(s) > 0)) return 'star';
  // La cuenta, cuando ya hay algo que perder
  if (want('google', ctx.guest && (s.era >= 2 || s.stars > 0 || pendingStars(s) > 0 || s.missionsDone >= 6 || s.cup.played > 0))) return 'google';
  return null;
}

/** Consejos vistos, al cargar una partida. Las partidas de antes de los consejos ya conocen el juego. */
export function tipsState(v: unknown, tutorial: TutorialState): Record<string, number> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const [k, x] of Object.entries(v)) if (x && TIP_BY_ID.has(k)) out[k] = 1;
    return out;
  }
  // Sin campo: si ya había terminado el tutorial, solo le queda por ver el aviso de la cuenta
  if (tutorial.step < TUTORIAL_DONE) return {};
  return Object.fromEntries(TIPS.filter((t) => t.id !== 'google').map((t) => [t.id, 1]));
}
