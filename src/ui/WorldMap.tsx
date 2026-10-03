import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { track } from '../firebase';
import { citySnapshot } from '../game/cities';
import { dateKey, now } from '../game/clock';
import { currentUid, fetchWorldCities, type PublicCity } from '../game/cloud';
import { eraHue, eraName } from '../game/economy';
import { fmt } from '../game/format';
import { giftBlock } from '../game/social';
import { useGame } from '../game/store';
import {
  LAND,
  WORLD_H,
  WORLD_W,
  clampView,
  cityPosition,
  clusterPoints,
  type Cluster,
  isDormant,
  landDecor,
  markerRadius,
  zoomView,
  type View,
} from '../game/world';
import { ago } from '../admin/metrics';
import { CityList } from './Gifts';
import { ConquestView } from './conquest/ConquestView';
import { GameScreen } from './Modal';

const DECOR = landDecor();
/** Hasta cuántos píxeles se puede mover el dedo para que cuente como toque y no como arrastre. */
const TAP_SLOP = 8;
/** Con pocas ciudades se ven todos los nombres; con muchas, solo al acercarse. */
const LABELS_ALWAYS = 40;
/** Ciudades a menos de tantos píxeles en pantalla se dibujan como un grupo. */
const CLUSTER_PX = 32;
const bubbleRadius = (c: Cluster<Marker>) => (c.items.length > 1 ? 12 + Math.min(8, c.items.length) : markerRadius(c.items[0].city.era));

interface Marker {
  city: PublicCity;
  x: number;
  y: number;
  mine: boolean;
}

/** Mapa del mundo con todas las ciudades (y su lista). Tocar una ciudad deja visitarla. */
export function WorldScreen({ onVisit, onClose }: { onVisit: (uid: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'map' | 'list' | 'conquest'>('map');
  const [cities, setCities] = useState<PublicCity[] | null | 'error'>(null);
  const [attempt, setAttempt] = useState(0);
  const me = currentUid();
  const name = useGame((st) => st.s.name);

  useEffect(() => {
    let alive = true;
    setCities(null);
    fetchWorldCities(attempt > 0).then(
      (c) => alive && setCities(c),
      (e) => {
        console.warn(e);
        if (alive) setCities('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => track('world_open'), []);

  // Tu ciudad siempre sale, aunque aún no se haya publicado o no esté entre las más recientes
  const all = useMemo<PublicCity[] | null | 'error'>(() => {
    if (!Array.isArray(cities) || !me || cities.some((c) => c.uid === me)) return cities;
    return [{ ...citySnapshot(useGame.getState().s), uid: me, updatedAt: now() }, ...cities];
    // `name` está para redibujar tu ciudad si cambias de nombre con el mapa abierto
  }, [cities, me, name]);

  const count = Array.isArray(all) ? all.length : 0;

  return (
    <GameScreen title="Mapa del mundo" right={count > 0 ? `🏙️ ${count}` : null} onClose={onClose}>
      <div className="world-wrap">
        <div className="segmented world-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'map'} className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')}>
            🗺️ Mapa
          </button>
          <button role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>
            📋 Lista
          </button>
          <button role="tab" aria-selected={mode === 'conquest'} className={mode === 'conquest' ? 'active' : ''} onClick={() => setMode('conquest')}>
            ⚔️ Conquista
          </button>
        </div>
        {mode === 'conquest' ? (
          <div className="world-list">
            <ConquestView onVisit={onVisit} />
          </div>
        ) : mode === 'list' ? (
          <div className="world-list">
            <CityList cities={all} onVisit={onVisit} />
          </div>
        ) : all === 'error' ? (
          <div className="daily-done">
            <div className="big-emoji">📡</div>
            <h2>No se pudo cargar el mapa</h2>
            <p className="muted">Revisa tu conexión e inténtalo de nuevo.</p>
            <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={() => setAttempt((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        ) : (
          <WorldMapView cities={all ?? []} loading={all === null} me={me} onVisit={onVisit} />
        )}
      </div>
    </GameScreen>
  );
}

function WorldMapView({ cities, loading, me, onVisit }: { cities: PublicCity[]; loading: boolean; me: string | null; onVisit: (uid: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const social = useGame((st) => st.s.social);
  const t = now();

  const markers = useMemo<Marker[]>(
    () =>
      cities
        .map((city) => ({ city, ...cityPosition(city.uid), mine: city.uid === me }))
        // La tuya, encima de las demás
        .sort((a, b) => Number(a.mine) - Number(b.mine)),
    [cities, me],
  );
  const mine = markers.find((m) => m.mine);

  // Tamaño de la pantalla: la vista del mapa tiene sus mismas proporciones
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.w > 0 ? size.h / size.w : WORLD_H / WORLD_W;

  // Vista inicial: el mapa llenando la pantalla (sin franjas de mar vacías), centrada en tu ciudad.
  // Al girar la pantalla se reajusta.
  useEffect(() => {
    if (!size.w) return;
    setView((v) => {
      if (v) return clampView(v, aspect);
      const w = Math.min(WORLD_W, WORLD_H / aspect);
      const cx = mine ? mine.x : WORLD_W / 2;
      const cy = mine ? mine.y : WORLD_H / 2;
      return clampView({ x: cx - w / 2, y: cy - (w * aspect) / 2, w, h: w * aspect }, aspect);
    });
  }, [size.w, size.h, aspect, mine]);

  // Rueda del ratón: acerca o aleja hacia el cursor
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        const r = el.getBoundingClientRect();
        const cx = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const cy = v.y + ((e.clientY - r.top) / r.height) * v.h;
        return zoomView(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy, r.height / r.width);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Arrastrar mueve el mapa, pellizcar hace zoom y un toque elige la ciudad más cercana
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const kNow = view && size.w ? view.w / size.w : 1;
  // Las ciudades que quedarían a menos de CLUSTER_PX en pantalla se agrupan (la tuya y la elegida, nunca)
  const clusters = clusterPoints(
    markers.map((m) => ({ ...m, alone: m.mine || m.city.uid === selected })),
    CLUSTER_PX * kNow,
  );
  const gesture = useRef({ moved: 0, pinch: 0 });

  const toWorld = (clientX: number, clientY: number, v: View) => {
    const r = box.current!.getBoundingClientRect();
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  };

  const onDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: 0 };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = TAP_SLOP + 1;
    }
  };

  const onMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view || !size.w) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinch > 0 && dist > 0) {
        const mid = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2, view);
        setView(zoomView(view, dist / gesture.current.pinch, mid.x, mid.y, aspect));
      }
      gesture.current.pinch = dist;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved <= TAP_SLOP) return;
    const k = view.w / size.w;
    setView(clampView({ ...view, x: view.x - dx * k, y: view.y - dy * k }, aspect));
  };

  const onUp = (e: ReactPointerEvent) => {
    const wasTap = pointers.current.size === 1 && gesture.current.moved <= TAP_SLOP;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = 0;
    if (!wasTap || !view || !size.w) return;
    const p = toWorld(e.clientX, e.clientY, view);
    const k = view.w / size.w;
    let best: Cluster<Marker> | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      // Se perdona un poco de puntería alrededor del marcador
      if (d <= (bubbleRadius(c) + 14) * k && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    // Un grupo de ciudades: se acerca hasta que se separan
    if (best && best.items.length > 1) {
      setView(zoomView(view, 2.2, best.x, best.y, aspect));
      setSelected(null);
      return;
    }
    setSelected(best ? best.items[0].city.uid : null);
  };

  const zoomBy = (factor: number) => {
    if (!view) return;
    setView(zoomView(view, factor, view.x + view.w / 2, view.y + view.h / 2, aspect));
  };

  const centerOnMe = () => {
    if (!view || !mine) return;
    setView(clampView({ ...view, x: mine.x - view.w / 2, y: mine.y - view.h / 2 }, aspect));
    setSelected(mine.city.uid);
  };

  const k = view && size.w ? view.w / size.w : 1;
  const labels = markers.length <= LABELS_ALWAYS || k < 0.75;
  const sel = markers.find((m) => m.city.uid === selected) ?? null;
  const day = dateKey(t);
  const canGift = sel && !sel.mine && !giftBlock({ social }, sel.city.uid, day, me);

  return (
    <div className="world-map-area">
      <div
        ref={box}
        className="world-map"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={`Mapa del mundo con ${markers.length} ${markers.length === 1 ? 'ciudad' : 'ciudades'}`}
      >
        {view && (
          <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} width="100%" height="100%">
            <defs>
              <radialGradient id="world-sea" cx="50%" cy="45%" r="75%">
                <stop offset="0%" stopColor="#1d4f86" />
                <stop offset="100%" stopColor="#0b1f3d" />
              </radialGradient>
            </defs>
            <rect x={-WORLD_W} y={-WORLD_H} width={WORLD_W * 3} height={WORLD_H * 3} fill="#0b1f3d" />
            <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="url(#world-sea)" />
            <g className="world-grid">
              {Array.from({ length: Math.floor(WORLD_W / 100) - 1 }, (_, i) => (
                <line key={`v${i}`} x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={WORLD_H} />
              ))}
              {Array.from({ length: Math.floor(WORLD_H / 100) - 1 }, (_, i) => (
                <line key={`h${i}`} x1={0} y1={(i + 1) * 100} x2={WORLD_W} y2={(i + 1) * 100} />
              ))}
            </g>
            {/* Costa (un poco más grande y clara) y tierra encima: los círculos se funden en continentes */}
            <g className="world-shore">
              {LAND.map((b, i) => (
                <circle key={i} cx={b.x} cy={b.y} r={b.r + 7} />
              ))}
            </g>
            <g className="world-land">
              {LAND.map((b, i) => (
                <circle key={i} cx={b.x} cy={b.y} r={b.r} />
              ))}
            </g>
            <g className="world-decor">
              {DECOR.map((d, i) =>
                d.kind === 'tree' ? (
                  <circle key={i} cx={d.x} cy={d.y} r={5} className="tree" />
                ) : (
                  <path key={i} d={`M${d.x - 9} ${d.y + 6}L${d.x} ${d.y - 9}L${d.x + 9} ${d.y + 6}z`} className="mountain" />
                ),
              )}
            </g>
            {clusters.map((c) => {
              if (c.items.length > 1) {
                const r = bubbleRadius(c) * k;
                return (
                  <g key={c.items[0].city.uid} className="world-cluster">
                    <circle cx={c.x} cy={c.y} r={r} strokeWidth={2 * k} />
                    <text x={c.x} y={c.y + 4.5 * k} fontSize={13 * k} textAnchor="middle">
                      {c.items.length}
                    </text>
                  </g>
                );
              }
              const m = c.items[0];
              const r = markerRadius(m.city.era) * k;
              const asleep = isDormant(m.city.updatedAt, t);
              const hue = eraHue(m.city.era);
              return (
                <g key={m.city.uid} className={`world-city${asleep ? ' asleep' : ''}${m.mine ? ' mine' : ''}`}>
                  {m.mine && <circle cx={m.x} cy={m.y} r={r + 7 * k} className="world-me-ring" strokeWidth={2 * k} />}
                  {m.city.uid === selected && <circle cx={m.x} cy={m.y} r={r + 4 * k} className="world-sel" strokeWidth={2.5 * k} />}
                  <circle cx={m.x} cy={m.y} r={r} fill={`hsl(${hue} 80% 60%)`} stroke="#0b1020" strokeWidth={1.5 * k} />
                  <circle cx={m.x} cy={m.y} r={r * 0.4} fill="#fff" opacity={0.85} />
                  {(labels || m.mine || m.city.uid === selected) && (
                    <text x={m.x} y={m.y + r + 13 * k} fontSize={12 * k} strokeWidth={3 * k} textAnchor="middle" className="world-label">
                      {m.mine ? `${m.city.name} (tú)` : m.city.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {loading && <div className="world-msg">Buscando ciudades…</div>}
        {!loading && markers.length <= 1 && <div className="world-msg">Aún no hay más ciudades. ¡Comparte la tuya e invita a tus amigos!</div>}
        <div className="world-controls">
          <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(1.4)} aria-label="Acercar">
            ＋
          </button>
          <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(1 / 1.4)} aria-label="Alejar">
            －
          </button>
          {mine && (
            <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={centerOnMe} aria-label="Ir a mi ciudad">
              📍
            </button>
          )}
        </div>
      </div>
      {sel ? (
        <div className="card world-card">
          <span className="world-card-dot" style={{ background: `hsl(${eraHue(sel.city.era)} 80% 60%)` }} />
          <div className="world-card-main">
            <b>{sel.mine ? `${sel.city.name} (tu ciudad)` : sel.city.name}</b>
            <small className="muted">
              Era {sel.city.era} · {eraName(sel.city.era)} · ⭐ {fmt(sel.city.stars)}
              {(sel.city.gifts ?? 0) > 0 && ` · ❤️ ${fmt(sel.city.gifts ?? 0)}`}
            </small>
            <small className="muted">
              {sel.city.updatedAt ? `Activa ${ago(sel.city.updatedAt, t)}` : 'Sin actividad reciente'}
              {canGift && ' · 🎁 Puedes dejarle un regalo'}
            </small>
          </div>
          <button className="btn primary" onClick={() => onVisit(sel.city.uid)}>
            {sel.mine ? '👀 Ver' : 'Visitar'}
          </button>
        </div>
      ) : (
        <p className="hint world-hint">Arrastra para moverte, pellizca para acercarte y toca una ciudad para visitarla.</p>
      )}
    </div>
  );
}
