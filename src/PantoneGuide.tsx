// The Pantone guides as a grid of swatches, arranged by hue (neutrals at the end),
// with your colour pinned and the closest matches marked. Used in To Pantone and in the colour box.
import { useEffect, useMemo, useRef, useState } from "react";
import { deltaE2000, hexToLab, readableInk } from "./color";
import { BOOKS, bookShort, guideColors, matchWord, type Book, type Candidate, type PantoneColor } from "./pantone";
import { IconCheck, IconX } from "./icons";

/** Colour families by Lab hue angle; anything with very little colour goes to Neutrals. */
const FAMILIES: { name: string; from: number; to: number }[] = [
  { name: "Pinks", from: 345, to: 20 },
  { name: "Reds", from: 20, to: 45 },
  { name: "Oranges and browns", from: 45, to: 70 },
  { name: "Yellows", from: 70, to: 100 },
  { name: "Yellow greens", from: 100, to: 130 },
  { name: "Greens", from: 130, to: 170 },
  { name: "Teals", from: 170, to: 215 },
  { name: "Blues", from: 215, to: 275 },
  { name: "Violets", from: 275, to: 315 },
  { name: "Purples", from: 315, to: 345 },
];
const NEUTRAL_CHROMA = 7;

interface Swatch extends PantoneColor {
  hue: number;
  chroma: number;
  family: number; // index in FAMILIES, or -1 for Neutrals
}

const swatchCache = new Map<Book, Swatch[]>();
function swatches(b: Book): Swatch[] {
  let list = swatchCache.get(b);
  if (!list) {
    list = guideColors(b).map((p) => {
      const [, a, bb] = p.lab;
      const chroma = Math.hypot(a, bb);
      let hue = (Math.atan2(bb, a) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      const family = chroma < NEUTRAL_CHROMA ? -1 : FAMILIES.findIndex((f) => (f.from < f.to ? hue >= f.from && hue < f.to : hue >= f.from || hue < f.to));
      return { ...p, hue, chroma, family };
    });
    swatchCache.set(b, list);
  }
  return list;
}

/** Hue order, rotating so the pinks that wrap past 0° sort first. */
const hueKey = (s: Swatch) => (s.hue + 360 - 345) % 360;
const byHue = (a: Swatch, b: Swatch) => hueKey(a) - hueKey(b) || b.lab[0] - a.lab[0];
/** Inside a family: light to dark in bands, and along the hue inside each band, so the grid reads as a ramp. */
const band = (s: Swatch) => Math.floor((100 - s.lab[0]) / 9);
const byShade = (a: Swatch, b: Swatch) => band(a) - band(b) || hueKey(a) - hueKey(b);

const short = (name: string) => name.replace(/^PANTONE /, "");
const norm = (t: string) => t.toLowerCase().replace(/^\s*pantone\s*/, "").replace(/\s+/g, " ").trim();

function matches(s: Swatch, q: string) {
  if (!q) return true;
  return norm(s.name).includes(q);
}

function useClosest(hex: string, list: Swatch[], n: number) {
  return useMemo(() => {
    const lab = hexToLab(hex);
    return list
      .map((s) => ({ s, dE: deltaE2000(lab, s.lab) }))
      .sort((a, b) => a.dE - b.dE)
      .slice(0, n);
  }, [hex, list, n]);
}

function Square({ s, rank, onHover, onPick, size }: { s: Swatch; rank?: number; onHover: (s: Swatch | null) => void; onPick: (s: Swatch) => void; size?: number }) {
  return (
    <button
      type="button"
      className={`pg-sq${rank ? " near" : ""}`}
      style={{ background: s.hex, width: size, height: size, color: readableInk(s.hex) }}
      title={`${short(s.name)} · ${s.hex}`}
      aria-label={short(s.name)}
      onMouseEnter={() => onHover(s)}
      onFocus={() => onHover(s)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(s)}
    >
      {rank ? <span>{rank}</span> : null}
    </button>
  );
}

function Status({ hex, s }: { hex: string; s: Swatch | null }) {
  const dE = s ? deltaE2000(hexToLab(hex), s.lab) : 0;
  return (
    <div className="pg-status" aria-live="polite">
      <span className="pg-pair">
        <i style={{ background: hex }} />
        <i style={{ background: s ? s.hex : hex }} />
      </span>
      {s ? (
        <span className="pg-info">
          <b>{short(s.name)}</b>
          <span>
            ΔE <b className="num">{dE.toFixed(1)}</b> · {matchWord(dE)} · {s.hex} · {bookShort(s.book)}
          </span>
        </span>
      ) : (
        <span className="pg-info">
          <b>Your colour</b>
          <span>Point at a swatch to compare. The numbered ones are the closest.</span>
        </span>
      )}
    </div>
  );
}

const toCandidate = (s: Swatch, hex: string): Candidate => ({ name: s.name, hex: s.hex, lab: s.lab, book: s.book, dE: deltaE2000(hexToLab(hex), s.lab) });

/** Compact version for the colour box: the closest swatches by hue, a search, and a way into the whole guide. */
export function PantoneMini({ hex, books, onPick, onOpenGuide }: { hex: string; books: Book[]; onPick: (c: Candidate) => void; onOpenGuide: () => void }) {
  const list = useMemo(() => books.flatMap(swatches), [books]);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<Swatch | null>(null);
  const closest = useClosest(hex, list, 45);
  const rank = new Map(closest.slice(0, 5).map((c, i) => [c.s.name, i + 1]));
  const query = norm(q);
  const shown = query ? list.filter((s) => matches(s, query)).slice(0, 63) : closest.map((c) => c.s).sort(byHue);
  return (
    <div className="pg-mini">
      <input id="pg-mini-q" className="field" placeholder="Find a number, e.g. 165" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a Pantone" />
      <Status hex={hex} s={hover} />
      <div className="pg-mini-grid">
        {shown.map((s) => (
          <Square key={s.name} s={s} rank={rank.get(s.name)} onHover={setHover} onPick={(x) => onPick(toCandidate(x, hex))} />
        ))}
        {!shown.length && <span className="sw-label">No Pantone with that number in these guides.</span>}
      </div>
      <button type="button" className="btn small" onClick={onOpenGuide}>
        See the whole guide
      </button>
    </div>
  );
}

/** The whole guide in a large window, arranged by hue. */
export function PantoneGuideDialog({ hex, books: initial, onPick, onClose }: { hex: string; books: Book[]; onPick: (c: Candidate) => void; onClose: () => void }) {
  const [books, setBooks] = useState<Book[]>(initial.length ? initial : ["SC"]);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<Swatch | null>(null);
  const list = useMemo(() => books.flatMap(swatches), [books]);
  const closest = useClosest(hex, list, 5);
  const rank = new Map(closest.map((c, i) => [c.s.name, i + 1]));
  const query = norm(q);
  const bodyRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const out: { name: string; items: Swatch[] }[] = FAMILIES.map((f) => ({ name: f.name, items: [] as Swatch[] }));
    const neutrals: Swatch[] = [];
    for (const s of list) {
      if (!matches(s, query)) continue;
      if (s.family < 0) neutrals.push(s);
      else out[s.family].items.push(s);
    }
    out.forEach((g) => g.items.sort(byShade));
    neutrals.sort((a, b) => b.lab[0] - a.lab[0]);
    return [...out, { name: "Neutrals", items: neutrals }].filter((g) => g.items.length);
  }, [list, query]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);

  const pick = (s: Swatch) => {
    onPick(toCandidate(s, hex));
    onClose();
  };
  const toggle = (b: Book) => setBooks((cur) => (cur.includes(b) ? (cur.length > 1 ? cur.filter((x) => x !== b) : cur) : BOOKS.map((x) => x.id).filter((id) => id === b || cur.includes(id))));
  const jumpToClosest = () => bodyRef.current?.querySelector(".pg-sq.near")?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="overlay pg-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog pg-dialog" role="dialog" aria-label="Pantone guide">
        <div className="pg-head">
          <div className="pg-title">
            <h2>Pantone guide</h2>
            <span className="sw-label">{list.length} colours, by hue. Click one to use it.</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="pg-tools">
          <div className="book-row" role="group" aria-label="Guides">
            {BOOKS.map((b) => (
              <button key={b.id} type="button" className="chip-btn" aria-pressed={books.includes(b.id)} onClick={() => toggle(b.id)}>
                {books.includes(b.id) && <IconCheck size={14} />} {b.label}
              </button>
            ))}
          </div>
          <input id="pg-q" className="field pg-search" placeholder="Find a number, e.g. 165 or Cool Gray" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a Pantone" />
        </div>
        <div className="pg-bar">
          <Status hex={hex} s={hover} />
          <div className="pg-closest">
            <span className="label">Closest</span>
            {closest.map((c, i) => (
              <button key={c.s.name} type="button" className="pg-chip" onMouseEnter={() => setHover(c.s)} onMouseLeave={() => setHover(null)} onClick={() => pick(c.s)} title={`ΔE ${c.dE.toFixed(1)}`}>
                <i style={{ background: c.s.hex }} />
                <span>
                  {i + 1}. {short(c.s.name)}
                </span>
              </button>
            ))}
            <button type="button" className="link" onClick={jumpToClosest}>
              Show in the grid
            </button>
          </div>
        </div>
        <div className="pg-body" ref={bodyRef}>
          {groups.map((g) => (
            <section key={g.name} className="pg-group">
              <h3>
                {g.name} <span className="num">{g.items.length}</span>
              </h3>
              <div className="pg-grid">
                {g.items.map((s) => (
                  <Square key={s.name} s={s} rank={rank.get(s.name)} onHover={setHover} onPick={pick} />
                ))}
              </div>
            </section>
          ))}
          {!groups.length && <p className="muted">No Pantone with that number in these guides.</p>}
        </div>
      </div>
    </div>
  );
}
