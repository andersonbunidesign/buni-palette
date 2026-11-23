// Gradient maths: blending stops without a muddy middle, checking a gradient, generating new ones,
// finding good pairs among palette colours, and reading a gradient off an image along a line.
import { hexToRgb, oklchToHex, rgbToHex, rgbToOklch, type RGB } from "./color";
import { pixels } from "./extract";

/**
 * How the colours between two stops are worked out.
 * "oklab": straight through a perceptual space, so lightness changes evenly and the middle doesn't go grey-brown the way RGB does.
 * "oklch": around the colour wheel, keeping the colour strong; for stops far apart in hue, where a straight line passes through grey.
 * "rgb": what plain CSS and Illustrator do.
 */
export type Blend = "oklab" | "oklch" | "rgb";
export type GradType = "linear" | "radial";
export interface GStop {
  hex: string;
  /** 0 to 1 along the gradient. */
  pos: number;
  locked?: boolean;
}
export interface GradLike {
  type: GradType;
  /** CSS angle: 0 points up, 90 points right. */
  angle: number;
  stops: GStop[];
  blend: Blend;
}

export const BLENDS: { id: Blend; label: string; help: string }[] = [
  { id: "oklab", label: "Perceptual", help: "Even lightness, no grey-brown middle. The best start for most gradients." },
  { id: "oklch", label: "Vivid", help: "Goes around the colour wheel, so stops far apart in hue stay bright in between." },
  { id: "rgb", label: "Plain RGB", help: "How plain CSS and older apps blend. Can go dull in the middle." },
];

// ---------- OKLab ----------
export type OkLab = [number, number, number];

export function toLab(hex: string): OkLab {
  const [L, C, h] = rgbToOklch(hexToRgb(hex) ?? [0, 0, 0]);
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
}
export function fromLab([L, a, b]: OkLab): string {
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return oklchToHex([L, Math.hypot(a, b), h]);
}
const lch = (hex: string) => rgbToOklch(hexToRgb(hex) ?? [0, 0, 0]);
export const labDist = (a: OkLab, b: OkLab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const chroma = (l: OkLab) => Math.hypot(l[1], l[2]);

/** The colour a fraction `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number, blend: Blend): string {
  if (blend === "rgb") {
    const x = hexToRgb(a) ?? [0, 0, 0], y = hexToRgb(b) ?? [0, 0, 0];
    return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as RGB);
  }
  if (blend === "oklab") {
    const x = toLab(a), y = toLab(b);
    return fromLab([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  const [L1, C1, h1] = lch(a), [L2, C2, h2] = lch(b);
  // A grey has no hue of its own: it takes the other colour's.
  const ha = C1 < 0.02 ? h2 : h1, hb = C2 < 0.02 ? h1 : h2;
  let d = hb - ha;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return oklchToHex([L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, (ha + d * t + 360) % 360]);
}

export const sorted = (stops: GStop[]) => [...stops].sort((a, b) => a.pos - b.pos);

/** The colour at `t` (0–1) along the gradient. */
export function colorAt(g: Pick<GradLike, "stops" | "blend">, t: number): string {
  const s = sorted(g.stops);
  if (!s.length) return "#000000";
  if (t <= s[0].pos) return s[0].hex;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].pos) {
      const span = s[i].pos - s[i - 1].pos;
      return mix(s[i - 1].hex, s[i].hex, span > 0 ? (t - s[i - 1].pos) / span : 1, g.blend);
    }
  }
  return s[s.length - 1].hex;
}

export const ramp = (g: Pick<GradLike, "stops" | "blend">, n: number) => Array.from({ length: n }, (_, i) => colorAt(g, i / (n - 1)));

/**
 * Stops for apps that blend in RGB (CSS without "in oklab", Illustrator): the blend is kept
 * by adding in-between stops, so the result looks the same.
 */
export function expandStops(g: Pick<GradLike, "stops" | "blend">, perSegment = 6): GStop[] {
  const s = sorted(g.stops);
  if (g.blend === "rgb" || s.length < 2) return s.map(({ hex, pos }) => ({ hex, pos }));
  const out: GStop[] = [{ hex: s[0].hex, pos: s[0].pos }];
  for (let i = 1; i < s.length; i++) {
    for (let k = 1; k <= perSegment; k++) {
      const t = k / perSegment;
      out.push({ hex: k === perSegment ? s[i].hex : mix(s[i - 1].hex, s[i].hex, t, g.blend), pos: s[i - 1].pos + (s[i].pos - s[i - 1].pos) * t });
    }
  }
  return out;
}

const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;
const shape = (g: GradLike) => (g.type === "radial" ? "radial-gradient(circle" : `linear-gradient(${Math.round(g.angle)}deg`);
const space = (b: Blend) => (b === "oklab" ? " in oklab" : b === "oklch" ? " in oklch" : "");

/** CSS for the gradient, using the browser's own perceptual blend. */
export function css(g: GradLike): string {
  const s = sorted(g.stops).map((x) => `${x.hex} ${pct(x.pos)}`).join(", ");
  if (g.type === "radial") return `radial-gradient(circle${space(g.blend)}, ${s})`;
  return `linear-gradient(${Math.round(g.angle)}deg${space(g.blend)}, ${s})`;
}
/** The same gradient written with plain RGB stops, for browsers and apps without "in oklab". */
export function cssFallback(g: GradLike): string {
  return `${shape(g)}, ${expandStops(g, 4).map((x) => `${x.hex} ${pct(x.pos)}`).join(", ")})`;
}
export function cssBlock(g: GradLike): string {
  return g.blend === "rgb" ? `background: ${css(g)};` : `background: ${cssFallback(g)};\nbackground: ${css(g)};`;
}

// ---------- checks ----------
export interface Issue {
  /** Index of the segment, between sorted stops i and i + 1. */
  seg: number;
  kind: "muddy" | "dark" | "flat";
  text: string;
}

/** Where a gradient goes dull or dips in lightness between two stops. */
export function issues(g: Pick<GradLike, "stops" | "blend">): Issue[] {
  const s = sorted(g.stops);
  const out: Issue[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    const a = toLab(s[i].hex), b = toLab(s[i + 1].hex);
    if (labDist(a, b) < 0.025) {
      out.push({ seg: i, kind: "flat", text: "These two stops are almost the same colour." });
      continue;
    }
    let dip = 0, dark = 0;
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const m = toLab(mix(s[i].hex, s[i + 1].hex, t, g.blend));
      const want = chroma(a) + (chroma(b) - chroma(a)) * t;
      if (want > 0.05) dip = Math.max(dip, 1 - chroma(m) / want);
      dark = Math.max(dark, Math.min(a[0], b[0]) - m[0]);
    }
    if (dip > 0.45) out.push({ seg: i, kind: "muddy", text: "The middle goes dull, through grey." });
    else if (dark > 0.04) out.push({ seg: i, kind: "dark", text: "The middle gets darker than both ends." });
  }
  return out;
}

/** Fixes a dull middle: a stop halfway, going around the colour wheel so it keeps its colour. */
export function fixSegment(g: Pick<GradLike, "stops" | "blend">, seg: number): GStop[] {
  const s = sorted(g.stops);
  const a = s[seg], b = s[seg + 1];
  if (!a || !b) return g.stops;
  const [L1, C1] = lch(a.hex), [L2, C2] = lch(b.hex);
  const mid = mix(a.hex, b.hex, 0.5, "oklch");
  const [, , h] = lch(mid);
  const hex = oklchToHex([(L1 + L2) / 2 + 0.02, Math.max(C1, C2) * 0.9, h]);
  return [...s.slice(0, seg + 1), { hex, pos: (a.pos + b.pos) / 2 }, ...s.slice(seg + 1)];
}

/** How good a gradient is, higher is better: no dull middles, lightness that moves one way, steps that aren't too small or too harsh. */
export function quality(stops: GStop[], blend: Blend): number {
  const s = sorted(stops);
  if (s.length < 2) return -9;
  let score = 0;
  const labs = s.map((x) => toLab(x.hex));
  for (const is of issues({ stops: s, blend })) score -= is.kind === "muddy" ? 1.2 : is.kind === "flat" ? 1 : 0.6;
  // Lightness: turning back once is fine (a glow in the middle), more looks bumpy.
  let turns = 0, dir = 0;
  for (let i = 1; i < labs.length; i++) {
    const d = labs[i][0] - labs[i - 1][0];
    if (Math.abs(d) < 0.03) continue;
    const sd = Math.sign(d);
    if (dir && sd !== dir) turns++;
    dir = sd;
  }
  score -= Math.max(0, turns - 1) * 0.8;
  for (let i = 1; i < labs.length; i++) {
    const d = labDist(labs[i - 1], labs[i]) / Math.max(0.15, s[i].pos - s[i - 1].pos);
    if (d > 0.75) score -= (d - 0.75) * 1.5;
  }
  const ends = labDist(labs[0], labs[labs.length - 1]);
  score += Math.min(ends, 0.35) * 2;
  if (ends < 0.08 && s.length < 4) score -= 0.8;
  score += labs.reduce((n, l) => n + Math.min(chroma(l), 0.2), 0) / labs.length;
  return score;
}

// ---------- generator ----------
export type GenMode = "smooth" | "vibrant" | "refs" | "unusual";
export const GEN_MODES: { id: GenMode; label: string; help: string }[] = [
  { id: "smooth", label: "Smooth", help: "Neighbouring hues and an even change in lightness. Calm, easy to use behind text." },
  { id: "vibrant", label: "Vibrant", help: "Strong colours a wider step apart on the wheel." },
  { id: "refs", label: "From references", help: "Built from the colours of this project's images and palettes." },
  { id: "unusual", label: "Unusual", help: "Pairings you wouldn't reach for: the long way round the wheel, dark into neon, pastel clashes." },
];

const wrap = (h: number) => ((h % 360) + 360) % 360;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Positions for n stops spread evenly. */
export const evenPos = (n: number) => Array.from({ length: n }, (_, i) => (n === 1 ? 0 : i / (n - 1)));

function candidate(mode: Exclude<GenMode, "refs">, n: number, anchor: [number, number, number] | null, r: () => number): { hexes: string[]; blend: Blend } {
  const h0 = anchor ? anchor[2] : r() * 360;
  const ts = evenPos(n);
  if (mode === "smooth") {
    const span = (25 + r() * 60) * (r() < 0.5 ? -1 : 1);
    const lightToDark = r() < 0.5;
    const l1 = anchor ? anchor[0] : 0.55 + r() * 0.35;
    const l2 = lightToDark ? Math.max(0.25, l1 - 0.2 - r() * 0.3) : Math.min(0.95, l1 + 0.15 + r() * 0.25);
    const c1 = anchor ? Math.max(0.04, anchor[1]) : 0.06 + r() * 0.1, c2 = 0.06 + r() * 0.11;
    return { hexes: ts.map((t) => oklchToHex([lerp(l1, l2, t), lerp(c1, c2, t), wrap(h0 + span * t)])), blend: "oklab" };
  }
  if (mode === "vibrant") {
    const span = (60 + r() * 110) * (r() < 0.5 ? -1 : 1);
    const l1 = 0.55 + r() * 0.25, l2 = 0.55 + r() * 0.3;
    const c1 = 0.17 + r() * 0.1, c2 = 0.17 + r() * 0.1;
    return { hexes: ts.map((t) => oklchToHex([lerp(l1, l2, t) + Math.sin(t * Math.PI) * 0.04, lerp(c1, c2, t), wrap(h0 + span * t)])), blend: "oklch" };
  }
  // Unusual: a few recipes, picked at random.
  const k = Math.floor(r() * 5);
  if (k === 0) {
    // The long way round the wheel, past colours a straight blend would skip.
    const span = (200 + r() * 100) * (r() < 0.5 ? -1 : 1);
    const c = 0.15 + r() * 0.06;
    return { hexes: ts.map((t) => oklchToHex([0.62 + Math.sin(t * Math.PI) * 0.12, c, wrap(h0 + span * t)])), blend: "oklch" };
  }
  if (k === 1) {
    // Deep and dark into something electric.
    const h1 = wrap(h0 + 90 + r() * 120);
    const l = 0.18 + r() * 0.08;
    return { hexes: ts.map((t) => oklchToHex([lerp(l, 0.86, t ** 0.8), lerp(0.08, 0.24, t), wrap(lerp(h0, h1, t))])), blend: "oklch" };
  }
  if (k === 2) {
    // Pastels that clash on purpose.
    const h1 = wrap(h0 + 120 + r() * 80);
    const l = 0.86 + r() * 0.07, c = 0.07 + r() * 0.05;
    return { hexes: ts.map((t) => oklchToHex([l, c, wrap(lerp(h0, h1, t))])), blend: "oklab" };
  }
  if (k === 3) {
    // A quiet, nearly grey start that wakes up.
    const h1 = wrap(h0 + 150 + r() * 60);
    const l = 0.7 + r() * 0.15;
    return { hexes: ts.map((t) => oklchToHex([lerp(l, 0.6, t), lerp(0.015, 0.2, t ** 1.4), wrap(lerp(h0, h1, t))])), blend: "oklab" };
  }
  // A glow: dark ends and a bright, saturated middle.
  const turn = 60 + r() * 60;
  return {
    hexes: ts.map((t) => {
      const mid = Math.sin(t * Math.PI);
      return oklchToHex([0.25 + mid * 0.6, 0.08 + mid * 0.16, wrap(h0 + (t - 0.5) * turn)]);
    }),
    blend: "oklch",
  };
}

/**
 * New colours for the stops that aren't locked. Tries many and keeps one of the best,
 * judged together with the locked stops.
 */
export function generateGradient(
  stops: GStop[],
  mode: GenMode,
  pool: string[],
  r: () => number = Math.random,
): { stops: GStop[]; blend: Blend } {
  const n = stops.length;
  const locked = stops.map((s) => (s.locked ? s.hex : null));
  const anchorHex = locked.find((x): x is string => !!x);
  const anchor = anchorHex ? lch(anchorHex) : null;
  const tries: { stops: GStop[]; blend: Blend; q: number }[] = [];
  const usePool = mode === "refs" && pool.length >= 2;
  for (let i = 0; i < 70; i++) {
    let hexes: string[], blend: Blend;
    if (usePool) ({ hexes, blend } = fromPool(pool, n, r));
    else ({ hexes, blend } = candidate(mode === "refs" ? "smooth" : mode, n, anchor && r() < 0.7 ? anchor : null, r));
    // A locked stop keeps its colour; its place in the gradient may differ from the candidate's,
    // so try the candidate both ways round.
    const flip = r() < 0.5;
    const out = stops.map((s, j) => ({ ...s, hex: locked[j] ?? (flip ? hexes[n - 1 - j] : hexes[j]) }));
    tries.push({ stops: out, blend, q: quality(out, blend) });
  }
  tries.sort((a, b) => b.q - a.q);
  const pick = tries[Math.floor(r() * Math.min(4, tries.length))];
  return { stops: pick.stops, blend: pick.blend };
}

/** A gradient from colours that already exist: two that blend well, with ones in between that sit on the way. */
function fromPool(pool: string[], n: number, r: () => number): { hexes: string[]; blend: Blend } {
  const a = pool[Math.floor(r() * pool.length)];
  let b = pool[Math.floor(r() * pool.length)];
  for (let k = 0; k < 6 && labDist(toLab(a), toLab(b)) < 0.1; k++) b = pool[Math.floor(r() * pool.length)];
  const blend: Blend = issues({ stops: [{ hex: a, pos: 0 }, { hex: b, pos: 1 }], blend: "oklab" }).some((x) => x.kind === "muddy") ? "oklch" : "oklab";
  const hexes = evenPos(n).map((t, i) => {
    if (i === 0) return a;
    if (i === n - 1) return b;
    // The pool colour closest to where the blend would be, if it's close enough; otherwise the blend itself.
    const want = toLab(mix(a, b, t, blend));
    let best = "", bd = 0.07;
    for (const c of pool) {
      const d = labDist(toLab(c), want);
      if (d < bd && chroma(toLab(c)) >= chroma(want) * 0.8) [best, bd] = [c, d];
    }
    return best || fromLab(want);
  });
  return { hexes, blend };
}

// ---------- suggestions from palettes ----------
export interface Suggestion {
  stops: GStop[];
  blend: Blend;
  q: number;
}

/** Unique colours, near-identical ones counted once. */
export function uniqueColors(hexes: string[]): string[] {
  const out: { hex: string; lab: OkLab }[] = [];
  for (const h of hexes) {
    const lab = toLab(h);
    if (!out.some((o) => labDist(o.lab, lab) < 0.02)) out.push({ hex: h, lab });
  }
  return out.map((o) => o.hex);
}

/** Good gradients made only of colours already in the palettes: pairs, and trios where a third colour sits on the way. */
export function suggest(hexes: string[], max = 12): Suggestion[] {
  const pool = uniqueColors(hexes).slice(0, 80);
  const labs = pool.map(toLab);
  const pairs: Suggestion[] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const d = labDist(labs[i], labs[j]);
      if (d < 0.09 || d > 0.55) continue;
      // Lighter colour first reads well in most layouts.
      const [a, b] = labs[i][0] >= labs[j][0] ? [i, j] : [j, i];
      const stops = [{ hex: pool[a], pos: 0 }, { hex: pool[b], pos: 1 }];
      let blend: Blend = "oklab";
      if (issues({ stops, blend }).length) blend = issues({ stops, blend: "oklch" }).length ? "oklab" : "oklch";
      // Distance around 0.2–0.3 makes the clearest gradients; strong colours add a little.
      const q = quality(stops, blend) - Math.abs(d - 0.25) * 2 + (chroma(labs[i]) + chroma(labs[j])) * 0.8;
      pairs.push({ stops, blend, q });
    }
  pairs.sort((x, y) => y.q - x.q);

  const trios: Suggestion[] = [];
  for (const p of pairs.slice(0, 40)) {
    const a = toLab(p.stops[0].hex), b = toLab(p.stops[1].hex);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let best: { hex: string; t: number; off: number } | null = null;
    labs.forEach((c, k) => {
      const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2;
      if (t < 0.25 || t > 0.75) return;
      const proj: OkLab = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      const off = labDist(c, proj);
      // On the way, and at least as colourful as the straight blend would be there.
      if (off < 0.09 && chroma(c) >= chroma(proj) - 0.01 && (!best || off < best.off)) best = { hex: pool[k], t, off };
    });
    if (best) {
      const m = best as { hex: string; t: number; off: number };
      const stops = [p.stops[0], { hex: m.hex, pos: Math.round(m.t * 100) / 100 }, p.stops[1]];
      trios.push({ stops, blend: "oklab", q: quality(stops, "oklab") + 0.4 });
    }
  }

  // Trios first where they're good, and no two suggestions that look alike.
  const all = [...trios, ...pairs].sort((x, y) => y.q - x.q);
  const out: Suggestion[] = [];
  const sig = (s: Suggestion) => [toLab(s.stops[0].hex), toLab(s.stops[s.stops.length - 1].hex)];
  for (const s of all) {
    const [a, b] = sig(s);
    if (out.some((o) => { const [c, d] = sig(o); return (labDist(a, c) < 0.06 && labDist(b, d) < 0.06) || (labDist(a, d) < 0.06 && labDist(b, c) < 0.06); })) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// ---------- from an image ----------
export type Line = [number, number, number, number];

const SIDE = 160;

/** Average colour around a point (0–1), in OKLab. */
function probe(px: { data: Uint8ClampedArray; w: number; h: number }, x: number, y: number, rad = 2): OkLab | null {
  const cx = Math.round(x * (px.w - 1)), cy = Math.round(y * (px.h - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const X = Math.min(px.w - 1, Math.max(0, cx + dx)), Y = Math.min(px.h - 1, Math.max(0, cy + dy));
      const i = (Y * px.w + X) * 4;
      if (px.data[i + 3] < 128) continue;
      r += px.data[i]; g += px.data[i + 1]; b += px.data[i + 2]; n++;
    }
  return n ? toLab(rgbToHex([r / n, g / n, b / n])) : null;
}

const STEPS = 33;

function along(px: { data: Uint8ClampedArray; w: number; h: number }, line: Line): (OkLab | null)[] {
  const [x1, y1, x2, y2] = line;
  return Array.from({ length: STEPS }, (_, i) => {
    const t = i / (STEPS - 1);
    return probe(px, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  });
}

/** Stops that rebuild the colours along the line best: the ends, then wherever the blend is furthest off. */
function stopsFrom(samples: (OkLab | null)[], n: number): GStop[] {
  const pts = samples.map((l, i) => ({ l, t: i / (samples.length - 1) })).filter((p): p is { l: OkLab; t: number } => !!p.l);
  if (pts.length < 2) return [];
  const picked = [0, pts.length - 1];
  while (picked.length < n) {
    picked.sort((a, b) => a - b);
    let worst = -1, wd = 0;
    for (let s = 0; s < picked.length - 1; s++) {
      const a = pts[picked[s]], b = pts[picked[s + 1]];
      for (let k = picked[s] + 1; k < picked[s + 1]; k++) {
        const t = (pts[k].t - a.t) / (b.t - a.t);
        const want: OkLab = [lerp(a.l[0], b.l[0], t), lerp(a.l[1], b.l[1], t), lerp(a.l[2], b.l[2], t)];
        const d = labDist(want, pts[k].l);
        if (d > wd) [worst, wd] = [k, d];
      }
    }
    if (worst < 0) break;
    picked.push(worst);
  }
  picked.sort((a, b) => a - b);
  // Each stop takes the average of a few samples around it, so a speck doesn't decide its colour.
  return picked.map((k) => {
    const near = pts.slice(Math.max(0, k - 1), k + 2).map((p) => p.l);
    const avg: OkLab = [0, 1, 2].map((c) => near.reduce((s, l) => s + l[c], 0) / near.length) as OkLab;
    return { hex: fromLab(avg), pos: Math.round(pts[k].t * 1000) / 1000 };
  });
}

/** Lines run left to right (top to bottom when upright), so gradients read the usual way. */
export function tidyLine(l: Line): Line {
  const [x1, y1, x2, y2] = l;
  return Math.abs(x2 - x1) > 0.05 ? (x2 < x1 ? [x2, y2, x1, y1] : l) : y2 < y1 ? [x2, y2, x1, y1] : l;
}

/** The CSS angle of a line drawn on an image `w` × `h` pixels, so the gradient runs the way it does in the image. */
export function lineAngle(l: Line, w: number, h: number): number {
  const dx = (l[2] - l[0]) * w, dy = (l[3] - l[1]) * h;
  let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (a < 0) a += 360;
  return Math.round(a / 5) * 5 % 360;
}

/** Stops read along a line on an image. */
export async function stopsAlong(url: string, line: Line, n: number): Promise<GStop[]> {
  const px = await pixels(url, SIDE);
  return stopsFrom(along(px, line), n);
}

/**
 * Finds a line across the image that makes a good gradient: the ends differ clearly,
 * and the colour changes smoothly from one to the other instead of jumping back and forth.
 */
export async function autoLine(url: string, n: number, seed = 0): Promise<{ line: Line; stops: GStop[]; angle: number }> {
  const px = await pixels(url, SIDE);
  const aspect = px.w / px.h;
  const found: { line: Line; score: number; samples: (OkLab | null)[] }[] = [];
  const m = 0.06;
  for (let a = 0; a < 180; a += 15) {
    const rad = (a * Math.PI) / 180;
    // Direction in image space, corrected so angles look right on wide or tall images.
    const dx = Math.cos(rad), dy = Math.sin(rad) * aspect;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    for (const off of [-0.25, 0, 0.25]) {
      const cx = 0.5 - uy * off, cy = 0.5 + ux * off;
      // Furthest the line can go both ways while staying inside the image (with a margin).
      const reach = (sx: number, sy: number) => {
        let t = 2;
        if (sx > 1e-6) t = Math.min(t, (1 - m - cx) / sx); else if (sx < -1e-6) t = Math.min(t, (m - cx) / sx);
        if (sy > 1e-6) t = Math.min(t, (1 - m - cy) / sy); else if (sy < -1e-6) t = Math.min(t, (m - cy) / sy);
        return t;
      };
      const t1 = reach(ux, uy), t0 = reach(-ux, -uy);
      if (t0 <= 0 || t1 <= 0 || t0 + t1 < 0.4) continue;
      const line = tidyLine([cx - ux * t0, cy - uy * t0, cx + ux * t1, cy + uy * t1]);
      const samples = along(px, line);
      const ok = samples.filter((s): s is OkLab => !!s);
      if (ok.length < STEPS * 0.7) continue;
      const ends = labDist(ok[0], ok[ok.length - 1]);
      let path = 0;
      for (let i = 1; i < ok.length; i++) path += labDist(ok[i - 1], ok[i]);
      const smooth = path > 0 ? ends / path : 0;
      const colour = ok.reduce((s, l) => s + chroma(l), 0) / ok.length;
      found.push({ line, samples, score: Math.min(ends, 0.4) * Math.pow(smooth, 1.2) + colour * 0.25 });
    }
  }
  if (!found.length) {
    const line: Line = [0.1, 0.5, 0.9, 0.5];
    return { line, stops: stopsFrom(along(px, line), n), angle: 90 };
  }
  found.sort((a, b) => b.score - a.score);
  // Another go (seed) picks among the next best lines, skipping ones that are nearly the same.
  const distinct: typeof found = [];
  for (const f of found) {
    if (distinct.some((d) => Math.hypot(d.line[0] - f.line[0], d.line[1] - f.line[1]) + Math.hypot(d.line[2] - f.line[2], d.line[3] - f.line[3]) < 0.35)) continue;
    distinct.push(f);
    if (distinct.length >= 6) break;
  }
  const best = distinct[seed % distinct.length];
  return { line: best.line, stops: stopsFrom(best.samples, n), angle: lineAngle(best.line, px.w, px.h) };
}

// ---------- drawing ----------
/** Paints the gradient onto a canvas area, with the blend worked out per pixel column (or ring). */
export function paint(ctx: CanvasRenderingContext2D, g: GradLike, x: number, y: number, w: number, h: number) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const lut = ramp(g, 256).map((h) => hexToRgb(h) ?? [0, 0, 0]);
  const img = ctx.createImageData(W, H);
  const rad = ((g.angle - 90) * Math.PI) / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);
  // Projection range so the gradient spans the box corner to corner, like CSS.
  const half = (Math.abs(ux) * W + Math.abs(uy) * H) / 2;
  const maxR = Math.hypot(W, H) / 2;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const px = i + 0.5 - W / 2, py = j + 0.5 - H / 2;
      const t = g.type === "radial" ? Math.hypot(px, py) / maxR : (px * ux + py * uy) / (2 * half) + 0.5;
      const c = lut[Math.max(0, Math.min(255, Math.round(t * 255)))];
      const k = (j * W + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, x, y, w, h);
}
