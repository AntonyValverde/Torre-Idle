import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import * as ne from './logic';

const DT = 1000 / 60;
const IDLE: ne.NeonInput = { mx: 0, my: 0, aim: null, bomb: false };

/** Partida vacía y sin apariciones, para probar una regla aislada. */
function quiet(): ne.NeonGame {
  const g = ne.newNeon();
  g.nextSpawn = 1e12;
  g.bossAt = 1e12;
  return g;
}

function put(g: ne.NeonGame, kind: ne.EnemyKind, x: number, y: number): ne.Enemy {
  const e = ne.makeEnemy(g, kind, x, y, mulberry32(9), 0);
  g.enemies.push(e);
  return e;
}

interface Skill {
  /** Radio al que huye de los enemigos y hasta dónde mira (lo de más lejos no lo ve). */
  fear: number;
  sight: number;
  /** Error de puntería (rad) y cada cuánto vuelve a decidir (ms): entre medias sigue igual. */
  aimErr: number;
  react: number;
  /** Desvío al moverse (0..1): un pulgar humano no va recto. */
  wobble: number;
  /** Va a por los fragmentos. */
  greedy: boolean;
  /** Distancia a la que tira una bomba (0: nunca). */
  bombAt: number;
}

const ROOKIE: Skill = { fear: 45, sight: 110, aimErr: 0.45, react: 380, wobble: 0.8, greedy: false, bombAt: 0 };
const DECENT: Skill = { fear: 65, sight: 160, aimErr: 0.25, react: 260, wobble: 0.5, greedy: true, bombAt: 14 };
const GREAT: Skill = { fear: 85, sight: 220, aimErr: 0.12, react: 170, wobble: 0.3, greedy: true, bombAt: 24 };

/**
 * Jugador automático con reflejos humanos: cada `react` ms mira lo que tiene cerca, decide hacia dónde
 * huir (o ir a por fragmentos) y a quién apuntar, y mantiene esa decisión hasta la siguiente.
 */
function makeBot(skill: Skill, rand: () => number) {
  let out: ne.NeonInput = { mx: 0, my: 0, aim: null, bomb: false };
  let next = 0;
  return (g: ne.NeonGame): ne.NeonInput => {
    if (g.t < next) return { ...out, bomb: false };
    next = g.t + skill.react * (0.7 + rand() * 0.6);
    let fx = ((ne.ARENA_W / 2 - g.x) / ne.ARENA_W) * 0.8;
    let fy = ((ne.ARENA_H / 2 - g.y) / ne.ARENA_H) * 0.8;
    let close = Infinity;
    let t: ne.Enemy | null = null;
    let td = Infinity;
    for (const e of g.enemies) {
      const dx = g.x - e.x;
      const dy = g.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > skill.sight + (e.kind === 'boss' ? 100 : 0)) continue;
      if (e.spawn <= 0) {
        close = Math.min(close, d - e.r);
        if (d < td) {
          td = d;
          t = e;
        }
      }
      const R = skill.fear + e.r + (e.kind === 'boss' ? 60 : 0);
      if (d < R) {
        const w = ((R - d) / R) * 3;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
      }
      for (const s of e.segs) {
        const sx = g.x - s.x;
        const sy = g.y - s.y;
        const sd = Math.hypot(sx, sy) || 1;
        if (sd < skill.fear * 0.6) {
          fx += (sx / sd) * 1.5;
          fy += (sy / sd) * 1.5;
        }
      }
    }
    for (const b of g.eshots) {
      const dx = g.x - b.x;
      const dy = g.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 50) {
        fx += (dx / d) * 2;
        fy += (dy / d) * 2;
      }
    }
    if (skill.greedy) {
      let best: ne.Geom | null = null;
      let bd = 120;
      for (const p of g.geoms) {
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        fx += ((best.x - g.x) / bd) * 0.8;
        fy += ((best.y - g.y) / bd) * 0.8;
      }
      for (const o of g.orbs) {
        const d = Math.hypot(o.x - g.x, o.y - g.y) || 1;
        if (d < skill.sight) {
          fx += ((o.x - g.x) / d) * 0.6;
          fy += ((o.y - g.y) / d) * 0.6;
        }
      }
    }
    let aim: { x: number; y: number } | null = null;
    if (t) {
      const a = Math.atan2(t.y - g.y, t.x - g.x) + (rand() - 0.5) * 2 * skill.aimErr;
      aim = { x: Math.cos(a), y: Math.sin(a) };
    }
    const m = Math.hypot(fx, fy);
    const wob = (rand() - 0.5) * 2 * skill.wobble;
    const ma = Math.atan2(fy, fx) + wob;
    out = { mx: m > 0.05 ? Math.cos(ma) : 0, my: m > 0.05 ? Math.sin(ma) : 0, aim, bomb: skill.bombAt > 0 && close < skill.bombAt };
    return out;
  };
}

function play(seed: number, skill: Skill, maxMin = 15) {
  const rand = mulberry32(seed);
  const brand = mulberry32(seed * 7 + 1);
  const g = ne.newNeon();
  const bot = makeBot(skill, brand);
  let picks = 0;
  for (let i = 0; i < maxMin * 3600 && g.phase !== 'over'; i++) {
    if (g.offer) {
      ne.chooseAny(g, brand);
      picks++;
      continue;
    }
    ne.step(g, DT, bot(g), rand);
  }
  return { g, picks };
}

describe('Arena de neón', () => {
  it('apuntar dispara y una bala derriba a un deambulante, que suelta fragmentos', () => {
    const g = quiet();
    put(g, 'wanderer', g.x + 60, g.y);
    let kills = 0;
    for (let i = 0; i < 30 && !kills; i++) kills += ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).kills.length;
    expect(kills).toBe(1);
    expect(g.pts).toBeCloseTo(ne.STATS.wanderer.pts * ne.ptsK(g.t), 5);
    expect(g.geoms.length).toBe(1);
  });

  it('sin apuntar no se dispara', () => {
    const g = quiet();
    for (let i = 0; i < 30; i++) ne.step(g, DT, IDLE, mulberry32(i));
    expect(g.shots.length).toBe(0);
  });

  it('durante el aviso de aparición ni hace daño ni se le puede dar', () => {
    const g = quiet();
    const e = ne.makeEnemy(g, 'chaser', g.x + 20, g.y, mulberry32(1));
    g.enemies.push(e);
    const ev = ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(2));
    expect(ev.kills.length).toBe(0);
    e.x = g.x;
    e.y = g.y;
    ne.step(g, DT, IDLE, mulberry32(2));
    expect(g.lives).toBe(ne.START_LIVES);
    for (let i = 0; i < 40; i++) ne.step(g, DT, IDLE, mulberry32(3));
    expect(g.lives).toBe(ne.START_LIVES - 1);
  });

  it('los fragmentos suben el multiplicador y morir lo devuelve a ×1', () => {
    const g = quiet();
    for (let i = 0; i < ne.multNeed(1) + ne.multNeed(2); i++) g.geoms.push({ x: g.x + 1, y: g.y, vx: 0, vy: 0, life: 5000, got: false });
    const ev = ne.step(g, DT, IDLE, mulberry32(1));
    expect(ev.geoms).toBe(ne.multNeed(1) + ne.multNeed(2));
    expect(g.mult).toBe(3);
    // Un enemigo vale base × multiplicador
    const e = put(g, 'dodger', g.x + 40, g.y);
    e.hp = 1;
    e.t = 1e9;
    let done = false;
    for (let i = 0; i < 20 && !done; i++) done = ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).kills.length > 0;
    expect(g.pts).toBeCloseTo(ne.STATS.dodger.pts * 3 * ne.ptsK(g.t), 5);
    put(g, 'chaser', g.x, g.y);
    const ev2 = ne.step(g, DT, IDLE, mulberry32(5));
    expect(ev2.died).not.toBeNull();
    expect(g.mult).toBe(1);
    expect(g.lives).toBe(ne.START_LIVES - 1);
  });

  it('al morir se limpian los enemigos cercanos y luego hay invulnerabilidad', () => {
    const g = quiet();
    put(g, 'chaser', g.x, g.y);
    put(g, 'wanderer', g.x + 60, g.y);
    const far = put(g, 'wanderer', 10, 10);
    const ev = ne.step(g, DT, IDLE, mulberry32(1));
    expect(ev.died).not.toBeNull();
    expect(g.enemies).toEqual([far]);
    expect(g.inv).toBeGreaterThan(ne.INV_MS);
    put(g, 'chaser', g.x, g.y).t = 0;
    for (let i = 0; i < 60; i++) ne.step(g, DT, IDLE, mulberry32(i));
    expect(g.lives).toBe(ne.START_LIVES - 1);
  });

  it('el divisor se parte en tres minis', () => {
    const g = quiet();
    const e = put(g, 'splitter', g.x + 80, g.y);
    e.hp = 1;
    let kinds: string[] = [];
    for (let i = 0; i < 30 && !kinds.length; i++) kinds = ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).kills.map((k) => k.kind);
    expect(kinds).toEqual(['splitter']);
    expect(g.enemies.filter((x) => x.kind === 'mini').length).toBe(3);
  });

  it('la cola de la serpiente para las balas; la cabeza no', () => {
    const g = quiet();
    const e = put(g, 'snake', g.x + 100, g.y);
    // Cola estirada entre la nave y la cabeza, pero la cabeza mira hacia fuera
    e.segs.forEach((s, i) => {
      s.x = g.x + 90 - i * 8;
      s.y = g.y;
    });
    e.x = g.x + 100;
    let absorbed = 0;
    for (let i = 0; i < 10; i++) absorbed += ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).absorbed.length;
    expect(absorbed).toBeGreaterThan(0);
    expect(e.hp).toBe(e.max);
  });

  it('el esquivador se aparta de una bala que va hacia él', () => {
    const g = quiet();
    const e = put(g, 'dodger', g.x + 120, g.y);
    e.t = 0;
    let dodges = 0;
    for (let i = 0; i < 20; i++) dodges += ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).dodges;
    expect(dodges).toBeGreaterThan(0);
  });

  it('la bomba barre la arena: puntos base sin fragmentos y quita una bomba', () => {
    const g = quiet();
    g.mult = 5;
    for (let i = 0; i < 6; i++) put(g, 'chaser', 20 + i * 50, 20);
    g.eshots.push({ x: 50, y: 300, vx: 0, vy: 0, r: 4, dead: false });
    const ev = ne.step(g, DT, { ...IDLE, bomb: true }, mulberry32(1));
    expect(ev.bomb).not.toBeNull();
    expect(g.bombs).toBe(ne.START_BOMBS - 1);
    expect(g.eshots.length).toBe(0);
    let kills = ev.kills.length;
    for (let i = 0; i < 40; i++) kills += ne.step(g, DT, IDLE, mulberry32(i)).kills.length;
    expect(kills).toBe(6);
    expect(g.pts).toBeGreaterThan(5.9 * ne.STATS.chaser.pts * ne.ptsK(g.t));
    expect(g.geoms.length).toBe(0);
    // Sin bombas no pasa nada
    g.bombs = 0;
    expect(ne.step(g, DT, { ...IDLE, bomb: true }, mulberry32(1)).bomb).toBeNull();
  });

  it('el potenciador dura lo suyo y la Ráfaga dispara tres balas', () => {
    const g = quiet();
    g.orbs.push({ x: g.x, y: g.y, vx: 0, vy: 0, kind: 'spread', life: 5000, got: false });
    const ev = ne.step(g, DT, { ...IDLE, aim: { x: 0, y: -1 } }, mulberry32(1));
    expect(ev.power).toBe('spread');
    ne.step(g, 200, { ...IDLE, aim: { x: 0, y: -1 } }, mulberry32(1));
    expect(g.shots.length).toBeGreaterThanOrEqual(4);
    let out: ne.PowerKind | null = null;
    for (let i = 0; i < 60 * 16 && !out; i++) out = ne.step(g, DT, IDLE, mulberry32(i)).powerOut;
    expect(out).toBe('spread');
    expect(g.t).toBeGreaterThan(ne.POWER_MS - 100);
  });

  it('al llegar a los puntos ofrece una mejora y la partida espera a que elijas', () => {
    const g = quiet();
    g.pts = ne.pickAt(1) - 0.5;
    put(g, 'wanderer', g.x + 60, g.y);
    let pick = false;
    for (let i = 0; i < 40 && !pick; i++) pick = ne.step(g, DT, { ...IDLE, aim: { x: 1, y: 0 } }, mulberry32(i)).pick;
    expect(pick).toBe(true);
    expect(g.offer?.length).toBe(3);
    const t = g.t;
    ne.step(g, DT, IDLE, mulberry32(1));
    expect(g.t).toBe(t);
    const bombs = g.bombs;
    g.offer = [ne.UPGRADES.find((u) => u.id === 'bomb')!];
    expect(ne.choose(g, 'bomb', mulberry32(1))).toBe(true);
    expect(g.bombs).toBe(bombs + 1);
    expect(g.offer).toBeNull();
  });

  it('el núcleo llega a los 90 s y al caer da una bomba', () => {
    const g = quiet();
    g.bossAt = ne.BOSS_EVERY;
    g.t = ne.BOSS_EVERY - DT;
    const ev = ne.step(g, DT, IDLE, mulberry32(1));
    expect(ev.bossIn).not.toBeNull();
    const b = ne.boss(g)!;
    expect(b.spawn).toBeGreaterThan(0);
    b.spawn = 0;
    b.hp = 1;
    b.x = g.x;
    b.y = g.y - 80;
    g.inv = 1e9;
    let down = false;
    for (let i = 0; i < 30 && !down; i++) down = !!ne.step(g, DT, { ...IDLE, aim: { x: 0, y: -1 } }, mulberry32(i)).bossDown;
    expect(down).toBe(true);
    expect(g.bombs).toBe(ne.START_BOMBS + 1);
    expect(g.bosses).toBe(1);
  });

  it('una partida sin jugar acaba sola y pronto', () => {
    const rand = mulberry32(3);
    const g = ne.newNeon();
    for (let i = 0; i < 60 * 600 && g.phase !== 'over'; i++) ne.step(g, DT, IDLE, rand);
    expect(g.phase).toBe('over');
    expect(g.t).toBeLessThan(120000);
    expect(g.score).toBe(0);
  });

  it('escala de puntos con jugadores automáticos', () => {
    const report: string[] = [];
    const stats = (name: string, skill: Skill, seeds: number[]) => {
      const runs = seeds.map((s) => play(s, skill));
      // Hasta el mejor acaba cayendo (la arena se desborda a partir de los 5 min)
      for (const r of runs) expect(r.g.phase).toBe('over');
      const scores = runs.map((r) => r.g.score).sort((a, b) => a - b);
      const mins = runs.map((r) => r.g.t / 60000);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      report.push(
        `${name}: puntos med ${scores[Math.floor(scores.length / 2)]} (min ${scores[0]}, max ${scores[scores.length - 1]}) · ` +
          `${avg(mins).toFixed(1)} min · ×${avg(runs.map((r) => r.g.bestMult)).toFixed(1)} máx · ${avg(runs.map((r) => r.g.kills)).toFixed(0)} derribos · ` +
          `${avg(runs.map((r) => r.picks)).toFixed(1)} mejoras · ${avg(runs.map((r) => r.g.bosses)).toFixed(1)} núcleos\n   ` +
          runs.map((r) => `${r.g.score}@${(r.g.t / 60000).toFixed(1)}`).join(' '),
      );
      return scores;
    };
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    const rookie = stats('novato', ROOKIE, seeds);
    const decent = stats('decente', DECENT, seeds);
    const great = stats('bueno', GREAT, seeds);
    console.log(report.join('\n'));
    const med = (xs: number[]) => xs[Math.floor(xs.length / 2)];
    expect(med(rookie)).toBeLessThan(med(decent));
    expect(med(decent)).toBeLessThan(med(great));
    expect(med(rookie)).toBeGreaterThanOrEqual(25);
    expect(med(rookie)).toBeLessThan(130);
    expect(med(great)).toBeGreaterThan(700);
    expect(Math.max(...great)).toBeLessThan(ne.SCORE_CAP);
  }, 60000);
});
