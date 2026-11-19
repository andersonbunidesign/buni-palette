// Data model and saving. Everything is kept in the library folder (<home>/Buni Palette):
// palettes.json for projects and palettes, Images/ for reference images and their thumbnails.
import type { Swatch } from "./extract";
import { api, imageUrl } from "./api";
import { bookShort } from "./pantone";
import { formatValue, type ValueMode } from "./color";
import { nearest, type Book } from "./pantone";
import type { Rule } from "./color";

export interface PColor {
  hex: string;
  /** Pantone name and guide, only in Pantone palettes. */
  pantone?: string;
  book?: Book;
  /** "White" or "Black" chosen instead of a Pantone colour: printed as process, exactly 0/0/0/0 or 0/0/0/100. */
  label?: "White" | "Black";
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
  /** Photos saved from Explore: who took them, for the credit Unsplash asks for. */
  source?: { author: string; authorUrl: string; photoUrl: string; keyword: string };
}

export const refUrl = (r: RefImage) => imageUrl(r.file);
export const thumbUrl = (r: RefImage) => imageUrl(r.thumb || r.file);

export interface Project {
  id: string;
  name: string;
  refs: RefImage[];
  palettes: Palette[];
  example?: boolean;
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
}

export interface AppState {
  projects: Project[];
  current: string;
  mode: ValueMode;
  /** Pantone guides searched when converting. */
  books: Book[];
  /** Projects whose palettes are hidden in the sidebar. */
  collapsed?: string[];
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
  const p: Project = { id: uid(), name: "Example project", refs: [], palettes: [rgb1, pms, rgb2, rgb3], example: true };
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
  return { ...s, books, projects: projects.map((p) => ({ ...p, refs: (p.refs ?? []).filter((r) => !!r.file) })) };
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
