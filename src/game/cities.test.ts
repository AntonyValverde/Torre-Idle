import { describe, expect, it } from 'vitest';
import { cityFromUrl, cityLayout, cityLink, citySnapshot, parseCups, parseDecos, parseLayout } from './cities';
import { now } from './clock';
import { BUILDINGS, boostMultiplier } from './economy';
import { newState, normalize } from './state';
import { useGame } from './store';

describe('ciudades públicas', () => {
  it('el plano guarda el tamaño de cada tipo de edificio (0 a 4)', () => {
    const layout = cityLayout({ choza: 1, casa: 3, tienda: 7, fabrica: 8, banco: 500 });
    expect(layout.split(',')).toHaveLength(BUILDINGS.length);
    expect(layout.startsWith('1,2,3,4,4,0')).toBe(true);
    expect(parseLayout(layout)).toBe(layout);
  });

  it('rechaza planos mal formados', () => {
    expect(parseLayout('1,2,9')).toBeNull();
    expect(parseLayout('<script>')).toBeNull();
    expect(parseLayout(42)).toBeNull();
    expect(parseLayout(Array(40).fill(1).join(','))).toBeNull();
  });

  it('la foto de la ciudad solo lleva lo que se ve al visitarla', () => {
    const s = { ...newState(0), name: 'Ana', era: 3, stars: 12.7, allTimeEarned: 1234.9, buildings: { casa: 10, tienda: 2 } };
    expect(citySnapshot(s)).toEqual({ name: 'Ana', era: 3, layout: cityLayout(s.buildings), buildings: 12, earned: 1234, stars: 12, cups: '0,0,0,0' });
    expect(citySnapshot({ ...s, cup: { ...s.cup, gold: 2, bronze: 1, seasons: 1 } }).cups).toBe('2,0,1,1');
    // Las ciudades publicadas antes de las temporadas traen solo tres números
    expect(parseCups('2,0,1')).toEqual([2, 0, 1, 0]);
    expect(parseCups('2,0,1,3')).toEqual([2, 0, 1, 3]);
    expect(parseCups('<b>')).toEqual([0, 0, 0, 0]);
    expect(parseCups(undefined)).toEqual([0, 0, 0, 0]);
  });

  it('los cosméticos del pase viajan en la foto y se leen con cuidado', () => {
    const s = newState(0);
    expect(citySnapshot(s).deco).toBeUndefined();
    expect(citySnapshot({ ...s, pass: { ...s.pass, decos: ['zeppelin', 'aurora'] } }).deco).toBe('zeppelin,aurora');
    expect(parseDecos('zeppelin,aurora')).toEqual(['zeppelin', 'aurora']);
    // Ids que esta versión no conoce se ignoran; cadenas raras no pasan
    expect(parseDecos('zeppelin,futuro')).toEqual(['zeppelin']);
    expect(parseDecos('Zeppelin')).toEqual([]);
    expect(parseDecos('<b>')).toEqual([]);
    expect(parseDecos(undefined)).toEqual([]);
  });

  it('el enlace para compartir lleva el UID y se lee al abrir el juego', () => {
    const link = cityLink('AbC123xyz0987', 'https://torre-idle.vercel.app');
    expect(link).toBe('https://torre-idle.vercel.app/?ciudad=AbC123xyz0987');
    expect(cityFromUrl('?ciudad=AbC123xyz0987')).toBe('AbC123xyz0987');
    expect(cityFromUrl('?ciudad=../../users/x')).toBeNull();
    expect(cityFromUrl('')).toBeNull();
  });
});

describe('recompensas de los juegos nuevos', () => {
  it('Bomberos da monedas, gemas según los puntos y guarda el récord', () => {
    useGame.getState().init(newState(Date.now()));
    const r = useGame.getState().rewardFire(130);
    expect(r.gems).toBe(2);
    expect(r.newBest).toBe(true);
    expect(r.coins).toBeGreaterThan(0);
    expect(useGame.getState().s.fireBest).toBe(130);
    expect(useGame.getState().rewardFire(20).newBest).toBe(false);
    expect(useGame.getState().s.fireBest).toBe(130);
  });

  it('el boost del Metro se multiplica con los demás', () => {
    const t = Date.now();
    useGame.getState().init({ ...newState(t), boosts: [{ k: 'stack', m: 2, u: t + 600_000 }] });
    const r = useGame.getState().rewardMetro(60);
    expect(r.mult).toBe(2);
    expect(boostMultiplier(useGame.getState().s, now())).toBe(4);
    expect(useGame.getState().s.metroBest).toBe(60);
  });

  it('el Plan verde tiene su propia racha y suma a la liga', () => {
    useGame.getState().init({ ...newState(Date.now()), parks: { last: '2026-10-02', streak: 2, bestStreak: 5 } });
    const r = useGame.getState().completeParks('2026-10-03', 30, 30);
    expect(r?.streak).toBe(3);
    expect(useGame.getState().completeParks('2026-10-03', 30, 30)).toBeNull();
    const s = useGame.getState().s;
    expect(s.parks).toEqual({ last: '2026-10-03', streak: 3, bestStreak: 5 });
    expect(s.daily.last).toBeNull();
  });

  it('las partidas antiguas reciben los campos nuevos', () => {
    const s = normalize({ coins: 5, thiefBest: 9 }, 0);
    expect(s.fireBest).toBe(0);
    expect(s.metroBest).toBe(0);
    expect(s.parks).toEqual({ last: null, streak: 0, bestStreak: 0 });
  });
});
