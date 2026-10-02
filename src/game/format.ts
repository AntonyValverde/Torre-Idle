const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Sufijo del grupo de mil número `tier`: K, M, B… y luego aa, ab, ac… hasta el infinito. */
function suffix(tier: number): string {
  if (tier < SUFFIXES.length) return SUFFIXES[tier];
  const i = tier - SUFFIXES.length;
  return String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
}

/** 1234 -> "1.23K", 5_600_000 -> "5.60M". Trunca en vez de redondear para no mostrar de más. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) {
    if (n < 10 && n % 1 !== 0) return (Math.floor(n * 10) / 10).toFixed(1);
    return Math.floor(n).toString();
  }
  let tier = Math.floor(Math.log10(n) / 3);
  // log10 puede quedarse corto por redondeo (p. ej. 1e15 → 14.999…) o pasarse justo por debajo
  // de una potencia de mil (999999.9999999999 → 6, que daría "0.99M" en vez de "999K")
  if (n / 10 ** (tier * 3) >= 1000) tier++;
  else if (n / 10 ** (tier * 3) < 1) tier--;
  const scaled = n / 10 ** (tier * 3);
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const p = 10 ** digits;
  return (Math.floor(scaled * p) / p).toFixed(digits) + suffix(tier);
}

export function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
