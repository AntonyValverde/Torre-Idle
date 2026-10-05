// "Artillería": vista de lado. Tu cañón está sobre la muralla, a la izquierda, y por la derecha avanzan
// máquinas de asedio. Se apunta como un tirachinas (arrastrar hacia atrás y soltar) y el obús vuela en
// parábola con el viento, que cambia en cada disparo. Cada máquina que llega a la muralla le quita una
// vida; con tres se pierde. Cada vez salen más y más variadas.

// Campo vertical (para el móvil): mucho cielo para los tiros bombeados
export const FIELD_W = 100;
export const FIELD_H = 140;
export const GROUND = 126;
/** Borde derecho de la muralla: ahí golpean las máquinas. */
export const WALL_X = 17;
export const WALL_TOP = 102;
export const CANNON = { x: 13, y: 98 };
export const GRAVITY = 60;
export const MIN_SPEED = 28;
export const MAX_SPEED = 92;
/** Arrastre (en unidades del campo) que da la potencia máxima. */
export const PULL_MAX = 35;
export const RELOAD_MS = 650;
export const BLAST_R = 7;
export const BLAST_MS = 450;
export const LIVES = 3;
/** Ángulo de tiro permitido (radianes; positivo hacia arriba). */
export const MIN_ANGLE = (-10 * Math.PI) / 180;
export const MAX_ANGLE = (85 * Math.PI) / 180;

export type EnemyKind = 'ram' | 'rider' | 'tower';

export const KINDS: Record<EnemyKind, { w: number; h: number; hp: number; speed: number; pts: number }> = {
  ram: { w: 11, h: 7, hp: 1, speed: 5, pts: 1 },
  rider: { w: 7, h: 9, hp: 1, speed: 10, pts: 2 },
  tower: { w: 10, h: 18, hp: 3, speed: 3, pts: 4 },
};

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Centro horizontal; se apoya en el suelo. */
  x: number;
  hp: number;
  /** ms de parpadeo tras recibir un golpe. */
  hurt: number;
}

export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Viento de este disparo (aceleración horizontal). */
  wind: number;
}

export interface Blast {
  x: number;
  y: number;
  age: number;
}

export interface ArtilleryGame {
  t: number;
  enemies: Enemy[];
  shells: Shell[];
  blasts: Blast[];
  lives: number;
  /** Viento para el próximo disparo. */
  wind: number;
  reload: number;
  nextSpawn: number;
  nextId: number;
  score: number;
  kills: number;
  shots: number;
  /** Disparos que derribaron algo. */
  hitShots: number;
  over: boolean;
}

export interface ArtilleryEvents {
  kills: number;
  points: number;
  /** Derribos del mismo disparo (para el "¡Doble!"). */
  multi: number;
  breached: number;
  blasts: Blast[];
  lost: boolean;
}

/** Velocidad de un disparo según cuánto se arrastró. */
export function shotSpeed(power: number): number {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.max(0, Math.min(1, power));
}

/** Ángulo y potencia a partir del arrastre (tirachinas: se dispara hacia el lado contrario). */
export function aimFrom(dx: number, dy: number): { angle: number; power: number } {
  const angle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, Math.atan2(dy, -dx)));
  return { angle, power: Math.min(1, Math.hypot(dx, dy) / PULL_MAX) };
}

export function spawnMs(t: number): number {
  return Math.max(650, 3600 - t / 25);
}

/** Las máquinas avanzan más deprisa cuanto más dura la partida (el doble a los 2 min). */
export function speedMult(t: number): number {
  return 1 + t / 120_000;
}

/** Viento aleatorio: más fuerte cuanto más dura la partida. */
export function rollWind(t: number, rand: () => number): number {
  const max = Math.min(16, 5 + t / 12_000);
  return Math.round((rand() * 2 - 1) * max);
}

export function newArtillery(rand: () => number): ArtilleryGame {
  return {
    t: 0,
    enemies: [],
    shells: [],
    blasts: [],
    lives: LIVES,
    wind: rollWind(0, rand),
    reload: 0,
    nextSpawn: 800,
    nextId: 1,
    score: 0,
    kills: 0,
    shots: 0,
    hitShots: 0,
    over: false,
  };
}

export function pickKind(t: number, rand: () => number): EnemyKind {
  const r = rand();
  if (t >= 60_000 && r < 0.22) return 'tower';
  if (t >= 25_000 && r < 0.5) return 'rider';
  return 'ram';
}

export function canShoot(g: ArtilleryGame): boolean {
  return !g.over && g.reload <= 0;
}

export function shoot(g: ArtilleryGame, angle: number, power: number, rand: () => number): boolean {
  if (!canShoot(g)) return false;
  const v = shotSpeed(power);
  g.shells.push({ x: CANNON.x, y: CANNON.y, vx: v * Math.cos(angle), vy: -v * Math.sin(angle), wind: g.wind });
  g.reload = RELOAD_MS;
  g.shots++;
  g.wind = rollWind(g.t, rand);
  return true;
}

/** Caja de una máquina (para los impactos directos). */
export function box(e: Enemy) {
  const k = KINDS[e.kind];
  return { x0: e.x - k.w / 2, x1: e.x + k.w / 2, y0: GROUND - k.h, y1: GROUND };
}

/** Puntos de la trayectoria sin viento durante los primeros `ms` (la guía de puntería). */
export function preview(angle: number, power: number, ms = 450, every = 50): { x: number; y: number }[] {
  const v = shotSpeed(power);
  const pts: { x: number; y: number }[] = [];
  for (let t = every; t <= ms; t += every) {
    const s = t / 1000;
    pts.push({ x: CANNON.x + v * Math.cos(angle) * s, y: CANNON.y - v * Math.sin(angle) * s + 0.5 * GRAVITY * s * s });
  }
  return pts;
}

export function step(g: ArtilleryGame, dt: number, rand: () => number): ArtilleryEvents {
  const ev: ArtilleryEvents = { kills: 0, points: 0, multi: 0, breached: 0, blasts: [], lost: false };
  if (g.over) return ev;
  g.t += dt;
  g.reload = Math.max(0, g.reload - dt);
  const s = dt / 1000;

  g.nextSpawn -= dt;
  if (g.nextSpawn <= 0) {
    const kind = pickKind(g.t, rand);
    g.enemies.push({ id: g.nextId++, kind, x: FIELD_W + KINDS[kind].w, hp: KINDS[kind].hp, hurt: 0 });
    g.nextSpawn += spawnMs(g.t) * (0.75 + rand() * 0.5);
  }

  for (const e of g.enemies) {
    e.x -= KINDS[e.kind].speed * speedMult(g.t) * s;
    e.hurt = Math.max(0, e.hurt - dt);
  }
  g.enemies = g.enemies.filter((e) => {
    if (e.x - KINDS[e.kind].w / 2 > WALL_X) return true;
    g.lives--;
    ev.breached++;
    return false;
  });

  // Obuses: vuelan y explotan al tocar una máquina o el suelo
  g.shells = g.shells.filter((sh) => {
    sh.vx += sh.wind * s;
    sh.vy += GRAVITY * s;
    sh.x += sh.vx * s;
    sh.y += sh.vy * s;
    if (sh.x > FIELD_W + 20 || sh.x < -20) return false;
    const direct = g.enemies.find((e) => {
      const b = box(e);
      return sh.x >= b.x0 && sh.x <= b.x1 && sh.y >= b.y0 && sh.y <= b.y1;
    });
    if (!direct && sh.y < GROUND) return true;
    const bx = sh.x;
    const by = Math.min(sh.y, GROUND);
    const blast = { x: bx, y: by, age: 0 };
    g.blasts.push(blast);
    ev.blasts.push(blast);
    let downs = 0;
    let pts = 0;
    g.enemies = g.enemies.filter((e) => {
      const b = box(e);
      // Distancia del centro de la explosión a la caja
      const nx = Math.max(b.x0, Math.min(bx, b.x1));
      const ny = Math.max(b.y0, Math.min(by, b.y1));
      const inside = e === direct || Math.hypot(nx - bx, ny - by) <= BLAST_R;
      if (!inside) return true;
      e.hp -= e === direct ? 2 : 1;
      e.hurt = 250;
      if (e.hp > 0) return true;
      downs++;
      pts += KINDS[e.kind].pts;
      return false;
    });
    if (downs > 0) {
      // Varias de un disparo: cada una extra suma otro tanto
      const bonus = downs > 1 ? downs - 1 : 0;
      g.score += pts + bonus;
      g.kills += downs;
      g.hitShots++;
      ev.kills += downs;
      ev.points += pts + bonus;
      ev.multi = Math.max(ev.multi, downs);
    }
    return false;
  });

  for (const b of g.blasts) b.age += dt;
  g.blasts = g.blasts.filter((b) => b.age < BLAST_MS);

  if (g.lives <= 0) {
    g.lives = 0;
    g.over = true;
    ev.lost = true;
  }
  return ev;
}
