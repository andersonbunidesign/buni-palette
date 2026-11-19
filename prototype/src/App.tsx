import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, GenState, Palette, Project, RefImage, loadState, migrate, sampleState, saveState, uid } from "./store";
import { generate } from "./color";
import type { Book } from "./pantone";
import { extract, loadImage } from "./extract";
import type { ValueMode } from "./color";
import { IconChevron, IconDots, IconPlus, IconTrash, IconEdit, IconGear, IconMoon, IconSun, IconX, Logo } from "./icons";
import { References } from "./References";
import { Generator, newGen } from "./Generator";
import { Palettes } from "./Palettes";
import { Convert } from "./Convert";
import { Compare } from "./Compare";
import { TextTest, type TextTestColor } from "./TextTest";
import { copyImage, paletteImage } from "./share";
import { copyText } from "./References";
import { formatValue } from "./color";

export const VERSION = "0.6.0";

export type View = "refs" | "gen" | "palettes" | "text";

export interface MenuItem { label: string; icon?: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; disabled?: boolean }

export interface Ctx {
  state: AppState;
  project: Project;
  updateProject: (fn: (p: Project) => Project) => void;
  setGen: (g: GenState) => void;
  gen: GenState;
  go: (v: View) => void;
  toast: (msg: string) => void;
  note: (msg: string, e: { clientX: number; clientY: number }) => void;
  mode: ValueMode;
  tray: string[];
  setTray: (t: string[]) => void;
  /** Pantone conversion of a saved palette, or of colours on screen in the generator. */
  openConvert: (paletteId: string) => void;
  convertColors: (colors: string[], name: string) => void;
  openCompare: (ids: string[]) => void;
  /** Text on colour test, inside the window. */
  openTextTest: (colors: TextTestColor[], name: string) => void;
  /** Shows the app's own right-click menu. */
  contextMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  sharePalette: (p: Palette) => void;
  /** Standard actions for a palette, for menus. */
  paletteActions: (p: Palette, projectId: string, extra?: { rename?: () => void }) => MenuItem[];
  /** Opens the generator with new random colours. */
  newPalette: () => void;
  /** Palette to select when the grid opens (picked from the sidebar). */
  focusPal: string | null;
  addImages: (files: Blob[], names?: string[]) => void;
  /** Opens a palette in the generator: in the window, or full screen straight from the grid. */
  openPalette: (paletteId: string, full?: boolean) => void;
  /** Full screen generator: opened from the window (Esc returns to it) or from the grid (Esc returns to the grid). */
  genFull: FullMode;
  setGenFull: (v: FullMode) => void;
  /** Moves palettes to another project, or copies them. */
  sendPalettes: (ids: string[], toProject: string, copy: boolean) => void;
  setBooks: (b: Book[]) => void;
}

export type FullMode = false | "window" | "grid";
type Theme = "light" | "dark";
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("bp.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* no storage here */
  }
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("palettes");
  const [convertState, setConvertState] = useState<{ pal: Palette; back: View } | null>(null);
  const [compare, setCompare] = useState<Palette[] | null>(null);
  const [textTest, setTextTest] = useState<{ colors: TextTestColor[]; name: string; back: View } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [shared, setShared] = useState<{ url: string; name: string } | null>(null);
  const [focusPal, setFocusPal] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [cursorNote, setCursorNote] = useState<{ text: string; x: number; y: number } | null>(null);
  const [tray, setTray] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [genFull, setGenFull] = useState<FullMode>(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    loadState().then((s) => setState(s && s.projects?.length ? migrate(s) : sampleState()));
  }, []);

  const set = useCallback((fn: (s: AppState) => AppState) => {
    setState((s) => {
      if (!s) return s;
      const next = fn(s);
      saveState(next);
      return next;
    });
  }, []);

  const toastTimer = useRef(0);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);
  const noteTimer = useRef(0);
  const note = useCallback((text: string, e: { clientX: number; clientY: number }) => {
    setCursorNote({ text, x: e.clientX + 14, y: e.clientY + 14 });
    clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setCursorNote(null), 1100);
  }, []);

  const updateProject = useCallback(
    (fn: (p: Project) => Project) =>
      set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === s.current ? fn(p) : p)) })),
    [set],
  );

  const addImages = useCallback(
    async (files: Blob[], names?: string[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) {
        toast("Drop image files (JPG, PNG, WebP).");
        return;
      }
      setView("refs");
      setConvertState(null);
      for (let i = 0; i < imgs.length; i++) {
        try {
          const { url, w, h } = await loadImage(imgs[i]);
          const count = 5;
          const auto = await extract(url, count);
          const name = names?.[i] || (imgs[i] as File).name || "Pasted image";
          const ref: RefImage = { id: uid(), url, w, h, name, count, auto, picked: [] };
          updateProject((p) => ({ ...p, refs: [ref, ...p.refs] }));
        } catch (e) {
          toast(e instanceof Error ? e.message : "Couldn't read that image.");
        }
      }
    },
    [toast, updateProject],
  );

  // Ctrl+V anywhere adds the image on the clipboard (a screenshot, for example).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        addImages(files, files.map(() => "Pasted image"));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages]);

  // Drag images anywhere onto the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addImages(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addImages]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  if (!state) return <div className="app" />;
  const project = state.projects.find((p) => p.id === state.current) ?? state.projects[0];
  const gen = state.gen[project.id] ?? newGen();

  const sharePalette = async (p: Palette) => {
    const img = paletteImage(p);
    if (await copyImage(img)) {
      toast(`Copied "${p.name}" as an image. Paste it anywhere.`);
      return;
    }
    // Copying images isn't allowed here: show it so it can be copied or saved with a right-click.
    try {
      setShared({ url: URL.createObjectURL(await img), name: p.name });
    } catch {
      toast("Couldn't make the image.");
    }
  };

  /** Switches to a project and runs `after` once that project is current. */
  const inProject = (projectId: string) => {
    if (projectId !== state.current) {
      set((s) => ({ ...s, current: projectId }));
      setTray([]);
    }
  };

  const paletteActions = (p: Palette, projectId: string, extra?: { rename?: () => void }): MenuItem[] => {
    const items: MenuItem[] = [
      { label: "Open", onClick: () => { inProject(projectId); openIn(projectId, p.id, false); } },
      { label: "Open full screen", onClick: () => { inProject(projectId); openIn(projectId, p.id, true); } },
    ];
    if (extra?.rename) items.push({ label: "Rename", onClick: extra.rename });
    if (p.kind === "rgb")
      items.push({ label: "To Pantone", onClick: () => { inProject(projectId); setGenFull(false); setTextTest(null); setConvertState({ pal: p, back: "palettes" }); setView("palettes"); } });
    items.push(
      { label: "Text on colour", onClick: () => { inProject(projectId); setGenFull(false); setTextTest({ colors: p.colors, name: p.name, back: "palettes" }); setView("text"); } },
      { label: "Copy values", onClick: (e) => copyText(p.colors.map((c) => c.pantone ?? formatValue(c.hex, state.mode)).join("\n"), e, ctx) },
      { label: "Share as image", onClick: () => sharePalette(p) },
      {
        label: "Duplicate",
        onClick: () => {
          const copy: Palette = { ...p, id: uid(), name: `${p.name} copy`, created: Date.now(), colors: p.colors.map((c) => ({ ...c })) };
          set((s) => ({
            ...s,
            projects: s.projects.map((pr) => {
              if (pr.id !== projectId) return pr;
              const i = pr.palettes.findIndex((x) => x.id === p.id);
              return { ...pr, palettes: [...pr.palettes.slice(0, i + 1), copy, ...pr.palettes.slice(i + 1)] };
            }),
          }));
          toast("Duplicated");
        },
      },
      {
        label: "Delete",
        danger: true,
        onClick: () => {
          set((s) => ({ ...s, projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, palettes: pr.palettes.filter((x) => x.id !== p.id) } : pr)) }));
          toast(`Deleted "${p.name}"`);
        },
      },
    );
    return items;
  };

  /** Opens a palette of any project in the generator. */
  const openIn = (projectId: string, id: string, full: boolean) => {
    const pr = state.projects.find((x) => x.id === projectId);
    const p = pr?.palettes.find((x) => x.id === id);
    if (!pr || !p) return;
    const colors = p.colors.map((c) => c.hex);
    const g = state.gen[projectId] ?? newGen();
    set((s) => ({ ...s, current: projectId, gen: { ...s.gen, [projectId]: { ...g, colors, locked: colors.map(() => true), editing: p.id, baseline: colors, from: "palettes" } } }));
    setConvertState(null);
    setTextTest(null);
    setView("gen");
    setGenFull(full ? "grid" : false);
  };

  const newPaletteIn = (projectId: string) => {
    const g = state.gen[projectId] ?? newGen();
    const colors = generate([null, null, null, null, null], g.rule, []);
    set((s) => ({ ...s, current: projectId, gen: { ...s.gen, [projectId]: { ...g, colors, locked: colors.map(() => false), editing: undefined, baseline: undefined, from: "palettes" } } }));
    setConvertState(null);
    setTextTest(null);
    setGenFull(false);
    setView("gen");
  };

  const ctx: Ctx = {
    state,
    project,
    updateProject,
    gen,
    setGen: (g) => set((s) => ({ ...s, gen: { ...s.gen, [project.id]: g } })),
    go: (v) => {
      setConvertState(null);
      setTextTest(null);
      setGenFull(false);
      setView(v);
    },
    toast,
    note,
    mode: state.mode,
    tray,
    setTray,
    openConvert: (id) => {
      const pal = project.palettes.find((p) => p.id === id);
      if (pal) setConvertState({ pal, back: view });
    },
    convertColors: (colors, name) => {
      setGenFull(false);
      setConvertState({ pal: { id: "unsaved", name, kind: "rgb", created: Date.now(), colors: colors.map((hex) => ({ hex })) }, back: view });
    },
    openCompare: (ids) => setCompare(ids.map((id) => project.palettes.find((p) => p.id === id)).filter((p): p is Palette => !!p)),
    openTextTest: (colors, name) => {
      setGenFull(false);
      setConvertState(null);
      setTextTest({ colors, name, back: view === "text" ? "palettes" : view });
      setView("text");
    },
    contextMenu: (e, items) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, items });
    },
    sharePalette: (p) => sharePalette(p),
    paletteActions: (p, projectId, extra) => paletteActions(p, projectId, extra),
    newPalette: () => newPaletteIn(project.id),
    focusPal,
    addImages,
    openPalette: (id, full = false) => openIn(project.id, id, full),
    sendPalettes: (ids, to, copy) => {
      if (to === project.id) return;
      const target = state.projects.find((p) => p.id === to);
      if (!target) return;
      const moving = project.palettes.filter((p) => ids.includes(p.id));
      if (!moving.length) return;
      const imgIds = new Set(moving.map((p) => p.imageId).filter(Boolean));
      set((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id === to) {
            // Bring along the reference images the palettes came from, so "where it came from" still works.
            const have = new Set(p.refs.map((r) => r.id));
            const refs = project.refs.filter((r) => imgIds.has(r.id) && !have.has(r.id));
            const pals = moving.map((m) => (copy ? { ...m, id: uid(), created: Date.now(), colors: m.colors.map((c) => ({ ...c })) } : m));
            return { ...p, refs: [...p.refs, ...refs], palettes: [...p.palettes, ...pals] };
          }
          if (p.id === project.id && !copy) return { ...p, palettes: p.palettes.filter((x) => !ids.includes(x.id)) };
          return p;
        }),
      }));
      const what = moving.length === 1 ? `"${moving[0].name}"` : `${moving.length} palettes`;
      toast(`${copy ? "Copied" : "Moved"} ${what} to ${target.name}`);
    },
    genFull,
    setGenFull,
    setBooks: (books) => set((s) => ({ ...s, books })),
  };

  const newProject = () => {
    const p: Project = { id: uid(), name: "New project", refs: [], palettes: [] };
    set((s) => ({ ...s, projects: [...s.projects, p], current: p.id }));
    setTray([]);
    setConvertState(null);
    setView("refs");
    setRenaming(p.id);
    setRenameText(p.name);
  };
  const commitRename = () => {
    const name = renameText.trim();
    if (renaming && name) set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === renaming ? { ...p, name } : p)) }));
    setRenaming(null);
  };
  const deleteProject = (id: string) => {
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      if (!projects.length) {
        const fresh = sampleState();
        return fresh;
      }
      const { [id]: _gone, ...gen } = s.gen;
      return { ...s, projects, gen, current: s.current === id ? projects[0].id : s.current };
    });
    toast("Project deleted");
  };

  const collapsed = state.collapsed ?? [];
  const editingPalette: Palette | undefined = convertState?.pal;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <Logo size={34} />
          <span>Buni Palette</span>
        </div>
        <div className="seg" role="group" aria-label="View">
          {(
            [
              ["palettes", "Palettes"],
              ["refs", "References"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={!editingPalette && view === v} onClick={() => ctx.go(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <label className="label" htmlFor="mode">
          Values
        </label>
        <select
          id="mode"
          className="select"
          value={state.mode}
          onChange={(e) => set((s) => ({ ...s, mode: e.target.value as ValueMode }))}
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="lab">Lab</option>
          <option value="hsb">HSB</option>
          <option value="cmyk">CMYK (approx.)</option>
        </select>
        <button
          type="button"
          className="round"
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={() => {
            const t = theme === "dark" ? "light" : "dark";
            setTheme(t);
            try {
              localStorage.setItem("bp.theme", t);
            } catch {
              /* remembered for this visit only */
            }
          }}
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button type="button" className="round" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}>
          <IconGear />
        </button>
      </header>

      <div className="body">
        <nav className="side" aria-label="Projects">
          <div className="colls">
            <div className="colls-head">
              <h2>Projects</h2>
              <button type="button" className="icon-btn" aria-label="New project" title="New project" onClick={newProject}>
                <IconPlus />
              </button>
            </div>
            {state.projects.map((p) =>
              renaming === p.id ? (
                <input
                  key={p.id}
                  id={`rename-${p.id}`}
                  className="rename"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <div
                  key={p.id}
                  className={`coll${dropOn === p.id ? " drop" : p.id === project.id ? " picked" : ""}`}
                  onDragOver={(e) => {
                    if (p.id === project.id || !Array.from(e.dataTransfer.types).includes("application/x-bp-palettes")) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
                    if (dropOn !== p.id) setDropOn(p.id);
                  }}
                  onDragLeave={() => setDropOn((d) => (d === p.id ? null : d))}
                  onContextMenu={(e) =>
                    ctx.contextMenu(e, [
                      { label: "Rename", onClick: () => { setRenaming(p.id); setRenameText(p.name); } },
                      { label: "New palette", onClick: () => newPaletteIn(p.id) },
                      { label: collapsed.includes(p.id) ? "Show palettes" : "Hide palettes", onClick: () => set((s) => { const c = s.collapsed ?? []; return { ...s, collapsed: c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id] }; }) },
                      { label: "Delete project", danger: true, onClick: () => deleteProject(p.id) },
                    ])
                  }
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData("application/x-bp-palettes");
                    setDropOn(null);
                    if (!raw || p.id === project.id) return;
                    e.preventDefault();
                    ctx.sendPalettes(JSON.parse(raw) as string[], p.id, e.ctrlKey || e.metaKey);
                  }}
                >
                  <button
                    type="button"
                    className="chev"
                    aria-label={collapsed.includes(p.id) ? `Show ${p.name} palettes` : `Hide ${p.name} palettes`}
                    aria-expanded={!collapsed.includes(p.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      set((s) => {
                        const c = s.collapsed ?? [];
                        return { ...s, collapsed: c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id] };
                      });
                    }}
                  >
                    <IconChevron size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      set((s) => ({ ...s, current: p.id }));
                      setTray([]);
                      setConvertState(null);
                    }}
                    onDoubleClick={() => {
                      setRenaming(p.id);
                      setRenameText(p.name);
                    }}
                  >
                    <span className="name">{p.name}</span>
                    <span className="count">{p.palettes.length}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${p.name} options`}
                    aria-expanded={menu === p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === p.id ? null : p.id);
                    }}
                  >
                    <IconDots />
                  </button>
                  {menu === p.id && (
                    <div className="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          setRenaming(p.id);
                          setRenameText(p.name);
                        }}
                      >
                        <IconEdit size={16} /> Rename
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setMenu(null);
                          deleteProject(p.id);
                        }}
                      >
                        <IconTrash size={16} /> Delete project
                      </button>
                    </div>
                  )}
                </div>
              ),
            ).flatMap((el, i) => {
              const p = state.projects[i];
              if (collapsed.includes(p.id) || !p.palettes.length || renaming === p.id) return [el];
              return [
                el,
                <div key={`${p.id}-minis`} className="minis">
                  {p.palettes.map((pal) => (
                    <button
                      key={pal.id}
                      type="button"
                      className={`mini${p.id === project.id && focusPal === pal.id && view === "palettes" ? " on" : ""}`}
                      title={pal.name}
                      aria-label={`${pal.name} in ${p.name}`}
                      onContextMenu={(e) => ctx.contextMenu(e, paletteActions(pal, p.id))}
                      onDoubleClick={() => openIn(p.id, pal.id, false)}
                      onClick={() => {
                        set((s) => ({ ...s, current: p.id }));
                        setTray([]);
                        setConvertState(null);
                        setGenFull(false);
                        setFocusPal(pal.id);
                        setView("palettes");
                      }}
                    >
                      {pal.colors.map((c, j) => (
                        <i key={j} style={{ background: c.hex }} />
                      ))}
                    </button>
                  ))}
                </div>,
              ];
            })}
          </div>
          <div className="side-foot">
            <p className="side-note">
              Drop images anywhere, or press <span className="kbd">Ctrl</span> + <span className="kbd">V</span> to add a screenshot to this
              project. Drag palettes onto a project to move them; hold <span className="kbd">Ctrl</span> to copy.
            </p>
            <a className="credit" href="https://andersonbunidesign.com" target="_blank" rel="noreferrer">
            <span>Vibe coded by Anderson Santos</span>
            <span>Version {VERSION} · web prototype</span>
            </a>
          </div>
        </nav>

        <main className="main" key={project.id + (convertState ? "c" : "") + view + (view === "palettes" ? focusPal ?? "" : "")}>
          {editingPalette ? (
            <Convert
              ctx={ctx}
              palette={editingPalette}
              onCancel={() => setConvertState(null)}
              onDone={() => {
                setConvertState(null);
                setView("palettes");
              }}
            />
          ) : view === "text" && textTest ? (
            <TextTest
              ctx={ctx}
              colors={textTest.colors}
              name={textTest.name}
              backLabel={textTest.back === "gen" ? "Palette" : textTest.back === "refs" ? "References" : "Palettes"}
              onBack={() => {
                setView(textTest.back === "text" ? "palettes" : textTest.back);
                setTextTest(null);
              }}
            />
          ) : view === "refs" ? (
            <References ctx={ctx} />
          ) : view === "gen" ? (
            <Generator ctx={ctx} />
          ) : (
            <Palettes ctx={ctx} />
          )}
        </main>
      </div>

      {settings && <Settings state={state} onClose={() => setSettings(false)} onClear={() => {
        set((s) => ({ ...s, projects: s.projects.map((p) => ({ ...p, refs: [] })) }));
        setTray([]);
        toast("Reference images cleared. Your palettes are untouched.");
      }} />}
      {compare && <Compare ctx={ctx} palettes={compare} onClose={() => setCompare(null)} />}
      {ctxMenu && <ContextMenu {...ctxMenu} onClose={() => setCtxMenu(null)} />}
      {shared && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && (URL.revokeObjectURL(shared.url), setShared(null))}>
          <div className="dialog wide" role="dialog" aria-label="Share palette">
            <div className="pop-head">
              <h2>{shared.name}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => { URL.revokeObjectURL(shared.url); setShared(null); }}>
                <IconX />
              </button>
            </div>
            <p className="muted">This browser doesn't let the page copy images. Right-click the image and choose Copy image or Save image. The desktop app copies it in one click.</p>
            <img className="share-img" src={shared.url} alt={`${shared.name} palette`} />
          </div>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>Drop images to add them as references</div>
        </div>
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
      {cursorNote && (
        <div className="cursor-note" style={{ left: cursorNote.x, top: cursorNote.y }}>
          {cursorNote.text}
        </div>
      )}
    </div>
  );
}

function Settings({ state, onClose, onClear }: { state: AppState; onClose: () => void; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const refs = state.projects.flatMap((p) => p.refs);
  const bytes = refs.reduce((n, r) => n + r.url.length * 0.75, 0);
  const size = bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Settings">
        <div className="pop-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <section className="set-row">
          <div>
            <h3>Reference images</h3>
            <p className="muted">
              {refs.length} {refs.length === 1 ? "image" : "images"} in {state.projects.length} {state.projects.length === 1 ? "project" : "projects"}, {size}.
              Clearing them keeps every palette and colour, but you can no longer see where a colour came from or pick new colours from
              those images.
            </p>
          </div>
          {confirm ? (
            <div className="tools">
              <button type="button" className="btn small" onClick={() => setConfirm(false)}>
                Keep
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={() => {
                  onClear();
                  setConfirm(false);
                }}
              >
                Clear {refs.length} images
              </button>
            </div>
          ) : (
            <button type="button" className="btn" disabled={!refs.length} onClick={() => setConfirm(true)}>
              <IconTrash size={16} /> Clear images
            </button>
          )}
        </section>
        <section className="set-row">
          <div>
            <h3>CMYK profile</h3>
            <p className="muted">Coated FOGRA39. The web prototype shows a plain conversion; the desktop app will use the profile and let you change it here.</p>
          </div>
        </section>
        <a className="credit settings-credit" href="https://andersonbunidesign.com" target="_blank" rel="noreferrer">
          <span>Vibe coded by Anderson Santos</span>
          <span>Version {VERSION} · web prototype</span>
        </a>
      </div>
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ left: Math.min(x, window.innerWidth - el.offsetWidth - 8), top: Math.min(y, window.innerHeight - el.offsetHeight - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu ctx-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={it.danger ? "danger" : undefined}
          disabled={it.disabled}
          onClick={(e) => {
            onClose();
            it.onClick(e);
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
