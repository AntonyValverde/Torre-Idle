import { useEffect, useRef, useState } from 'react';
import { ALL_TILES, CENTER, SHIELD_MS, banditGarrison, garrisonAt, isCapitalSlot, neighbors, parseTile, type Tile } from '../../game/conquest';
import { hashString } from '../../minigames/rng';

// Tablero de la Conquista: hexágonos con relieve y terreno, fronteras del color de cada alcalde,
// campamentos de bandidos, castillos en las capitales y la Torre central. Solo dibuja: las reglas del
// juego están en conquest.ts y la interacción en ConquestView.

/** Radio de un hexágono en el dibujo. */
const SIZE = 10;
const SQ3 = Math.sqrt(3);
/** Grosor del relieve (lo que asoma por debajo de cada ficha). */
const DEPTH = 1.8;

export const hexCenter = (id: string) => {
  const h = parseTile(id)!;
  return { x: SIZE * SQ3 * (h.q + h.r / 2), y: SIZE * 1.5 * h.r };
};

const corners = (k: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: SIZE * k * Math.cos(a), y: SIZE * k * Math.sin(a) };
  });
const pts = (c: { x: number; y: number }[]) => c.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
const HEX = pts(corners(0.97));
const INNER = corners(0.86);

const VIEW = `${-SIZE * SQ3 * 4.75} ${-SIZE * 7.3} ${SIZE * SQ3 * 9.5} ${SIZE * 14.8}`;

type Terrain = 'grass' | 'forest' | 'hills' | 'meadow';
const TERRAIN: Record<Terrain, string> = { grass: '#3b5240', forest: '#2e4536', hills: '#4d4a3c', meadow: '#44573f' };
const terrainOf = (id: string): Terrain => (['grass', 'forest', 'hills', 'meadow', 'grass', 'forest'] as Terrain[])[hashString('hex:' + id) % 6];

/** Lados de un territorio que dan a otro dueño (o a nadie): por ahí pasa la frontera. */
function borderEdges(id: string, owner: string, tiles: Map<string, Tile>): string[] {
  const c = hexCenter(id);
  const out: string[] = [];
  const ns = neighbors(id);
  // Los 6 lados; un lado sin vecino (borde del mapa) también es frontera
  for (let i = 0; i < 6; i++) {
    const a = INNER[i];
    const b = INNER[(i + 1) % 6];
    // Centro del vecino que hay al otro lado de este lado
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const k = (SIZE * SQ3) / Math.hypot(mx, my);
    const n = ns.find((x) => {
      const p = hexCenter(x);
      return Math.hypot(p.x - (c.x + mx * k), p.y - (c.y + my * k)) < SIZE * 0.3;
    });
    if (!n || tiles.get(n)?.owner !== owner)
      out.push(`M${(c.x + a.x).toFixed(2)} ${(c.y + a.y).toFixed(2)}L${(c.x + b.x).toFixed(2)} ${(c.y + b.y).toFixed(2)}`);
  }
  return out;
}

/** Adorno del terreno (árboles o colinas), pequeño y arriba, para dejar sitio al número. */
function Decor({ kind }: { kind: Terrain }) {
  if (kind === 'forest')
    return (
      <g className="cq-decor">
        <path d="M-5 -2.2l1.6 -3.4l1.6 3.4z" />
        <path d="M-1.6 -3.4l1.8 -3.8l1.8 3.8z" />
        <path d="M2.4 -2l1.5 -3.2l1.5 3.2z" />
      </g>
    );
  if (kind === 'hills')
    return (
      <g className="cq-decor hills">
        <path d="M-5.5 -1.8q2.6 -4.6 5.2 0z" />
        <path d="M-0.6 -2.2q2.9 -5 5.8 0z" />
      </g>
    );
  if (kind === 'meadow')
    return (
      <g className="cq-decor meadow">
        <circle cx={-3.2} cy={-3.6} r={0.7} />
        <circle cx={0.4} cy={-5} r={0.6} />
        <circle cx={3.4} cy={-3.2} r={0.7} />
      </g>
    );
  return null;
}

interface Burst {
  id: string;
  key: number;
  hue: number;
}

let burstKey = 0;

export function ConquestBoard({
  tiles,
  me,
  t,
  sel,
  src,
  near,
  arrow,
  hueOf,
  onTap,
}: {
  tiles: Map<string, Tile>;
  me: string;
  t: number;
  sel: string | null;
  src: string | null;
  /** Territorios que se pueden atacar ahora (borde claro que late). */
  near: Set<string>;
  /** Flecha del ataque que se está preparando. */
  arrow: { from: string; to: string } | null;
  /** Tono del color de cada alcalde. */
  hueOf: (uid: string) => number;
  onTap: (id: string) => void;
}) {
  // Destello cuando un territorio cambia de dueño (lo veas tú o llegue de otro alcalde)
  const prev = useRef<Map<string, string> | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  // Temporizadores de los destellos en marcha: solo se cancelan al desmontar (cada tanda tiene el suyo)
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);
  useEffect(() => {
    const now = new Map([...tiles].map(([id, x]) => [id, x.owner]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const fresh: Burst[] = [];
    for (const [id, owner] of now) if (before.get(id) !== owner) fresh.push({ id, key: ++burstKey, hue: hueOf(owner) });
    if (!fresh.length) return;
    setBursts((b) => [...b, ...fresh]);
    const keys = new Set(fresh.map((f) => f.key));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setBursts((b) => b.filter((x) => !keys.has(x.key)));
    }, 1300);
    timers.current.add(timer);
  }, [tiles, hueOf]);

  const owned = (id: string) => tiles.get(id);
  const arrowPath = (() => {
    if (!arrow) return null;
    const a = hexCenter(arrow.from);
    const b = hexCenter(arrow.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Un poco curvada, como en los mapas de batalla
    // Sale del borde del origen y se queda en el borde del objetivo, sin tapar su número
    const s = { x: a.x + ux * 2.5, y: a.y + uy * 2.5 };
    const e = { x: b.x - ux * 6.2, y: b.y - uy * 6.2 };
    const m = { x: (s.x + e.x) / 2 - uy * 3, y: (s.y + e.y) / 2 + ux * 3 };
    return `M${s.x.toFixed(2)} ${s.y.toFixed(2)}Q${m.x.toFixed(2)} ${m.y.toFixed(2)} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  })();

  return (
    <svg className="conquest-map" viewBox={VIEW} role="img" aria-label="Mapa de la conquista">
      <defs>
        <radialGradient id="cq-sea" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#1c3d6e" />
          <stop offset="100%" stopColor="#0a1530" />
        </radialGradient>
        <radialGradient id="cq-gold" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#f6d77a" />
          <stop offset="100%" stopColor="#a67c1f" />
        </radialGradient>
        <linearGradient id="cq-shade-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
        <pattern id="cq-waves" width="14" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 5q3.5 -3 7 0t7 0" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
        </pattern>
        <marker id="cq-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ffc23d" />
        </marker>
        <filter id="cq-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect x="-200" y="-200" width="400" height="400" fill="url(#cq-sea)" />
      <rect x="-200" y="-200" width="400" height="400" fill="url(#cq-waves)" />

      {/* Relieve: el canto de cada ficha, dibujado antes que todas las caras */}
      <g className="cq-depth">
        {ALL_TILES.map((id) => {
          const c = hexCenter(id);
          return <polygon key={id} points={HEX} transform={`translate(${c.x.toFixed(2)} ${(c.y + DEPTH).toFixed(2)})`} />;
        })}
      </g>

      {/* Brillo de la Torre central */}
      <circle cx={0} cy={0} r={11} fill="#ffcf4a" opacity={0.35} filter="url(#cq-glow)" className="cq-center-glow" />

      {ALL_TILES.map((id) => {
        const c = hexCenter(id);
        const tile = owned(id);
        const reserved = !tile && isCapitalSlot(id);
        const terrain = terrainOf(id);
        const hue = tile ? hueOf(tile.owner) : 0;
        const mine = tile?.owner === me;
        const fill = tile ? `hsl(${hue} ${mine ? 70 : 52}% ${mine ? 44 : 38}%)` : reserved ? '#1b2340' : id === CENTER ? 'url(#cq-gold)' : TERRAIN[terrain];
        const g = tile ? Math.floor(garrisonAt(tile, t)) : reserved ? null : banditGarrison(id);
        const shield = tile && !tile.capital && t < tile.ct + SHIELD_MS;
        const cls = ['conquest-hex', sel === id && 'sel', src === id && 'src', near.has(id) && 'near', reserved && 'reserved', mine && 'mine', tile && 'owned']
          .filter(Boolean)
          .join(' ');
        return (
          <g key={id} data-tile={id} className={cls} transform={`translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`} onClick={() => onTap(id)}>
            <polygon points={HEX} fill={fill} className="cq-face" />
            {/* Luz arriba, sombra abajo: da volumen a la ficha */}
            <polygon points={HEX} className="cq-shade" />
            {!reserved && id !== CENTER && !tile?.capital && <Decor kind={terrain} />}
            {near.has(id) && <polygon points={HEX} className="cq-near" />}
            {reserved && (
              <text y={1.6} fontSize={4.2} textAnchor="middle" className="cq-reserved">
                ⚑
              </text>
            )}
            {tile?.capital && (
              <g className="cq-capital">
                <path d="M0 -9.2v-3.6" stroke="#e8e8e8" strokeWidth={0.45} />
                <path d="M0 -12.8l3.4 0.9l-3.4 0.9z" fill={`hsl(${hue} 85% 62%)`} />
                <text y={-2.6} fontSize={6.6} textAnchor="middle">
                  🏰
                </text>
              </g>
            )}
            {id === CENTER && (
              <text y={-2.4} fontSize={6.4} textAnchor="middle" className="cq-crown">
                👑
              </text>
            )}
            {!tile && !reserved && id !== CENTER && (
              <text x={4.4} y={-2.2} fontSize={3.2} textAnchor="middle" className="cq-camp">
                ⛺
              </text>
            )}
            {shield && <circle r={8.2} className="cq-shield" />}
            {shield && (
              <text x={5.6} y={-3.6} fontSize={3.6} textAnchor="middle">
                🛡️
              </text>
            )}
            {g !== null && (
              <g
                className={`cq-badge${tile ? '' : ' bandit'}${id === CENTER ? ' center' : ''}`}
                transform={`translate(0 ${tile?.capital || id === CENTER ? 4.4 : 2.6})`}
              >
                <rect x={-4.8} y={-2.9} width={9.6} height={5.4} rx={2.7} />
                <text y={1.35} fontSize={3.7} textAnchor="middle">
                  {g}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Fronteras: cada alcalde, su país */}
      <g className="cq-borders">
        {[...tiles.values()].map((tile) => {
          const mine = tile.owner === me;
          const d = borderEdges(tile.id, tile.owner, tiles);
          return d.length ? (
            <path key={tile.id} d={d.join('')} stroke={`hsl(${hueOf(tile.owner)} 90% ${mine ? 72 : 66}%)`} className={mine ? 'mine' : ''} />
          ) : null;
        })}
      </g>

      {arrowPath && <path d={arrowPath} className="cq-arrow" markerEnd="url(#cq-head)" />}

      {bursts.map((b) => {
        const c = hexCenter(b.id);
        return (
          <g key={b.key} transform={`translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`} className="cq-burst" style={{ color: `hsl(${b.hue} 90% 65%)` }}>
            <circle r={9} />
            <polygon points={HEX} />
          </g>
        );
      })}
    </svg>
  );
}
