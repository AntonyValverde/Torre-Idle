import { useEffect, useState } from 'react';
import { cityLink, type CitySnapshot } from '../game/cities';
import { now } from '../game/clock';
import { currentUid, fetchCity, type PublicCity } from '../game/cloud';
import { eraName } from '../game/economy';
import { fmt } from '../game/format';
import { useGame } from '../game/store';
import { ago } from '../admin/metrics';
import { CityScene } from './CityScene';
import { GameScreen } from './Modal';
import { SEASON_LABEL, WEATHER_LABEL, seasonAt, weatherAt } from './weather';

/** Comparte el enlace de tu ciudad (menú de compartir del móvil o, si no hay, lo copia). */
export async function shareCity(uid: string, name: string) {
  const url = cityLink(uid);
  const toast = useGame.getState().toast;
  const text = `Visita mi ciudad en Torre Idle: ${name}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Torre Idle', text, url });
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
  const [city, setCity] = useState<(CitySnapshot & { updatedAt?: number | null }) | null | undefined>(given);
  const mine = uid === currentUid();
  const t = now();
  const season = seasonAt(t);

  useEffect(() => {
    if (given) return;
    let alive = true;
    fetchCity(uid)
      .then((c: PublicCity | null) => alive && setCity(c))
      .catch(() => alive && setCity(null));
    return () => {
      alive = false;
    };
  }, [uid, given]);

  return (
    <GameScreen title={city ? `Ciudad de ${city.name}` : 'De visita'} right={mine ? 'Tu ciudad' : null} onClose={onClose}>
      <div className="visit-wrap">
        {city === undefined && <p className="empty">Cargando la ciudad…</p>}
        {city === null && (
          <div className="daily-done">
            <div className="big-emoji">🏚️</div>
            <h2>Esta ciudad aún no abrió sus puertas</h2>
            <p className="muted">El alcalde tiene que abrir el juego con la última versión para que se pueda visitar.</p>
          </div>
        )}
        {city && (
          <>
            <div className="scene-wrap visit-scene">
              <CityScene visit={{ layout: city.layout, era: city.era, buildings: city.buildings }} />
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
            </div>
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
