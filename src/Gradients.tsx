// The project's gradients as a grid, like Color Palettes, plus gradients suggested from the palettes' own colours.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx } from "./App";
import { gradientsOf, nextGradName, thumbUrl, uid, type Gradient } from "./store";
import { css, sorted, suggest, type Suggestion } from "./gradient";
import { formatValue } from "./color";
import { IconArtwork, IconDots, IconPlus, IconTrash, IconX, IconGradient } from "./icons";
import { copyText } from "./References";

export function Gradients({ ctx }: { ctx: Ctx }) {
  const { project } = ctx;
  const all = gradientsOf(project);
  const [sel, setSel] = useState<string[]>(() => (ctx.focusGrad && all.some((g) => g.id === ctx.focusGrad) ? [ctx.focusGrad] : []));
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const dragIds = useRef<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  // The Compare button in the header compares what's selected here.
  useEffect(() => ctx.setGridSel(sel), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctx.setGridSel([]), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ctx.focusGrad) document.querySelector(`[data-grad="${ctx.focusGrad}"]`)?.scrollIntoView({ block: "nearest" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return;
      if (document.querySelector(".overlay")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel(all.map((g) => g.id));
      }
      if (e.key === "Escape") setSel([]);
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) deleteSelected();
      if ((e.code === "Space" || e.key === "Enter") && !e.repeat && sel.length) {
        e.preventDefault();
        ctx.openGradient(anchor.current && sel.includes(anchor.current) ? anchor.current : sel[0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setGradients = (fn: (gs: Gradient[]) => Gradient[]) => ctx.updateProject((pr) => ({ ...pr, gradients: fn(gradientsOf(pr)) }));
  const commitRename = () => {
    const name = text.trim();
    if (renaming && name && name !== all.find((g) => g.id === renaming)?.name) {
      ctx.checkpoint("rename");
      setGradients((gs) => gs.map((g) => (g.id === renaming ? { ...g, name } : g)));
    }
    setRenaming(null);
  };

  const pick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = all.map((g) => g.id);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      const range = ids.slice(a, b + 1);
      setSel((s) => (e.ctrlKey || e.metaKey ? Array.from(new Set([...s, ...range])) : range));
      return;
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setSel([id]);
  };

  const deleteSelected = () => {
    const n = sel.length;
    ctx.checkpoint("delete");
    setGradients((gs) => gs.filter((g) => !sel.includes(g.id)));
    setSel([]);
    ctx.toast(n === 1 ? "Deleted 1 gradient" : `Deleted ${n} gradients`, true);
  };

  const actions = (g: Gradient) =>
    ctx.gradientActions(g, project.id, {
      rename: () => {
        setRenaming(g.id);
        setText(g.name);
      },
    });

  // Every colour in this project's palettes, to look for pairs that blend well.
  const colors = useMemo(() => project.palettes.flatMap((p) => p.colors.map((c) => c.hex)), [project.palettes]);
  const ideas = useMemo(() => (suggesting ? suggest(colors, 12) : []), [suggesting, colors]);

  const saveIdea = (s: Suggestion, open: boolean) => {
    if (open) {
      ctx.newGradient({ stops: s.stops.map((x) => ({ ...x, locked: true })), blend: s.blend, type: "linear", angle: 90 });
      return;
    }
    const g: Gradient = { id: uid(), name: nextGradName(project), type: "linear", angle: 90, blend: s.blend, stops: s.stops.map(({ hex, pos }) => ({ hex, pos })), created: Date.now() };
    setGradients((gs) => [...gs, g]);
    ctx.toast(`Saved "${g.name}"`);
  };

  return (
    <>
      <div className="titlebar">
        <div>
          <p className="kicker">
            Gradients · {all.length} in this project{sel.length ? ` · ${sel.length} selected` : ""}
          </p>
          <h1>{project.name}</h1>
        </div>
        <div className="tools">
          {sel.length > 0 && (
            <div className="sel-tools">
              <button type="button" className="btn" title="Export the selected gradients to an Illustrator file" onClick={() => ctx.exportItems([], all.filter((g) => sel.includes(g.id)))}>
                <IconArtwork /> Illustrator
              </button>
              <button type="button" className="btn" onClick={deleteSelected}>
                <IconTrash /> Delete
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn"
            aria-pressed={suggesting}
            disabled={colors.length < 2}
            title={colors.length < 2 ? "Save a palette in this project first" : "Find gradients among the colours already in this project's palettes"}
            onClick={() => setSuggesting(!suggesting)}
          >
            Suggest from palettes
          </button>
          <button type="button" className="btn primary" onClick={() => ctx.newGradient()}>
            <IconPlus /> New gradient
          </button>
        </div>
      </div>

      {suggesting && (
        <section className="ideas" aria-label="Suggested gradients">
          <div className="ideas-head">
            <h2>From your palettes</h2>
            <span className="sw-label">
              Pairs and trios of colours already in {project.name}'s palettes that blend without a dull middle. Save one, or open it to change it.
            </span>
            <div className="spacer" />
            <button type="button" className="icon-btn" aria-label="Close suggestions" onClick={() => setSuggesting(false)}>
              <IconX />
            </button>
          </div>
          {ideas.length === 0 ? (
            <p className="muted">These palettes' colours are too close to each other to make a clear gradient. Try New gradient.</p>
          ) : (
            <div className="ideas-grid">
              {ideas.map((s, i) => (
                <div key={i} className="idea">
                  <button type="button" className="idea-prev" style={{ background: css({ type: "linear", angle: 90, stops: s.stops, blend: s.blend }) }} title="Open to edit" onClick={() => saveIdea(s, true)} />
                  <div className="idea-foot">
                    <span className="gdots">
                      {s.stops.map((x, j) => (
                        <i key={j} style={{ background: x.hex }} title={x.hex} />
                      ))}
                    </span>
                    <span className="sw-label">{s.stops.length === 3 ? "Trio" : "Pair"}</span>
                    <div className="spacer" />
                    <button type="button" className="btn small" onClick={() => saveIdea(s, false)}>
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {all.length === 0 ? (
        <div className="empty">
          <b>No gradients yet</b>
          <span>
            Make one with New gradient, let Suggest from palettes find some among your colours, or read one off an image in Image Sampling (switch it to
            Gradient).
          </span>
          <button type="button" className="btn primary" onClick={() => ctx.newGradient()}>
            <IconPlus /> New gradient
          </button>
        </div>
      ) : (
        <div className="pgrid ggrid" onClick={(e) => e.target === e.currentTarget && setSel([])}>
          {all.map((g) => {
            const picked = sel.includes(g.id);
            const img = g.imageId ? project.refs.find((r) => r.id === g.imageId) : undefined;
            return (
              <article
                key={g.id}
                className={`pcard gcard${picked ? " sel" : ""}${dropAt?.id === g.id ? (dropAt.after ? " drop-after" : " drop-before") : ""}`}
                data-grad={g.id}
                aria-selected={picked}
                onClick={(e) => pick(e, g.id)}
                onDoubleClick={() => ctx.openGradient(g.id)}
                onContextMenu={(e) => {
                  if (!sel.includes(g.id)) {
                    anchor.current = g.id;
                    setSel([g.id]);
                  }
                  ctx.contextMenu(e, actions(g));
                }}
                draggable={renaming !== g.id}
                onDragStart={(e) => {
                  const ids = sel.includes(g.id) ? sel : [g.id];
                  if (!sel.includes(g.id)) setSel([g.id]);
                  dragIds.current = ids;
                  e.dataTransfer.setData("application/x-bp-gradients", JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragEnd={() => {
                  dragIds.current = [];
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  if (!dragIds.current.length || dragIds.current.includes(g.id)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > r.left + r.width / 2;
                  if (dropAt?.id !== g.id || dropAt.after !== after) setDropAt({ id: g.id, after });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt((d) => (d?.id === g.id ? null : d));
                }}
                onDrop={(e) => {
                  const ids = dragIds.current;
                  setDropAt(null);
                  if (!ids.length || ids.includes(g.id)) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > r.left + r.width / 2;
                  ctx.checkpoint("reorder");
                  setGradients((gs) => {
                    const moving = gs.filter((x) => ids.includes(x.id));
                    const rest = gs.filter((x) => !ids.includes(x.id));
                    const at = rest.findIndex((x) => x.id === g.id) + (after ? 1 : 0);
                    return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
                  });
                }}
              >
                <div className="gprev" style={{ background: css(g) }} />
                <div className="gvals">
                  {sorted(g.stops).map((s, i) => (
                    <span
                      key={i}
                      title={picked ? "Click to copy" : `${s.hex} at ${Math.round(s.pos * 100)}%`}
                      onClick={(e) => {
                        if (!picked || e.detail > 1 || e.ctrlKey || e.metaKey || e.shiftKey || sel.length !== 1) return;
                        e.stopPropagation();
                        copyText(formatValue(s.hex, ctx.mode), e, ctx);
                      }}
                    >
                      <i style={{ background: s.hex }} />
                      {formatValue(s.hex, ctx.mode)}
                    </span>
                  ))}
                </div>
                <div className="pfoot">
                  {renaming === g.id ? (
                    <input
                      id={`grad-name-${g.id}`}
                      className="pal-name-input"
                      autoFocus
                      value={text}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onChange={(e) => setText(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className={`pal-name${img ? " has-img" : ""}`}>
                      <span className="pn-text" title={g.name}>
                        {g.name}
                      </span>
                      {img && (
                        <span className="img-pop" aria-hidden="true">
                          <img src={thumbUrl(img)} alt="" />
                          {g.line && (
                            <svg className="gline-pop" viewBox="0 0 100 100" preserveAspectRatio="none">
                              <line x1={g.line[0] * 100} y1={g.line[1] * 100} x2={g.line[2] * 100} y2={g.line[3] * 100} />
                            </svg>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="badge" title={g.type === "radial" ? "Radial" : `Linear, ${Math.round(g.angle)}°`}>
                    {g.type === "radial" ? "Radial" : `${Math.round(g.angle)}°`}
                  </span>
                  <div className="spacer" />
                  <span className="sw-label num">{g.stops.length}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${g.name} options`}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.contextMenu(e, actions(g));
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <IconDots />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {all.length > 0 && (
        <p className="note">
          <IconGradient size={14} /> Double-click a gradient to edit it. Drag gradients onto another project in the sidebar to move them (hold <span className="kbd">Ctrl</span> to copy).
        </p>
      )}
    </>
  );
}
