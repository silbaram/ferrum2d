"""Blender cold fixture builder; never overwrites production village models.

Run: blender --background --factory-startup --python this-file -- SOURCE_DIR OUTPUT_DIR
"""

import hashlib
import json
from pathlib import Path
import sys

import bpy


def main():
    source, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
    if source.resolve() == output.resolve():
        raise ValueError("LOD output must differ from the original model directory")
    output.mkdir(parents=True, exist_ok=True)
    result = {}
    for name in ("tree", "pine"):
        original = source / (name + ".glb")
        target = output / (name + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(original))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        before = sum(len(obj.data.polygons) for obj in meshes)
        for obj in meshes:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("Ferrum measured LOD", "DECIMATE")
            modifier.ratio = .55
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_yup=True)
        result[name] = {
            "sourceSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "sourcePolygons": before,
            "lodPolygons": sum(len(obj.data.polygons) for obj in meshes),
        }
    (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
