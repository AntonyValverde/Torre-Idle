// Nombres públicos del ranking. Debe coincidir con validName() de firestore.rules:
// letras (incluidas tildes y ñ), números, espacio, guion, guion bajo y punto.

export const NAME_MAX = 16;

// Palabras que no se permiten en el ranking (se buscan dentro del nombre, sin tildes ni signos).
// Solo palabras largas o inequívocas, para no bloquear nombres como "Cálculo" o "Penélope".
const BLOCKED = [
  'mierda', 'chinga', 'maricon', 'cabron', 'pendejo', 'culero', 'hitler',
  'fuck', 'bitch', 'pussy', 'nigger', 'nigga', 'faggot', 'admin', 'moderador', 'soporte',
];

// Palabras cortas que también aparecen dentro de palabras normales ("Computadora", "Disputa",
// "Cómputo"): solo cuentan al principio del nombre o de una de sus palabras ("Puta", "ElPuto", "Putas").
const BLOCKED_START = ['puta', 'puto', 'verga', 'nazi'];

/**
 * Palabras del nombre en minúsculas, sin tildes ni signos. NFKD convierte también las letras
 * "decoradas" (𝓹𝓾𝓽𝓪, ｐｕｔａ…) en letras normales, así que no sirven para saltarse el filtro.
 */
function words(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) =>
      w
        .toLowerCase()
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's'),
    );
}

/** Recorta a `max` unidades sin partir nunca un carácter de dos unidades (las reglas lo rechazarían). */
function cut(s: string, max: number): string {
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** Limpia un nombre: quita caracteres no permitidos, espacios repetidos y lo recorta. */
export function sanitizeName(raw: string): string {
  return cut(
    raw
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} _.-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
    NAME_MAX,
  ).trim();
}

export function isNameAllowed(name: string): boolean {
  const w = words(name);
  const f = w.join('');
  return (
    name.length > 0 &&
    !BLOCKED.some((b) => f.includes(b)) &&
    !BLOCKED_START.some((b) => f.startsWith(b) || w.some((x) => x.startsWith(b)))
  );
}

export function randomName(): string {
  return `Alcalde${Math.floor(1000 + Math.random() * 9000)}`;
}
