import React, { useEffect, useRef, useState } from "react";
import type { Ctx } from "./App";
import { api, errText, type UnsplashPhoto } from "./api";
import { extract, type Swatch } from "./extract";
import { formatValue } from "./color";
import { nextName, uid, type Palette, type RefImage } from "./store";
import { IconCheck, IconDots, IconMinus, IconPlus, IconSearch, IconSwatches } from "./icons";
import { copyText } from "./References";

interface Result {
  photo: UnsplashPhoto;
  /** Null while the photo is being read. */
  colors: Swatch[] | null;
  error?: string;
}

interface Search {
  query: string;
  page: number;
  pages: number;
  total: number;
  results: Result[];
  count: number;
}

// Results stay while the app is open, so switching tabs doesn't lose them.
let cache: Search | null = null;
const photoUrls = new Map<string, string>();
/** Photos saved, by project: so cards can show "Saved". */
const savedIn = new Map<string, Set<string>>();

async function photoSrc(p: UnsplashPhoto): Promise<string> {
  const hit = photoUrls.get(p.id);
  if (hit) return hit;
  const buf = await api.unsplashImage(p.urls.small);
  const url = URL.createObjectURL(new Blob([buf]));
  photoUrls.set(p.id, url);
  return url;
}

/** Runs `fn` over the items, a few at a time. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const credit = (p: UnsplashPhoto) => `Photo by ${p.user.name} on Unsplash`;

export function Explore({ ctx }: { ctx: Ctx }) {
  const [search, setSearchState] = useState<Search | null>(cache);
  const searchRef = useRef(search);
  const setSearch = (fn: (s: Search | null) => Search | null) => {
    const next = fn(searchRef.current);
    searchRef.current = next;
    cache = next;
    setSearchState(next);
  };
  const [text, setText] = useState(cache?.query ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const anchor = useRef<string | null>(null);
  const dragIds = useRef<string[]>([]);
  const [, bump] = useState(0);
  const count = search?.count ?? 5;

  useEffect(() => {
    api.getSettings().then((s) => setHasKey(!!s.unsplashKey), () => setHasKey(false));
  }, []);

  const read = async (list: Result[], n: number) => {
    await pool(list, 6, async (r) => {
      try {
        const colors = await extract(await photoSrc(r.photo), n);
        setSearch((s) => (s ? { ...s, results: s.results.map((x) => (x.photo.id === r.photo.id ? { ...x, colors, error: undefined } : x)) } : s));
      } catch (e) {
        setSearch((s) => (s ? { ...s, results: s.results.map((x) => (x.photo.id === r.photo.id ? { ...x, colors: [], error: errText(e) } : x)) } : s));
      }
    });
  };

  const run = async (query: string, page: number) => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.unsplashSearch(q, page);
      const fresh: Result[] = res.results.map((photo) => ({ photo, colors: null }));
      const n = searchRef.current?.count ?? 5;
      setSearch((s) => {
        const have = page > 1 && s ? s.results : [];
        const ids = new Set(have.map((r) => r.photo.id));
        return { query: q, page, pages: res.total_pages, total: res.total, count: n, results: [...have, ...fresh.filter((r) => !ids.has(r.photo.id))] };
      });
      if (page === 1) setSel([]);
      if (!fresh.length && page === 1) setError(`No photos for "${q}". Try another word.`);
      read(fresh, n);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setCount = (n: number) => {
    setSearch((s) => (s ? { ...s, count: n, results: s.results.map((r) => ({ ...r, colors: r.error ? r.colors : null })) } : s));
    if (searchRef.current) read(searchRef.current.results.filter((r) => !r.error), n);
  };

  const results = search?.results ?? [];
  const byId = (id: string) => results.find((r) => r.photo.id === id);

  const save = async (ids: string[], projectId: string) => {
    const project = ctx.state.projects.find((p) => p.id === projectId);
    const list = ids.map(byId).filter((r): r is Result => !!r && !!r.colors && r.colors.length > 0);
    if (!project || !list.length || saving) return;
    setSaving(true);
    try {
      const pals: Palette[] = [];
      const refs: RefImage[] = [];
      const kw = search?.query ?? "Explore";
      for (const r of list) {
        const p = r.photo;
        const blob = new Blob([await api.unsplashImage(p.urls.regular)]);
        const ref = await ctx.storeImage(blob, kw, {
          auto: r.colors!,
          count: r.colors!.length,
          source: { author: p.user.name, authorUrl: p.user.links.html, photoUrl: p.links.html, keyword: kw },
        });
        // Named after the keyword, numbered like other palettes.
        const name = nextName({ ...project, palettes: [...project.palettes, ...pals] }, kw);
        pals.push({ id: uid(), name, kind: "rgb", created: Date.now(), imageId: ref.id, colors: r.colors!.map((c) => ({ hex: c.hex, x: c.x, y: c.y })) });
        refs.push(ref);
        api.unsplashTrack(p.links.download_location).catch(() => {});
        if (!savedIn.has(projectId)) savedIn.set(projectId, new Set());
        savedIn.get(projectId)!.add(p.id);
      }
      ctx.addToProject(projectId, pals, refs);
      ctx.toast(`Saved ${pals.length === 1 ? `"${pals[0].name}"` : `${pals.length} palettes`} to ${project.name}`);
      bump((n) => n + 1);
    } catch (e) {
      ctx.toast(errText(e));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    ctx.exploreDrop.current = (projectId) => saveRef.current(dragIds.current, projectId);
    return () => {
      ctx.exploreDrop.current = null;
    };
  }, [ctx.exploreDrop]);

  const openInGenerator = (id: string, full: boolean) => {
    const r = byId(id);
    if (!r?.colors?.length) return;
    const colors = r.colors.map((c) => c.hex).slice(0, 10);
    while (colors.length < 2) colors.push("#BFBFBF");
    ctx.setGen({ ...ctx.gen, colors, locked: colors.map(() => true), editing: undefined, baseline: colors, from: "explore" });
    ctx.go("gen");
    if (full) ctx.setGenFull("grid");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel(results.map((r) => r.photo.id));
      }
      if (e.key === "Escape") setSel([]);
      if (e.code === "Space" && !e.repeat && sel.length) {
        e.preventDefault();
        openInGenerator(anchor.current && sel.includes(anchor.current) ? anchor.current : sel[0], true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = results.map((r) => r.photo.id);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      const range = ids.slice(a, b + 1);
      setSel((s) => (e.ctrlKey || e.metaKey ? Array.from(new Set([...s, ...range])) : range));
      return;
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setSel([id]);
  };

  const menu = (r: Result) => [
    { label: `Save to ${ctx.project.name}`, onClick: () => save(sel.includes(r.photo.id) ? sel : [r.photo.id], ctx.project.id) },
    { label: "Open", onClick: () => openInGenerator(r.photo.id, false) },
    { label: "Open full screen", onClick: () => openInGenerator(r.photo.id, true) },
    { label: "Copy values", onClick: (e: React.MouseEvent) => copyText((r.colors ?? []).map((c) => formatValue(c.hex, ctx.mode)).join("\n"), e, ctx) },
    { label: "See the photo on Unsplash", onClick: () => window.document.getElementById(`ph-${r.photo.id}`)?.click() },
  ];

  const savedHere = savedIn.get(ctx.project.id);

  return (
    <>
      <div className="titlebar">
        <div>
          <p className="kicker">
            Explore{search ? ` · ${search.total.toLocaleString("en")} photos for "${search.query}"` : ""}
            {sel.length ? ` · ${sel.length} selected` : ""}
          </p>
          <h1>Find palettes by keyword</h1>
        </div>
        <div className="tools">
          {sel.length > 0 && (
            <button type="button" className="btn primary" disabled={saving} onClick={() => save(sel, ctx.project.id)}>
              <IconSwatches /> {saving ? "Saving…" : `Save ${sel.length} to ${ctx.project.name}`}
            </button>
          )}
        </div>
      </div>

      <form
        className="explore-bar"
        onSubmit={(e) => {
          e.preventDefault();
          run(text, 1);
        }}
      >
        <div className="search-field">
          <IconSearch size={16} />
          <input
            id="explore-q"
            className="field"
            placeholder="A word: forest, citrus, spa, Nordic winter…"
            value={text}
            disabled={hasKey === false}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy || !text.trim() || hasKey === false}>
          {busy && !search?.results.length ? "Searching…" : "Search"}
        </button>
        <span className="label">Colours per photo</span>
        <div className="counter">
          <button type="button" className="icon-btn" aria-label="One colour less" disabled={count <= 2} onClick={() => setCount(count - 1)}>
            <IconMinus size={16} />
          </button>
          <b className="num">{count}</b>
          <button type="button" className="icon-btn" aria-label="One colour more" disabled={count >= 10} onClick={() => setCount(count + 1)}>
            <IconPlus size={16} />
          </button>
        </div>
      </form>

      {hasKey === false ? (
        <div className="empty">
          <b>Explore needs an Unsplash access key</b>
          <span>
            It's free: make an app at unsplash.com/developers, copy its Access Key and paste it in Settings. Results are palettes read from
            the photos, like the ones from your own references.
          </span>
          <button type="button" className="btn primary" onClick={ctx.openSettings}>
            Open Settings
          </button>
        </div>
      ) : error ? (
        <div className="flash" role="status">
          <span>{error}</span>
        </div>
      ) : !search ? (
        <div className="empty">
          <b>Search photos by keyword</b>
          <span>
            Each photo becomes a palette. Select the ones you like and save them to {ctx.project.name}, or drag them onto a project in the sidebar.
            Saved palettes are named after the keyword and their photo goes into Project references.
          </span>
        </div>
      ) : null}

      {results.length > 0 && (
        <>
          <div className="pgrid" onClick={(e) => e.target === e.currentTarget && setSel([])}>
            {results.map((r) => {
              const id = r.photo.id;
              const picked = sel.includes(id);
              const n = r.colors?.length || count;
              return (
                <article
                  key={id}
                  className={`pcard${picked ? " sel" : ""}`}
                  aria-selected={picked}
                  onClick={(e) => pick(e, id)}
                  onDoubleClick={() => openInGenerator(id, false)}
                  onContextMenu={(e) => {
                    if (!sel.includes(id)) {
                      anchor.current = id;
                      setSel([id]);
                    }
                    ctx.contextMenu(e, menu(r));
                  }}
                  draggable={!!r.colors?.length}
                  onDragStart={(e) => {
                    const ids = sel.includes(id) ? sel : [id];
                    if (!sel.includes(id)) setSel([id]);
                    dragIds.current = ids;
                    e.dataTransfer.setData("application/x-bp-explore", JSON.stringify(ids));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={() => {
                    // The drop handler runs first; then the list is cleared.
                    setTimeout(() => (dragIds.current = []), 0);
                  }}
                >
                  <div className="pstrip">
                    {r.colors
                      ? r.colors.map((c, i) => (
                          <i
                            key={i}
                            style={{ background: c.hex }}
                            onClick={(e) => {
                              if (!picked || e.detail > 1 || e.ctrlKey || e.metaKey || e.shiftKey || sel.length !== 1) return;
                              e.stopPropagation();
                              copyText(formatValue(c.hex, ctx.mode), e, ctx);
                            }}
                          />
                        ))
                      : Array.from({ length: n }, (_, i) => <i key={i} className="loading" />)}
                  </div>
                  <div className="plabels" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                    {(r.colors ?? []).map((c, i) => (
                      <span key={i}>{formatValue(c.hex, ctx.mode)}</span>
                    ))}
                    {r.error && <span className="error-line">{r.error}</span>}
                  </div>
                  <div className="pfoot">
                    <span className="pal-name has-img">
                      <span className="pn-text" title={search?.query}>
                        {search?.query}
                      </span>
                      <span className="img-pop" aria-hidden="true">
                        <img src={r.photo.urls.small} alt="" />
                        {(r.colors ?? []).map((c, i) => (
                          <i key={i} className="marker small" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, background: c.hex }} />
                        ))}
                        <span className="pop-credit">{credit(r.photo)}</span>
                      </span>
                    </span>
                    <a
                      id={`ph-${id}`}
                      className="photo-credit"
                      href={`${r.photo.links.html}?utm_source=buni_palette&utm_medium=referral`}
                      target="_blank"
                      rel="noreferrer"
                      title={credit(r.photo)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.photo.user.name}
                    </a>
                    {savedHere?.has(id) && (
                      <span className="badge saved" title={`Saved to ${ctx.project.name}`}>
                        <IconCheck size={12} /> Saved
                      </span>
                    )}
                    <div className="spacer" />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Options"
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.contextMenu(e, menu(r));
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
          <div className="more">
            {search && search.page < search.pages ? (
              <button type="button" className="btn" disabled={busy} onClick={() => run(search.query, search.page + 1)}>
                {busy ? "Loading…" : "Load more"}
              </button>
            ) : (
              <span className="sw-label">That's all for "{search?.query}".</span>
            )}
            <span className="sw-label">
              Photos from{" "}
              <a href="https://unsplash.com/?utm_source=buni_palette&utm_medium=referral" target="_blank" rel="noreferrer">
                Unsplash
              </a>
              . Double-click a palette to open it, Space opens it full screen.
            </span>
          </div>
        </>
      )}
    </>
  );
}
