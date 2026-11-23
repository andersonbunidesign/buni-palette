// Data model and saving. Everything is kept in the library folder (<home>/Buni Palette):
// palettes.json for projects and palettes, Images/ for reference images and their thumbnails.
import type { Swatch } from "./extract";
import { api, imageUrl } from "./api";
import { bookShort } from "./pantone";
import { formatValue, type ValueMode } from "./color";
import { nearest, type Book } from "./pantone";
import type { Rule } from "./color";
import type { Blend, GenMode, GStop, GradType, Line } from "./gradient";

export interface PColor {
  hex: string;
  /** Pantone name and guide, only in Pantone palettes. */
  pantone?: string;
  book?: Book;
  /** "White" or "Black" chosen instead of a Pantone colour: printed as process, exactly 0/0/0/0 or 0/0/0/100. */
  label?: "White" | "Black";
  /** For a Pantone, White or Black colour: the colour it was before, to go back to. */
  orig?: string;
  /** Where the colour was picked in the source image (0–1). */
  x?: number;
  y?: number;
}

export interface Palette {
  id: string;
  name: string;
  /** "pantone": made by To Pantone; it can mix Pantone and process colours. */
  kind: "rgb" | "pantone";
  colors: PColor[];
  /** Reference image the colours came from, if any. */
  imageId?: string;
  created: number;
}

export interface RefImage {
  id: string;
  /** Image file and its small thumbnail, in the Images folder. */
  file: string;
  thumb: string;
  w: number;
  h: number;
  name: string;
  count: number;
  auto: Swatch[];
  picked: Swatch[];
  /** Changed by Resample, so the automatic colours come out different. */
  seed?: number;
  /** The order the colours were dragged into (keys from swatchKey); unset means automatic first, then picked. */
  order?: string[];
  /** Gradient mode: the line the gradient is read along (0–1), how many stops, and which automatic line. */
  gline?: Line;
  gstops?: number;
  gseed?: number;
  /** Photos saved from Explore: who took them, for the credit Unsplash asks for. */
  source?: { author: string; authorUrl: string; photoUrl: string; keyword: string };
}

export const swatchKey = (s: { hex: string; x: number; y: number }) => `${s.hex}@${s.x.toFixed(4)},${s.y.toFixed(4)}`;

/** An image's colours in the order shown: the dragged order if there is one, new colours at the end. */
export function refColors(r: RefImage): { s: import("./extract").Swatch; auto: boolean }[] {
  const all = [...r.auto.map((s) => ({ s, auto: true })), ...r.picked.map((s) => ({ s, auto: false }))];
  if (!r.order?.length) return all;
  const at = new Map(r.order.map((k, i) => [k, i]));
  return all
    .map((c, i) => ({ c, i, o: at.get(swatchKey(c.s)) }))
    .sort((a, b) => (a.o ?? 1e6 + a.i) - (b.o ?? 1e6 + b.i))
    .map((x) => x.c);
}

export const refUrl = (r: RefImage) => imageUrl(r.file);
export const thumbUrl = (r: RefImage) => imageUrl(r.thumb || r.file);

export interface Gradient {
  id: string;
  name: string;
  type: GradType;
  /** CSS angle for linear gradients: 0 points up, 90 points right. */
  angle: number;
  stops: GStop[];
  blend: Blend;
  /** Reference image it was read from, and the line it was read along (0–1 coordinates). */
  imageId?: string;
  line?: Line;
  created: number;
}

export interface Project {
  id: string;
  name: string;
  refs: RefImage[];
  palettes: Palette[];
  /** Missing in data from before 1.2. */
  gradients?: Gradient[];
  example?: boolean;
}

/** The gradient editor's state, per project. */
export interface GradState {
  type: GradType;
  angle: number;
  stops: GStop[];
  blend: Blend;
  mode: GenMode;
  /** Gradient being edited, if any. */
  editing?: string;
  /** Name base for a new gradient (the keyword in Keywords); the project name otherwise. */
  name?: string;
  /** What it looked like when opened or last saved (gradSig), to tell if there are unsaved changes. */
  baseline?: string;
  /** The saved gradient as it was when opened, for Original. */
  original?: Omit<Gradient, "id" | "name" | "created">;
  imageId?: string;
  line?: Line;
  /** Where Back (and Esc) goes. */
  from?: "gradients" | "refs" | "explore";
}

export const gradSig = (g: { type: GradType; angle: number; stops: GStop[]; blend: Blend }) =>
  JSON.stringify([g.type, Math.round(g.angle), g.blend, [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => [s.hex, Math.round(s.pos * 1000)])]);

export const gradientsOf = (p: Project) => p.gradients ?? [];

/** Default gradient name: the project name (or keyword) and the next free number. */
export function nextGradName(project: Project, base = project.name): string {
  const names = new Set(gradientsOf(project).map((g) => g.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export interface GenState {
  colors: string[];
  locked: boolean[];
  rule: Rule;
  fromRefs: boolean;
  /** Palette being edited, if the generator was opened from one. */
  editing?: string;
  /** Colours when the generator was opened or last saved, to tell if there are unsaved changes. */
  baseline?: string[];
  /** Where Back (and Esc) goes. */
  from?: "refs" | "palettes" | "explore";
  /** Pantone (or White / Black) details of each colour, by position; empty for plain colours. */
  meta?: (ColorMeta | null)[];
  baselineMeta?: (ColorMeta | null)[];
}

/** What makes a colour more than its hex: a Pantone name, or White / Black, and the colour it was before. */
export interface ColorMeta {
  hex: string;
  pantone?: string;
  book?: Book;
  label?: "White" | "Black";
  orig?: string;
}

export const metaOf = (c: PColor): ColorMeta | null =>
  c.pantone || c.label ? { hex: c.hex, pantone: c.pantone, book: c.book, label: c.label, orig: c.orig } : null;

/**
 * Lines the details up with the colours after a change. A detail stays with its colour when the colour moves;
 * a colour that changed loses it (it's no longer that Pantone).
 */
export function alignMeta(colors: string[], meta?: (ColorMeta | null)[]): (ColorMeta | null)[] {
  if (!meta?.some(Boolean)) return colors.map(() => null);
  const pool = meta.filter((m): m is ColorMeta => !!m);
  const used = new Set<ColorMeta>();
  const out = colors.map((h, i) => {
    const same = meta[i];
    if (same && same.hex === h && !used.has(same)) {
      used.add(same);
      return same;
    }
    return null;
  });
  return out.map((m, i) => {
    if (m) return m;
    const hit = pool.find((x) => !used.has(x) && x.hex === colors[i]);
    if (hit) used.add(hit);
    return hit ?? null;
  });
}

/** A palette is a Pantone palette when any colour is Pantone, White or Black. */
export const kindOf = (colors: PColor[]): Palette["kind"] => (colors.some((c) => c.pantone || c.label) ? "pantone" : "rgb");
export const hasPantone = (p: Palette) => p.colors.some((c) => c.pantone);
/** Colours To Pantone still has to match. */
export const hasProcess = (p: Palette) => p.colors.some((c) => !c.pantone && !c.label);
/** Turns every Pantone (and White / Black) colour back into the colour it was before. */
export const withoutPantone = (p: Palette): Palette => ({
  ...p,
  kind: "rgb",
  colors: p.colors.map((c) => (c.pantone || c.label ? { hex: c.orig ?? c.hex, x: c.x, y: c.y } : c)),
});

export interface AppState {
  projects: Project[];
  current: string;
  mode: ValueMode;
  /** Pantone guides searched when converting. */
  books: Book[];
  /** Projects whose palettes are hidden in the sidebar. */
  collapsed?: string[];
  /** Sidebar sections closed inside a project: "<project id>:p" for Palettes, "<project id>:g" for Gradients. */
  closedSections?: string[];
  /** Gradient editor, per project. */
  grad?: Record<string, GradState>;
  gen: Record<string, GenState>;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function sampleState(): AppState {
  const rgb1: Palette = {
    id: uid(), name: "Rye and linen", kind: "rgb", created: Date.now() - 4000,
    colors: ["#2F3A2F", "#7C8A5A", "#D9C9A8", "#F2EBDD", "#B5532E"].map((hex) => ({ hex })),
  };
  const rgb2: Palette = {
    id: uid(), name: "Harbour morning", kind: "rgb", created: Date.now() - 3000,
    colors: ["#1D3557", "#457B9D", "#A8DADC", "#F1FAEE", "#E63946"].map((hex) => ({ hex })),
  };
  const rgb3: Palette = {
    id: uid(), name: "Two-colour label", kind: "rgb", created: Date.now() - 2000,
    colors: ["#3B2A4A", "#F4C542"].map((hex) => ({ hex })),
  };
  const pms: Palette = {
    id: uid(), name: "Rye and linen · Pantone", kind: "pantone", created: Date.now() - 1000,
    colors: rgb1.colors.map((c) => {
      const best = nearest(c.hex, ["SC", "PC"], 1)[0];
      return { hex: best.hex, pantone: best.name, book: best.book };
    }),
  };
  const gradients: Gradient[] = [
    { id: uid(), name: "Example project 1", type: "linear", angle: 135, blend: "oklab", created: Date.now() - 900, stops: [{ hex: "#F2EBDD", pos: 0 }, { hex: "#D9C9A8", pos: 0.45 }, { hex: "#B5532E", pos: 1 }] },
    { id: uid(), name: "Example project 2", type: "linear", angle: 90, blend: "oklab", created: Date.now() - 800, stops: [{ hex: "#A8DADC", pos: 0 }, { hex: "#457B9D", pos: 0.55 }, { hex: "#1D3557", pos: 1 }] },
  ];
  const p: Project = { id: uid(), name: "Example project", refs: [], palettes: [rgb1, pms, rgb2, rgb3], gradients, example: true };
  return { projects: [p], current: p.id, mode: "hex", books: ["SC", "PC"], gen: {} };
}

let timer = 0;
let pending: AppState | null = null;
/** Saves to the library folder a moment after the last change. */
export function saveState(s: AppState) {
  pending = s;
  clearTimeout(timer);
  timer = window.setTimeout(flushState, 400);
}
/** Writes a change that is still waiting (before the window closes). */
export async function flushState() {
  clearTimeout(timer);
  const s = pending;
  pending = null;
  if (!s) return;
  try {
    await api.saveData(JSON.stringify(s));
  } catch (e) {
    onSaveError?.(e);
  }
}
let onSaveError: ((e: unknown) => void) | null = null;
export const setSaveErrorHandler = (fn: (e: unknown) => void) => (onSaveError = fn);

/** Brings data saved by an older version up to date. */
export function migrate(s: AppState): AppState {
  const books = Array.isArray(s.books) && s.books.length ? s.books : (["SC", "PC"] as Book[]);
  const projects = s.projects.map((p) => ({
    ...p,
    palettes: p.palettes.map((pal) => {
      const old = pal as Palette & { book?: string; sourceId?: string; sourceHexes?: string[] };
      const legacy: Book | undefined = old.book === "C" ? "SC" : old.book === "U" ? "SU" : undefined;
      const { book: _b, sourceId: _s, sourceHexes: _h, ...rest } = old;
      return { ...rest, colors: rest.colors.map((c) => (c.pantone && !c.book ? { ...c, book: legacy ?? (c.pantone.endsWith(" U") ? "SU" : "SC") } : c)) } as Palette;
    }),
  }));
  return { ...s, books, projects: projects.map((p) => ({ ...p, refs: (p.refs ?? []).filter((r) => !!r.file), gradients: p.gradients ?? [] })) };
}

/** Short guide label for a Pantone palette, e.g. "C" or "C + P&N C". */
export function paletteBooks(p: Palette): Book[] {
  return Array.from(new Set(p.colors.map((c) => c.book).filter((b): b is Book => !!b)));
}

/** Tag of a Pantone palette: "PANTONE C", "PANTONE C + P&N C + 1 process". */
export function paletteTag(p: Palette): string {
  const books = paletteBooks(p);
  const process = p.colors.filter((c) => !c.pantone).length;
  const head = books.length ? `PANTONE ${books.map(bookShort).join(" + ")}` : "PANTONE";
  return process ? `${head} + ${process} process` : head;
}

/** What a colour is called in lists: its Pantone name, White/Black, or its value. */
export function colorLabel(c: PColor, mode: ValueMode): string {
  if (c.pantone) return c.pantone.replace(/^PANTONE /, "");
  if (c.label) return c.label;
  return formatValue(c.hex, mode);
}

/** The value copied to the clipboard for a colour. */
export function colorCopy(c: PColor, mode: ValueMode): string {
  return c.pantone ?? (c.label ? `${c.label} ${formatValue(c.hex, mode)}` : formatValue(c.hex, mode));
}

/** Default palette name: the project name and the next free number. */
export function nextName(project: Project, base = project.name): string {
  const names = new Set(project.palettes.map((p) => p.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
