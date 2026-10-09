import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import * as sq from './logic';

const STILL = { x: 0, y: 0 };

/** Vacía la oleada para probar una regla sin enemigos de por medio. */
function empty(g: sq.SquadronGame) {
  g.queue = [];
  g.enemies = [];
}

function enemy(g: sq.SquadronGame, kind: sq.EnemyKind, x: number, y: number, hp = 1): sq.Enemy {
  const e: sq.Enemy = { id: g.nextId++, kind, move: 'down', x, y, vx: 0, vy: 0, r: 12, hp, max: hp, age: 1000, ty: y, phase: 0, fire: 1e9, flash: 0, pattern: 0, warn: 0, burst: 0 };
  g.enemies.push(e);
  return e;
}

/** Jugador automático: se pone debajo del enemigo más bajo y se aparta de las balas cercanas. */
function bot(g: sq.SquadronGame, dt: number): { x: number; y: number } {
  const sp = (sq.KEY_SPEED * dt) / 1000;
  let dx = 0;
  let dy = 0;
  const danger = g.eshots.filter((b) => Math.abs(b.x - g.x) < 22 && b.y < g.y + 10 && b.y > g.y - 90);
  if (danger.length) dx = danger[0].x > g.x ? -1 : 1;
  else {
    const t = g.enemies.reduce<sq.Enemy | null>((m, e) => (!m || e.y > m.y ? e : m), null);
    if (t) dx = Math.sign(t.x - g.x) * Math.min(1, Math.abs(t.x - g.x) / 20);
    dy = g.y < sq.FIELD_H - 100 ? 1 : 0;
  }
  return { x: dx * sp, y: dy * sp * 0.5 };
}

function play(seed: number, smart: boolean): sq.SquadronGame {
  const rand = mulberry32(seed);
  const g = sq.newSquadron(rand);
  for (let i = 0; i < 60 * 60 * 15 && g.phase !== 'over'; i++) {
    if (g.phase === 'hangar') {
      if (smart) for (const id of ['repair', 'dmg', 'rate', 'missile', 'wing', 'armor', 'magnet'] as sq.ShopId[]) while (sq.buy(g, id));
      sq.leaveHangar(g, rand);
    }
    sq.step(g, 1000 / 60, smart ? bot(g, 1000 / 60) : STILL, rand);
  }
  return g;
}

describe('Escuadrilla', () => {
  it('dispara solo y una bala derriba al enemigo, que suelta monedas', () => {
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    // Uno lejos para que la oleada no se dé por despejada
    enemy(g, 'fighter', 20, 20, 99);
    enemy(g, 'scout', g.x, g.y - 60);
    let kills = 0;
    for (let i = 0; i < 30 && !kills; i++) kills += sq.step(g, 16, STILL, mulberry32(i)).kills.length;
    expect(kills).toBe(1);
    expect(g.score).toBe(1);
    expect(g.pickups.some((p) => p.kind === 'coin')).toBe(true);
  });

  it('una bala enemiga quita una vida, da invulnerabilidad y limpia las balas', () => {
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    enemy(g, 'fighter', 20, 20, 99);
    g.eshots = [{ x: g.x, y: g.y, vx: 0, vy: 0, r: 4 }, { x: 10, y: 10, vx: 0, vy: 0, r: 4 }];
    const ev = sq.step(g, 16, STILL, mulberry32(1));
    expect(ev.hurt).toBe(true);
    expect(g.hp).toBe(sq.START_HP - 1);
    expect(g.inv).toBeGreaterThan(0);
    expect(g.eshots).toHaveLength(0);
    g.eshots = [{ x: g.x, y: g.y, vx: 0, vy: 0, r: 4 }];
    expect(sq.step(g, 16, STILL, mulberry32(1)).hurt).toBe(false);
  });

  it('sin vidas se acaba la partida', () => {
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    enemy(g, 'fighter', 20, 20, 99);
    g.hp = 1;
    g.eshots = [{ x: g.x, y: g.y, vx: 0, vy: 0, r: 4 }];
    const ev = sq.step(g, 16, STILL, mulberry32(1));
    expect(ev.lost).toBe(true);
    expect(g.phase).toBe('over');
    expect(sq.step(g, 16, STILL, mulberry32(1)).kills).toHaveLength(0);
  });

  it('el arrastre mueve el avión sin salirse del campo', () => {
    const g = sq.newSquadron(mulberry32(1));
    sq.step(g, 16, { x: -1000, y: 1000 }, mulberry32(1));
    expect(g.x).toBe(14);
    expect(g.y).toBe(sq.PLAYER_MAX_Y);
  });

  it('las estrellas suben el arma hasta el máximo y luego dan puntos', () => {
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    enemy(g, 'fighter', 20, 20, 99);
    // Empieza en 1: cuatro estrellas lo suben al máximo y la quinta da puntos
    for (let k = 0; k < sq.POWER_MAX; k++) {
      g.pickups.push({ x: g.x, y: g.y, vx: 0, vy: 0, kind: 'star', value: 1, pulled: false });
      sq.step(g, 16, STILL, mulberry32(k));
    }
    expect(g.power).toBe(sq.POWER_MAX);
    expect(g.score).toBe(5);
  });

  it('al despejar la oleada suma el bono, atrae las monedas y cada dos abre el hangar', () => {
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    g.pickups.push({ x: 20, y: 100, vx: 0, vy: 0, kind: 'coin', value: 3, pulled: false });
    const ev = sq.step(g, 16, STILL, mulberry32(1));
    expect(ev.waveClear).toBe(true);
    expect(g.score).toBe(1);
    let started = 0;
    for (let i = 0; i < 200 && !started; i++) started = sq.step(g, 16, STILL, mulberry32(i)).waveStart;
    expect(started).toBe(2);
    expect(g.coins).toBe(3);
    empty(g);
    sq.step(g, 16, STILL, mulberry32(1));
    let hangar = false;
    for (let i = 0; i < 200 && !hangar; i++) hangar = sq.step(g, 16, STILL, mulberry32(i)).hangar;
    expect(hangar).toBe(true);
    expect(g.phase).toBe('hangar');
  });

  it('el hangar cobra, respeta los máximos y la reparación solo si faltan vidas', () => {
    const g = sq.newSquadron(mulberry32(1));
    g.phase = 'hangar';
    g.coins = 1000;
    expect(sq.shopCost(g, 'repair')).toBeNull();
    expect(sq.buy(g, 'repair')).toBe(false);
    expect(sq.buy(g, 'dmg')).toBe(true);
    expect(g.coins).toBe(1000 - 30);
    expect(sq.dmgMult(g)).toBeCloseTo(1.25);
    expect(sq.buy(g, 'armor')).toBe(true);
    expect(sq.maxHp(g)).toBe(sq.START_HP + 1);
    expect(g.hp).toBe(sq.START_HP + 1);
    g.hp = 1;
    expect(sq.buy(g, 'repair')).toBe(true);
    expect(g.hp).toBe(2);
    while (sq.buy(g, 'magnet'));
    expect(g.lv.magnet).toBe(2);
    expect(sq.shopCost(g, 'magnet')).toBeNull();
    expect(sq.leaveHangar(g, mulberry32(1))).toBe(2);
    expect(g.phase).toBe('play');
  });

  it('cada cuatro oleadas sale un dirigible que da monedas, estrella y corazón', () => {
    expect(sq.waveSpawns(4, mulberry32(1)).map((s) => s.kind)).toEqual(['boss']);
    const g = sq.newSquadron(mulberry32(1));
    empty(g);
    g.wave = 4;
    const b = enemy(g, 'boss', g.x, g.y - 80, 1);
    b.kind = 'boss';
    const ev = sq.step(g, 16, STILL, mulberry32(1));
    let down = ev.bossDown;
    for (let i = 0; i < 30 && !down; i++) down = sq.step(g, 16, STILL, mulberry32(i)).bossDown;
    expect(down).toBe(true);
    expect(g.bosses).toBe(1);
    expect(g.pickups.some((p) => p.kind === 'star')).toBe(true);
    expect(g.pickups.some((p) => p.kind === 'heart')).toBe(true);
  });

  it('las partidas acaban y la puntuación queda en la escala del arcade', () => {
    const idle = [1, 2, 3, 4, 5].map((seed) => play(seed, false));
    const smart = [1, 2, 3, 4, 5].map((seed) => play(seed, true));
    for (const g of [...idle, ...smart]) expect(g.phase).toBe('over');
    const avg = (l: sq.SquadronGame[]) => l.reduce((n, g) => n + g.score, 0) / l.length;
    // Sin moverse se cae pronto; jugando bien se llega bastante más lejos, sin pasar del tope
    expect(avg(idle)).toBeGreaterThan(5);
    expect(avg(idle)).toBeLessThan(150);
    expect(avg(smart)).toBeGreaterThan(avg(idle));
    for (const g of smart) expect(g.score).toBeLessThan(5000);
    console.log(
      'Escuadrilla · quieto:',
      idle.map((g) => `${g.score}/o${g.wave}`).join(' '),
      '· bot:',
      smart.map((g) => `${g.score}/o${g.wave}`).join(' '),
    );
  });
});
