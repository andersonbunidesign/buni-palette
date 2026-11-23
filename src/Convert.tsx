import { useMemo, useState } from "react";
import type { Ctx } from "./App";
import { Palette, PColor, uid } from "./store";
import { BOOKS, bookShort, findCode, nearest, matchWord, type Book, type Candidate } from "./pantone";
import { PantoneGuideDialog } from "./PantoneGuide";
import { formatValue } from "./color";

/** Besides a Pantone colour, each colour can stay as it is or become plain white or black (process). */
type Other = "keep" | "white" | "black";
const OTHER: { id: Other; label: string; help: string }[] = [
  { id: "keep", label: "Keep as is", help: "Printed in process colours" },
  { id: "white", label: "White", help: "Paper or white ink, 0/0/0/0" },
  { id: "black", label: "Black", help: "Process black, 0/0/0/100" },
];
import { IconCheck } from "./icons";

/** Pick a Pantone colour for each colour of a palette; the result is a new, separate palette. */
export function Convert({ ctx, palette, onDone, onCancel }: { ctx: Ctx; palette: Palette; onDone: () => void; onCancel: () => void }) {
  const books = ctx.state.books;
  // A colour that already is Pantone (or White / Black) is matched from the colour it was before.
  const base = (c: PColor) => ((c.pantone || c.label) && c.orig ? c.orig : c.hex);
  const cands = useMemo(() => palette.colors.map((c) => nearest(base(c), books, 5)), [palette, books]); // eslint-disable-line react-hooks/exhaustive-deps
  // The closest match is picked for each colour; picks reset when the guides change.
  // A pick is a Pantone name or one of the other choices.
  // Colours that already are Pantone, White or Black start with that choice.
  const initialPicks = () => {
    const out: Record<number, string> = {};
    palette.colors.forEach((c, i) => {
      if (c.pantone) out[i] = c.pantone;
      else if (c.label === "White") out[i] = "white";
      else if (c.label === "Black") out[i] = "black";
    });
    return out;
  };
  const [picks, setPicks] = useState<Record<number, string>>(initialPicks);
  // A Pantone typed in by hand for a colour (any code, from any guide).
  // Colours that are already Pantone keep it, shown as a choice of their own.
  const [typed, setTyped] = useState<Record<number, Candidate>>(() => {
    const out: Record<number, Candidate> = {};
    palette.colors.forEach((c, i) => {
      const hit = c.pantone ? findCode(c.pantone, base(c), c.book ? [c.book] : books) : null;
      if (hit) out[i] = hit;
    });
    return out;
  });
  const [guideFor, setGuideFor] = useState<number | null>(null);
  const [query, setQuery] = useState<Record<number, string>>({});
  const [notFound, setNotFound] = useState<Record<number, boolean>>({});
  const chosen = (i: number) =>
    cands[i].find((c) => c.name === picks[i]) ??
    (typed[i]?.name === picks[i] ? typed[i] : null) ??
    (OTHER.some((o) => o.id === picks[i]) ? null : cands[i][0]);
  const lookUp = (i: number, hex: string) => {
    const q = (query[i] ?? "").trim();
    if (!q) return;
    const hit = findCode(q, hex, books);
    setNotFound((s) => ({ ...s, [i]: !hit }));
    if (!hit) return;
    const inList = cands[i].some((c) => c.name === hit.name);
    if (!inList) setTyped((s) => ({ ...s, [i]: hit }));
    setPicks((s) => ({ ...s, [i]: hit.name }));
    setQuery((s) => ({ ...s, [i]: "" }));
  };
  const other = (i: number) => (OTHER.find((o) => o.id === picks[i])?.id ?? null) as Other | null;

  const toggleBook = (b: Book) => {
    const next = books.includes(b) ? books.filter((x) => x !== b) : [...books, b];
    if (!next.length) {
      ctx.toast("Keep at least one guide on.");
      return;
    }
    ctx.setBooks(BOOKS.map((x) => x.id).filter((id) => next.includes(id)));
    setPicks(initialPicks());
  };

  const save = () => {
    const pal: Palette = {
      id: uid(),
      name: `${palette.name} · Pantone`,
      kind: "pantone",
      created: Date.now(),
      imageId: palette.imageId,
      colors: palette.colors.map((c, i): PColor => {
        const p = chosen(i);
        // The colour before it became Pantone is kept, so it can go back to it later.
        const orig = c.pantone || c.label ? c.orig : c.hex;
        if (p) return { hex: p.hex, pantone: p.name, book: p.book, orig, x: c.x, y: c.y };
        const o = other(i);
        if (o === "white") return { hex: "#FFFFFF", label: "White", orig, x: c.x, y: c.y };
        if (o === "black") return { hex: "#000000", label: "Black", orig, x: c.x, y: c.y };
        return { hex: c.hex, x: c.x, y: c.y };
      }),
    };
    if (!pal.colors.some((c) => c.pantone)) {
      ctx.toast("Pick a Pantone colour for at least one colour.");
      return;
    }
    ctx.updateProject((p) => ({ ...p, palettes: [...p.palettes, pal] }));
    ctx.toast(`Created "${pal.name}"`);
    onDone();
  };

  return (
    <>
      <div className="titlebar">
        <div>
          <p className="kicker">To Pantone · {ctx.project.name}</p>
          <h1>{palette.name}</h1>
        </div>
      </div>
      <div className="book-row" role="group" aria-label="Pantone guides to search">
        <span className="label">Search in</span>
        {BOOKS.map((b) => (
          <button key={b.id} type="button" className="chip-btn" aria-pressed={books.includes(b.id)} onClick={() => toggleBook(b.id)}>
            {books.includes(b.id) && <IconCheck size={14} />} {b.label}
          </button>
        ))}
      </div>
      <p className="note">
        The five closest colours across the guides you chose, by Delta E 2000 (under 2 is hard to tell apart, over 5 is clearly
        different). The closest one is picked for you. A colour can also stay as it is, or become white or black: those print as process
        colours, so a palette can mix Pantone and process. Screen values are approximations, and neons always look duller on screen
        than in print: confirm your picks in the printed guide.
      </p>

      <div className="conv">
        {palette.colors.map((c, i) => {
          const pick = chosen(i);
          return (
            <div key={i} className="conv-row">
              <div className="conv-src">
                <div className="block" style={{ background: base(c) }} />
                <b className="num">{c.pantone ? c.pantone.replace(/^PANTONE /, "") : c.label ?? c.hex}</b>
                <span>{formatValue(c.hex, ctx.mode === "hex" ? "rgb" : ctx.mode)}</span>
              </div>
              <div className="cands" role="radiogroup" aria-label={`Pantone options for ${c.hex}`}>
                {[...cands[i], ...(typed[i] && !cands[i].some((c) => c.name === typed[i].name) ? [typed[i]] : [])].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={`cand${typed[i]?.name === p.name ? " typed" : ""}`}
                    role="radio"
                    aria-checked={pick?.name === p.name}
                    onClick={() => setPicks((s) => ({ ...s, [i]: p.name }))}
                  >
                    <span className="pair" title="Top: your colour. Bottom: the Pantone colour.">
                      <i style={{ background: base(c) }} />
                      <i style={{ background: p.hex }} />
                    </span>
                    <span className="meta">
                      <b>{p.name.replace(/^PANTONE /, "")}</b>
                      <span>
                        ΔE <span className="de">{p.dE.toFixed(1)}</span> · {matchWord(p.dE)}
                      </span>
                      {books.length > 1 && <span className="book-tag">{bookShort(p.book)}</span>}
                    </span>
                  </button>
                ))}
                <form
                  className="cand-find"
                  onSubmit={(e) => {
                    e.preventDefault();
                    lookUp(i, base(c));
                  }}
                >
                  <input
                    id={`find-${i}`}
                    className={`field${notFound[i] ? " bad" : ""}`}
                    placeholder="Type a Pantone, e.g. 165 C"
                    aria-label={`Type a Pantone for colour ${i + 1}`}
                    value={query[i] ?? ""}
                    onChange={(e) => {
                      setQuery((s) => ({ ...s, [i]: e.target.value }));
                      setNotFound((s) => ({ ...s, [i]: false }));
                    }}
                  />
                  <button type="submit" className="btn small" disabled={!(query[i] ?? "").trim()}>
                    Use
                  </button>
                  {notFound[i] && <span className="find-msg">Not in the guides. Check the number, e.g. 165 C or Cool Gray 9 U.</span>}
                  <button type="button" className="btn small" onClick={() => setGuideFor(i)} title="See the whole Pantone guide, by hue">
                    Browse guide
                  </button>
                </form>
                <div className="cand-others">
                  {OTHER.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="cand other"
                      role="radio"
                      aria-checked={other(i) === o.id}
                      title={o.help}
                      onClick={() => setPicks((s) => ({ ...s, [i]: o.id }))}
                    >
                      <span className="pair">
                        <i style={{ background: base(c) }} />
                        <i style={{ background: o.id === "white" ? "#FFFFFF" : o.id === "black" ? "#000000" : c.hex }} />
                      </span>
                      <span className="meta">
                        <b>{o.label}</b>
                        <span>{o.help}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="foot">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          Create Pantone palette
        </button>
      </div>
      {guideFor !== null && palette.colors[guideFor] && (
        <PantoneGuideDialog
          hex={base(palette.colors[guideFor])}
          books={books}
          onClose={() => setGuideFor(null)}
          onPick={(hit) => {
            const i = guideFor;
            if (!cands[i].some((c) => c.name === hit.name)) setTyped((s) => ({ ...s, [i]: hit }));
            setPicks((s) => ({ ...s, [i]: hit.name }));
          }}
        />
      )}
    </>
  );
}
