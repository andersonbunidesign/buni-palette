// Colour maths: conversions, Delta E 2000, contrast and the harmony generator.

export type RGB = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): RGB | null {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
}

export function normHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// ---------- CIE Lab (D65) ----------
export function rgbToLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(toLinear);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex) ?? [0, 0, 0]);
}

/** CIEDE2000 colour difference. Under 1 is invisible, 1–2 close, over 5 clearly different. */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (x: number, y: number) => {
    if (x === 0 && y === 0) return 0;
    const h = Math.atan2(y, x) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

// ---------- HSB ----------
export function rgbToHsb([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? (d / max) * 100 : 0, max * 100];
}

export function hsbToRgb(h: number, s: number, v: number): RGB {
  s /= 100; v /= 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

// ---------- CMYK through the profile chosen in Settings (Coated FOGRA39 by default) ----------
// The desktop side sends two lookup tables built with Little CMS; values in between are interpolated.
interface CmykTables { name: string; n: number; m: number; toCmyk: Uint16Array; toRgb: Uint8Array }
let tables: CmykTables | null = null;

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function setCmykTables(t: { name: string; rgbSteps: number; cmykSteps: number; toCmyk: string; toRgb: string } | null) {
  if (!t) {
    tables = null;
    return;
  }
  const a = b64(t.toCmyk);
  tables = { name: t.name, n: t.rgbSteps, m: t.cmykSteps, toCmyk: new Uint16Array(a.buffer, a.byteOffset, a.byteLength / 2), toRgb: b64(t.toRgb) };
}
export const cmykProfileName = () => tables?.name ?? "";

function naiveCmyk([r, g, b]: RGB): [number, number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => v * 100) as [number, number, number, number];
}

/** CMYK in percent with the chosen profile (relative colorimetric, black point compensation). */
export function rgbToCmyk(rgb: RGB): [number, number, number, number] {
  const t = tables;
  if (!t) return naiveCmyk(rgb);
  const n = t.n;
  const f = rgb.map((v) => (Math.max(0, Math.min(255, v)) / 255) * (n - 1));
  const i0 = f.map((v) => Math.min(n - 2, Math.floor(v)));
  const d = f.map((v, k) => v - i0[k]);
  const out = [0, 0, 0, 0];
  // Trilinear interpolation over the eight corners of the cell.
  for (let c = 0; c < 8; c++) {
    const dr = c & 4 ? 1 : 0, dg = c & 2 ? 1 : 0, db = c & 1 ? 1 : 0;
    const w = (dr ? d[0] : 1 - d[0]) * (dg ? d[1] : 1 - d[1]) * (db ? d[2] : 1 - d[2]);
    if (!w) continue;
    const idx = (((i0[0] + dr) * n + (i0[1] + dg)) * n + (i0[2] + db)) * 4;
    for (let k = 0; k < 4; k++) out[k] += w * t.toCmyk[idx + k];
  }
  return out.map((v) => v / 100) as [number, number, number, number];
}

/** RGB of CMYK percentages with the chosen profile. */
export function cmykToRgb(cmyk: [number, number, number, number]): RGB {
  const t = tables;
  const v = cmyk.map((x) => Math.max(0, Math.min(100, x)) / 100);
  if (!t) return [255 * (1 - v[0]) * (1 - v[3]), 255 * (1 - v[1]) * (1 - v[3]), 255 * (1 - v[2]) * (1 - v[3])];
  const m = t.m;
  const f = v.map((x) => x * (m - 1));
  const i0 = f.map((x) => Math.min(m - 2, Math.floor(x)));
  const d = f.map((x, k) => x - i0[k]);
  const out = [0, 0, 0];
  for (let c = 0; c < 16; c++) {
    let w = 1, idx = 0;
    for (let k = 0; k < 4; k++) {
      const bit = (c >> (3 - k)) & 1;
      w *= bit ? d[k] : 1 - d[k];
      idx = idx * m + i0[k] + bit;
    }
    if (!w) continue;
    for (let k = 0; k < 3; k++) out[k] += w * t.toRgb[idx * 3 + k];
  }
  return out as RGB;
}

// ---------- OKLCH, used by the generator because its lightness and hue steps look even ----------
export type Oklch = [number, number, number];

export function rgbToOklch(rgb: RGB): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(A, B), h];
}

function oklchToLinear([L, C, h]: Oklch): RGB {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to hex, lowering chroma until the colour fits on screen. */
export function oklchToHex(c: Oklch): string {
  let [L, C, h] = c;
  L = Math.max(0, Math.min(1, L));
  for (let i = 0; i < 30; i++) {
    const lin = oklchToLinear([L, C, h]);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(fromLinear) as RGB);
    C *= 0.9;
  }
  return rgbToHex(oklchToLinear([L, 0, h]).map(fromLinear) as RGB);
}

// ---------- contrast ----------
export function luminance(hex: string): number {
  const [r, g, b] = (hexToRgb(hex) ?? [0, 0, 0]).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function contrastGrade(r: number): { label: string; tone: "ok" | "warn" | "bad" } {
  if (r >= 7) return { label: "AAA", tone: "ok" };
  if (r >= 4.5) return { label: "AA", tone: "ok" };
  if (r >= 3) return { label: "Large text only", tone: "warn" };
  return { label: "Too low", tone: "bad" };
}

export function grayHex(hex: string): string {
  // Perceptual grey with the same lightness, so value contrast reads true.
  const [L] = hexToLab(hex);
  const y = L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27);
  const v = fromLinear(y);
  return rgbToHex([v, v, v]);
}

export function readableInk(hex: string): string {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#1E1E1E") ? "#FFFFFF" : "#1E1E1E";
}

// ---------- value formats ----------
export type ValueMode = "hex" | "rgb" | "lab" | "hsb" | "cmyk";

export function formatValue(hex: string, mode: ValueMode): string {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const r = (v: number) => Math.round(v);
  switch (mode) {
    case "hex": return hex.toUpperCase();
    case "rgb": return rgb.join(" ");
    case "lab": return rgbToLab(rgb).map(r).join(" ");
    case "hsb": {
      const [h, s, b] = rgbToHsb(rgb);
      return `${r(h)}° ${r(s)} ${r(b)}`;
    }
    case "cmyk": return rgbToCmyk(rgb).map(r).join(" ");
  }
}

// ---------- harmony generator ----------
export type Rule = "free" | "mono" | "analogous" | "complementary" | "split" | "triad" | "tetradic";

export const RULES: { id: Rule; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "mono", label: "Monochromatic" },
  { id: "analogous", label: "Analogous" },
  { id: "complementary", label: "Complementary" },
  { id: "split", label: "Split complementary" },
  { id: "triad", label: "Triad" },
  { id: "tetradic", label: "Tetradic" },
];

const OFFSETS: Record<Exclude<Rule, "free">, number[]> = {
  mono: [0],
  analogous: [0, -30, 30],
  complementary: [0, 180],
  split: [0, 150, 210],
  triad: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

const wrap = (h: number) => ((h % 360) + 360) % 360;
const hueDist = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Fills the unlocked slots. Locked colours stay and set the base hue.
 * With `pool` (colours from the project's references), each slot takes the pool colour
 * closest to the hue the rule asks for, so results keep the feel of the references.
 */
export function generate(slots: (string | null)[], rule: Rule, pool: string[], rand: () => number = Math.random): string[] {
  const locked = slots.filter((s): s is string => !!s);
  const lockedLch = locked.map((h) => rgbToOklch(hexToRgb(h)!));
  const chromatic = lockedLch.filter((c) => c[1] > 0.03);
  const poolLch = pool.map((h) => ({ hex: h, lch: rgbToOklch(hexToRgb(h)!) }));

  let base: number;
  if (chromatic.length) base = chromatic[0][2];
  else if (poolLch.length) base = poolLch[Math.floor(rand() * poolLch.length)].lch[2];
  else base = rand() * 360;

  const free = slots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
  // Spread lightness across the free slots so a palette has darks, mids and lights.
  const lights = free.map((_, k) => 0.28 + ((k + rand() * 0.8) / Math.max(1, free.length)) * 0.64);
  for (let i = lights.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [lights[i], lights[j]] = [lights[j], lights[i]];
  }

  const used = new Set(locked);
  const out = slots.slice();
  const offsets = rule === "free" ? null : OFFSETS[rule];
  // Start the rule cycle after the hues the locked colours already cover.
  let cursor = rule === "free" ? 0 : Math.min(locked.length, offsets!.length) % offsets!.length;

  free.forEach((slot, k) => {
    let target: number;
    if (!offsets) target = rand() * 360;
    else {
      target = wrap(base + offsets[cursor % offsets.length] + (rand() - 0.5) * (rule === "mono" ? 8 : 18));
      cursor++;
    }
    if (poolLch.length) {
      const ranked = poolLch
        .filter((p) => !used.has(p.hex))
        .map((p) => ({ p, d: (p.lch[1] < 0.03 ? 60 : hueDist(p.lch[2], target)) + Math.abs(p.lch[0] - lights[k]) * 60 + rand() * 25 }))
        .sort((a, b) => a.d - b.d);
      const pick = (rule === "free" ? ranked[Math.floor(rand() * Math.min(ranked.length, 6))] : ranked[0])?.p;
      if (pick) {
        used.add(pick.hex);
        out[slot] = pick.hex;
        return;
      }
    }
    const chroma = rule === "mono" ? 0.03 + rand() * 0.1 : 0.05 + rand() * 0.15;
    const L = lights[k];
    out[slot] = oklchToHex([L, chroma * (1 - Math.abs(L - 0.6)), target]);
  });
  return out as string[];
}

/** A small seeded random generator, so image extraction gives the same result every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- back from Lab, parsing typed values, adjustments ----------
export function labToRgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [r, g, bl].map((v) => Math.max(0, Math.min(255, fromLinear(Math.max(0, Math.min(1, v)))))) as RGB;
}

/** Reads a value typed in the current mode ("12 200 40", "#C0FFEE", "45° 80 60"...). */
export function parseValue(text: string, mode: ValueMode): string | null {
  if (mode === "hex" || /^\s*#/.test(text)) return normHex(text);
  const n = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  switch (mode) {
    case "rgb":
      return n.length === 3 && n.every((v) => v >= 0 && v <= 255) ? rgbToHex(n as RGB) : null;
    case "hsb":
      return n.length === 3 ? rgbToHex(hsbToRgb(((n[0] % 360) + 360) % 360, clamp(n[1], 0, 100), clamp(n[2], 0, 100))) : null;
    case "lab":
      return n.length === 3 ? rgbToHex(labToRgb([clamp(n[0], 0, 100), n[1], n[2]])) : null;
    case "cmyk": {
      if (n.length !== 4) return null;
      return rgbToHex(cmykToRgb(n.map((v) => clamp(v, 0, 100)) as [number, number, number, number]));
    }
  }
  return null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface Adjust { hue: number; sat: number; bri: number; temp: number }
export const NO_ADJUST: Adjust = { hue: 0, sat: 0, bri: 0, temp: 0 };

/** Shifts a colour: hue in degrees, the others from -100 to 100. Temperature warms or cools in Lab. */
export function adjustHex(hex: string, a: Adjust): string {
  let [h, s, b] = rgbToHsb(hexToRgb(hex) ?? [0, 0, 0]);
  h = (((h + a.hue) % 360) + 360) % 360;
  s = a.sat >= 0 ? s + (100 - s) * (a.sat / 100) : s * (1 + a.sat / 100);
  b = a.bri >= 0 ? b + (100 - b) * (a.bri / 100) : b * (1 + a.bri / 100);
  let rgb = hsbToRgb(h, clamp(s, 0, 100), clamp(b, 0, 100));
  if (a.temp) {
    const lab = rgbToLab(rgb);
    rgb = labToRgb([lab[0], lab[1] + a.temp * 0.06, lab[2] + a.temp * 0.3]);
  }
  return rgbToHex(rgb);
}

/** Lighter and darker versions of a colour (same hue), lightest first. */
export function shades(hex: string, steps = 11): string[] {
  const [, C, h] = rgbToOklch(hexToRgb(hex) ?? [0, 0, 0]);
  return Array.from({ length: steps }, (_, i) => {
    const L = 0.97 - (i / (steps - 1)) * 0.85;
    const edge = Math.min(1, Math.min(L, 1 - L) * 3.2);
    return oklchToHex([L, C * edge, h]);
  });
}

// ---------- colour vision deficiency (Machado, Oliveira & Fernandes 2009, full severity) ----------
export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";
export const VISIONS: { id: Vision; label: string; help: string }[] = [
  { id: "normal", label: "Normal vision", help: "" },
  { id: "protanopia", label: "Protanopia", help: "No red cones" },
  { id: "deuteranopia", label: "Deuteranopia", help: "No green cones, the most common" },
  { id: "tritanopia", label: "Tritanopia", help: "No blue cones, rare" },
];
const CVD: Record<Exclude<Vision, "normal">, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

/** How a colour looks with the given colour vision. */
export function simulate(hex: string, v: Vision): string {
  if (v === "normal") return hex;
  const lin = (hexToRgb(hex) ?? [0, 0, 0]).map(toLinear);
  const m = CVD[v];
  const out = m.map((row) => fromLinear(Math.max(0, Math.min(1, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))));
  return rgbToHex(out as RGB);
}

/** Pairs of colours (by position) that become hard to tell apart with this colour vision. */
export function confusedPairs(hexes: string[], v: Vision, limit = 8): [number, number][] {
  if (v === "normal") return [];
  const labs = hexes.map((h) => hexToLab(simulate(h, v)));
  const realLabs = hexes.map(hexToLab);
  const out: [number, number][] = [];
  for (let i = 0; i < hexes.length; i++)
    for (let j = i + 1; j < hexes.length; j++)
      // Only pairs that are distinct with normal vision but close with this one.
      if (deltaE2000(labs[i], labs[j]) < limit && deltaE2000(realLabs[i], realLabs[j]) >= limit) out.push([i, j]);
  return out;
}
