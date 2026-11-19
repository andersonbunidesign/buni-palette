// Data model and saving. In the web prototype everything is kept in this browser
// (IndexedDB); the desktop app will keep it in a library folder like the Font Manager.
import type { Swatch } from "./extract";
import { nearest, type Book } from "./pantone";
import type { Rule, ValueMode } from "./color";

export interface PColor {
  hex: string;
  /** Pantone name and guide, only in Pantone palettes. */
  pantone?: string;
  book?: Book;
  /** Where the colour was picked in the source image (0–1). */
  x?: number;
  y?: number;
}

export interface Palette {
  id: string;
  name: string;
  kind: "rgb" | "pantone";
  colors: PColor[];
  /** Reference image the colours came from, if any. */
  imageId?: string;
  created: number;
}

export interface RefImage {
  id: string;
  url: string;
  w: number;
  h: number;
  name: string;
  count: number;
  auto: Swatch[];
  picked: Swatch[];
}

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
  from?: "refs" | "palettes";
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

const DB = "buni-palette";
const STORE = "state";

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    } catch (e) {
      fail(e);
    }
  });
}

export async function loadState(): Promise<AppState | null> {
  try {
    const db = await open();
    return await new Promise((ok) => {
      const req = db.transaction(STORE).objectStore(STORE).get("app");
      req.onsuccess = () => ok((req.result as AppState) ?? null);
      req.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}

let timer = 0;
export function saveState(s: AppState) {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    try {
      const db = await open();
      db.transaction(STORE, "readwrite").objectStore(STORE).put(s, "app");
    } catch {
      /* Saving isn't available here (private window); the app still works for this visit. */
    }
  }, 300);
}

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
  return { ...s, books, projects };
}

/** Short guide label for a Pantone palette, e.g. "C" or "C + P&N C". */
export function paletteBooks(p: Palette): Book[] {
  return Array.from(new Set(p.colors.map((c) => c.book).filter((b): b is Book => !!b)));
}

/** Default palette name: the project name and the next free number. */
export function nextName(project: Project, base = project.name): string {
  const names = new Set(project.palettes.map((p) => p.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
