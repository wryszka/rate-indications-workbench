// Formatting + assumption helpers.

export const pct = (v: number | null | undefined, dp = 1, signed = true): string => {
  if (v === null || v === undefined || isNaN(v as number)) return '—';
  const s = (v * 100).toFixed(dp);
  return (signed && v > 0 ? '+' : '') + s + '%';
};

export const pts = (v: number, dp = 1): string => (v > 0 ? '+' : '') + v.toFixed(dp) + ' pts';

export const money = (v: number | null | undefined, ccy = 'EUR'): string => {
  if (v === null || v === undefined) return '—';
  const sym = ccy === 'USD' ? '$' : ccy === 'GBP' ? '£' : '€';
  if (Math.abs(v) >= 1e9) return sym + (v / 1e9).toFixed(2) + 'bn';
  if (Math.abs(v) >= 1e6) return sym + (v / 1e6).toFixed(1) + 'm';
  if (Math.abs(v) >= 1e3) return sym + (v / 1e3).toFixed(0) + 'k';
  return sym + v.toFixed(0);
};

// how an assumption renders/edits by unit
export const isPct = (unit: string) => unit === 'pct';
export const toDisplay = (name: string, val: number, unit: string): string => {
  if (unit === 'pct') return (val * 100).toFixed(2);
  if (unit === 'years') return String(Math.round(val));
  return val.toFixed(3); // factor
};
export const fromDisplay = (raw: string, unit: string): number => {
  const n = parseFloat(raw);
  if (isNaN(n)) return 0;
  if (unit === 'pct') return n / 100;
  if (unit === 'years') return Math.round(n);
  return n;
};
export const unitSuffix = (unit: string) => (unit === 'pct' ? '%' : unit === 'years' ? 'yr' : '');

export const arrow = (v: number) => (v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '▬');
export const signClass = (v: number) => (v > 0.0005 ? 'pos' : v < -0.0005 ? 'neg' : 'mut');
