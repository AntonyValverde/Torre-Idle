import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt } from '../../game/format';
import { sfx } from '../../ui/haptics';
import type { UpgradeDef } from './kit';
import './shooter.css';

// Interfaz común de los shooters: va por encima del canvas. El canvas pinta el juego a 60 fps y estos
// componentes solo se repintan cuando cambia lo que enseñan (useHud).

/**
 * Estado del marcador que solo provoca un render cuando algún valor cambia de verdad. El bucle del
 * juego puede llamar a `push` en cada fotograma sin coste.
 */
export function useHud<T extends Record<string, unknown>>(initial: T): [T, (next: T) => void] {
  const [hud, setHud] = useState(initial);
  const last = useRef(initial);
  const push = useCallback((next: T) => {
    const prev = last.current;
    for (const k in next) {
      if (next[k] !== prev[k]) {
        last.current = next;
        setHud(next);
        return;
      }
    }
  }, []);
  return [hud, push];
}

export interface HudItem {
  icon: string;
  value: ReactNode;
  /** Nombre para lectores de pantalla. */
  label: string;
  hot?: boolean;
}

/** Barra superior: datos a la izquierda y botón de pausa a la derecha. */
export function HudBar({ items, onPause, children }: { items: HudItem[]; onPause?: () => void; children?: ReactNode }) {
  return (
    <div className="sh-hud">
      <div className="sh-hud-row">
        {items.map((it) => (
          <span key={it.label} className={`sh-pill${it.hot ? ' hot' : ''}`} aria-label={`${it.label}: ${typeof it.value === 'string' || typeof it.value === 'number' ? it.value : ''}`}>
            <i aria-hidden="true">{it.icon}</i>
            <b>{it.value}</b>
          </span>
        ))}
        {onPause && (
          <button
            className="sh-pause-btn"
            // Al apoyar el dedo: con el otro pulgar en el joystick el navegador a veces no genera el clic
            onPointerDown={(e) => {
              e.preventDefault();
              onPause();
            }}
            // El clic solo cuenta desde el teclado (Enter o espacio con el botón enfocado)
            onClick={(e) => {
              if (e.detail === 0) onPause();
            }}
            aria-label="Pausa"
          >
            ⏸
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Barra de vida, experiencia o progreso. */
export function Meter({ value, max, color, label, text }: { value: number; max: number; color: string; label: string; text?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="sh-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <div className="sh-meter-fill" style={{ width: `${pct}%`, background: color }} />
      {text && <span>{text}</span>}
    </div>
  );
}

/** Corazones de vida. */
export function Hearts({ hp, max }: { hp: number; max: number }) {
  return (
    <span className="sh-hearts" aria-label={`Vidas: ${hp} de ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < hp ? 'on' : ''} aria-hidden="true">
          {i < hp ? '❤️' : '🖤'}
        </i>
      ))}
    </span>
  );
}

export interface HowToLine {
  icon: string;
  text: string;
}

/**
 * Tarjeta de inicio: qué hay que hacer y cuenta atrás. Tocar en cualquier sitio empieza ya.
 * `left` son los ms que faltan (de `total`).
 */
export function StartCard({ title, lines, left, total, onSkip }: { title: string; lines: HowToLine[]; left: number; total: number; onSkip: () => void }) {
  const n = Math.max(1, Math.ceil(left / 1000));
  return (
    <div className="sh-overlay sh-start" onPointerDown={onSkip} role="dialog" aria-label={`${title}: cómo se juega`}>
      <div className="sh-card">
        <h3>{title}</h3>
        <ul className="sh-howto">
          {lines.map((l) => (
            <li key={l.text}>
              <span aria-hidden="true">{l.icon}</span>
              {l.text}
            </li>
          ))}
        </ul>
        <div className="sh-start-count">
          <span key={n}>{n}</span>
          <div className="sh-start-bar">
            <i style={{ width: `${100 - (left / total) * 100}%` }} />
          </div>
          <small>Toca para empezar ya</small>
        </div>
      </div>
    </div>
  );
}

/** Retraso antes de aceptar toques en una elección (para no elegir sin querer con el dedo que jugaba). */
const ARM_MS = 450;

/**
 * Elegir una de varias mejoras. Se puede con toque o con las teclas 1, 2, 3.
 */
export function UpgradePick<Id extends string>({
  title,
  subtitle,
  choices,
  levels,
  onPick,
}: {
  title: string;
  subtitle?: string;
  choices: UpgradeDef<Id>[];
  levels: Partial<Record<Id, number>>;
  onPick: (d: UpgradeDef<Id>) => void;
}) {
  const [armed, setArmed] = useState(false);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < choices.length) {
        e.preventDefault();
        sfx('buy');
        pick.current(choices[i]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, choices]);

  return (
    <div className="sh-overlay sh-dim" role="dialog" aria-label={title}>
      <div className="sh-pick">
        <h3>{title}</h3>
        {subtitle && <p className="sh-sub">{subtitle}</p>}
        <div className="sh-choices">
          {choices.map((d, i) => {
            const lv = levels[d.id] ?? 0;
            return (
              <button
                key={d.id}
                className={`sh-choice${d.weapon && lv === 0 ? ' weapon' : ''}`}
                style={{ animationDelay: `${i * 70}ms` }}
                disabled={!armed}
                onClick={() => {
                  sfx('buy');
                  onPick(d);
                }}
              >
                <span className="sh-choice-emoji" aria-hidden="true">
                  {d.emoji}
                </span>
                <span className="sh-choice-text">
                  <b>{d.name}</b>
                  <small>{d.desc(lv + 1)}</small>
                </span>
                <span className="sh-choice-lv">{lv === 0 ? (d.weapon ? '¡Nueva!' : 'Nueva') : d.max > 1 ? `Nv ${lv} → ${lv + 1}` : ''}</span>
                {d.max > 1 && (
                  <span className="sh-dots" aria-hidden="true">
                    {Array.from({ length: d.max }, (_, k) => (
                      <i key={k} className={k < lv ? 'on' : k === lv ? 'next' : ''} />
                    ))}
                  </span>
                )}
                <kbd aria-hidden="true">{i + 1}</kbd>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface ShopItem {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  /** Nivel actual y máximo (sin máximo: no se muestran puntos). */
  level: number;
  max?: number;
  /** Precio del siguiente nivel; null si ya está al máximo o no se vende. */
  cost: number | null;
}

/** Tienda entre rondas (hangar, taller…): comprar con lo ganado en la partida y seguir. */
export function ShopPanel({
  title,
  subtitle,
  money,
  moneyIcon = '🪙',
  items,
  onBuy,
  doneText,
  onDone,
}: {
  title: string;
  subtitle?: string;
  money: number;
  moneyIcon?: string;
  items: ShopItem[];
  onBuy: (id: string) => void;
  doneText: string;
  onDone: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="sh-overlay sh-dim" role="dialog" aria-label={title}>
      <div className="sh-shop">
        <header>
          <h3>{title}</h3>
          <span className="sh-money" aria-label={`Tienes ${money}`}>
            {moneyIcon} {fmt(money)}
          </span>
        </header>
        {subtitle && <p className="sh-sub">{subtitle}</p>}
        <div className="sh-shop-list">
          {items.map((it) => {
            const maxed = it.cost === null;
            const poor = !maxed && money < (it.cost ?? 0);
            return (
              <button
                key={it.id}
                className={`sh-shop-item${maxed ? ' maxed' : poor ? ' poor' : ''}`}
                disabled={!armed || maxed || poor}
                onClick={() => {
                  sfx('buy');
                  onBuy(it.id);
                }}
              >
                <span className="sh-choice-emoji" aria-hidden="true">
                  {it.emoji}
                </span>
                <span className="sh-choice-text">
                  <b>
                    {it.name}
                    {it.max ? <em> Nv {it.level}</em> : null}
                  </b>
                  <small>{it.desc}</small>
                  {it.max && it.max > 1 ? (
                    <span className="sh-dots" aria-hidden="true">
                      {Array.from({ length: it.max }, (_, k) => (
                        <i key={k} className={k < it.level ? 'on' : ''} />
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="sh-price">{maxed ? 'MÁX' : `${moneyIcon} ${fmt(it.cost ?? 0)}`}</span>
              </button>
            );
          })}
        </div>
        <button className="btn primary sh-done" disabled={!armed} onClick={onDone}>
          {doneText}
        </button>
      </div>
    </div>
  );
}

/** Pausa: se para todo hasta tocar "Seguir". */
export function PauseCard({ onResume, children }: { onResume: () => void; children?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyP') {
        e.preventDefault();
        onResume();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResume]);
  return (
    <div className="sh-overlay sh-dim" role="dialog" aria-label="En pausa">
      <div className="sh-card sh-paused">
        <div className="sh-paused-icon" aria-hidden="true">
          ⏸
        </div>
        <h3>En pausa</h3>
        {children}
        <button className="btn primary" onClick={onResume} autoFocus>
          Seguir
        </button>
        <small className="muted">Si sales con ✕ cobras lo que llevas.</small>
      </div>
    </div>
  );
}

/** Aviso grande que no bloquea (oleada superada, jefe a la vista…). */
export function Banner({ text, tone = 'good' }: { text: string; tone?: 'good' | 'bad' | 'boss' }) {
  return (
    <div className={`sh-banner ${tone}`} role="status">
      <span key={text}>{text}</span>
    </div>
  );
}
