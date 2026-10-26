"""Author original 16-bit-inspired village assets with Blender (no external art).

blender --background --factory-startup --python scripts/assets/build-rpg-village.py
Outputs a source .blend, bounded static GLBs, pixel PNGs, provenance and a scene.
Blender X/Y/Z maps to Ferrum X/Y/elevation through the standard Y-up glTF export.
"""
from pathlib import Path
import hashlib
import json
import math
import random
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/placement-viewer/public/assets/rpg-village'
SOURCE = ROOT / 'apps/placement-viewer/assets/rpg-village'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
RNG = random.Random(1994)
MATERIALS = {}
MODELS = {}
SCENES = {}
CURRENT = None
# Shared visual/support dimensions keep the example's height grid on the actual ground.
GARDEN = {'x': -180, 'y': -218, 'width': 100, 'depth': 64, 'elevation': 24}
GARDEN_RAMP = {'x': -80, 'y': -210, 'width': 64, 'depth': 48,
               'elevation': 24, 'endElevation': 0, 'rampAxis': 'x'}

PALETTE = {
    'ink': '#322e32', 'wood': '#835434', 'timber': '#543a31', 'wood_light': '#b78550',
    'plaster': '#ecd6a8', 'plaster_shadow': '#d5b882', 'stone': '#9b9580',
    'stone_dark': '#726f65', 'roof': '#b75d44', 'roof_blue': '#587b85',
    'roof_dark': '#824a3e', 'leaf': '#63864b', 'leaf_light': '#89a55a',
    'leaf_dark': '#3d643f', 'grass': '#839351', 'grass_light': '#9aa65e',
    'path': '#b5ad8c', 'water': '#5d9aab', 'water_light': '#95c2c2',
    'gold': '#e4bc64', 'glass': '#8db7ad', 'cream': '#f8e5b5', 'red': '#b25b51',
    'purple': '#8b7795', 'pink': '#d99894', 'white': '#ece5c9',
}


def rgb(hex_color):
    return tuple(int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5))


def linear(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def texture(name, kind, size=64):
    """Small hand-authored palette textures, encoded by Blender itself."""
    image = bpy.data.images.new('Village_' + name, width=size, height=size, alpha=True)
    data = []
    base = rgb(PALETTE[name])
    local = random.Random('village-' + name)
    for y in range(size):
        for x in range(size):
            value = 1.0
            if kind == 'roof':
                row = y // 8
                xx = (x + (4 if row % 2 else 0)) % 16
                value = .68 if y % 8 == 0 or xx == 0 else (1.12 if y % 8 == 1 else .94 + .04 * (xx // 4))
            elif kind == 'plaster':
                value = local.choice([.92, .97, 1, 1, 1.02])
            elif kind == 'wood':
                value = .69 if x % 16 == 0 else (.87 if (x + y // 6) % 17 == 1 else 1.03)
                if y % 32 in (0, 1): value *= .82
            elif kind == 'stone':
                row = y // 12
                xx = (x + row % 2 * 9) % 24
                value = .72 if y % 12 == 0 or xx == 0 else [.92, 1.03, 1.1][(x // 24 + row) % 3]
            elif kind == 'grass':
                value = local.choice([.84, .96, 1, 1, 1, 1.07])
                if (x * 13 + y * 7) % 71 < 2: value = 1.2
            elif kind == 'path':
                row = y // 8
                xx = (x + row % 2 * 4) % 12
                value = .73 if y % 8 == 0 or xx == 0 else [.91, 1, 1.06][(row + x // 12) % 3]
            elif kind == 'water':
                value = 1.17 if y % 14 == 0 and (x + y // 14 * 7) % 23 < 12 else (.92 if y % 14 == 1 else 1)
            data.extend([min(1, v * value) for v in base] + [1])
    image.pixels.foreach_set(data)
    image.filepath_raw = str(OUT / (name + '.png'))
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image


def material(name, pattern=None):
    key = (name, pattern)
    if key in MATERIALS: return MATERIALS[key]
    mat = bpy.data.materials.new('Village_' + name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    color = tuple(linear(v) for v in rgb(PALETTE[name]))
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 1
    shader.inputs['Metallic'].default_value = 0
    mat.diffuse_color = (*color, 1)
    if pattern:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = texture(name, pattern)
        node.interpolation = 'Closest'
        node.extension = 'REPEAT'
        mat.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
        shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
    MATERIALS[key] = mat
    return mat


def use(obj, name, pattern=None):
    obj.data.materials.append(material(name, pattern))
    # Deterministic world-density UVs; sharp normals and positive transforms only.
    if obj.type == 'MESH':
        if not obj.data.uv_layers: obj.data.uv_layers.new(name='UVMap')
        uv = obj.data.uv_layers.active.data
        for poly in obj.data.polygons:
            normal = poly.normal
            axis = max(range(3), key=lambda i: abs(normal[i]))
            axes = [i for i in range(3) if i != axis]
            for index in poly.loop_indices:
                point = obj.matrix_world @ obj.data.vertices[obj.data.loops[index].vertex_index].co
                uv[index].uv = (point[axes[0]] / 32, point[axes[1]] / 32)
    return obj


def box(name, at, dimensions, color='wood', pattern=None, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    obj.rotation_euler[2] = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return use(obj, color, pattern)


def mesh(name, points, faces, color, pattern=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(points, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    CURRENT.collection.objects.link(obj)
    return use(obj, color, pattern)


def cylinder(name, at, radius, depth, color, vertices=10, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=at)
    obj = bpy.context.object
    obj.name = name
    if rotation: obj.rotation_euler = rotation
    return use(obj, color)


def beam(name, a, b, thickness, color='timber'):
    a, b = Vector(a), Vector(b)
    obj = box(name, (a + b) / 2, (thickness, thickness, (b - a).length), color)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def roof(width, depth, base, rise, color='roof', at=(0, 0), prefix='Roof'):
    x, y = at
    w, d = width / 2, depth / 2
    # A closed gable shell; exterior normals are recalculated below.
    points = [(x-w,y-d,base),(x+w,y-d,base),(x,y-d,base+rise),
              (x-w,y+d,base),(x+w,y+d,base),(x,y+d,base+rise)]
    obj = mesh(prefix, points, [(0,1,2),(3,5,4),(0,3,4,1),(0,2,5,3),(2,1,4,5)], color, 'roof')
    beam(prefix + '_ridge', (x,y-d-1,base+rise+1), (x,y+d+1,base+rise+1), 2.5, 'roof_dark')
    for side in (-1, 1):
        beam(prefix + '_eave', (x+side*w,y-d,base), (x+side*w,y+d,base), 2.5)
        beam(prefix + '_gable', (x+side*w,y-d-1,base), (x,y-d-1,base+rise), 2)
    return obj


def window(x, y, z, width=13, height=17):
    box('Window_frame', (x,y,z), (width+3,1.8,height+3), 'timber')
    box('Blue_glass', (x,y-1,z), (width,.8,height), 'glass')
    box('Window_cross', (x,y-1.7,z), (1.2,.8,height), 'cream')
    box('Window_cross', (x,y-1.7,z), (width,.8,1.2), 'cream')
    box('Window_sill', (x,y-2,z-height/2-1), (width+5,4,2), 'wood_light')
    for side in (-1, 1): box('Shutter', (x+side*(width/2+3),y-.5,z), (3,2,height+2), 'wood', 'wood')


def text_board(text, at, width=28, color='gold'):
    x, y, z = at
    box('Sign_board', (x,y,z), (width,2,10), 'timber')
    bpy.ops.object.text_add(location=(x-width*.42,y-1.15,z-3.3), rotation=(math.pi/2,0,0))
    obj = bpy.context.object
    obj.name = 'Sign_' + text
    obj.data.body = text
    obj.data.size = 7
    obj.data.extrude = .08
    obj.data.space_character = 1.1
    obj.data.materials.append(material(color))
    bpy.ops.object.convert(target='MESH')


def house(kind):
    w, d, h = {'cottage':(76,60,42),'inn':(96,74,65),'shop':(88,62,46)}[kind]
    box('Stone_foundation', (0,0,4), (w+4,d+4,8), 'stone', 'stone')
    box('Plaster_walls', (0,0,h/2+8), (w,d,h), 'plaster', 'plaster')
    for x in (-w/2+1,w/2-1):
        for y in (-d/2-1,d/2+1): box('Corner_timber',(x,y,h/2+7),(3,3,h+2),'timber')
    for z in (10,h+7): box('Front_crossbeam',(0,-d/2-1,z),(w+2,2,3),'timber')
    for x in (-w/4,w/4): box('Front_stud',(x,-d/2-1,h/2+7),(2.2,2,h),'timber')
    box('Door_frame',(0,-d/2-1,20),(18,3,28),'timber')
    box('Wooden_door',(0,-d/2-3,19),(14,1.5,24),'wood','wood')
    cylinder('Door_handle',(4,-d/2-4,19),.8,1,'gold',8,(math.pi/2,0,0))
    box('Doorstep',(0,-d/2-6,3),(24,10,6),'stone','stone')
    for x in (-w*.29,w*.29): window(x,-d/2-2,29,11,14)
    if kind == 'inn':
        box('Upper_crossbeam',(0,-d/2-2,46),(w,3,3),'timber')
        for x in (-28,0,28): window(x,-d/2-2,57,12,14)
        beam('Sign_arm',(w/2-8,-d/2,46),(w/2-8,-d/2-19,46),2)
        text_board('INN',(w/2-8,-d/2-18,37),25)
    roof(w+14,d+14,h+9,27 if kind!='inn' else 32,'roof_blue' if kind=='shop' else 'roof')
    box('Chimney',(w*.27,d*.22,h+29),(10,10,28),'stone','stone')
    box('Chimney_cap',(w*.27,d*.22,h+44),(13,13,3),'stone_dark')
    if kind == 'shop':
        text_board('SHOP',(0,-d/2-3,h+3),33)
        for i in range(7):
            x = -35 + i*10
            a = box('Striped_awning',(x,-d/2-13,35),(10,27,2),'cream' if i%2 else 'red')
            a.rotation_euler[0] = math.radians(12)
            box('Awning_fringe',(x,-d/2-26,31),(10,2,6),'cream' if i%2 else 'red')
        for x in (-36,36): box('Awning_post',(x,-d/2-25,16),(2,2,32),'timber')
        for x in (-23,23):
            box('Market_box',(x,-d/2-17,7),(18,14,14),'wood','wood')
            for i in range(3):
                for j in range(2):
                    cylinder('Produce',(x-6+i*6,-d/2-21+j*6,15),2.6,3,'red' if x<0 else 'gold',7)
    else:
        for x in (-w*.30,w*.30):
            box('Flower_box',(x,-d/2-5,18),(17,7,5),'wood','wood')
            for dx in (-5,0,5): cylinder('Flower',(x+dx,-d/2-6,22),2,2,'pink',6)


def tower():
    box('Tower_base',(0,0,4),(46,46,8),'stone','stone')
    box('Tower_stone',(0,0,38),(38,38,68),'plaster','plaster')
    for x in (-20,20):
        for y in (-20,20): box('Tower_pillar',(x,y,48),(4,4,92),'stone','stone')
    box('Belfry_floor',(0,0,75),(48,48,5),'wood_light')
    box('Bell_shadow',(0,0,84),(32,32,16),'timber')
    for x in (-17,17):
        for y in (-17,17): box('Belfry_post',(x,y,87),(4,4,24),'wood')
    cylinder('Bell',(0,-7,84),7,12,'gold',10)
    roof(54,54,99,28,'roof_blue')
    cylinder('Clock_face',(0,-20.5,56),10,1.2,'cream',16,(math.pi/2,0,0))
    beam('Clock_hour',(0,-21.4,56),(0,-21.4,62),1.4)
    beam('Clock_minute',(0,-21.4,56),(6,-21.4,54),1.4)
    box('Tower_door',(0,-20,16),(14,2,24),'wood','wood')


def well():
    cylinder('Stone_paving',(0,0,.8),28,1.6,'stone',12)
    cylinder('Well_water',(0,0,5),13,1,'water',16)
    for i in range(12):
        a = i*math.tau/12
        box('Well_stone',(math.cos(a)*17,math.sin(a)*17,8),(9,6,16),'stone' if i%3 else 'stone_dark',rotation=a+math.pi/2)
    for x in (-22,22): box('Well_post',(x,0,21),(4,4,42),'wood','wood')
    beam('Well_crossbar',(-24,0,36),(24,0,36),3,'wood_light')
    beam('Rope',(0,0,35),(0,0,9),1,'cream')
    roof(56,38,42,15,'roof_blue')
    cylinder('Bucket',(5,-4,16),4.5,7,'wood',10)


def tree(pine=False):
    cylinder('Trunk',(0,0,17),4.5,34,'wood',8)
    if pine:
        for z, radius in [(27,25),(43,21),(58,15)]:
            bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=radius, radius2=1, depth=30, location=(0,0,z))
            use(bpy.context.object,'leaf_dark' if z==27 else 'leaf')
    else:
        for x,y,z,r,c in [(0,0,45,27,'leaf'),(-15,0,39,18,'leaf_dark'),(14,4,47,20,'leaf_light'),(0,8,60,18,'leaf_light')]:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x,y,z))
            use(bpy.context.object,c)
        for i in range(8):
            a=i*math.tau/8
            box('Grass_tuft',(math.cos(a)*8,math.sin(a)*8,2),(2,2,4),'leaf_dark')


def lamp():
    box('Lamp_foot',(0,0,2),(8,8,4),'stone')
    box('Lamp_post',(0,0,24),(3,3,48),'timber')
    box('Lantern_glass',(0,0,45),(9,9,12),'gold')
    for x in (-5,5):
        for y in (-5,5): box('Lantern_frame',(x,y,45),(1.5,1.5,14),'timber')
    roof(13,13,52,6,'roof_dark')


def fence():
    for x in (-22,0,22):
        box('Fence_post',(x,0,11),(4,5,22),'wood_light')
        roof(5,6,22,3,'wood_light',at=(x,0),prefix='Fence_cap')
    for z in (6,16): box('Fence_rail',(0,0,z),(48,3,3),'wood')


def cart():
    box('Cart_bed',(0,0,10),(27,22,4),'wood','wood')
    for x in (-14,14): box('Cart_wall',(x,0,17),(3,24,13),'wood_light','wood')
    for y in (-12,12): box('Cart_wall',(0,y,17),(30,3,13),'wood','wood')
    for x in (-18,18):
        cylinder('Cart_wheel',(x,1,9),10,3,'timber',12,(0,math.pi/2,0))
        for a in (0,math.pi/2):
            beam('Wheel_spoke',(x-2,1-math.cos(a)*8,9-math.sin(a)*8),(x-2,1+math.cos(a)*8,9+math.sin(a)*8),1.5,'wood_light')
    for x in (-8,8): box('Cart_handle',(x,-25,10),(2,30,2),'wood')
    for x,y in [(-7,-5),(5,5),(-4,6)]: cylinder('Cart_apples',(x,y,26),5,6,'red',8)


def bridge():
    for x in range(-27,28,6): box('Bridge_plank',(x,0,1),(5.7,38,2),'wood_light','wood')
    for y in (-20,20):
        for x in (-27,0,27): box('Bridge_post',(x,y,11),(4,4,22),'wood')
        box('Bridge_rail',(0,y,19),(60,3,3),'wood_light')
        box('Bridge_rail',(0,y,8),(60,2,2),'wood')


def flowers():
    box('Garden_soil',(0,0,1),(34,18,2),'wood')
    for x in (-18,18): box('Garden_border',(x,0,2),(3,22,4),'stone')
    for y in (-10,10): box('Garden_border',(0,y,2),(38,3,4),'stone')
    for i in range(6):
        x=-13+(i%3)*13; y=-4+(i//3)*8
        box('Stem',(x,y,6),(1.5,1.5,8),'leaf_dark')
        for dx,dy in [(-2,0),(2,0),(0,-2),(0,2)]:
            box('Petal',(x+dx,y+dy,10),(3,3,2),'pink' if i%2 else 'gold')
        box('Pollen',(x,y,11),(2,2,1),'cream')


def landscape():
    # River lives on the east edge; visual geometry and native supports stay separate.
    box('West_bank',(-75,0,-2),(490,440,4),'grass','grass')
    box('East_bank',(265,0,-2),(110,440,4),'grass','grass')
    box('River',(190,0,-1.2),(40,440,1),'water','water')
    for x in (168,212): box('River_edge',(x,0,-2),(4,440,5),'stone_dark')
    box('Market_road',(-60,-12,.15),(520,48,.3),'path','path')
    box('North_road',(-10,65,.18),(44,194,.3),'path','path')
    box('South_road',(-10,-129,.18),(44,166,.3),'path','path')
    for i in range(34):
        x=RNG.uniform(-300,150); y=RNG.uniform(-205,205)
        if abs(y+12)<38 or abs(x+10)<34: continue
        for j in range(3):
            box('Grass_dapple',(x+j*2,y,1),(1.3,1.3,2),'grass_light')
    for y in (-155,-103,50,118,185):
        for dx in (0,13,23):
            box('Water_glint',(178+dx,y+dx/4,-.58),(6,1,.08),'water_light')


def garden():
    # Keep the raised ground separate from the flat landscape's selection bounds.
    g = GARDEN
    ox,oy = g['x']+g['width']/2,g['y']+g['depth']/2
    box('Garden_retaining_wall', (0,0,g['elevation']/2),
        (g['width'],g['depth'],g['elevation']), 'stone', 'stone')
    box('Garden_turf', (0,0,g['elevation']-.25),
        (g['width'],g['depth'],.5), 'grass', 'grass')
    r = GARDEN_RAMP
    x0,y0 = r['x']-ox,r['y']-oy;x1,y1 = x0+r['width'],y0+r['depth'];h = r['elevation']
    mesh('Garden_ramp', [(x0,y0,0),(x1,y0,0),(x0,y0,h),(x0,y1,0),(x1,y1,0),(x0,y1,h)],
         [(0,1,2),(3,5,4),(0,3,4,1),(0,2,5,3),(2,1,4,5)], 'stone', 'stone')


def new_scene(name):
    global CURRENT
    CURRENT = bpy.data.scenes.new('Village_' + name)
    bpy.context.window.scene = CURRENT
    CURRENT.view_settings.view_transform = 'Standard'
    CURRENT.world = bpy.data.worlds.new(name + '_world')
    CURRENT.world.color = (.3,.3,.3)
    SCENES[name] = CURRENT


def export_asset(name, maker, width, depth, height):
    new_scene(name)
    maker()
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = next(o for o in CURRENT.objects if o.type=='MESH')
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name='village_' + name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    path=OUT/(name+'.glb')
    # No skins, animations, compression, vertex colors, external buffers or required extensions.
    args=dict(filepath=str(path), export_format='GLB', use_selection=True, use_active_scene=True,
              export_yup=True, export_normals=True, export_texcoords=True,
              export_materials='EXPORT', export_animations=False, export_skins=False,
              export_morph=False, export_cameras=False, export_lights=False,
              export_extras=False, export_image_format='AUTO')
    available=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if 'export_vertex_color' in available: args['export_vertex_color']='NONE'
    bpy.ops.export_scene.gltf(**args)
    blob=path.read_bytes()
    MODELS['village_'+name]={'file':name+'.glb','sha256':hashlib.sha256(blob).hexdigest(),
      'bytes':len(blob),'width':width,'depth':depth,'height':height,
      'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons)}
    print('VILLAGE_ASSET',name,len(blob),flush=True)


def sprite_pixels(direction=0, step=0, outfit='hero'):
    """Original pixel character painted as a Blender image, not a borrowed sprite."""
    W,H=32,48; pixels=[None]*(W*H)
    colors={'o':'#34303a','h':'#705044','s':'#e6b68b','l':'#f5cf9e','e':'#332e39',
            'c':'#477a9c','b':'#365971','a':'#ebc477','r':'#a85454','w':'#e4d5b6','t':'#54424a'}
    if outfit=='merchant': colors.update(c='#8f7194',b='#645471',r='#ce9a65')
    if outfit=='elder': colors.update(c='#75865d',b='#52604c',h='#cbc2aa',r='#8e7760')
    def rect(x,y,w,h,k):
        for yy in range(max(0,y),min(H,y+h)):
            for xx in range(max(0,x),min(W,x+w)): pixels[yy*W+xx]=colors[k]
    # Coordinates are top-left for readable art; saving flips into Blender bottom-left.
    bob=1 if step in (1,3) else 0
    rect(9,6+bob,14,3,'o');rect(7,9+bob,18,8,'o');rect(8,9+bob,16,8,'h')
    rect(8,15+bob,16,9,'o');rect(9,15+bob,14,8,'s');rect(10,15+bob,12,5,'l')
    if direction==1: rect(8,12+bob,16,10,'h')
    elif direction in (2,3):
        side=9 if direction==2 else 19
        rect(side,16+bob,3,5,'s');rect(side,18+bob,2,2,'e')
        rect(11 if direction==2 else 8,12+bob,13,5,'h')
    else:
        rect(11,18+bob,2,2,'e');rect(19,18+bob,2,2,'e');rect(14,22+bob,4,1,'h')
        rect(9,13+bob,14,3,'h');rect(9,16+bob,3,2,'h')
    rect(10,23+bob,12,14,'o');rect(11,24+bob,10,12,'c')
    rect(8,25+bob,3,11,'o');rect(21,25+bob,3,11,'o')
    rect(9,27+bob,2,6,'c');rect(21,27+bob,2,6,'c')
    rect(8,34+bob,3,3,'s');rect(21,34+bob,3,3,'s')
    rect(11,26+bob,10,2,'r');rect(11,34+bob,10,2,'t');rect(15,34+bob,3,2,'a')
    if direction==1: rect(11,26+bob,10,8,'r')
    left=1 if step==1 else -1 if step==3 else 0
    rect(11,37,4,5+left,'b');rect(17,37,4,5-left,'b')
    rect(10,41+left,6,3,'o');rect(17,41-left,6,3,'o')
    if outfit=='elder' and direction!=1: rect(11,22+bob,10,4,'w')
    return pixels


def save_sprites():
    result={}
    for outfit in ('hero','merchant','elder'):
        cols,rows=(4,4) if outfit=='hero' else (1,1)
        image=bpy.data.images.new('Village_sprite_'+outfit,width=32*cols,height=48*rows,alpha=True)
        values=[0.]*(32*cols*48*rows*4)
        for row in range(rows):
            for col in range(cols):
                pixels=sprite_pixels(row,col,outfit)
                for y in range(48):
                    for x in range(32):
                        c=pixels[y*32+x]
                        if c:
                            target=((48*rows-1-(row*48+y))*(32*cols)+col*32+x)*4
                            values[target:target+4]=[*rgb(c),1.]
        image.pixels.foreach_set(values)
        image.filepath_raw=str(OUT/(outfit+'.png'))
        image.file_format='PNG';image.save();image.pack()
        blob=(OUT/(outfit+'.png')).read_bytes()
        result['village_'+outfit]={'file':outfit+'.png','sha256':hashlib.sha256(blob).hexdigest(),
          'width':32,'height':48,'imageWidth':32*cols,'imageHeight':48*rows,'bytes':len(blob)}
    return result


def make_document():
    instances=[]; models={}; billboards={}
    def model(id, asset, x,y, scale=1,yaw=0,solid=True):
        data=MODELS['village_'+asset]
        c={'visual':{'kind':'primitive','shape':'rect','width':data['width']*scale,'height':data['depth']*scale,'color':'#9b8b6b'},
          'collider':{'type':'aabb','halfWidth':max(2,data['width']*scale/2-4),
          'halfHeight':max(2,data['depth']*scale/2-4),'isTrigger':False} if solid else {'type':'none'},
          'layer':'wall','body':{'type':'static','heightSpan':{'floorId':0,'elevation':0,'height':data['height']*scale}}}
        if not solid: del c['body']
        instances.append({'id':id,'prefab':'object','x':x,'y':y,'props':{'components':c}})
        models[id]={'asset':'village_'+asset,'contentId':data['sha256'],'scale':scale,'yawDegrees':yaw}
    model('village_landscape','landscape',0,0,solid=False)
    model('sunflower_inn','inn',-150,115)
    model('provision_shop','shop',95,110)
    model('west_cottage','cottage',-225,-105)
    model('east_cottage','cottage',105,-120)
    model('clock_tower','tower',-35,165)
    model('village_well','well',-20,25,solid=True)
    model('river_bridge','bridge',190,-12,solid=False)
    model('raised_garden','garden',GARDEN['x']+GARDEN['width']/2,GARDEN['y']+GARDEN['depth']/2,solid=False)
    for i,(x,y,s) in enumerate([(-286,172,1),(-267,70,.9),(-300,-25,1),(-290,-180,1.15),(-130,-176,.85),
        (54,190,.95),(141,188,1),(277,168,1.1),(277,70,.9),(287,-97,1),(267,-184,1.1)]):
        model('oak_'+str(i),'tree',x,y,s,solid=False)
    for i,(x,y) in enumerate([(-205,204),(-117,204),(235,204),(315,124),(305,-215),(-315,-211)]):
        model('pine_'+str(i),'pine',x,y,.85,solid=False)
    for i,(x,y) in enumerate([(-111,-35),(37,-35),(-63,82),(145,20),(241,-40)]): model('lantern_'+str(i),'lamp',x,y,.8,solid=False)
    for i,x in enumerate([-285,-237,-189,57,105,153]): model('garden_fence_'+str(i),'fence',x,205,.8,solid=False)
    for i,(x,y) in enumerate([(-215,66),(125,58),(-235,-147),(75,-159)]): model('flowers_'+str(i),'flowers',x,y,solid=False)
    model('merchant_cart','cart',71,31,.85,solid=True)
    # Explicit trunk proxies allow walking under the visual canopy.
    for item in list(instances):
        if item['id'].startswith(('oak_','pine_')):
            item['props']['components']['collider']={'type':'aabb','halfWidth':4,'halfHeight':4,'isTrigger':False}
            item['props']['components']['body']={'type':'static','heightSpan':{'floorId':0,'elevation':0,'height':24}}
            if item['id'] == 'oak_4':
                item['props']['components']['body']['heightSpan']['elevation'] = GARDEN['elevation']
    def person(id,texture,x,y,player=False):
        visual={'kind':'sprite','asset':'village_'+texture,'width':21,'height':31.5,'originX':.5,'originY':1}
        if player:
            clips=[]
            # up/down/left/right IDs are a public native animation policy, no TS motion state.
            for direction,row in enumerate([1,0,2,3]):
                frames=[{'u0':col/4,'v0':row/4,'u1':(col+1)/4,'v1':(row+1)/4} for col in range(4)]
                clips.append({'id':direction,'frames':[frames[0]],'fps':1,'loop':True})
                clips.append({'id':direction+4,'frames':frames,'fps':8,'loop':True})
            visual['animationSet']={'clips':clips,'initialClip':1}
        c={'visual':visual,'collider':{'type':'aabb','halfWidth':4,'halfHeight':3,'isTrigger':False},
           'layer':'player' if player else 'wall','body':{'type':'kinematic' if player else 'static',
           'heightSpan':{'floorId':0,'elevation':0,'height':21}}}
        instances.append({'id':id,'prefab':'object','x':x,'y':y,'props':{'components':c}})
        billboards[id]={'alphaCutoff':.5,'castShadow':True}
    person('village_hero','hero',-30,-102,True)
    person('shopkeeper','merchant',94,46)
    person('village_elder','elder',-61,5)
    person('traveler','merchant',-124,59)
    doc={'format':'ferrum2d.consumer.scene-authoring','version':1,
      'behaviorRecipes':{'entities':{}},'gameplay':{'primaryActor':'village_hero'},
      'sceneComposition':{'initialFragment':'village','prefabs':{'object':{'props':{}}},
        'fragments':{'village':{'instances':instances}}},
      'spatial':{'camera':{'projection':'orthographic','position':{'x':410,'y':-610,'elevation':580},
        'target':{'x':0,'y':10,'elevation':15},'height':660,'near':.1,'far':2200},
        # Same-floor supports must not overlap: carve the garden and ramp out of the west bank.
        'terrain':[{'id':'west_bank','x':-320,'y':-154,'width':490,'depth':374,'elevation':0,'render':False},
          {'id':'south_west_bank','x':-320,'y':-220,'width':140,'depth':66,'elevation':0,'render':False},
          {'id':'south_east_bank','x':-16,'y':-220,'width':186,'depth':66,'elevation':0,'render':False},
          {'id':'south_edge_bank','x':-180,'y':-220,'width':164,'depth':2,'elevation':0,'render':False},
          {'id':'garden_north_edge','x':-80,'y':-162,'width':64,'depth':8,'elevation':0,'render':False},
          {'id':'garden_south_edge','x':-80,'y':-218,'width':64,'depth':8,'elevation':0,'render':False},
          {'id':'east_bank','x':210,'y':-220,'width':110,'depth':440,'elevation':0,'render':False},
          {'id':'bridge_deck','x':170,'y':-31,'width':40,'depth':38,'elevation':2,'kind':'bridge','baseElevation':0,'render':False},
          {'id':'south_garden',**GARDEN,'baseElevation':0,'render':False},
          {'id':'garden_ramp',**GARDEN_RAMP,'kind':'ramp','baseElevation':0,'render':False}],
        'models':models,'billboards':billboards,
        'actor':{'instanceId':'village_hero','speed':72,'maxStepHeight':4,'maxDropHeight':4},
        'environment':{'pixelArt':{'width':384,'height':256,'snapCamera':True},
          'lighting':{'ambient':[.62,.64,.64],'lights':[],
            'directional':{'direction':{'x':-1,'y':-1,'elevation':2.4},'color':[1,.91,.77],'intensity':.72,
              'shadows':{'resolution':512,'extent':430,'distance':1400,'bias':.07}},'shadowFilter':'pcf3'},
          'colorGrading':{'exposure':.1,'contrast':1.04,'saturation':.94,'tint':[1,.98,.93],'toneMapping':'none'}}}}
    (OUT.parents[1]/'placement.village.scene-authoring.json').write_text(json.dumps(doc,indent=2)+'\n',encoding='utf8',newline='\n')
    return doc


def save_source(document):
    # A separate overview scene keeps each export scene at a meaningful local origin.
    new_scene('Overview')
    for item in document['sceneComposition']['fragments']['village']['instances']:
        model=document['spatial']['models'].get(item['id'])
        if not model: continue
        name=model['asset'].removeprefix('village_')
        for original in SCENES[name].objects:
            if original.type!='MESH': continue
            copy=original.copy();copy.data=original.data
            CURRENT.collection.objects.link(copy)
            elevation=item['props']['components'].get('body',{}).get('heightSpan',{}).get('elevation',0)
            copy.location=Vector((item['x'],item['y'],elevation+model.get('elevation',0)))
            copy.scale=(model['scale'],)*3
            copy.rotation_euler.z=math.radians(model['yawDegrees'])
    bpy.ops.object.camera_add(location=(410,-610,595))
    camera=bpy.context.object
    camera.rotation_euler=(Vector((0,10,15))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=760;CURRENT.camera=camera
    bpy.ops.object.light_add(type='SUN',location=(-200,-200,400))
    bpy.context.object.rotation_euler=(math.radians(26),math.radians(-30),math.radians(-25))
    bpy.context.object.data.energy=2
    CURRENT.render.resolution_x=1152;CURRENT.render.resolution_y=768;CURRENT.render.resolution_percentage=100
    CURRENT.render.image_settings.file_format='PNG'
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'rpg-village.blend'),check_existing=False)


def main():
    # Avoid writing recovery/preferences outside the repository.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_auto_save_temporary_files=False
    bpy.context.preferences.filepaths.save_version=0
    assets=[('cottage',lambda:house('cottage'),80,64,84),('inn',lambda:house('inn'),100,78,112),
      ('shop',lambda:house('shop'),92,88,92),('tower',tower,46,46,130),('well',well,48,48,61),
      ('tree',tree,50,45,80),('pine',lambda:tree(True),50,50,75),('lamp',lamp,12,12,59),
      ('fence',fence,48,6,26),('cart',cart,38,52,32),('bridge',bridge,60,42,24),
      ('flowers',flowers,40,24,12),('landscape',landscape,640,440,2),
      ('garden',garden,164,64,GARDEN['elevation'])]
    for args in assets: export_asset(*args)
    textures=save_sprites()
    document=make_document()
    manifest={'format':'ferrum2d.example.village-assets','version':1,'author':'Ferrum2D procedural Blender authoring',
      'license':'MIT OR Apache-2.0 (original project assets)','blender':bpy.app.version_string,
      'generator':'scripts/assets/build-rpg-village.py','seed':1994,'models':MODELS,'textures':textures}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8',newline='\n')
    save_source(document)
    print('VILLAGE_COMPLETE',len(MODELS),'models',len(textures),'sprites',flush=True)


if __name__=='__main__': main()
