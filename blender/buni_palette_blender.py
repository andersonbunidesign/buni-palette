# Buni Palette for Blender
# Reads the palettes you keep in Buni Palette and puts one into the Shader Editor
# as a frame with one RGB node per colour.
#
# Install: Blender > Edit > Preferences > Add-ons > Install from Disk, pick this file, tick it.
# Use: Shader Editor > sidebar (N) > Buni Palette tab.

bl_info = {
    "name": "Buni Palette",
    "author": "Anderson Santos",
    "version": (1, 0, 0),
    "blender": (4, 0, 0),
    "location": "Shader Editor > Sidebar > Buni Palette",
    "description": "Insert a Buni Palette palette as RGB nodes inside a frame",
    "doc_url": "https://andersonbunidesign.com",
    "category": "Node",
}

import json
import os

import bpy
from bpy.props import EnumProperty, StringProperty

DEFAULT_FILE = os.path.join(os.path.expanduser("~"), "Buni Palette", "palettes.json")

# Blender needs the strings behind enum items to stay alive, so the lists are kept here.
_cache = {"mtime": None, "path": None, "projects": [], "project_items": [], "palette_items": {}}


def _prefs():
    addon = bpy.context.preferences.addons.get(__name__)
    return addon.preferences if addon else None


def data_file():
    p = _prefs()
    path = p.data_file if p and p.data_file else DEFAULT_FILE
    return bpy.path.abspath(path)


def load(force=False):
    """Reads palettes.json again when it changed since the last read."""
    path = data_file()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        _cache.update(mtime=None, path=path, projects=[], project_items=[], palette_items={})
        return []
    if force or mtime != _cache["mtime"] or path != _cache["path"]:
        try:
            with open(path, encoding="utf-8") as f:
                state = json.load(f)
        except (OSError, ValueError):
            return _cache["projects"]
        projects = state.get("projects", [])
        _cache.update(
            mtime=mtime,
            path=path,
            projects=projects,
            project_items=[(p["id"], p.get("name", "Project"), "") for p in projects],
            palette_items={
                p["id"]: [(pl["id"], pl.get("name", "Palette"), _summary(pl)) for pl in p.get("palettes", [])] for p in projects
            },
        )
    return _cache["projects"]


def _summary(pl):
    return ", ".join(_label(c) for c in pl.get("colors", []))


def _label(c):
    name = c.get("pantone") or c.get("label")
    return name.replace("PANTONE ", "") if name else c.get("hex", "").upper()


def project_items(self, context):
    load()
    return _cache["project_items"] or [("NONE", "No projects found", "")]


def palette_items(self, context):
    load()
    return _cache["palette_items"].get(context.scene.buni_project) or [("NONE", "No palettes", "")]


def srgb_to_linear(c):
    # RGB nodes work in linear colour; palette hex values are sRGB.
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def find_palette(project_id, palette_id):
    for p in load():
        if p["id"] == project_id:
            for pl in p.get("palettes", []):
                if pl["id"] == palette_id:
                    return pl
    return None


def insert_palette(tree, palette, location=(0.0, 0.0)):
    """Adds a frame named after the palette with one RGB node per colour, top to bottom."""
    for n in tree.nodes:
        n.select = False
    frame = tree.nodes.new("NodeFrame")
    frame.label = palette.get("name", "Palette")
    frame.name = "Buni Palette: " + frame.label
    frame.label_size = 20
    frame.shrink = True
    x, y = location
    frame.location = (x, y)
    nodes = []
    for i, c in enumerate(palette.get("colors", [])):
        node = tree.nodes.new("ShaderNodeRGB")
        node.label = _label(c)
        node.outputs[0].default_value = hex_to_linear(c.get("hex", "#000000"))
        node.parent = frame
        node.location = (x + 20, y - 40 - i * 200)
        node.select = True
        nodes.append(node)
    frame.select = True
    tree.nodes.active = frame
    return frame, nodes


class BUNI_Preferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    data_file: StringProperty(
        name="Palettes file",
        description="Buni Palette's palettes.json. Change it only if you moved the Buni Palette folder",
        subtype="FILE_PATH",
        default=DEFAULT_FILE,
    )

    def draw(self, context):
        self.layout.prop(self, "data_file")


class BUNI_OT_reload(bpy.types.Operator):
    bl_idname = "buni_palette.reload"
    bl_label = "Reload"
    bl_description = "Read the palettes from Buni Palette again"

    def execute(self, context):
        projects = load(force=True)
        if not projects:
            self.report({"WARNING"}, f"No Buni Palette data at {data_file()}")
        else:
            self.report({"INFO"}, f"Read {sum(len(p.get('palettes', [])) for p in projects)} palettes")
        return {"FINISHED"}


class BUNI_OT_insert(bpy.types.Operator):
    bl_idname = "buni_palette.insert"
    bl_label = "Insert palette"
    bl_description = "Add the palette as a frame of RGB nodes in this shader"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        space = context.space_data
        return space and space.type == "NODE_EDITOR" and space.edit_tree is not None

    def execute(self, context):
        scene = context.scene
        pal = find_palette(scene.buni_project, scene.buni_palette)
        if not pal:
            self.report({"WARNING"}, "Pick a palette first")
            return {"CANCELLED"}
        space = context.space_data
        loc = tuple(space.cursor_location) if hasattr(space, "cursor_location") else (0.0, 0.0)
        insert_palette(space.edit_tree, pal, loc)
        self.report({"INFO"}, f"Inserted {pal.get('name', 'palette')}")
        return {"FINISHED"}


class BUNI_PT_panel(bpy.types.Panel):
    bl_label = "Buni Palette"
    bl_space_type = "NODE_EDITOR"
    bl_region_type = "UI"
    bl_category = "Buni Palette"

    @classmethod
    def poll(cls, context):
        return context.space_data.tree_type == "ShaderNodeTree"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        projects = load()
        if not projects:
            layout.label(text="No palettes found", icon="ERROR")
            layout.label(text="Open Buni Palette once, or set the")
            layout.label(text="file in the add-on preferences.")
            layout.operator("buni_palette.reload", icon="FILE_REFRESH")
            return
        layout.prop(scene, "buni_project", text="Project")
        layout.prop(scene, "buni_palette", text="Palette")
        pal = find_palette(scene.buni_project, scene.buni_palette)
        if pal:
            col = layout.column(align=True)
            for c in pal.get("colors", []):
                col.label(text=_label(c), icon="NODE")
        if context.space_data.edit_tree is None:
            layout.label(text="Open a material to insert into", icon="INFO")
        row = layout.row(align=True)
        row.scale_y = 1.3
        row.operator("buni_palette.insert", icon="ADD")
        row.operator("buni_palette.reload", text="", icon="FILE_REFRESH")


def _project_changed(self, context):
    items = _cache["palette_items"].get(self.buni_project) or []
    if items:
        try:
            self.buni_palette = items[0][0]
        except TypeError:
            pass


classes = (BUNI_Preferences, BUNI_OT_reload, BUNI_OT_insert, BUNI_PT_panel)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.buni_project = EnumProperty(name="Project", items=project_items, update=_project_changed)
    bpy.types.Scene.buni_palette = EnumProperty(name="Palette", items=palette_items)


def unregister():
    del bpy.types.Scene.buni_palette
    del bpy.types.Scene.buni_project
    for c in reversed(classes):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
