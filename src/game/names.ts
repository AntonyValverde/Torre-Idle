// Nombres públicos del ranking. Debe coincidir con validName() de firestore.rules:
// letras (incluidas tildes y ñ), números, espacio, guion, guion bajo y punto.

export const NAME_MAX = 16;

// Palabras que no se permiten en el ranking (se buscan dentro del nombre, sin tildes ni signos).
// Solo palabras largas o inequívocas, para no bloquear nombres como "Cálculo" o "Penélope".
const BLOCKED = [
  'puta', 'puto', 'mierda', 'verga', 'chinga', 'maricon', 'cabron', 'pendejo', 'culero', 'hitler', 'nazi',
  'fuck', 'bitch', 'pussy', 'nigger', 'nigga', 'faggot', 'admin', 'moderador', 'soporte',
];

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's');
}

/** Limpia un nombre: quita caracteres no permitidos, espacios repetidos y lo recorta. */
export function sanitizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

export function isNameAllowed(name: string): boolean {
  const f = fold(name);
  return name.length > 0 && !BLOCKED.some((w) => f.includes(w));
}

export function randomName(): string {
  return `Alcalde${Math.floor(1000 + Math.random() * 9000)}`;
}
