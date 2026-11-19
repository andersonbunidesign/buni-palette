//! The optional link with Buni Font Manager: its projects (collections) and their fonts,
//! read from its library folder. Nothing is written there.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FmFont {
    pub id: String,
    /// "Bodoni Moda Bold Italic".
    pub name: String,
    pub family: String,
    pub style: String,
    pub weight: u32,
    pub italic: bool,
    pub path: String,
    /// Position inside a .ttc file; the interface can only load the first one.
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FmProject {
    pub name: String,
    pub fonts: Vec<FmFont>,
}

fn font_of(v: &Value) -> Option<FmFont> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let id = s("id");
    let path = s("path");
    if id.is_empty() || path.is_empty() {
        return None;
    }
    let family = s("family");
    let style = s("style");
    let full = s("fullName");
    Some(FmFont {
        name: if full.is_empty() { format!("{family} {style}").trim().to_string() } else { full },
        family,
        style,
        weight: v.get("weight").and_then(|x| x.as_u64()).unwrap_or(400) as u32,
        italic: v.get("italic").and_then(|x| x.as_bool()).unwrap_or(false),
        index: v.get("index").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        path,
        id,
    })
}

/// None when the Font Manager isn't there. Fonts whose files are gone are left out.
pub fn read(root: &Path) -> Option<Vec<FmProject>> {
    let lib: Value = serde_json::from_slice(&std::fs::read(root.join("library.json")).ok()?).ok()?;
    let mut fonts: HashMap<String, FmFont> = HashMap::new();
    for f in lib.get("fonts").and_then(|x| x.as_array()).into_iter().flatten() {
        if let Some(ff) = font_of(f) {
            fonts.insert(ff.id.clone(), ff);
        }
    }
    // System and Adobe fonts in collections are described in the Font Manager's scan cache.
    if let Some(cache) = std::fs::read(root.join("external-cache.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
        for e in cache.get("entries").and_then(|x| x.as_object()).into_iter().flat_map(|m| m.values()) {
            for r in e.get("records").and_then(|x| x.as_array()).into_iter().flatten() {
                if let Some(ff) = font_of(r) {
                    fonts.entry(ff.id.clone()).or_insert(ff);
                }
            }
        }
    }
    let mut out = Vec::new();
    for c in lib.get("collections").and_then(|x| x.as_array()).into_iter().flatten() {
        let name = c.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let list: Vec<FmFont> = c
            .get("fontIds")
            .and_then(|x| x.as_array())
            .into_iter()
            .flatten()
            .filter_map(|id| id.as_str().and_then(|id| fonts.get(id)).cloned())
            .filter(|f| Path::new(&f.path).exists())
            .collect();
        if !name.is_empty() && !list.is_empty() {
            out.push(FmProject { name, fonts: list });
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_collections() {
        let dir = tempfile::tempdir().unwrap();
        let font = dir.path().join("a.otf");
        std::fs::write(&font, b"x").unwrap();
        let sys = dir.path().join("b.ttf");
        std::fs::write(&sys, b"x").unwrap();
        let p = |x: &Path| x.to_string_lossy().replace('\\', "\\\\");
        std::fs::write(
            dir.path().join("library.json"),
            format!(
                r#"{{"version":1,"fonts":[{{"id":"a1","family":"Acme","style":"Bold","fullName":"Acme Bold","weight":700,"italic":false,"path":"{}"}}],
                "collections":[{{"name":"Brand","fontIds":["a1","x9","gone"]}},{{"name":"Empty","fontIds":[]}}]}}"#,
                p(&font)
            ),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("external-cache.json"),
            format!(r#"{{"version":1,"entries":{{"k":{{"size":1,"mtime":1,"records":[{{"id":"x9","family":"Segoe UI","style":"Regular","path":"{}"}}]}}}}}}"#, p(&sys)),
        )
        .unwrap();
        let pr = read(dir.path()).unwrap();
        assert_eq!(pr.len(), 1);
        assert_eq!(pr[0].name, "Brand");
        assert_eq!(pr[0].fonts.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Acme Bold", "Segoe UI Regular"]);
        assert!(read(&dir.path().join("nope")).is_none());
    }
}
