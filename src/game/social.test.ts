import { describe, expect, it } from 'vitest';
import { headlines } from '../ui/gazette';
import { citySnapshot } from './cities';
import { rollPaper } from './paper';
import {
  GIFT_GEMS,
  GIFT_TICKETS_PER_DAY,
  GIFTS_PER_DAY,
  applyGiftSent,
  applyGiftsReceived,
  giftBlock,
  giftsLeft,
  newSocial,
  socialState,
  type GiftIn,
} from './social';
import { newState, normalize, type GameState } from './state';

const base = (extra: Partial<GameState> = {}): GameState => ({ ...newState(0), gems: 0, tickets: 0, ...extra });
const D1 = '2026-10-02';
const D2 = '2026-10-03';
const gift = (from: string, at: number, name = from): GiftIn => ({ from, name, at });

describe('regalos enviados', () => {
  it('uno al día por ciudad, hasta cinco ciudades, y da gemas', () => {
    let s = base();
    expect(giftBlock(s, 'bob', D1, 'me')).toBeNull();
    expect(giftBlock(s, 'me', D1, 'me')).toContain('ti mismo');
    expect(giftBlock(s, 'bob', D1, null)).toContain('conexión');
    s = applyGiftSent(s, 'bob', D1);
    expect(s.gems).toBe(GIFT_GEMS);
    expect(giftBlock(s, 'bob', D1, 'me')).toContain('Ya le dejaste');
    expect(applyGiftSent(s, 'bob', D1)).toBe(s);
    for (const u of ['c1', 'c2', 'c3', 'c4']) s = applyGiftSent(s, u, D1);
    expect(s.gems).toBe(GIFTS_PER_DAY * GIFT_GEMS);
    expect(giftsLeft(s, D1)).toBe(0);
    expect(giftBlock(s, 'c5', D1, 'me')).toContain(`${GIFTS_PER_DAY} regalos`);
    expect(applyGiftSent(s, 'c5', D1)).toBe(s);
    // Al día siguiente se puede volver a regalar, también a Bob
    expect(giftBlock(s, 'bob', D2, 'me')).toBeNull();
    expect(giftsLeft(s, D2)).toBe(GIFTS_PER_DAY);
    s = applyGiftSent(s, 'bob', D2);
    expect(s.social.sent).toEqual(['bob']);
  });
});

describe('regalos recibidos', () => {
  it('dan tickets con tope diario, cuentan todos y no se cobran dos veces', () => {
    const gifts = Array.from({ length: 7 }, (_, i) => gift(`u${i}`, 1000 + i));
    let r = applyGiftsReceived(base(), gifts, D1);
    expect(r.count).toBe(7);
    expect(r.tickets).toBe(GIFT_TICKETS_PER_DAY);
    expect(r.s.tickets).toBe(GIFT_TICKETS_PER_DAY);
    expect(r.s.social.received).toBe(7);
    expect(r.s.social.seenAt).toBe(1006);
    // El más reciente primero
    expect(r.s.social.recent[0].name).toBe('u6');
    // Los mismos otra vez: nada
    const again = applyGiftsReceived(r.s, gifts, D1);
    expect(again.count).toBe(0);
    expect(again.s).toBe(r.s);
    // Uno nuevo el mismo día: cuenta, pero ya no da ticket
    r = applyGiftsReceived(r.s, [gift('u9', 2000)], D1);
    expect(r.count).toBe(1);
    expect(r.tickets).toBe(0);
    expect(r.s.social.received).toBe(8);
    // Al día siguiente vuelve a dar tickets
    r = applyGiftsReceived(r.s, [gift('u9', 90_000_000)], D2);
    expect(r.tickets).toBe(1);
    expect(r.s.social.recent.length).toBeLessThanOrEqual(8);
  });
});

describe('regalos: guardado, ciudad pública y periódico', () => {
  it('carga sin romperse y conserva lo guardado', () => {
    expect(normalize({}, 0).social).toEqual(newSocial());
    expect(socialState({ sent: ['a', 'a', 5, 'b'], received: -3, seenAt: 'x', recent: [{ name: 'Ana', at: 5 }, { bad: 1 }] })).toEqual({
      day: null,
      sent: ['a', 'b'],
      ticketsToday: 0,
      seenAt: 0,
      received: 0,
      recent: [{ name: 'Ana', at: 5 }],
    });
    const s = applyGiftsReceived(applyGiftSent(base(), 'bob', D1), [gift('x', 7)], D1).s;
    expect(normalize(JSON.parse(JSON.stringify(s)), 0).social).toEqual(s.social);
  });

  it('la ciudad pública solo lleva el ❤️ si hay regalos (las versiones viejas de las reglas no lo conocen)', () => {
    expect('gifts' in citySnapshot(base())).toBe(false);
    const s = applyGiftsReceived(base(), [gift('a', 1), gift('b', 2)], D1).s;
    expect(citySnapshot(s).gifts).toBe(2);
  });

  it('el periódico cuenta los regalos del día', () => {
    let s = rollPaper(base(), '2026-10-01');
    s = applyGiftsReceived(s, [gift('a', 1), gift('b', 2), gift('c', 3)], D1).s;
    s = rollPaper(s, '2026-10-02');
    expect(s.paper.prev?.gifts).toBe(3);
    expect(headlines(s, s.paper.prev).some((h) => h.title.startsWith('3 alcaldes'))).toBe(true);
  });
});
