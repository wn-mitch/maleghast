"""Run with Blender --background --python build_kit.py -- REPO PREVIEW_DIR.

Geometry is authored Z-up; glTF export maps Blender +Y to game north (-Z).
Each collection is one reusable piece with its root at the world origin.
"""
import bpy
import math
import random
import sys
from pathlib import Path
from mathutils import Vector

ROOT, PREVIEW = map(Path, sys.argv[sys.argv.index('--') + 1:])
OUT = ROOT / 'public/art/board'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
rng = random.Random(666)
atlas = bpy.data.images.load(str(OUT / 'board_atlas.png'))
atlas.pack()

def material(name, color, texture=False):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 1
    if texture:
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = atlas
        m.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
    return m

stone = material('Ink and halftone atlas', (1, 1, 1), True)
ink = material('Charcoal seams', (.009, .009, .009))
red = material('Dried blood vent', (.19, .019, .013))
pieces = {}
active = None

def start(name):
    global active
    active = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(active)
    pieces[name] = active

def finish_object(obj, quadrant=0, mat=stone, bevel=0):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    active.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat == stone:
        uv = obj.data.uv_layers.active or obj.data.uv_layers.new()
        # Project each face independently into a padded atlas quadrant.
        for face in obj.data.polygons:
            axis = max(range(3), key=lambda k: abs(face.normal[k]))
            axes = [k for k in range(3) if k != axis]
            coords = [obj.data.vertices[obj.data.loops[i].vertex_index].co for i in face.loop_indices]
            lo = [min(v[k] for v in coords) for k in axes]
            span = [max(v[k] for v in coords) - lo[j] for j, k in enumerate(axes)]
            q = quadrant
            for i, v in zip(face.loop_indices, coords):
                u, w = [(v[k] - lo[j]) / max(span[j], .0001) for j, k in enumerate(axes)]
                uv.data[i].uv = ((q % 2) * .5 + .012 + u * .476 * min(span[0], 1),
                                 (1 - q // 2) * .5 + .012 + w * .476 * min(span[1], 1))
    if bevel:
        obj.data.materials.append(ink)
        mod = obj.modifiers.new('Ink chipped edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.material = len(obj.data.materials) - 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def box(name, loc, size, q=0, mat=stone, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    return finish_object(o, q, mat, bevel)

def orb(name, loc, size, q=3, mat=stone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    return finish_object(o, q, mat)

def bone(a, b, radius=.018):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object
    o.name = 'Bone'
    o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish_object(o, 3)

def floor(q=0):
    return box('Square foundation', (0, 0, -.035), (1, 1, .07), q, bevel=0)

for n in range(3):
    start('ground_' + 'abc'[n])
    o = floor()
    uv = o.data.uv_layers.active
    # Quarter turns vary the flagstone pattern without changing the footprint.
    for item in uv.data:
        x, y = item.uv.x - .25, item.uv.y - .75
        for _ in range(n):
            x, y = -y, x
        item.uv = (.25 + x, .75 + y)

start('elevated')
box('Raised masonry', (0, 0, .235), (.98, .98, .47), 0)
box('Pale coping', (0, 0, .48), (1, 1, .04), 1, bevel=0)

start('stairs')
for j in range(5):
    h = (j + 1) * .1
    box('Tread %d' % j, (0, -.4 + j*.2, h/2), (.98, .2, h), 1, bevel=0)
    box('Ink riser', (0, -.497 + j*.2, h-.018), (.96, .004, .018), mat=ink, bevel=0)

for damaged in (False, True):
    start('wall_damaged' if damaged else 'wall')
    box('Plinth', (0, 0, .055), (.96, .96, .11), 0)
    for row in range(3):
        for col in range(3):
            if damaged and (row, col) in ((2, 1), (2, 2)):
                continue
            x = (col - 1) * .30
            h = .18 if not damaged or row < 2 else .12
            o = box('Masonry course', (x, 0, .12 + row*.19 + h/2), (.29, .80, h), 1, bevel=.015)
            if damaged and row == 2:
                o.rotation_euler.y = .17
    if not damaged:
        box('Coping', (0, 0, .72), (.96, .92, .08), 1)
    for y in (-.425, .425):
        for x in (-.35, .35):
            box('Buttress', (x, y, .30), (.11, .10, .50), 0)
    if damaged:
        for i in range(4):
            o = box('Broken stone', (rng.uniform(-.3, .3), rng.uniform(-.35, .35), .64), (.12, .16, .08), 1)
            o.rotation_euler.z = rng.uniform(-1, 1)

start('rubble')
for i in range(13):
    x, y = rng.uniform(-.37, .37), rng.uniform(-.37, .37)
    o = box('Walkable fragment', (x, y, .025), (rng.uniform(.08, .18), .12, .05), 0)
    o.rotation_euler.z = rng.uniform(-math.pi, math.pi)

start('hazard')
floor()
box('Vent shadow', (0, 0, .002), (.77, .77, .004), mat=ink, bevel=0)
box('Blood well', (0, 0, .006), (.62, .62, .006), mat=red, bevel=0)
for x in (-.39, .39):
    box('Vent rim', (x, 0, .025), (.08, .86, .05), 1)
for y in (-.39, .39):
    box('Vent rim', (0, y, .025), (.70, .08, .05), 1)
for x in (-.24, -.08, .08, .24):
    box('Iron grate', (x, 0, .027), (.045, .70, .035), mat=ink, bevel=0)

start('adverse')
floor(2)
for x, y, angle in ((-.30, .20, .5), (.23, -.20, -.5), (.1, .3, 1)):
    o = box('Half buried bone', (x, y, .012), (.17, .026, .024), 3, bevel=.005)
    o.rotation_euler.z = angle

def puddle(radius, count):
    # A scalloped ink silhouette with a textured interior, all above y=0.
    points = 24
    radii = [radius * (1 + .12 * math.sin(i*2.7 + count)) for i in range(points)]
    for inset, z, mat in ((1, .003, ink), (.88, .006, stone)):
        verts = [(0, 0, z)] + [(math.cos(i*math.tau/points)*r*inset,
                  math.sin(i*math.tau/points)*r*inset*.75, z) for i, r in enumerate(radii)]
        faces = [(0, i+1, (i+1)%points+1) for i in range(points)]
        mesh = bpy.data.meshes.new('Goo silhouette')
        mesh.from_pydata(verts, [], faces)
        ob = bpy.data.objects.new('Goo puddle', mesh)
        active.objects.link(ob)
        finish_object(ob, 2, mat)
        if mat == stone:
            for loop in mesh.loops:
                v = mesh.vertices[loop.vertex_index].co
                mesh.uv_layers.active.data[loop.index].uv = (.25+v.x*.65, .25+v.y*.65)

for count in range(1, 4):
    start('corpse_%d' % count)
    radius = .18 + count*.035
    puddle(radius, count)
    for i in range(count):
        x = (i-(count-1)/2)*.14
        y = .035 if i%2 == 0 else -.035
        orb('Skull', (x, y, .045), (.058, .065, .039))
        for dx in (-.022, .022):
            orb('Empty socket', (x+dx, y-.018, .076), (.016, .019, .007), mat=ink)
        box('Broken jaw', (x, y-.053, .03), (.062, .034, .022), 3, bevel=.005)
    for i in range(3+count*2):
        angle = i*2.4
        x, y = math.cos(angle)*radius*.55, math.sin(angle)*radius*.5
        dx, dy = math.cos(angle+.7)*.055, math.sin(angle+.7)*.055
        bone((x-dx, y-dy, .018), (x+dx, y+dy, .025), .015)
        for sign in (-1, 1):
            orb('Knuckle', (x+sign*dx, y+sign*dy, .022), (.022, .019, .017))

for size in (6, 8, 10):
    start('frame_%d' % size)
    for sign in (-1, 1):
        for j in range(size):
            at = j - size/2 + .5
            box('Border block', (sign*(size/2+.15), at, -.04), (.28, .99, .16), 0, bevel=0)
            box('Border block', (at, sign*(size/2+.15), -.04), (.99, .28, .16), 0, bevel=0)
    for x in (-1, 1):
        for y in (-1, 1):
            box('Corner cap', (x*(size/2+.15), y*(size/2+.15), .045), (.27, .27, .07), 1)

start('backdrop')
for x in (-4, -2, 0, 2, 4):
    box('Ruined pier', (x, 0, 1), (.45, .6, 2), 0)
    for sign in (-1, 1):
        o = box('Broken arch spring', (x+sign*.3, 0, 1.65), (.65, .5, .24), 0)
        o.rotation_euler.y = sign*-.6

# Every export contains one identity root, regardless of mesh pivot placement.
for name, collection in pieces.items():
    bpy.ops.object.select_all(action='DESELECT')
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    for ob in collection.objects:
        if ob != root:
            ob.parent = root
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name+'.glb')), export_format='GLB',
                              use_selection=True, export_yup=True, export_cameras=False,
                              export_lights=False, export_image_format='AUTO')
for name, collection in pieces.items():
    collection.hide_viewport = name != 'ground_a'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/board_kit.blend'), compress=True)

# Unlit review scene: emission uses precisely the exported base-color input.
for m in (stone, ink, red):
    nodes, links = m.node_tree.nodes, m.node_tree.links
    base = nodes.get('Principled BSDF').inputs['Base Color']
    emission = nodes.new('ShaderNodeEmission')
    if base.is_linked:
        links.new(base.links[0].from_socket, emission.inputs['Color'])
    else:
        emission.inputs['Color'].default_value = base.default_value
    links.new(emission.outputs[0], nodes.get('Material Output').inputs['Surface'])
for collection in pieces.values():
    collection.hide_render = True
review = bpy.data.collections.new('Review')
bpy.context.scene.collection.children.link(review)
names = list(pieces)[:13]
for i, name in enumerate(names):
    offset = Vector(((i%5-2)*1.4, (i//5-1)*1.65, 0))
    for ob in pieces[name].objects:
        if ob.type != 'MESH':
            continue
        copy = ob.copy()
        copy.parent = None
        review.objects.link(copy)
        copy.location += offset
    if name in ('rubble', 'wall', 'wall_damaged') or name.startswith('corpse'):
        src = pieces['ground_a'].objects.get('Square foundation')
        if src:
            copy = src.copy()
            copy.parent = None
            review.objects.link(copy)
            copy.location += offset
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.world.color = (.035, .035, .035)
scene.view_settings.view_transform = 'Standard'
bpy.ops.object.camera_add()
camera = bpy.context.object
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 8.5
PREVIEW.mkdir(parents=True, exist_ok=True)
for end, sign in (('south', -1), ('north', 1)):
    camera.location = (0, sign*7, 10)
    camera.rotation_euler = (Vector((0, 0, .1))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(PREVIEW / ('kit_'+end+'.png'))
    bpy.ops.render.render(write_still=True)
