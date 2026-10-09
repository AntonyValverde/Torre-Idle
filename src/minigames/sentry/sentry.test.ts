import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import {
  BOSS_EVERY,
  RAYO_MS,
  STATS,
  TOWER_R,
  TX,
  TY,
  UPGRADES,
  WAVE_MS,
  WAVE_PTS,
  buy,
  edgePoint,
  isBossWave,
  maxHp,
  newSentry,
  rayo,
  rayoReady,
  spawnAt,
  stat,
  step,
  upCost,
  waveSpawns,
  type SentryGame,
  type UpId,
} from './logic';

const DT = 1000 / 60;

/** Avanza `ms` de partida y devuelve todos los eventos juntos. */
function run(g: SentryGame, ms: number, rand = mulberry32(1)) {
  const kills: string[] = [];
  let hurt = 0;
  let lost = false;
  for (let t = 0; t < ms && g.phase === 'play'; t += DT) {
    const ev = step(g, DT, rand);
    for (const k of ev.kills) kills.push(`${k.kind}:${k.how}`);
    hurt += ev.hurt;
    lost ||= ev.lost;
  }
  return { kills, hurt, lost };
}

/** Campo vacío y sin oleadas (para probar una regla suelta). */
function quiet(seed = 1): SentryGame {
  const g = newSentry(mulberry32(seed));
  g.queue = [];
  return g;
}

type Bot = 'idle' | 'random' | 'cheap' | 'smart';

const SMART_W: Partial<Record<UpId, number>> = {
  dmg: 1,
  rate: 1.15,
  hp: 1.1,
  regen: 1.4,
  crit: 1.5,
  critx: 1.7,
  multi: 0.9,
  range: 2.4,
  thorns: 1.6,
  cash: 1.1,
  bonus: 2.2,
  knock: 3.5,
  interest: 3,
};

/** Partida entera con un jugador automático. Devuelve el resultado. */
function botRun(bot: Bot, seed: number) {
  const rand = mulberry32(seed);
  const br = mulberry32(seed * 7 + 3);
  const g = newSentry(rand);
  let thinkT = 0;
  while (g.phase === 'play' && g.t < 60 * 60 * 1000) {
    step(g, DT, rand);
    thinkT -= DT;
    if (thinkT > 0 || bot === 'idle') continue;
    thinkT = bot === 'random' ? 3000 : 1000;
    if (bot === 'random') {
      const ok = UPGRADES.filter((d) => {
        const c = upCost(g, d.id);
        return c !== null && c <= g.coins;
      });
      if (ok.length && br() < 0.6) buy(g, ok[Math.floor(br() * ok.length)].id);
      if (rayoReady(g) && g.enemies.length >= 10) rayo(g);
    } else {
      // Compra hasta que no le llegue
      for (let n = 0; n < 20; n++) {
        let best: UpId | null = null;
        let bestScore = Infinity;
        for (const d of UPGRADES) {
          const c = upCost(g, d.id);
          if (c === null) continue;
          const w = bot === 'cheap' ? 1 : (SMART_W[d.id] ?? 2);
          if (c * w < bestScore) {
            bestScore = c * w;
            best = d.id;
          }
        }
        if (!best || !buy(g, best)) break;
      }
      const crowd = g.enemies.filter((e) => Math.hypot(e.x - TX, e.y - TY) < 110).length;
      if (rayoReady(g) && (crowd >= (bot === 'smart' ? 5 : 7) || g.enemies.some((e) => e.kind === 'boss' && e.stuck))) rayo(g);
    }
  }
  return { score: g.score, wave: g.wave, min: g.t / 60000, kills: g.kills };
}

describe('Torre vigía: reglas', () => {
  it('la torre dispara sola al enemigo más cercano dentro del alcance y lo mata', () => {
    const g = quiet();
    const near = spawnAt(g, 'basic', TX + 60, TY);
    const far = spawnAt(g, 'basic', TX - 300, TY);
    const r = run(g, 1600);
    expect(r.kills).toContain('basic:shot');
    expect(g.enemies).not.toContain(near);
    // El lejano está fuera del alcance: sigue vivo y con la vida entera
    expect(far.hp).toBe(far.max);
    expect(g.coins).toBeGreaterThan(0);
    expect(g.kills).toBe(1);
  });

  it('un básico que llega a la torre revienta y le quita vida, sin dar monedas', () => {
    const g = quiet();
    g.lv.range = 0;
    g.fireT = 1e9; // la torre no dispara
    spawnAt(g, 'basic', TX + TOWER_R + 20, TY);
    const r = run(g, 2000);
    expect(r.hurt).toBeCloseTo(STATS.basic.dmg, 5);
    expect(g.hp).toBeCloseTo(maxHp(g) - STATS.basic.dmg, 5);
    expect(g.enemies).toHaveLength(0);
    expect(g.kills).toBe(0);
    expect(g.coins).toBe(0);
  });

  it('el tanque se queda pegado y sigue golpeando', () => {
    const g = quiet();
    g.fireT = 1e9;
    spawnAt(g, 'tank', TX, TY - TOWER_R - 13);
    const r = run(g, 4000);
    expect(g.enemies).toHaveLength(1);
    expect(r.hurt).toBeGreaterThanOrEqual(STATS.tank.dmg * 3 - 1e-9);
  });

  it('las espinas matan al que toca la torre antes de que haga daño, y la baja cuenta', () => {
    const g = quiet();
    g.fireT = 1e9;
    g.lv.thorns = 15; // 60 %
    const e = spawnAt(g, 'basic', TX + TOWER_R + 10, TY);
    e.hp = e.max * 0.5;
    const r = run(g, 1500);
    expect(r.kills).toEqual(['basic:thorns']);
    expect(r.hurt).toBe(0);
    expect(g.coins).toBeGreaterThan(0);
  });

  it('el enemigo a distancia se para fuera de la torre y le dispara balas lentas', () => {
    const g = quiet();
    g.fireT = 1e9;
    const e = spawnAt(g, 'ranged', TX, TY - 170);
    const r = run(g, 9000);
    expect(Math.hypot(e.x - TX, e.y - TY)).toBeGreaterThan(100);
    expect(g.enemies).toContain(e);
    expect(r.hurt).toBeGreaterThan(0);
  });

  it('el retroceso aleja a los enemigos al recibir un disparo', () => {
    const a = quiet();
    const b = quiet();
    b.lv.knock = 10;
    for (const g of [a, b]) {
      const e = spawnAt(g, 'tank', TX + 100, TY);
      e.hp = e.max = 1e6;
      run(g, 2000);
    }
    expect(b.enemies[0].x).toBeGreaterThan(a.enemies[0].x + 10);
  });

  it('el multidisparo reparte las balas entre varios blancos', () => {
    const g = quiet();
    g.lv.multi = 2;
    for (const [dx, dy] of [
      [60, 0],
      [-60, 0],
      [0, 60],
    ])
      spawnAt(g, 'tank', TX + dx, TY + dy);
    step(g, DT, mulberry32(3));
    expect(new Set(g.bullets.map((b) => b.target)).size).toBe(3);
  });

  it('no malgasta disparos: si una bala ya basta para matar, el siguiente va a otro', () => {
    const g = quiet();
    const a = spawnAt(g, 'basic', TX + 50, TY);
    const b = spawnAt(g, 'basic', TX + 70, TY);
    a.hp = 1;
    step(g, DT, mulberry32(3));
    g.fireT = 0;
    step(g, DT, mulberry32(4));
    expect(g.bullets.map((x) => x.target)).toEqual([a.id, b.id]);
  });

  it('comprar cuesta monedas, sube el valor y el precio crece; sin dinero no se puede', () => {
    const g = quiet();
    expect(buy(g, 'dmg')).toBe(false);
    g.coins = 1000;
    const before = stat(g, 'dmg');
    const c0 = upCost(g, 'dmg')!;
    expect(buy(g, 'dmg')).toBe(true);
    expect(g.coins).toBe(1000 - c0);
    expect(stat(g, 'dmg')).toBeGreaterThan(before);
    expect(upCost(g, 'dmg')!).toBeGreaterThan(c0);
    // La vida máxima nueva se rellena
    const hp0 = g.hp;
    buy(g, 'hp');
    expect(g.hp).toBeCloseTo(hp0 + (maxHp(g) - 100), 5);
    // Las mejoras con tope dejan de venderse
    g.lv.multi = 4;
    expect(upCost(g, 'multi')).toBeNull();
    g.coins = 1e12;
    expect(buy(g, 'multi')).toBe(false);
  });

  it('los precios crecen de forma exponencial y los valores mejoran siempre', () => {
    for (const d of UPGRADES) {
      const top = Number.isFinite(d.max) ? d.max : 60;
      for (let lv = 0; lv < top; lv++) {
        expect(d.value(lv + 1)).toBeGreaterThan(d.value(lv));
        expect(d.base * d.growth ** (lv + 1)).toBeGreaterThan(d.base * d.growth ** lv);
      }
      expect(d.show(d.value(0)).length).toBeGreaterThan(0);
    }
  });

  it('el rayo golpea a todos, borra sus balas, aturde y se recarga', () => {
    const g = quiet();
    for (let i = 0; i < 6; i++) spawnAt(g, 'basic', TX + 150 * Math.cos(i), TY + 150 * Math.sin(i));
    const t = spawnAt(g, 'tank', TX, TY - 150);
    t.hp = t.max = 1e6;
    g.ebullets.push({ x: 10, y: 10, vx: 1, vy: 1, dmg: 5 });
    expect(rayoReady(g)).toBe(true);
    const ev = rayo(g);
    expect(ev.kills.filter((k) => k.how === 'rayo')).toHaveLength(6);
    expect(g.enemies).toEqual([t]);
    expect(t.stun).toBeGreaterThan(0);
    expect(g.ebullets).toHaveLength(0);
    expect(rayoReady(g)).toBe(false);
    expect(rayo(g).kills).toHaveLength(0);
    g.enemies = [];
    run(g, RAYO_MS + 50);
    expect(rayoReady(g)).toBe(true);
  });

  it('las oleadas pasan con el reloj, dan puntos e interés, y cada 10 llega un jefe', () => {
    const g = quiet();
    g.fireT = 1e9;
    g.coins = 100;
    g.lv.interest = 5; // 10 %
    g.waveT = WAVE_MS - DT / 2;
    const ev = step(g, DT, mulberry32(2));
    expect(ev.waveClear?.wave).toBe(1);
    expect(ev.waveClear?.interest).toBeCloseTo(10, 5);
    expect(g.wave).toBe(2);
    expect(g.score).toBe(WAVE_PTS);
    expect(isBossWave(BOSS_EVERY)).toBe(true);
    expect(waveSpawns(BOSS_EVERY, mulberry32(1)).filter((s) => s.kind === 'boss')).toHaveLength(1);
    expect(waveSpawns(BOSS_EVERY - 1, mulberry32(1)).filter((s) => s.kind === 'boss')).toHaveLength(0);
    // Los tipos difíciles aparecen más tarde
    expect(waveSpawns(1, mulberry32(5)).every((s) => s.kind === 'basic')).toBe(true);
  });

  it('los enemigos salen por los bordes del campo', () => {
    for (let i = 0; i < 64; i++) {
      const p = edgePoint((i / 64) * Math.PI * 2);
      const out = p.x <= 0 || p.x >= 360 || p.y <= 0 || p.y >= 400;
      expect(out).toBe(true);
    }
  });

  it('la torre cae cuando se queda sin vida y ya no avanza nada', () => {
    const g = quiet();
    g.fireT = 1e9;
    g.hp = 3;
    spawnAt(g, 'basic', TX + TOWER_R + 9, TY);
    const r = run(g, 2000);
    expect(r.lost).toBe(true);
    expect(g.phase).toBe('over');
    const t = g.t;
    expect(step(g, DT, mulberry32(1)).lost).toBe(false);
    expect(g.t).toBe(t);
  });
});

describe('Torre vigía: partidas automáticas', () => {
  const table = (bot: Bot, seeds: number[]) => seeds.map((s) => botRun(bot, s));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('todas las partidas acaban, y la puntuación sigue la escala del ranking', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const res = {
      idle: table('idle', seeds),
      random: table('random', seeds),
      cheap: table('cheap', seeds),
      smart: table('smart', seeds),
    };
    for (const [k, rs] of Object.entries(res)) {
      console.log(
        `${k.padEnd(6)} score ${avg(rs.map((r) => r.score)).toFixed(0).padStart(5)} · oleada ${avg(rs.map((r) => r.wave)).toFixed(1)} · ${avg(rs.map((r) => r.min)).toFixed(1)} min ·`,
        rs.map((r) => r.score).join(' '),
      );
    }
    const a = (k: keyof typeof res) => avg(res[k].map((r) => r.score));
    expect(a('idle')).toBeGreaterThan(20);
    expect(a('idle')).toBeLessThan(90);
    expect(a('random')).toBeGreaterThan(50);
    expect(a('random')).toBeLessThan(260);
    expect(a('cheap')).toBeGreaterThan(200);
    expect(a('cheap')).toBeLessThan(700);
    expect(a('smart')).toBeGreaterThan(700);
    expect(a('smart')).toBeLessThan(1600);
    for (const rs of Object.values(res)) for (const r of rs) expect(r.score).toBeLessThan(5000);
  });
});
