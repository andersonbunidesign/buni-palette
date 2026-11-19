//! Export to Illustrator: an ExtendScript that Illustrator runs to build the file itself,
//! with one square per colour and a swatch group per palette. Pantone colours become
//! named spot colours (defined in Lab, like Pantone's own libraries); the rest are process colours.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportColor {
    pub hex: String,
    /// "PANTONE 7621 C": a spot colour.
    #[serde(default)]
    pub pantone: Option<String>,
    /// "White" or "Black" picked in the Pantone conversion: exact 0/0/0/0 or 0/0/0/100 in CMYK.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportPalette {
    pub name: String,
    pub colors: Vec<ExportColor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocMode {
    Rgb,
    Cmyk,
}

pub fn parse_hex(hex: &str) -> Option<[u8; 3]> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([v(0)?, v(2)?, v(4)?])
}

/// sRGB to CIE Lab with a D50 white (Bradford adapted), the white Illustrator's Lab colours use.
pub fn lab_d50(rgb: [u8; 3]) -> [f64; 3] {
    let lin = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    let (r, g, b) = (lin(rgb[0]), lin(rgb[1]), lin(rgb[2]));
    // sRGB to XYZ, already adapted to D50 (Bradford).
    let x = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b;
    let y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b;
    let z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b;
    let f = |t: f64| if t > 216.0 / 24389.0 { t.cbrt() } else { (24389.0 / 27.0 * t + 16.0) / 116.0 };
    let (fx, fy, fz) = (f(x / 0.96422), f(y), f(z / 0.82521));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// A JavaScript string literal, ASCII only (ExtendScript reads files as Latin-1 otherwise).
pub fn js_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for u in c.encode_utf16(&mut buf) {
                    o.push_str(&format!("\\u{:04x}", u));
                }
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn r1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Builds the script. `cmyk` converts a colour with the CMYK profile chosen in Settings.
pub fn script(palettes: &[ExportPalette], mode: DocMode, ai_path: &str, profile_name: &str, cmyk: &dyn Fn([u8; 3]) -> [f64; 4]) -> Result<String, String> {
    if palettes.is_empty() || palettes.iter().all(|p| p.colors.is_empty()) {
        return Err("Pick at least one palette with colours".into());
    }
    let mut js = String::new();
    js.push_str("// Made by Buni Palette. Run it in Illustrator: File > Scripts > Other Script.\n");
    js.push_str(&format!(
        "var MODE={},AI_PATH={},PROFILE={};\n",
        js_str(if mode == DocMode::Cmyk { "cmyk" } else { "rgb" }),
        js_str(ai_path),
        js_str(profile_name)
    ));
    js.push_str("var PALETTES=[\n");
    for p in palettes {
        js.push_str(&format!("{{name:{},colors:[", js_str(&p.name)));
        for c in &p.colors {
            let rgb = parse_hex(&c.hex).ok_or_else(|| format!("\"{}\" isn't a colour", c.hex))?;
            let label = c.label.as_deref().map(|l| l.to_ascii_lowercase());
            let k = match label.as_deref() {
                Some("white") => [0.0, 0.0, 0.0, 0.0],
                Some("black") => [0.0, 0.0, 0.0, 100.0],
                _ => cmyk(rgb).map(|v| v.round()),
            };
            let lab = lab_d50(rgb);
            let hex = format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2]);
            js.push_str(&format!(
                "{{hex:{},rgb:[{},{},{}],cmyk:[{},{},{},{}],lab:[{},{},{}],spot:{},label:{}}},",
                js_str(&hex),
                rgb[0],
                rgb[1],
                rgb[2],
                k[0],
                k[1],
                k[2],
                k[3],
                r1(lab[0]),
                r1(lab[1]),
                r1(lab[2]),
                c.pantone.as_deref().map(js_str).unwrap_or_else(|| "null".into()),
                c.label.as_deref().map(js_str).unwrap_or_else(|| "null".into()),
            ));
        }
        js.push_str("]},\n");
    }
    js.push_str("];\n");
    js.push_str(RUNTIME);
    Ok(js)
}

const RUNTIME: &str = r#"
var SQ = 72, MARGIN = 48, TITLE = 16, GAP = 36, LABEL_H = 46;
function font(names) {
  for (var i = 0; i < names.length; i++) { try { return app.textFonts.getByName(names[i]); } catch (e) {} }
  return null;
}
function ink() {
  if (MODE == "cmyk") { var c = new CMYKColor(); c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 85; return c; }
  var r = new RGBColor(); r.red = 52; r.green = 52; r.blue = 52; return r;
}
function process(col) {
  if (MODE == "cmyk") {
    var c = new CMYKColor(); c.cyan = col.cmyk[0]; c.magenta = col.cmyk[1]; c.yellow = col.cmyk[2]; c.black = col.cmyk[3]; return c;
  }
  var r = new RGBColor(); r.red = col.rgb[0]; r.green = col.rgb[1]; r.blue = col.rgb[2]; return r;
}
function processName(col) {
  if (col.label) return col.label;
  if (MODE == "cmyk") return "C=" + col.cmyk[0] + " M=" + col.cmyk[1] + " Y=" + col.cmyk[2] + " K=" + col.cmyk[3];
  return "R=" + col.rgb[0] + " G=" + col.rgb[1] + " B=" + col.rgb[2];
}
function swatchNamed(doc, name) { try { return doc.swatches.getByName(name); } catch (e) { return null; } }
function spotNamed(doc, name) { try { return doc.spots.getByName(name); } catch (e) { return null; } }
function main() {
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  var widest = 0;
  for (var i = 0; i < PALETTES.length; i++) widest = Math.max(widest, PALETTES[i].colors.length);
  var rowH = TITLE + 12 + SQ + LABEL_H;
  var W = Math.max(360, MARGIN * 2 + widest * SQ), H = MARGIN * 2 + PALETTES.length * rowH + (PALETTES.length - 1) * GAP;
  var doc = app.documents.add(MODE == "cmyk" ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB, W, H);
  app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
  // Start from an empty Swatches panel, so only the palettes are in it.
  try { for (var g = doc.swatchGroups.length - 1; g > 0; g--) doc.swatchGroups[g].remove(); } catch (e) {}
  try { for (var s = doc.swatches.length - 1; s >= 0; s--) { try { doc.swatches[s].remove(); } catch (e) {} } } catch (e) {}
  var ab = doc.artboards[0].artboardRect, L0 = ab[0], T0 = ab[1];
  doc.artboards[0].name = PALETTES.length == 1 ? PALETTES[0].name : "Palettes";
  var titleFont = font(["SegoeUI-Semibold", "MyriadPro-Semibold", "Arial-BoldMT", "ArialMT"]);
  var labelFont = font(["SegoeUI", "MyriadPro-Regular", "ArialMT"]);
  var layer = doc.layers[0];
  layer.name = "Palettes";
  for (var p = 0; p < PALETTES.length; p++) {
    var pal = PALETTES[p];
    var top = T0 - MARGIN - p * (rowH + GAP), left = L0 + MARGIN;
    var group = doc.swatchGroups.add();
    group.name = pal.name;
    var art = layer.groupItems.add();
    art.name = pal.name;
    var t = art.textFrames.pointText([left, top - TITLE + 3]);
    t.contents = pal.name;
    t.textRange.characterAttributes.size = 14;
    if (titleFont) t.textRange.characterAttributes.textFont = titleFont;
    t.textRange.characterAttributes.fillColor = ink();
    for (var c = 0; c < pal.colors.length; c++) {
      var col = pal.colors[c], fill, name;
      if (col.spot) {
        name = col.spot;
        var spot = spotNamed(doc, name);
        if (!spot) {
          spot = doc.spots.add();
          spot.name = name;
          spot.colorType = ColorModel.SPOT;
          var lab = new LabColor(); lab.l = col.lab[0]; lab.a = col.lab[1]; lab.b = col.lab[2];
          spot.color = lab;
          try { spot.spotKind = SpotColorKind.SPOTLAB; } catch (e) {}
        }
        fill = new SpotColor(); fill.spot = spot; fill.tint = 100;
        var sw = swatchNamed(doc, name);
        if (sw) { try { group.addSwatch(sw); } catch (e) {} } else { try { group.addSpot(spot); } catch (e) {} }
      } else {
        fill = process(col);
        name = processName(col);
        if (swatchNamed(doc, name)) name = name + " (" + pal.name + ")";
        var s2 = doc.swatches.add();
        s2.name = name; s2.color = fill;
        try { group.addSwatch(s2); } catch (e) {}
      }
      var x = left + c * SQ, y = top - TITLE - 12;
      var r = art.pathItems.rectangle(y, x, SQ, SQ);
      r.stroked = false; r.filled = true; r.fillColor = fill; r.name = name;
      var lines = [];
      if (col.spot) lines.push(col.spot.replace(/^PANTONE /, ""));
      else if (col.label) lines.push(col.label);
      lines.push(col.hex);
      lines.push(MODE == "cmyk" ? col.cmyk.join(" ") : col.rgb.join(" "));
      var lt = art.textFrames.pointText([x + 2, y - SQ - 12]);
      lt.contents = lines.join("\r");
      var a = lt.textRange.characterAttributes;
      a.size = 7; a.fillColor = ink();
      if (labelFont) a.textFont = labelFont;
      try { lt.textRange.paragraphAttributes.spaceBefore = 0; lt.textRange.characterAttributes.leading = 9; lt.textRange.characterAttributes.autoLeading = false; } catch (e) {}
    }
  }
  var note = layer.textFrames.pointText([L0 + MARGIN, T0 - H + 18]);
  note.contents = "Buni Palette" + (MODE == "cmyk" ? " \u00b7 CMYK values from " + PROFILE : "") + " \u00b7 Pantone values are approximations: check the printed guide";
  note.textRange.characterAttributes.size = 6;
  note.textRange.characterAttributes.fillColor = ink();
  if (labelFont) note.textRange.characterAttributes.textFont = labelFont;
  var opts = new IllustratorSaveOptions();
  opts.pdfCompatible = true;
  doc.saveAs(new File(AI_PATH), opts);
  return "OK";
}
var __result;
try { __result = main(); } catch (e) { __result = "ERROR:" + e; }
__result;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lab_of_white_and_red() {
        let w = lab_d50([255, 255, 255]);
        assert!((w[0] - 100.0).abs() < 0.1 && w[1].abs() < 0.2 && w[2].abs() < 0.2, "{w:?}");
        let r = lab_d50([255, 0, 0]);
        // Known value for sRGB red with D50: about 54.3, 80.8, 69.9.
        assert!((r[0] - 54.3).abs() < 0.5 && (r[1] - 80.8).abs() < 1.0 && (r[2] - 69.9).abs() < 1.0, "{r:?}");
    }

    #[test]
    fn writes_spots_and_process() {
        let pals = vec![ExportPalette {
            name: "Rye é \"1\"".into(),
            colors: vec![
                ExportColor { hex: "#2F3A2F".into(), pantone: Some("PANTONE 5605 C".into()), label: None },
                ExportColor { hex: "#FFFFFF".into(), pantone: None, label: Some("White".into()) },
                ExportColor { hex: "#B5532E".into(), pantone: None, label: None },
            ],
        }];
        let js = script(&pals, DocMode::Cmyk, "C:\\out\\a.ai", "Coated FOGRA39", &|_| [10.0, 20.0, 30.0, 40.0]).unwrap();
        assert!(js.is_ascii());
        assert!(js.contains("spot:\"PANTONE 5605 C\""));
        assert!(js.contains("cmyk:[0,0,0,0]"), "white is exact");
        assert!(js.contains("cmyk:[10,20,30,40]"));
        assert!(js.contains("\"C:\\\\out\\\\a.ai\""));
        assert!(js.contains("Rye \\u00e9 \\\"1\\\""));
        assert!(script(&[], DocMode::Rgb, "a.ai", "", &|_| [0.0; 4]).is_err());
    }
}
