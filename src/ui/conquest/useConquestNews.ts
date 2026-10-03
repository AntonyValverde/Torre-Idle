import { useEffect } from 'react';
import { cloudEnabled, track } from '../../firebase';
import { now } from '../../game/clock';
import { currentUid } from '../../game/cloud';
import { pendingSeason, seasonOf } from '../../game/conquest';
import { fetchFinalStandings, fetchReports, myWorld } from '../../game/conquestCloud';
import { useGame } from '../../game/store';
import { celebrate } from '../celebrate';
import { sfx, vibrate } from '../haptics';

/** Cada cuánto se miran las novedades de la Conquista mientras se juega. */
const EVERY_MS = 5 * 60_000;

/**
 * Novedades de la Conquista en segundo plano (como el buzón de regalos):
 *  - Al terminar una temporada, cobra su premio según la clasificación final.
 *  - Apunta en qué mundo juegas esta semana (aunque te unieras desde otro dispositivo).
 *  - Avisa de los partes de batalla: quién te quitó territorios mientras no estabas.
 */
export function useConquestNews(ready: boolean) {
  useEffect(() => {
    if (!ready || !cloudEnabled) return;
    let busy = false;
    let lookedUp = '';
    const notify = (fresh: { name: string }[]) => {
      if (!fresh.length) return;
      const names = [...new Set(fresh.map((r) => r.name))];
      const who = names.slice(0, 2).join(' y ') + (names.length > 2 ? ` y ${names.length - 2} más` : '');
      useGame.getState().toast(`⚔️ ${who} te ${fresh.length === 1 ? 'quitó un territorio' : `quitaron ${fresh.length} territorios`}. ¡Recupéralos en el Mapa del mundo!`);
      vibrate([30, 40, 30]);
    };
    const check = async () => {
      if (busy || document.visibilityState !== 'visible' || !currentUid()) return;
      busy = true;
      try {
        const st = useGame.getState();
        const c = st.s.conquest;
        const week = seasonOf(now()).week;

        // 1. Temporada terminada sin cobrar: la recordada en `prev` (si la pestaña ya apuntó la nueva) o la
        //    actual si ya es vieja. Primero sus últimos partes, luego el premio.
        const old = pendingSeason(c, week);
        if (old) {
          const me = currentUid();
          notify(st.receiveReports(await fetchReports(old.week, old.w, c.seenAt)));
          const { rows, size } = await fetchFinalStandings(old.week, old.w);
          const i = rows.findIndex((r) => r.uid === me);
          if (i >= 0) {
            const prize = st.claimConquest(old.week, i + 1, size, rows[i].points);
            if (prize) {
              st.toast(`⚔️ Terminó la Conquista: ${i + 1}º de ${size}. +${prize.gems} 💎${prize.tickets ? ` · +${prize.tickets} 🎟️` : ''}`);
              sfx('win');
              if (prize.podium) celebrate(prize.win ? 6 : 3);
              track('conquest_season', { rank: i + 1, size, points: rows[i].points });
            }
          } else {
            // No saliste en la clasificación: se da por cerrada para no volver a consultarla cada 5 min
            st.skipConquest(old.week);
          }
        }

        // 2. Mundo de esta semana (una consulta por sesión si aún no se sabe)
        const c2 = useGame.getState().s.conquest;
        if (c2.week !== week && lookedUp !== week) {
          lookedUp = week;
          const w = await myWorld(week);
          if (w) useGame.getState().setConquestWorld(week, w);
        }

        // 3. Partes de batalla
        const c3 = useGame.getState().s.conquest;
        if (c3.week === week && c3.w) notify(useGame.getState().receiveReports(await fetchReports(week, c3.w, c3.seenAt)));
      } catch (e) {
        console.warn('No se pudieron leer las novedades de la Conquista', e);
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(check, 10_000);
    const timer = setInterval(check, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready]);
}
