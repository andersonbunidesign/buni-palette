import { deltaE2000, hexToLab, Lab } from "./color";
import { SC, SU, PC, PU } from "./pantoneData";

/** The Pantone guides the app can search. */
export type Book = "SC" | "SU" | "PC" | "PU";

export const BOOKS: { id: Book; label: string; short: string; suffix: "C" | "U" }[] = [
  { id: "SC", label: "Solid Coated", short: "C", suffix: "C" },
  { id: "SU", label: "Solid Uncoated", short: "U", suffix: "U" },
  { id: "PC", label: "Pastels & Neons Coated", short: "P&N C", suffix: "C" },
  { id: "PU", label: "Pastels & Neons Uncoated", short: "P&N U", suffix: "U" },
];

export interface PantoneColor { name: string; hex: string; lab: Lab; book: Book }
export interface Candidate extends PantoneColor { dE: number }

const RAW: Record<Book, string> = { SC, SU, PC, PU };
const cache: Partial<Record<Book, PantoneColor[]>> = {};

function load(b: Book): PantoneColor[] {
  if (!cache[b]) {
    const suffix = BOOKS.find((x) => x.id === b)!.suffix;
    cache[b] = RAW[b].split(";").map((item) => {
      const [code, h, l] = item.split("|");
      const hex = "#" + h.toUpperCase();
      // The guide's own Lab is used for matching: the hex is clipped to what a screen can show,
      // which matters for neons and other very bright colours.
      const lab = l ? (l.split(",").map(Number) as Lab) : hexToLab(hex);
      return { name: `PANTONE ${code} ${suffix}`, hex, lab, book: b };
    });
  }
  return cache[b]!;
}

/** The closest colours across the chosen guides by Delta E 2000, best first. */
export function nearest(hex: string, books: Book[], count = 5): Candidate[] {
  const lab = hexToLab(hex);
  return books
    .flatMap((b) => load(b))
    .map((p) => ({ ...p, dE: deltaE2000(lab, p.lab) }))
    .sort((x, y) => x.dE - y.dE)
    .slice(0, count);
}

export function bookShort(b: Book): string {
  return BOOKS.find((x) => x.id === b)?.short ?? b;
}

export function matchWord(dE: number): string {
  if (dE < 1) return "Same";
  if (dE < 2) return "Very close";
  if (dE < 3.5) return "Close";
  if (dE < 6) return "Noticeable";
  return "Far";
}

const norm = (t: string) => t.toLowerCase().replace(/^\s*pantone\s*/, "").replace(/[\s-]+/g, " ").trim();

/**
 * Finds a Pantone colour by the code you type: "165", "165 C", "PANTONE 165 U", "Cool Gray 9", "9224".
 * A C or U at the end picks coated or uncoated; otherwise the guides in use come first.
 * Returns it with its Delta E to `hex`, or null when no guide has that code.
 */
export function findCode(query: string, hex: string, preferred: Book[]): Candidate | null {
  let q = norm(query);
  if (!q) return null;
  let suffix: "C" | "U" | null = null;
  const m = q.match(/^(.*?)\s*([cu])$/);
  if (m && m[1] && /\d|gray|black|yellow|red|blue|green|violet|purple|pink|orange|magenta|rubine|rhodamine|reflex/.test(m[1])) {
    q = m[1].trim();
    suffix = m[2].toUpperCase() as "C" | "U";
  }
  const order = [...preferred, ...BOOKS.map((b) => b.id).filter((b) => !preferred.includes(b))];
  const lab = hexToLab(hex);
  for (const b of order) {
    if (suffix && BOOKS.find((x) => x.id === b)!.suffix !== suffix) continue;
    const hit = load(b).find((p) => norm(p.name.replace(/ [CU]$/, "")) === q);
    if (hit) return { ...hit, dE: deltaE2000(lab, hit.lab) };
  }
  return null;
}
