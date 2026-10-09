import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import * as nt from './logic';

const DT = 1000 / 60;
const STILL = { x: 0, y: 0 };

/** Sin bichos que nazcan solos: para probar una regla aislada. */
function quiet(g: nt.NightGame) {
  g.nextEvent = nt.TIMELINE.length;
  g.spawnAcc = -1e9;
}

function enemy(g: nt.NightGame, kind: nt.EnemyKind, x: number, y: number, hp?: number): nt.Enemy {
  const e = nt.makeEnemy(g, kind, x, y, mulberry32(9));
  if (hp !== undefined) e.hp = e.max = hp;
  e.speed = 0;
  return e;
}

/**
 * Jugador automático: huye de los bichos cercanos (pesan más cuanto más cerca), va a por la comida y
 * las gemas cuando no hay peligro, y vuelve hacia el centro para no alejarse demasiado.
 */
function bot(g: nt.NightGame, look: number): { x: number; y: number } {
  let fx = 0;
  let fy = 0;
  for (const e of g.enemies) {
    const dx = g.x - e.x;
    const dy = g.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > look * look) continue;
    const w = (e.kind === 'coco' ? 6 : e.kind === 'gargoyle' ? 3 : 1) / Math.max(30, d2);
    fx += dx * w;
    fy += dy * w;
  }
  const danger = Math.hypot(fx, fy);
  // Hacia la comida si hace falta, si no hacia la gema más cercana
  const it = g.items.find((i) => i.kind === 'magnet' || g.hp < nt.maxHp(g) * 0.7);
  const tgt = it ?? g.gems.reduce<nt.Gem | null>((m, x) => (!m || Math.hypot(x.x - g.x, x.y - g.y) < Math.hypot(m.x - g.x, m.y - g.y) ? x : m), null);
  let gx = 0;
  let gy = 0;
  if (tgt) {
    const d = Math.max(1, Math.hypot(tgt.x - g.x, tgt.y - g.y));
    gx = (tgt.x - g.x) / d;
    gy = (tgt.y - g.y) / d;
  } else {
    const d = Math.max(1, Math.hypot(g.x, g.y));
    gx = -g.x / d / 3;
    gy = -g.y / d / 3;
  }
  if (danger < 0.003) return { x: gx, y: gy };
  // Rodea un poco en vez de huir en línea recta, sin olvidar las gemas
  const k = 1 / danger;
  return { x: (fx - fy * 0.35) * k + gx * 0.4, y: (fy + fx * 0.35) * k + gy * 0.4 };
}

/**
 * `skill` 0: quieto. 1: decente (ve a 110 y reacciona cada 100 ms). 2: bueno (ve a 140, cada paso).
 * Entre medias, un novato que se distrae: reacciona cada 450 ms y a veces no se mueve.
 */
function play(seed: number, skill: number, maxMs = nt.RUN_MS + 1000) {
  const rand = mulberry32(seed);
  const noise = mulberry32(seed * 31 + 7);
  const g = nt.newNight();
  let frames = 0;
  let peak = 0;
  let held = STILL;
  const every = skill >= 2 ? 1 : skill >= 1 ? 6 : 27;
  for (let i = 0; i < maxMs / DT && g.phase === 'play'; i++) {
    while (g.pending > 0) nt.applyUpgrade(g, nt.rollChoices(g, rand)[0].id);
    if (skill > 0 && i % every === 0) held = skill < 1 && noise() < 0.35 ? STILL : bot(g, skill >= 2 ? 140 : 110);
    nt.step(g, DT, held, rand);
    peak = Math.max(peak, g.enemies.length);
    frames++;
  }
  return { g, frames, peak };
}

describe('Ronda nocturna', () => {
  it('el farol dispara solo al bicho más cercano y lo mata; suelta una gema', () => {
    const g = nt.newNight();
    quiet(g);
    enemy(g, 'rat', g.x + 60, g.y, 5);
    let kills = 0;
    for (let i = 0; i < 90 && !kills; i++) kills += nt.step(g, DT, STILL, mulberry32(i)).kills.length;
    expect(kills).toBe(1);
    expect(g.kills).toBe(1);
    expect(g.gems).toHaveLength(1);
    expect(g.gems[0].v).toBe(1);
  });

  it('las gemas cercanas vuelan hacia ti y al llenar la barra se sube de nivel', () => {
    const g = nt.newNight();
    quiet(g);
    for (let i = 0; i < 5; i++) g.gems.push({ x: g.x + 10 + i * 2, y: g.y, v: 1, pulled: false, sp: 0, got: false });
    let up = false;
    for (let i = 0; i < 120; i++) up = nt.step(g, DT, STILL, mulberry32(1)).levelUp || up;
    expect(up).toBe(true);
    expect(g.lv).toBe(2);
    expect(g.pending).toBe(1);
    expect(g.gems).toHaveLength(0);
  });

  it('las gemas lejanas no se mueven hasta que coges el imán', () => {
    const g = nt.newNight();
    quiet(g);
    g.gems.push({ x: g.x + 300, y: g.y, v: 1, pulled: false, sp: 0, got: false });
    for (let i = 0; i < 30; i++) nt.step(g, DT, STILL, mulberry32(1));
    expect(g.gems[0].x).toBe(g.x + 300);
    g.items.push({ x: g.x, y: g.y, kind: 'magnet', age: 0, got: false });
    const ev = nt.step(g, DT, STILL, mulberry32(1));
    expect(ev.magnet).toBe(true);
    for (let i = 0; i < 120; i++) nt.step(g, DT, STILL, mulberry32(1));
    expect(g.gems).toHaveLength(0);
    expect(g.xp).toBe(1);
  });

  it('la comida cura sin pasar del máximo', () => {
    const g = nt.newNight();
    quiet(g);
    g.hp = 50;
    g.items.push({ x: g.x, y: g.y, kind: 'food', age: 0, got: false });
    expect(nt.step(g, DT, STILL, mulberry32(1)).food).toBe(true);
    expect(g.hp).toBe(80);
    g.items.push({ x: g.x, y: g.y, kind: 'food', age: 0, got: false });
    nt.step(g, DT, STILL, mulberry32(1));
    expect(g.hp).toBe(nt.maxHp(g));
  });

  it('un bicho pegado muerde con un respiro entre mordiscos y sin vida se acaba', () => {
    const g = nt.newNight();
    quiet(g);
    g.levels = {};
    const e = enemy(g, 'rat', g.x + 3, g.y, 999);
    const ev = nt.step(g, DT, STILL, mulberry32(1));
    expect(ev.hurt).toBe(nt.ENEMY.rat.dmg);
    expect(g.hp).toBe(nt.BASE_HP - nt.ENEMY.rat.dmg);
    expect(nt.step(g, DT, STILL, mulberry32(1)).hurt).toBe(0);
    e.dmg = 500;
    let lost = false;
    for (let i = 0; i < 60 && !lost; i++) lost = nt.step(g, DT, STILL, mulberry32(1)).lost;
    expect(lost).toBe(true);
    expect(g.phase).toBe('over');
    expect(g.won).toBe(false);
  });

  it('al amanecer se gana el bonus y la partida termina', () => {
    const g = nt.newNight();
    quiet(g);
    g.t = nt.RUN_MS - 10;
    enemy(g, 'rat', g.x + 200, g.y, 999);
    const ev = nt.step(g, DT, STILL, mulberry32(1));
    expect(ev.dawn).toBe(true);
    expect(ev.burn).toHaveLength(1);
    expect(g.won).toBe(true);
    expect(g.enemies).toHaveLength(0);
    expect(g.score).toBe(nt.DAWN_BONUS + Math.floor(nt.RUN_MS / 2000));
    expect(nt.step(g, DT, STILL, mulberry32(1)).dawn).toBe(false);
  });

  it('las mejoras suben de nivel hasta el máximo y al principio siempre se ofrece un arma nueva', () => {
    const rand = mulberry32(3);
    const g = nt.newNight();
    for (let i = 0; i < 40; i++) {
      const ch = nt.rollChoices(g, rand);
      expect(ch).toHaveLength(3);
      expect(new Set(ch.map((d) => d.id)).size).toBe(3);
      expect(ch.some((d) => d.weapon && nt.wl(g, d.id) === 0)).toBe(true);
    }
    for (const d of nt.UPGRADES) for (let i = 0; i < 7; i++) nt.applyUpgrade(g, d.id);
    for (const d of nt.UPGRADES) expect(nt.wl(g, d.id)).toBe(5);
    expect(nt.maxHp(g)).toBe(nt.BASE_HP + 100);
    // Con todo al máximo quedan los premios de consolación
    const ch = nt.rollChoices(g, rand);
    expect(ch.map((d) => d.id).sort()).toEqual(['bolsa', 'pollo']);
    const before = g.score;
    nt.applyUpgrade(g, 'bolsa');
    expect(g.score).toBe(before + 10);
  });

  it('campana, escoba, silbato, petardos y agua dañan a los bichos', () => {
    for (const id of ['campana', 'escoba', 'silbato', 'petardos', 'agua'] as nt.WeaponId[]) {
      const g = nt.newNight();
      quiet(g);
      g.levels = { [id]: 1 };
      g.cd[id] = 0;
      const e = enemy(g, 'rat', g.x + (id === 'escoba' ? 34 : 30), g.y, 999);
      e.dmg = 0;
      for (let i = 0; i < 60 * 3; i++) nt.step(g, DT, STILL, mulberry32(i));
      expect(e.hp, id).toBeLessThan(999);
    }
  });

  it('El Coco llega a los 4:00, avisa antes de embestir y suelta premios al caer', () => {
    const g = nt.newNight();
    g.nextEvent = nt.TIMELINE.findIndex((e) => e.kind === 'boss');
    g.spawnAcc = -1e9;
    g.t = nt.BOSS_AT - 1;
    const ev = nt.step(g, DT, STILL, mulberry32(1));
    expect(ev.bossIn).toBe(true);
    const b = nt.boss(g)!;
    expect(b).toBeTruthy();
    let warn = -1;
    let charge = -1;
    for (let i = 0; i < 60 * 8 && charge < 0; i++) {
      const e2 = nt.step(g, DT, STILL, mulberry32(i));
      if (e2.bossWarn) warn = i;
      if (e2.bossCharge) charge = i;
      g.hp = nt.BASE_HP;
    }
    expect(warn).toBeGreaterThan(0);
    expect(charge - warn).toBeGreaterThan(50);
    b.hp = 1;
    b.x = g.x + 40;
    b.y = g.y;
    let down = false;
    for (let i = 0; i < 120 && !down; i++) {
      down = nt.step(g, DT, STILL, mulberry32(i)).bossDown;
      g.hp = nt.BASE_HP;
    }
    expect(down).toBe(true);
    expect(g.items.length).toBeGreaterThanOrEqual(2);
    expect(g.killPts).toBeGreaterThanOrEqual(nt.ENEMY.coco.pts);
  });

  it('la rejilla encuentra a los bichos cercanos', () => {
    const g = nt.newNight();
    quiet(g);
    const a = enemy(g, 'rat', 10, 10);
    enemy(g, 'rat', 400, 400);
    g.grid.build(g.enemies, 0, 0);
    const n = g.grid.query(0, 0, 20);
    const found = Array.from(g.grid.out.slice(0, n)).map((i) => g.enemies[i]);
    expect(found).toContain(a);
    expect(found).toHaveLength(1);
  });

  it('nunca se pasa del tope de bichos', () => {
    const { peak } = play(5, 1, 200_000);
    expect(peak).toBeLessThanOrEqual(nt.HARD_MAX);
  }, 120_000);

  it('partidas automáticas: quieto se pierde pronto, huyendo se llega lejos, y la puntuación está en escala', () => {
    const rows: string[] = [];
    const stats = (skill: number) =>
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const { g } = play(seed, skill);
        rows.push(`skill ${skill} seed ${seed}: ${(g.t / 1000).toFixed(0)} s, ${g.kills} bichos, nv ${g.lv}, ${g.score} pts${g.won ? ' (amanece)' : ''}${g.bossDown ? ' (Coco)' : ''}`);
        return g;
      });
    const idle = stats(0);
    stats(0.5);
    const good = stats(1);
    stats(2);
    console.log(rows.join('\n'));
    for (const g of idle) {
      expect(g.phase).toBe('over');
      expect(g.score).toBeLessThan(200);
    }
    for (const g of [...idle, ...good]) expect(g.score).toBeLessThan(5000);
    const avgGood = good.reduce((n, g) => n + g.score, 0) / good.length;
    expect(avgGood).toBeGreaterThan(200);
  }, 300_000);
});
