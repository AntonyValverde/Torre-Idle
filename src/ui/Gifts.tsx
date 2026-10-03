import { useEffect, useState } from 'react';
import { track } from '../firebase';
import { cloudEnabled } from '../firebase';
import { dateKey, now } from '../game/clock';
import { currentUid, fetchNewGifts, sendGiftCloud, type PublicCity } from '../game/cloud';
import { eraName } from '../game/economy';
import { fmt } from '../game/format';
import { GIFT_GEMS, GIFTS_PER_DAY, giftBlock, giftsLeft } from '../game/social';
import { useGame } from '../game/store';
import { ago } from '../admin/metrics';
import { pressable } from './a11y';
import { celebrate } from './celebrate';
import { sfx, vibrate } from './haptics';

/** Cada cuánto se miran los regalos recibidos mientras se juega. */
const INBOX_EVERY_MS = 5 * 60_000;
/** Ciudades que muestra la lista (las de actividad más reciente). */
const LIST_MAX = 20;

/**
 * Cobra los regalos que otros alcaldes dejaron en tu ciudad: al poco de abrir el juego y luego
 * cada pocos minutos con la app visible.
 */
export function useGiftInbox(ready: boolean) {
  useEffect(() => {
    if (!ready || !cloudEnabled) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible' || !currentUid()) return;
      busy = true;
      try {
        const gifts = await fetchNewGifts(useGame.getState().s.social.seenAt);
        const st = useGame.getState();
        const r = st.receiveGifts(gifts);
        if (r.count > 0) {
          const who = r.names.slice(0, 3).join(', ') + (r.names.length > 3 ? ` y ${r.names.length - 3} más` : '');
          st.toast(`📬 ${who} te ${r.count === 1 ? 'dejó un regalo' : 'dejaron regalos'}${r.tickets ? `: +${r.tickets} 🎟️` : ''}`);
          sfx('win');
          vibrate([15, 30, 15]);
          track('gifts_received', { count: r.count, tickets: r.tickets });
        }
      } catch (e) {
        console.warn('No se pudieron leer los regalos', e);
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(check, 8000);
    const timer = setInterval(check, INBOX_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready]);
}

/** Botón para dejar un regalo en la ciudad que se está visitando. */
export function GiftButton({ uid, cityName }: { uid: string; cityName: string }) {
  const s = useGame((st) => st.s);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const day = dateKey(now());
  const block = giftBlock(s, uid, day, currentUid());

  const give = async () => {
    if (block || sending) return;
    setSending(true);
    const st = useGame.getState();
    try {
      await sendGiftCloud(uid, st.s.name);
      st.sendGift(uid);
      setDone(true);
      st.toast(`🎁 Regalo entregado a ${cityName}: +${GIFT_GEMS} 💎 para ti y un 🎟️ para su ciudad`);
      sfx('win');
      vibrate([20, 40, 20]);
      celebrate(3);
      track('gift_sent');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // Rechazado por las reglas: ya le regalaste hoy (p. ej. desde otro dispositivo)
      if (code === 'permission-denied') {
        st.sendGift(uid);
        st.toast('🎁 Ya le dejaste un regalo hoy a esta ciudad');
      } else st.toast('⚠️ No se pudo entregar el regalo. Revisa tu conexión.');
    } finally {
      setSending(false);
    }
  };

  if (done) return <p className="gift-done">🎁 ¡Regalo entregado! Vuelve mañana para dejarle otro.</p>;
  return (
    <div className="gift-box">
      <button className="btn primary big" disabled={!!block || sending} onClick={give}>
        {sending ? 'Entregando…' : `🎁 Dejar un regalo · +${GIFT_GEMS} 💎`}
      </button>
      <small className="muted">{block ?? `Te quedan ${giftsLeft(s, day)} de ${GIFTS_PER_DAY} regalos hoy. Su alcalde recibirá un 🎟️.`}</small>
    </div>
  );
}

/** Tus regalos recibidos y el acceso a explorar ciudades (en el Perfil). */
export function GiftsCard({ onExplore }: { onExplore: () => void }) {
  const social = useGame((st) => st.s.social);
  const t = now();
  return (
    <div className="card gifts-card">
      <b>❤️ Regalos de otros alcaldes</b>
      <p className="muted">
        {social.received > 0
          ? `Tu ciudad ha recibido ${fmt(social.received)} ${social.received === 1 ? 'regalo' : 'regalos'}.`
          : 'Aún nadie te ha dejado un regalo. ¡Comparte tu ciudad!'}
      </p>
      {social.recent.length > 0 && (
        <ul className="gifts-recent">
          {social.recent.slice(0, 5).map((g) => (
            <li key={`${g.name}-${g.at}`}>
              <span>🎁 {g.name}</span>
              <small className="muted">{ago(g.at, t)}</small>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" onClick={onExplore}>
        🌍 Mapa del mundo: visita y deja regalos
      </button>
    </div>
  );
}

/** Ciudades con actividad reciente (vista de lista del mapa del mundo): para descubrir a quién visitar y regalar. */
export function CityList({ cities, onVisit }: { cities: PublicCity[] | null | 'error'; onVisit: (uid: string) => void }) {
  const s = useGame((st) => st.s);
  const me = currentUid();
  const day = dateKey(now());
  const t = now();
  const others = Array.isArray(cities) ? cities.filter((x) => x.uid !== me).slice(0, LIST_MAX) : cities;

  return (
    <div className="explore">
      <p className="hint">Ciudades con actividad reciente. Visita una y déjale un regalo: tú ganas 💎 y su alcalde, 🎟️.</p>
      {others === null && <p className="empty">Buscando ciudades…</p>}
      {others === 'error' && <p className="empty">No se pudieron cargar las ciudades. Revisa tu conexión.</p>}
      {Array.isArray(others) && others.length === 0 && <p className="empty">Aún no hay otras ciudades. ¡Invita a tus amigos!</p>}
      {Array.isArray(others) && others.length > 0 && (
        <ul className="explore-list">
          {others.map((c) => {
            const can = !giftBlock(s, c.uid, day, me);
            const given = s.social.day === day && s.social.sent.includes(c.uid);
            return (
              <li key={c.uid} className="clickable" {...pressable(() => onVisit(c.uid))}>
                <span className="explore-main">
                  <b>{c.name}</b>
                  <small className="muted">
                    Era {c.era} · {eraName(c.era)} · ⭐ {fmt(c.stars)}
                    {c.updatedAt ? ` · ${ago(c.updatedAt, t)}` : ''}
                  </small>
                </span>
                <span className="explore-side">
                  {(c.gifts ?? 0) > 0 && <small>❤️ {fmt(c.gifts ?? 0)}</small>}
                  {(can || given) && <span className={`explore-gift${can ? ' can' : ''}`}>{can ? '🎁' : '✔'}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
