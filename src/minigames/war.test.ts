import { beforeEach, describe, expect, it } from 'vitest';
import { useGame } from '../game/store';
import { newState, normalize } from '../game/state';
import { ACHIEVEMENTS } from '../game/economy';
import { BOARD_CAP, localBest, nextResend } from '../game/pending';
import { WAR_GAMES, warGems } from '../game/war';
import { citySnapshot } from '../game/cities';
import { mulberry32 } from './rng';
import * as flak from './flak/logic';
import * as art from './artillery/logic';
import * as lanes from './lanes/logic';
import * as duel from './duel/logic';

describe('Defensa antiaérea', () => {
  it('una explosión derriba lo que toca y encadena otra que puntúa más', () => {
    const g = flak.newFlak(mulberry32(1));
    g.toSpawn = 0;
    const mk = (x: number, y: number): flak.Enemy => ({ x, y, vx: 0, vy: 0, kind: 'shell', target: 0, splitY: 0, x0: x, y0: y });
    // Uno en el borde de la explosión y otro más allá: fuera de su radio pero dentro del de la cadena
    g.enemies = [mk(50 + flak.BLAST_R - 2, 60), mk(50 + flak.BLAST_R - 2 + flak.CHAIN_R, 60)];
    g.blasts.push({ x: 50, y: 60, r: flak.BLAST_R, age: flak.GROW_MS, depth: 0 });
    const ev1 = flak.step(g, 16, mulberry32(2));
    expect(ev1.kills).toBe(1);
    expect(g.score).toBe(1);
    // La explosión en cadena crece y alcanza al segundo
    let kills = 0;
    for (let i = 0; i < 20 && g.enemies.length; i++) kills += flak.step(g, 16, mulberry32(3)).kills;
    expect(kills).toBe(1);
    expect(g.score).toBeGreaterThanOrEqual(1 + 2);
    expect(g.bestChain).toBeGreaterThanOrEqual(1);
  });

  it('disparar gasta munición, no deja tirar al suelo y se recarga', () => {
    const g = flak.newFlak(mulberry32(1));
    expect(flak.fire(g, 50, flak.GROUND)).toBe('low');
    for (let i = 0; i < flak.AMMO_MAX; i++) expect(flak.fire(g, 50, 40)).toBe('ok');
    expect(flak.fire(g, 50, 40)).toBe('empty');
    flak.step(g, flak.AMMO_REFILL_MS + 1, mulberry32(1));
    expect(g.ammo).toBe(1);
  });

  it('el obús llega a su destino y explota allí', () => {
    const g = flak.newFlak(mulberry32(1));
    g.toSpawn = 0;
    g.enemies = [{ x: 0, y: 0, vx: 0, vy: 1, kind: 'shell', target: 0, splitY: 0, x0: 0, y0: 0 }];
    flak.fire(g, 30, 50);
    const d = Math.hypot(30 - flak.BATTERY.x, 50 - flak.BATTERY.y);
    flak.step(g, (d / flak.SHOT_SPEED) * 1000 + 20, mulberry32(1));
    expect(g.shots).toHaveLength(0);
    expect(g.blasts.some((b) => b.x === 30 && b.y === 50 && b.depth === 0)).toBe(true);
  });

  it('un proyectil que llega derriba el edificio y sin edificios se pierde', () => {
    const g = flak.newFlak(mulberry32(1));
    g.toSpawn = 0;
    g.buildings.forEach((b, i) => (b.alive = i === 0));
    const b = g.buildings[0];
    g.enemies = [{ x: b.x, y: flak.GROUND - b.h - 0.5, vx: 0, vy: 30, kind: 'shell', target: 0, splitY: 0, x0: b.x, y0: 0 }];
    const ev = flak.step(g, 100, mulberry32(1));
    expect(ev.hits).toBe(1);
    expect(ev.lost).toBe(true);
    expect(g.over).toBe(true);
  });

  it('al vaciar la oleada se cobra el bono y empieza la siguiente', () => {
    const g = flak.newFlak(mulberry32(1));
    g.toSpawn = 0;
    const ev = flak.step(g, 16, mulberry32(1));
    expect(ev.waveCleared).toBe(true);
    expect(g.score).toBe(flak.SURVIVOR_BONUS * flak.BUILDING_X.length);
    const ev2 = flak.step(g, flak.WAVE_PAUSE_MS + 1, mulberry32(1));
    expect(ev2.waveStart).toBe(true);
    expect(g.wave).toBe(2);
    expect(g.toSpawn).toBe(flak.waveSize(2));
  });

  it('los que se parten dan tres proyectiles', () => {
    const g = flak.newFlak(mulberry32(1));
    g.toSpawn = 0;
    g.enemies = [{ x: 50, y: 49, vx: 0, vy: 20, kind: 'split', target: 0, splitY: 50, x0: 50, y0: 0 }];
    const ev = flak.step(g, 100, mulberry32(1));
    expect(ev.split).toBe(true);
    expect(g.enemies).toHaveLength(3);
  });

  it('una partida sin disparar acaba perdiéndose', () => {
    const r = mulberry32(9);
    const g = flak.newFlak(r);
    for (let i = 0; i < 20_000 && !g.over; i++) flak.step(g, 50, r);
    expect(g.over).toBe(true);
  });
});

describe('Artillería', () => {
  it('apuntar como un tirachinas: arrastrar hacia atrás y abajo dispara hacia arriba y adelante', () => {
    const a = art.aimFrom(-20, 20);
    expect(a.angle).toBeCloseTo(Math.PI / 4);
    expect(a.power).toBeCloseTo(Math.hypot(20, 20) / art.PULL_MAX);
    expect(art.aimFrom(-100, 0).power).toBe(1);
    // Hacia atrás y arriba se limita al ángulo mínimo
    expect(art.aimFrom(-20, -40).angle).toBe(art.MIN_ANGLE);
  });

  it('un disparo bien apuntado destruye la máquina', () => {
    const g = art.newArtillery(mulberry32(1));
    g.nextSpawn = 1e9;
    g.wind = 0;
    g.enemies = [{ id: 1, kind: 'ram', x: 80, hp: 1, hurt: 0 }];
    // Busca el ángulo que cae cerca de x = 80 sin viento
    let best = { angle: 0, power: 0, d: Infinity };
    // Tiro tenso (el bombeado tarda tanto que la máquina se mueve demasiado)
    for (let deg = 0; deg <= 35; deg += 0.5) {
      for (let power = 0.1; power <= 1; power += 0.02) {
        const angle = (deg * Math.PI) / 180;
        const land = art.preview(angle, power, 4000, 10).find((p) => p.y >= art.GROUND);
        if (land && Math.abs(land.x - 78) < best.d) best = { angle, power, d: Math.abs(land.x - 78) };
      }
    }
    expect(best.d).toBeLessThan(2);
    expect(art.shoot(g, best.angle, best.power, () => 0.5)).toBe(true);
    expect(art.shoot(g, best.angle, best.power, () => 0.5)).toBe(false); // recargando
    let kills = 0;
    for (let i = 0; i < 400 && g.shells.length; i++) kills += art.step(g, 16, mulberry32(1)).kills;
    expect(kills).toBe(1);
    expect(g.score).toBe(art.KINDS.ram.pts);
    expect(g.hitShots).toBe(1);
  });

  it('el viento desvía el disparo', () => {
    const fly = (wind: number) => {
      const g = art.newArtillery(mulberry32(1));
      g.nextSpawn = 1e9;
      g.wind = wind;
      art.shoot(g, Math.PI / 4, 0.3, () => 0.5);
      for (let i = 0; i < 600 && g.shells.length; i++) art.step(g, 10, mulberry32(1));
      return g.blasts[0].x;
    };
    expect(fly(10)).toBeGreaterThan(fly(0));
    expect(fly(-10)).toBeLessThan(fly(0));
  });

  it('cada máquina que llega a la muralla quita una vida y con tres se pierde', () => {
    const g = art.newArtillery(mulberry32(1));
    g.nextSpawn = 1e9;
    g.enemies = [0, 1, 2].map((i) => ({ id: i, kind: 'ram' as const, x: art.WALL_X + art.KINDS.ram.w / 2 + 0.01, hp: 1, hurt: 0 }));
    const ev = art.step(g, 100, mulberry32(1));
    expect(ev.breached).toBe(3);
    expect(ev.lost).toBe(true);
    expect(g.lives).toBe(0);
  });

  it('la torre de asedio aguanta varios golpes', () => {
    const g = art.newArtillery(mulberry32(1));
    g.nextSpawn = 1e9;
    g.enemies = [{ id: 1, kind: 'tower', x: 100, hp: art.KINDS.tower.hp, hurt: 0 }];
    // Obús que cae justo al lado (sin tocar la caja)
    g.shells = [{ x: 100 + art.KINDS.tower.w / 2 + 3, y: art.GROUND - 0.5, vx: 0, vy: 10, wind: 0 }];
    art.step(g, 100, mulberry32(1));
    expect(g.enemies[0].hp).toBe(art.KINDS.tower.hp - 1);
    expect(g.score).toBe(0);
  });
});

describe('Defensa de calles', () => {
  it('construir cuesta dinero y no se puede repetir casilla', () => {
    const g = lanes.newLanes();
    expect(lanes.build(g, 'archer', 0, 4)).toBe('ok');
    expect(g.money).toBe(lanes.START_MONEY - lanes.DEFENSES.archer.cost);
    expect(lanes.build(g, 'wall', 0, 4)).toBe('taken');
    g.money = lanes.DEFENSES.cannon.cost - 1;
    expect(lanes.build(g, 'cannon', 1, 4)).toBe('money');
  });

  it('la barricada frena al enemigo, que la golpea hasta romperla', () => {
    const g = lanes.newLanes();
    g.toSpawn = 0;
    lanes.build(g, 'wall', 1, 2);
    g.enemies = [{ id: 1, kind: 'soldier', lane: 1, y: 0, hp: 99, cool: 0, hurt: 0 }];
    let broken = 0;
    for (let i = 0; i < 2000 && !broken; i++) broken += lanes.step(g, 50, mulberry32(1)).broken;
    expect(broken).toBe(1);
    expect(g.defenses[1][2]).toBeNull();
    // Nunca pasó de la barricada mientras estaba en pie
    expect(g.enemies[0].y).toBeLessThan(lanes.rowY(2));
  });

  it('la torreta dispara calle arriba y cobra cada derribo', () => {
    const g = lanes.newLanes();
    g.toSpawn = 0;
    g.pause = 1e9; // sin fin de oleada (su bono también suma puntos)
    lanes.build(g, 'archer', 2, 4);
    g.enemies = [{ id: 1, kind: 'runner', lane: 2, y: 40, hp: 2, cool: 0, hurt: 0 }];
    const money = g.money;
    let kills = 0;
    for (let i = 0; i < 100 && !kills; i++) kills += lanes.step(g, 50, mulberry32(1)).kills;
    expect(kills).toBe(1);
    expect(g.score).toBe(lanes.ENEMIES.runner.pts);
    expect(g.money).toBeGreaterThan(money + lanes.ENEMIES.runner.money - 1);
  });

  it('las torretas no disparan a otras calles ni hacia atrás', () => {
    const g = lanes.newLanes();
    g.toSpawn = 0;
    lanes.build(g, 'archer', 0, 1);
    g.enemies = [
      { id: 1, kind: 'soldier', lane: 1, y: 20, hp: 4, cool: 0, hurt: 0 },
      { id: 2, kind: 'soldier', lane: 0, y: 100, hp: 4, cool: 0, hurt: 0 },
    ];
    lanes.step(g, 50, mulberry32(1));
    expect(g.enemies.map((e) => e.hp)).toEqual([4, 4]);
  });

  it('el cañón daña a los de alrededor', () => {
    const g = lanes.newLanes();
    g.toSpawn = 0;
    g.money = 999;
    lanes.build(g, 'cannon', 0, 4);
    g.enemies = [
      { id: 1, kind: 'brute', lane: 0, y: 60, hp: 12, cool: 0, hurt: 0 },
      { id: 2, kind: 'brute', lane: 0, y: 55, hp: 12, cool: 0, hurt: 0 },
    ];
    lanes.step(g, 16, mulberry32(1));
    expect(g.enemies.map((e) => e.hp)).toEqual([12 - lanes.DEFENSES.cannon.dmg, 12 - lanes.SPLASH_DMG]);
  });

  it('quien llega al ayuntamiento quita una vida y con cinco se pierde', () => {
    const g = lanes.newLanes();
    g.toSpawn = 0;
    g.enemies = [0, 1, 2, 3, 4].map((i) => ({ id: i, kind: 'soldier' as const, lane: i % 3, y: lanes.HALL_Y - 0.1, hp: 4, cool: 0, hurt: 0 }));
    const ev = lanes.step(g, 100, mulberry32(1));
    expect(ev.leaked).toBe(5);
    expect(ev.lost).toBe(true);
  });

  it('cada quinta oleada trae un ariete', () => {
    const g = lanes.newLanes();
    g.wave = 4;
    g.toSpawn = 0;
    lanes.step(g, 16, mulberry32(1)); // fin de la oleada 4
    lanes.step(g, lanes.WAVE_PAUSE_MS + 1, mulberry32(1));
    expect(g.wave).toBe(5);
    const seen = new Set<string>();
    for (let i = 0; i < 1000 && (g.toSpawn > 0 || seen.size === 0); i++) {
      lanes.step(g, 50, mulberry32(i));
      g.enemies.forEach((e) => seen.add(e.kind));
    }
    expect(seen.has('ram')).toBe(true);
  });
});

describe('Duelo de generales', () => {
  it('el triángulo: infantería > arqueros > caballería > infantería', () => {
    expect(duel.outcome('inf', 'arc')).toBe('win');
    expect(duel.outcome('arc', 'cav')).toBe('win');
    expect(duel.outcome('cav', 'inf')).toBe('win');
    expect(duel.outcome('arc', 'inf')).toBe('lose');
    expect(duel.outcome('cav', 'cav')).toBe('tie');
    for (const u of duel.UNITS) expect(duel.outcome(duel.COUNTER[u], u)).toBe('win');
  });

  it('las manos tienen 5 unidades y al menos una de cada', () => {
    for (let seed = 0; seed < 50; seed++) {
      const h = duel.randomHand(mulberry32(seed));
      expect(duel.handSize(h)).toBe(duel.HAND);
      for (const u of duel.UNITS) expect(h[u]).toBeGreaterThanOrEqual(1);
    }
  });

  it('el rival solo saca lo que le queda y cada general tira hacia su manía', () => {
    const r = mulberry32(4);
    const counts = { inf: 0, arc: 0, cav: 0 };
    for (let i = 0; i < 400; i++) {
      const g = duel.newDuel(r);
      g.general = 'bravo';
      g.theirs = { inf: 1, arc: 0, cav: 1 };
      const u = duel.enemyPick(g, r);
      counts[u]++;
    }
    expect(counts.arc).toBe(0);
    expect(counts.cav).toBeGreaterThan(counts.inf * 1.5);
  });

  it('el Zorro saca lo que gana a tu última unidad', () => {
    const g = duel.newDuel(mulberry32(1));
    g.general = 'zorro';
    g.battle = 10;
    g.theirs = { inf: 1, arc: 1, cav: 1 };
    g.rounds = [{ mine: 'arc', theirs: 'arc', result: 'tie' }];
    const w = duel.weights(g);
    expect(w.inf).toBeGreaterThan(w.arc);
    expect(w.inf).toBeGreaterThan(w.cav);
  });

  it('una batalla son 5 rondas; ganarla suma puntos y perderla cuesta un estandarte', () => {
    const g = duel.newDuel(mulberry32(1));
    // El rival solo tiene arqueros: la infantería gana todas
    g.mine = { inf: 5, arc: 0, cav: 0 };
    g.theirs = { inf: 0, arc: 5, cav: 0 };
    for (let i = 0; i < duel.ROUNDS; i++) expect(duel.play(g, 'inf', mulberry32(i))).not.toBeNull();
    expect(g.result).toBe('win');
    expect(g.score).toBe(duel.ROUNDS + duel.battlePoints(1));
    expect(duel.play(g, 'inf', mulberry32(1))).toBeNull();
    duel.nextBattle(g, mulberry32(2));
    expect(g.battle).toBe(2);
    expect(g.rounds).toHaveLength(0);
    // Ahora pierde todas
    g.mine = { inf: 5, arc: 0, cav: 0 };
    g.theirs = { inf: 0, arc: 0, cav: 5 };
    for (let i = 0; i < duel.ROUNDS; i++) duel.play(g, 'inf', mulberry32(i));
    expect(g.result).toBe('lose');
    expect(g.banners).toBe(duel.BANNERS - 1);
  });

  it('sin estandartes se acaba la campaña', () => {
    const g = duel.newDuel(mulberry32(1));
    g.banners = 1;
    g.mine = { inf: 5, arc: 0, cav: 0 };
    g.theirs = { inf: 0, arc: 0, cav: 5 };
    for (let i = 0; i < duel.ROUNDS; i++) duel.play(g, 'inf', mulberry32(i));
    expect(g.over).toBe(true);
    duel.nextBattle(g, mulberry32(1));
    expect(g.battle).toBe(1);
  });

  it('no se puede sacar una unidad que no te queda', () => {
    const g = duel.newDuel(mulberry32(1));
    g.mine = { inf: 0, arc: 5, cav: 0 };
    expect(duel.play(g, 'inf', mulberry32(1))).toBeNull();
  });
});

describe('Duelo contra alcaldes de verdad', () => {
  it('el estilo público sale tras unas rondas y se lee de vuelta', () => {
    expect(duel.styleString({ inf: 3, arc: 2, cav: 1 })).toBeNull();
    expect(duel.styleString({ inf: 4, arc: 4, cav: 2 })).toBe('40-40-20');
    expect(duel.parseStyle('40-40-20')).toEqual({ inf: 0.4, arc: 0.4, cav: 0.2 });
    for (const bad of ['caballería', '1000-0-0', '0-0-0', 40, null, '40-40']) expect(duel.parseStyle(bad)).toBeNull();
  });

  it('solo salen como veteranos (desde la batalla 7) y juegan con su estilo', () => {
    const rival = { name: 'Ana', style: { inf: 0.1, arc: 0.1, cav: 0.8 } };
    for (let b = 1; b <= duel.ORDER.length; b++) expect(duel.newBattle(b, () => 0, [rival]).rival).toBeNull();
    const vet = duel.newBattle(7, () => 0, [rival]);
    expect(vet.general).toBe('rival');
    expect(duel.generalInfo(vet)).toMatchObject({ name: 'Ana' });
    expect(duel.generalInfo(vet).tell).toContain('80 %');
    // Sin rivales cargados, veteranos inventados
    expect(duel.newBattle(7, () => 0, []).general).not.toBe('rival');
    const g = { ...duel.newDuel(mulberry32(1)), ...vet, theirs: { inf: 1, arc: 1, cav: 1 } };
    const w = duel.weights(g);
    expect(w.cav).toBeGreaterThan(w.inf * 2);
  });

  it('las unidades sacadas se guardan y la ciudad publica el estilo', () => {
    useGame.setState({ s: newState(Date.now()) });
    expect(citySnapshot(useGame.getState().s).army).toBeUndefined();
    for (let i = 0; i < 10; i++) useGame.getState().noteDuelPick(i < 5 ? 'cav' : i < 8 ? 'inf' : 'arc');
    expect(useGame.getState().s.duelPicks).toEqual({ inf: 3, arc: 2, cav: 5 });
    expect(citySnapshot(useGame.getState().s).army).toBe('30-20-50');
    expect(normalize({ duelPicks: { inf: 2, arc: -1 } }, 0).duelPicks).toEqual({ inf: 2, arc: 0, cav: 0 });
  });
});

describe('Premios de los juegos de guerra', () => {
  beforeEach(() => {
    useGame.setState({ s: newState(Date.now()) });
  });

  it('dan monedas, gemas por tramos y guardan el récord', () => {
    for (const game of WAR_GAMES) {
      const r = useGame.getState().rewardWar(game, 300);
      expect(r.coins).toBeGreaterThan(0);
      expect(r.gems).toBe(warGems(game, 300));
      expect(r.newBest).toBe(true);
      expect(localBest(useGame.getState().s, game)).toBe(300);
      expect(useGame.getState().rewardWar(game, 10)).toMatchObject({ newBest: false });
      expect(localBest(useGame.getState().s, game)).toBe(300);
      expect(BOARD_CAP[game]).toBe(5000);
    }
    expect(useGame.getState().rewardWar('duel', 0).gems).toBe(0);
  });

  it('los récords se suben al ranking y sobreviven al guardado', () => {
    const s = { ...newState(0), duelBest: 40 };
    expect(nextResend(s)).toEqual({ board: 'duel', score: 40 });
    expect(normalize({ flakBest: 12 }, 0).flakBest).toBe(12);
    expect(normalize({ coins: 5 }, 0).lanesBest).toBe(0);
  });

  it('cada juego tiene su logro', () => {
    for (const id of WAR_GAMES) expect(ACHIEVEMENTS.some((a) => a.id === id)).toBe(true);
  });
});
