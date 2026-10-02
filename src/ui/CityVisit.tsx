import { useEffect, useState } from 'react';
import { cityLink, parseCups, type CitySnapshot } from '../game/cities';
import { now } from '../game/clock';
import { currentUid, fetchCity, type PublicCity } from '../game/cloud';
import { eraName } from '../game/economy';
import { fmt } from '../game/format';
import { useGame } from '../game/store';
import { ago } from '../admin/metrics';
import { CityScene } from './CityScene';
import { GiftButton } from './Gifts';
import { GameScreen } from './Modal';
import { SEASON_LABEL, WEATHER_LABEL, seasonAt, weatherAt } from './weather';

/** Comparte el enlace de tu ciudad (menú de compartir del móvil o, si no hay, lo copia). */
export async function shareCity(uid: string, name: string) {
  const url = cityLink(uid);
  const toast = useGame.getState().toast;
  const text = `Visita mi ciudad en Infinite City: ${name}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Infinite City', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('🔗 Enlace copiado. ¡Compártelo con tus amigos!');
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    toast(`🔗 ${url}`);
  }
}

/**
 * Ciudad de otro jugador. Se puede pasar ya cargada (`city`, p. ej. desde el panel de administración)
 * o solo el `uid` y se lee de la nube.
 */
export function CityVisit({ uid, city: given, onClose }: { uid: string; city?: CitySnapshot; onClose: () => void }) {
  // undefined = cargando, null = no existe, 'error' = no se pudo leer (sin conexión, etc.)
  const [city, setCity] = useState<(CitySnapshot & { updatedAt?: number | null }) | null | undefined | 'error'>(given);
  const [attempt, setAttempt] = useState(0);
  const mine = uid === currentUid();
  const t = now();
  const season = seasonAt(t);

  useEffect(() => {
    if (given) return;
    let alive = true;
    setCity(undefined);
    fetchCity(uid)
      .then((c: PublicCity | null) => alive && setCity(c))
      .catch((e) => {
        console.warn(e);
        if (alive) setCity('error');
      });
    return () => {
      alive = false;
    };
  }, [uid, given, attempt]);

  return (
    <GameScreen title={city && city !== 'error' ? `Ciudad de ${city.name}` : 'De visita'} right={mine ? 'Tu ciudad' : null} onClose={onClose}>
      <div className="visit-wrap">
        {city === undefined && <p className="empty">Cargando la ciudad…</p>}
        {city === 'error' && (
          <div className="daily-done">
            <div className="big-emoji">📡</div>
            <h2>No se pudo cargar la ciudad</h2>
            <p className="muted">Revisa tu conexión e inténtalo de nuevo.</p>
            <button className="btn primary" style={{ flex: '0 0 auto', padding: '12px 28px' }} onClick={() => setAttempt((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        )}
        {city === null && (
          <div className="daily-done">
            <div className="big-emoji">🏚️</div>
            <h2>Esta ciudad aún no abrió sus puertas</h2>
            <p className="muted">El alcalde tiene que abrir el juego con la última versión para que se pueda visitar.</p>
          </div>
        )}
        {city && city !== 'error' && (
          <>
            <div className="scene-wrap visit-scene">
              <CityScene visit={{ layout: city.layout, era: city.era, buildings: city.buildings, cups: parseCups(city.cups) }} />
              <div className="scene-badge">
                Era {city.era} · {eraName(city.era)}
              </div>
              <div className="scene-badge scene-weather">
                {WEATHER_LABEL[weatherAt(t)]}
                {season && ` · ${SEASON_LABEL[season]}`}
              </div>
            </div>
            <div className="stats-grid">
              <div>
                <small>Edificios</small>
                <b>{fmt(city.buildings)}</b>
              </div>
              <div>
                <small>Monedas ganadas</small>
                <b>{fmt(city.earned)}</b>
              </div>
              <div>
                <small>Estrellas</small>
                <b>{fmt(city.stars)} ⭐</b>
              </div>
              <div>
                <small>Regalos</small>
                <b>❤️ {fmt(city.gifts ?? 0)}</b>
              </div>
            </div>
            {!mine && <GiftButton uid={uid} cityName={city.name} />}
            {parseCups(city.cups).some((n) => n > 0) && (
              <div className="card cup-showcase">
                <b>Vitrina de la Copa de Alcaldes</b>
                <div className="cup-showcase-row">
                  {(['🏆', '🥈', '🥉', '🚩'] as const).map((e, i) => (
                    <span key={e}>
                      {e} <b>{parseCups(city.cups)[i]}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="hint">
              {mine ? 'Así ven tu ciudad los demás jugadores.' : 'Toca la ciudad para saludar 👋.'}
              {city.updatedAt ? ` Actualizada ${ago(city.updatedAt, t)}.` : ''}
            </p>
            {mine && (
              <button className="btn primary" onClick={() => shareCity(uid, city.name)}>
                🔗 Compartir mi ciudad
              </button>
            )}
          </>
        )}
      </div>
    </GameScreen>
  );
}
