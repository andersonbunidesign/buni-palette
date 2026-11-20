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
