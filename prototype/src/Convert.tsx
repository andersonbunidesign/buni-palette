import React, { useMemo, useState } from "react";
import type { Ctx } from "./App";
import { Palette, uid } from "./store";
import { BOOKS, bookShort, nearest, matchWord, type Book } from "./pantone";
import { formatValue } from "./color";
import { IconCheck } from "./icons";

/** Pick a Pantone colour for each colour of a palette; the result is a new, separate palette. */
export function Convert({ ctx, palette, onDone, onCancel }: { ctx: Ctx; palette: Palette; onDone: () => void; onCancel: () => void }) {
  const books = ctx.state.books;
  const cands = useMemo(() => palette.colors.map((c) => nearest(c.hex, books, 5)), [palette, books]);
  // The closest match is picked for each colour; picks reset when the guides change.
  const [picks, setPicks] = useState<Record<number, string>>({});
  const chosen = (i: number) => cands[i].find((c) => c.name === picks[i]) ?? cands[i][0];

  const toggleBook = (b: Book) => {
    const next = books.includes(b) ? books.filter((x) => x !== b) : [...books, b];
    if (!next.length) {
      ctx.toast("Keep at least one guide on.");
      return;
    }
    ctx.setBooks(BOOKS.map((x) => x.id).filter((id) => next.includes(id)));
    setPicks({});
  };

  const save = () => {
    const pal: Palette = {
      id: uid(),
      name: `${palette.name} · Pantone`,
      kind: "pantone",
      created: Date.now(),
      imageId: palette.imageId,
      colors: palette.colors.map((c, i) => {
        const p = chosen(i);
        return { hex: p.hex, pantone: p.name, book: p.book, x: c.x, y: c.y };
      }),
    };
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
        different). The closest one is picked for you. Screen values are approximations, and neons always look duller on screen than
        in print: confirm your picks in the printed guide.
      </p>

      <div className="conv">
        {palette.colors.map((c, i) => {
          const pick = chosen(i);
          return (
            <div key={i} className="conv-row">
              <div className="conv-src">
                <div className="block" style={{ background: c.hex }} />
                <b className="num">{c.pantone ? c.pantone.replace(/^PANTONE /, "") : c.hex}</b>
                <span>{formatValue(c.hex, ctx.mode === "hex" ? "rgb" : ctx.mode)}</span>
              </div>
              <div className="cands" role="radiogroup" aria-label={`Pantone options for ${c.hex}`}>
                {cands[i].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="cand"
                    role="radio"
                    aria-checked={pick.name === p.name}
                    onClick={() => setPicks((s) => ({ ...s, [i]: p.name }))}
                  >
                    <span className="pair" title="Top: your colour. Bottom: the Pantone colour.">
                      <i style={{ background: c.hex }} />
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
    </>
  );
}
