"""Original Blender Mapping-node fixture for the bounded static glTF importer.

blender --background --factory-startup --python scripts/assets/build-texture-transform-fixture.py
Exports GLB and separated glTF from the same scene without patching exporter output.
"""
import bpy
import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'spatial-texture-transform'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def image(name, kind):
    img = bpy.data.images.new(name, width=8, height=8, alpha=True)
    if kind == 'normal':
        img.colorspace_settings.name = 'Non-Color'
    values = []
    colors = [(1, .1, .1), (.1, 1, .1), (.1, .1, 1), (1, .8, .1)]
    for y in range(8):
        for x in range(8):
            if kind == 'normal':
                rgb = (.8 if x < 4 else .2, .5, .9)
            else:
                rgb = colors[(x // 4) + (y // 4) * 2]
            alpha = 0 if kind == 'base' and x < 4 and y < 4 else 1
            values.extend((*rgb, alpha))
    img.pixels = values
    img.pack()
    return img


mat = bpy.data.materials.new('IndependentUVTransforms')
mat.use_nodes = True
mat.use_backface_culling = False
nodes, links = mat.node_tree.nodes, mat.node_tree.links
shader = nodes.get('Principled BSDF')
shader.inputs['Metallic'].default_value = 0
shader.inputs['Roughness'].default_value = 1
shader.inputs['Emission Strength'].default_value = .6
uv = nodes.new('ShaderNodeTexCoord')
for name, location, rotation, scale in [
    ('base', (.125, .25), math.pi / 2, (.75, 1.25)),
    ('normal', (.25, .125), -.35, (-1, .75)),
    ('emissive', (.125, .5), .2, (1.5, .5)),
]:
    mapping = nodes.new('ShaderNodeMapping')
    mapping.vector_type = 'POINT'
    mapping.inputs['Location'].default_value = (*location, 0)
    mapping.inputs['Rotation'].default_value = (0, 0, rotation)
    mapping.inputs['Scale'].default_value = (*scale, 1)
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image(name, name)
    tex.interpolation = 'Closest'
    tex.extension = 'REPEAT'
    links.new(uv.outputs['UV'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    if name == 'base':
        links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        threshold = nodes.new('ShaderNodeMath')
        threshold.operation = 'GREATER_THAN'
        threshold.inputs[1].default_value = .5
        links.new(tex.outputs['Alpha'], threshold.inputs[0])
        links.new(threshold.outputs[0], shader.inputs['Alpha'])
    elif name == 'normal':
        normal = nodes.new('ShaderNodeNormalMap')
        links.new(tex.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    else:
        links.new(tex.outputs['Color'], shader.inputs['Emission Color'])

mesh = bpy.data.meshes.new('UVPanel')
mesh.from_pydata([(-32, 0, 8), (32, 0, 8), (32, 0, 104), (-32, 0, 104)], [], [(0, 1, 2, 3)])
mesh.update()
layer = mesh.uv_layers.new(name='UVMap')
for loop, coord in zip(layer.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
    loop.uv = coord
obj = bpy.data.objects.new('UVPanel', mesh)
bpy.context.collection.objects.link(obj)
obj.data.materials.append(mat)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
for fmt, filename in [('GLB', 'mapping.glb'), ('GLTF_SEPARATE', 'mapping.gltf')]:
    args = dict(filepath=str(OUT / filename), export_format=fmt, use_selection=True,
                export_yup=True, export_normals=True, export_tangents=True, export_texcoords=True,
                export_materials='EXPORT', export_animations=False, export_skins=False, export_morph=False,
                export_cameras=False, export_lights=False, export_extras=False, export_image_format='AUTO')
    available = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if 'export_vertex_color' in available:
        args['export_vertex_color'] = 'NONE'
    bpy.ops.export_scene.gltf(**args)
print('TEXTURE_TRANSFORM_FIXTURE', bpy.app.version_string, str(OUT))
