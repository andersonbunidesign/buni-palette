import React, { useEffect, useRef, useState } from "react";
import type { Ctx } from "./App";
import { hasPantone, hasProcess, Palette, colorCopy, colorLabel, paletteTag, thumbUrl } from "./store";
import { IconArtwork, IconDots, IconTrash, IconPlus } from "./icons";
import { copyText } from "./References";

export function Palettes({ ctx }: { ctx: Ctx }) {
  const { project } = ctx;
  const all = project.palettes;
  const [sel, setSel] = useState<string[]>(() => (ctx.focusPal && project.palettes.some((p) => p.id === ctx.focusPal) ? [ctx.focusPal] : []));
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const dragIds = useRef<string[]>([]);
  // A palette picked in the sidebar: scroll it into view.
  useEffect(() => {
    if (ctx.focusPal) document.querySelector(`[data-pal="${ctx.focusPal}"]`)?.scrollIntoView({ block: "nearest" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const anchor = useRef<string | null>(null);
  // The Compare button in the header compares what's selected here.
  useEffect(() => ctx.setGridSel(sel), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctx.setGridSel([]), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return;
      if (document.querySelector(".compare")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel(all.map((p) => p.id));
      }
      if (e.key === "Escape") {
        setSel([]);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) deleteSelected();
      if (e.code === "Space" && !e.repeat && sel.length) {
        e.preventDefault();
        ctx.openPalette(anchor.current && sel.includes(anchor.current) ? anchor.current : sel[0], true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setPalettes = (fn: (ps: Palette[]) => Palette[]) => ctx.updateProject((pr) => ({ ...pr, palettes: fn(pr.palettes) }));
  const commitRename = () => {
    const name = text.trim();
    if (renaming && name && name !== all.find((p) => p.id === renaming)?.name) ctx.checkpoint("rename");
    if (renaming && name) setPalettes((ps) => ps.map((p) => (p.id === renaming ? { ...p, name } : p)));
    setRenaming(null);
  };

  const pick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = all.map((p) => p.id);
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
    setPalettes((ps) => ps.filter((p) => !sel.includes(p.id)));
    setSel([]);
    ctx.toast(n === 1 ? "Deleted 1 palette" : `Deleted ${n} palettes`, true);
  };

  const actions = (p: Palette) =>
    ctx.paletteActions(p, project.id, {
      rename: () => {
        setRenaming(p.id);
        setText(p.name);
      },
    });

  const single = sel.length === 1 ? all.find((p) => p.id === sel[0]) : undefined;

  return (
    <>
      <div className="titlebar">
        <div>
          <p className="kicker">
            Palettes · {all.length} in this project{sel.length ? ` · ${sel.length} selected` : ""}
          </p>
          <h1>{project.name}</h1>
        </div>
        <div className="tools">
          {sel.length > 0 && (
            <div className="sel-tools">
              {single && hasProcess(single) && (
                <button type="button" className="btn" onClick={() => ctx.openConvert(single.id)}>
                  To Pantone
                </button>
              )}
              <button type="button" className="btn" title="Export the selected palettes to an Illustrator file" onClick={() => ctx.exportPalettes(all.filter((p) => sel.includes(p.id)))}>
                <IconArtwork /> Illustrator
              </button>
              <button type="button" className="btn" onClick={deleteSelected}>
                <IconTrash /> Delete
              </button>
            </div>
          )}
          <button type="button" className="btn primary" onClick={ctx.newPalette}>
            <IconPlus /> New palette
          </button>
        </div>
      </div>

      {project.example && (
        <p className="note">
          An example project with sample palettes to try things out. Click to select, Ctrl or Shift to select several. Space opens the
          selected palette full screen, double-click opens it here. Make your own project with the + next to Projects.
        </p>
      )}

      {all.length === 0 ? (
        <div className="empty">
          <b>No palettes yet</b>
          <span>Start a new one, save one from an image in Image Sampling, or find some in Keywords.</span>
          <button type="button" className="btn primary" onClick={ctx.newPalette}>
            <IconPlus /> New palette
          </button>
        </div>
      ) : (
        <div
          className="pgrid"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSel([]);
          }}
        >
          {all.map((p) => {
            const picked = sel.includes(p.id);
            const img = p.imageId ? project.refs.find((r) => r.id === p.imageId) : undefined;
            return (
              <article
                key={p.id}
                className={`pcard${picked ? " sel" : ""}${dropAt?.id === p.id ? (dropAt.after ? " drop-after" : " drop-before") : ""}`}
                data-pal={p.id}
                aria-selected={picked}
                onClick={(e) => pick(e, p.id)}
                onDoubleClick={() => ctx.openPalette(p.id)}
                onContextMenu={(e) => {
                  if (!sel.includes(p.id)) {
                    anchor.current = p.id;
                    setSel([p.id]);
                  }
                  ctx.contextMenu(e, actions(p));
                }}
                draggable={renaming !== p.id}
                onDragStart={(e) => {
                  const ids = sel.includes(p.id) ? sel : [p.id];
                  if (!sel.includes(p.id)) setSel([p.id]);
                  dragIds.current = ids;
                  e.dataTransfer.setData("application/x-bp-palettes", JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragEnd={() => {
                  dragIds.current = [];
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  // Dragging onto another card puts the palettes before or after it.
                  if (!dragIds.current.length || dragIds.current.includes(p.id)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > r.left + r.width / 2;
                  if (dropAt?.id !== p.id || dropAt.after !== after) setDropAt({ id: p.id, after });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt((d) => (d?.id === p.id ? null : d));
                }}
                onDrop={(e) => {
                  const ids = dragIds.current;
                  setDropAt(null);
                  if (!ids.length || ids.includes(p.id)) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > r.left + r.width / 2;
                  ctx.checkpoint("reorder");
                  setPalettes((ps) => {
                    const moving = ps.filter((x) => ids.includes(x.id));
                    const rest = ps.filter((x) => !ids.includes(x.id));
                    const at = rest.findIndex((x) => x.id === p.id) + (after ? 1 : 0);
                    return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
                  });
                }}
              >
                <div className="pstrip">
                  {p.colors.map((c, i) => (
                    <i
                      key={i}
                      style={{ background: c.hex }}
                      title={picked ? "Click to copy" : undefined}
                      onClick={(e) => {
                        // Once the card is selected, clicking a colour copies its value.
                        if (!picked || e.detail > 1 || e.ctrlKey || e.metaKey || e.shiftKey || sel.length !== 1) return;
                        e.stopPropagation();
                        copyText(colorCopy(c, ctx.mode), e, ctx);
                      }}
                    />
                  ))}
                </div>
                <div className="plabels" style={{ gridTemplateColumns: `repeat(${p.colors.length}, minmax(0, 1fr))` }}>
                  {p.colors.map((c, i) => {
                    const main = colorLabel(c, ctx.mode);
                    return (
                      <span key={i} title={`${main}${c.pantone || c.label ? ` · ${c.hex}` : ""}`}>
                        {main}
                      </span>
                    );
                  })}
                </div>
                <div className="pfoot">
                  {renaming === p.id ? (
                    <input
                      id={`pal-name-${p.id}`}
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
                      <span className="pn-text" title={p.name}>{p.name}</span>
                      {img && (
                        <span className="img-pop" aria-hidden="true">
                          <img src={thumbUrl(img)} alt="" />
                          {p.colors.map((c, i) =>
                            c.x !== undefined && c.x >= 0 ? (
                              <i key={i} className="marker small" style={{ left: `${c.x * 100}%`, top: `${(c.y ?? 0) * 100}%`, background: c.hex }} />
                            ) : null,
                          )}
                        </span>
                      )}
                    </span>
                  )}
                  {hasPantone(p) && (
                    <span className="badge pms">{paletteTag(p)}</span>
                  )}
                  <div className="spacer" />
                  <span className="sw-label num">{p.colors.length}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${p.name} options`}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.contextMenu(e, actions(p));
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
    </>
  );
}
