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
      const [code, h] = item.split("|");
      const hex = "#" + h.toUpperCase();
      return { name: `PANTONE ${code} ${suffix}`, hex, lab: hexToLab(hex), book: b };
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
