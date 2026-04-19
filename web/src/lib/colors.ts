/**
 * Matches desktop `chip_streamer.py`: `_MAC_BASE_PALETTE` and `_antenna_shade`.
 */

export const MAC_BASE_PALETTE_RGB: [number, number, number][] = [
  [0.22, 0.55, 0.91],
  [0.96, 0.54, 0.13],
  [0.3, 0.73, 0.32],
  [0.9, 0.24, 0.24],
  [0.62, 0.45, 0.82],
  [0.55, 0.36, 0.28],
  [0.95, 0.52, 0.78],
  [0.55, 0.55, 0.55],
  [0.8, 0.78, 0.22],
  [0.14, 0.8, 0.82],
  [0.38, 0.68, 0.95],
  [0.99, 0.7, 0.28],
];

export function rgbToHex(rgb: [number, number, number]): string {
  const r = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export function antennaShade(
  baseRgb: [number, number, number],
  portIdx: number,
  totalPorts: number,
): [number, number, number] {
  const [h, s0] = rgbToHsl(baseRgb[0], baseRgb[1], baseRgb[2]);
  let factor: number;
  if (totalPorts <= 1) {
    factor = 0.55;
  } else {
    const seq = [0.55, 0.72, 0.4, 0.82, 0.32, 0.65, 0.48, 0.78, 0.36];
    factor = seq[portIdx % seq.length];
  }
  factor = Math.max(0.28, Math.min(0.85, factor));
  const [r, g, b] = hslToRgb(h, s0 * 0.9, factor);
  return [r, g, b];
}

export function portSortKey(port: string): [number, string] {
  const n = parseInt(port, 10);
  if (!Number.isNaN(n)) return [0, String(n).padStart(6, "0")];
  return [1, port];
}
