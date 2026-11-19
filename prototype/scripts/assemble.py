# Builds dist/buni-palette.html: one self-contained page for the web prototype.
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
dist = root / "dist"
js = (dist / "app.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
css = (dist / "app.css").read_text(encoding="utf-8")
html = f"""<title>Buni Palette</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>{css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>{js}</script>
"""
(dist / "buni-palette.html").write_text(html, encoding="utf-8")
print("wrote", dist / "buni-palette.html", len(html) // 1024, "KB")
