# Buni Palette — handoff from the web prototype (v0.6.0) to the Windows app (v1.0)

> **1.1:** tabs renamed Color Palettes / Image Sampling / Keywords; Illustrator export from an open palette;
> one text object per line in the .ai; APCA contrast; font list in each font's own face; Lock all / Unlock all;
> harmony fix with locked colours; undo (toast + Ctrl+Z); Keywords photo toggle; Image Sampling: dots on hover,
> slider counts the total, Resample, triangle on hand-picked colours; new icon.
>
> **Status:** v1.0 for Windows is built from this list (root of the repo). Everything under
> "To do in v1.0" and "Desktop-only items" is in. Kept below as the record of decisions.

Web prototype: https://claude.ai/artifact/TwWLyV36secPfQhtbKp8kz (private to Buni).
Next step: Windows desktop app, same stack and repo layout as Buni Font Manager
(github.com/andersonbunidesign/buni-font-manager: Tauri 2 + React + TypeScript, Windows installers built on GitHub).
New repo to create: `andersonbunidesign/buni-palette`.

## What's in this folder

- `src/` — React + TypeScript prototype, reusable as the Tauri front end.
  - `color.ts` conversions (RGB, Lab, HSB, OKLCH, naive CMYK), Delta E 2000, WCAG contrast, harmony generator, adjustments, shades, colour-vision simulation (Machado 2009).
  - `pantone.ts` + `pantoneData.ts` — community approximations (MIT: pantoner, color2library) of PANTONE+ Solid Coated/Uncoated and Pastels & Neons Coated/Uncoated. Not official; shortlist only.
  - `extract.ts` — image loading (keeps transparency as WebP), k-means colour extraction in Lab, eyedropper.
  - `store.ts` — data model (projects, palettes, reference images, generator state), IndexedDB saving, migration from older versions.
  - `App.tsx` shell (header, sidebar with palette miniatures, right-click menus, settings, share dialog), `Palettes.tsx` grid, `References.tsx`, `Generator.tsx` (generator, colour popover, wheel view, vision picker, harmony picker), `Convert.tsx` (Pantone), `TextTest.tsx`, `Compare.tsx`, `share.ts` (palette PNG), `icons.tsx`, `styles.css` (Font Manager design tokens).
- `assets/logo.svg` — app icon by Buni (amber with B and four stripes).
- `scripts/assemble.py`, `vite.config.ts` — build the single-page web prototype (React from CDN). The Tauri app will use a normal Vite build instead.

## Decisions so far (keep)

- UI in English; same design and colours as Buni Font Manager; light sidebar in light mode (do the same in Font Manager later).
- Tabs: Palettes, then References. Generator opens from a palette or from "New palette" (5 random colours).
- Default palette size 5. Default name: project name + number. Palettes from a keyword search are named after the keyword.
- Palettes grid: 3 → 2 → 1 columns, colours touching, values under the strip. Click selects, Ctrl/Shift multi-select, Space opens full screen (Esc back to the grid), double-click opens in the window. Clicking a colour of a selected card copies its value. Drag cards to reorder; drag onto a project in the sidebar moves (Ctrl copies). Image appears when hovering the palette name.
- Opened palette: all colours locked. Save, Save copy, Original, Discard; Ctrl+Z / Ctrl+Y; Esc asks before discarding. To Pantone converts the colours on screen.
- Pantone copies are independent palettes named "<name> · Pantone" with a yellow "PANTONE …" tag. Search across chosen guides (default Solid Coated + Pastels & Neons Coated); closest Delta E preselected.
- References: one colour list per image (extracted + picked by hand at the end), any colour removable; removing an extracted one lowers the count; the slider recalculates only extracted colours.
- Settings: clear reference images (with confirmation, palettes kept), CMYK profile Coated FOGRA39 (changeable in the desktop app).
- Share as image: 1200 px PNG, transparent background, hex + RGB + Pantone under each colour.

## To do in v1.0 (agreed in voice, not yet built — the "0.7" list)

1. Text on colour: black/white/custom swatches smaller than the palette swatches; custom opens the same full colour box as the generator (HSB, RGB, Square, Disc); sample title and paragraph centred.
2. Colour wheel button moves to the left group, first, before the harmony picker.
3. Harmony icons redrawn like Adobe Color's, simplified, in grey and black only: light grey circle, colour positions as black dots joined by lines.
4. Wheel view: a locked colour's point can't be dragged and its brightness slider is locked too; show a small padlock instead of the square. Unlock to move it.
5. Mixed Pantone palettes: besides the Pantone candidates, each colour can be "White", "Black" or "Keep as is". The palette can mix Pantone and non-Pantone colours. Illustrator export: Pantone as named spot colours, the rest as process colours. Tag e.g. "PANTONE C + 1 process".
6. Tabs become: Palettes, Project references, Explore.
7. Explore (keyword search, Unsplash API with a key in settings): results as a grid of palettes like the Palettes grid, one per photo, photo on hovering the name. Select and "Save to project" (or drag to a project); saved palettes are named after the keyword and the photo goes into Project references. "Load more" at the end. Explore results don't count as project references until saved.

## Desktop-only items from the original scope

- Illustrator export: one or several palettes → .ai with a square per colour; Pantone as named spot colours, others as process colours (script approach like Font Manager).
- Real CMYK with FOGRA39 (profile changeable in settings).
- Optional link to Buni Font Manager if installed: pick fonts from a Font Manager project in Text on colour.
- Reference images stored as files in a library folder with thumbnails; clear-cache in settings.
- Clipboard: Paste screenshot button reads the clipboard directly; Share as image copies in one click.
- Credit line: "Vibe coded by Anderson Santos · Version X", linking to andersonbunidesign.com.

## 1.1.1

- Pantone guides updated: Solid Coated from an unofficial 2024 list (2,364 colours, metallics and pastels left out,
  includes the 2000 and 4000 series such as 2024 C); Solid Uncoated and Pastels & Neons from the PANTONE+ 2019 (V3)
  libraries. Matching uses each guide's own Lab values (D50, adapted to D65), not clipped screen hex.
  Newer uncoated colours (2023+) have no open data yet. PANTONE 10401–10454 C are left out until it's clear which guide they belong to.
- Image Sampling: colours come from a map of the image's ~30 colour blocks. Resample draws a different set of clearly
  different colours, small areas included, and avoids the last set. Colours can be dragged into a new order (reset by
  Resample or the slider). To Pantone button on each image goes straight to the Pantone screen.
- Open palette: drag a colour column to move it (Ctrl+Z undoes it); Pantone names follow their colour.

## 1.1.2

- To Pantone: each colour has a "Type a Pantone" field. Any code from any of the four guides ("165", "165 C",
  "PANTONE 165 U", "Cool Gray 9") is added as a choice with its Delta E and picked.

## 1.1.3

- Pantone guide window: every colour of the chosen guides as swatches, by hue family (light to dark), neutrals last;
  your colour pinned, the five closest numbered, search by number. Opens from "Browse guide" in To Pantone and from
  the colour box. The colour box has a Pantone tab with the closest swatches.
- Pantone colours inside a palette: picking a Pantone in the generator makes that colour a Pantone (locked). Adjust
  leaves Pantone, White and Black alone; changing the colour by hand makes it a plain colour again (with a notice;
  Ctrl+Z undoes). "Make process colour" (colour box) and "Remove Pantone" (palette menu) go back to the colour it
  was before (PColor.orig). Palettes can mix Pantone and process; tag "PANTONE C + n process". To Pantone keeps
  colours that already are Pantone.

## 1.2.0 — Gradients

- Tabs: Color Palettes / Gradients / Image Sampling / Keywords. Each project in the sidebar has two collapsible
  sections, Palettes and Gradients (`AppState.closedSections`: "<id>:p" / "<id>:g"). Gradients drag between
  projects like palettes (`application/x-bp-gradients`, Ctrl copies).
- Data: `Project.gradients?: Gradient[]` (`{id, name, type: linear|radial, angle (CSS), stops [{hex, pos 0–1}], blend:
  oklab|oklch|rgb, imageId?, line?}`); editor state per project in `AppState.grad`. Default names: project + number,
  keyword + number from Keywords.
- `src/gradient.ts`: OKLab/OKLCH blending, `issues()` (dull/grey middle, dark dip, flat stops) and `fixSegment()`
  (adds a colourful middle stop), `quality()`, `generateGradient()` (modes Smooth / Vibrant / From references /
  Unusual; 70 candidates scored together with locked stops), `suggest()` (pairs and trios from palette colours),
  `autoLine()` (best of ~36 lines across an image: ends differ, colour changes smoothly), `stopsAlong()`,
  `paint()` for exact per-pixel images, CSS with `in oklab` plus an RGB fallback.
- Editor (`GradientEditor.tsx`): 2–5 stops, drag stops on the bar, locks, Space generates, Ctrl+Z, linear angle dial
  or radial, blend Perceptual / Vivid / Plain RGB. While it's open, clicking a colour in a sidebar palette puts it in
  the selected stop. Save / Save copy / Original / Discard, Copy CSS, image, Illustrator.
- Gradients grid (`Gradients.tsx`) with "Suggest from palettes".
- Image Sampling and Keywords: Palette (default) / Gradient switch. Gradient mode draws a line automatically; drag its
  ends or drag across the image to draw your own; "Another line" tries the next best. The gradient takes the line's
  angle on the image.
- Illustrator: `export_illustrator` takes `gradients` too; each becomes a gradient swatch (group "Gradients") and a
  rectangle with its stops written under it. Perceptual blends are sent with extra in-between stops because
  Illustrator blends in RGB/CMYK. Gradients are process only (no Pantone). Mesh ("blurry blobs") gradients: later.
