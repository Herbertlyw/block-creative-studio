#!/usr/bin/env python3
"""Compile a constrained BCS scene exchange package inside Blender.

This script is intentionally data driven. It never executes code from the input
package and never overwrites the source file. Run it through Blender:

    blender --background --factory-startup --python compile_bcs_scene.py -- \
      --source scene-exchange.json --output compiled/package-id
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import shutil
import sys
import time
import traceback
import warnings
from typing import Any

import bpy
from mathutils import Quaternion, Vector


CONTRACT_VERSION = "1.0.0"
SCENE_CONTRACT = "bcs.blender-scene-exchange"
REPORT_CONTRACT = "bcs.blender-compile-report"
ENTITY_OBJECTS: dict[str, bpy.types.Object] = {}
MATERIAL_CACHE: dict[str, bpy.types.Material] = {}
SHARD_MESH_CACHE: dict[str, bpy.types.Mesh] = {}
ASSET_PATHS: dict[str, Path] = {}
COMPILE_WARNINGS: list[str] = []
FALLBACK_FACE_ENTITY_IDS: list[str] = []
UNRESOLVED_ASSET_IDS: list[str] = []


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Compile a BCS Blender scene exchange package")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--engine", choices=("BLENDER_EEVEE", "CYCLES"), default="BLENDER_EEVEE")
    parser.add_argument("--asset-root")
    return parser.parse_args(values)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def hex_rgba(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    color = value.lstrip("#")
    if len(color) != 6:
        raise ValueError(f"Invalid hex color: {value}")
    channels = [int(color[index : index + 2], 16) / 255.0 for index in (0, 2, 4)]
    # Principled inputs operate in scene-linear space. Convert sRGB literals so
    # the browser and Blender preview agree more closely.
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return linear[0], linear[1], linear[2], alpha


def safe_principled_input(shader: bpy.types.Node, names: tuple[str, ...]) -> bpy.types.NodeSocket | None:
    for name in names:
        socket = shader.inputs.get(name)
        if socket is not None:
            return socket
    return None


def ensure_node_tree(owner: Any, label: str) -> bpy.types.NodeTree:
    """Use Blender 5's always-on node tree while retaining a quiet legacy fallback."""
    tree = owner.node_tree
    if tree is None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            owner.use_nodes = True
        tree = owner.node_tree
    if tree is None:
        raise RuntimeError(f"{label} node tree is unavailable")
    return tree


def create_material(name: str, spec: dict[str, Any]) -> bpy.types.Material:
    cache_key = json.dumps(spec, sort_keys=True, separators=(",", ":"))
    cached = MATERIAL_CACHE.get(cache_key)
    if cached is not None:
        return cached
    material = bpy.data.materials.new(name=name)
    tree = ensure_node_tree(material, "Material")
    shader = tree.nodes.get("Principled BSDF")
    if shader is None:
        raise RuntimeError("Principled BSDF node is unavailable")
    base = hex_rgba(str(spec["baseColor"]))
    safe_principled_input(shader, ("Base Color",)).default_value = base
    safe_principled_input(shader, ("Roughness",)).default_value = float(spec["roughness"])
    safe_principled_input(shader, ("Metallic",)).default_value = float(spec["metallic"])
    emission_strength = float(spec.get("emissionStrength", 0.0))
    emission_color = hex_rgba(str(spec.get("emissionColor", spec["baseColor"])))
    emission_input = safe_principled_input(shader, ("Emission Color", "Emission"))
    if emission_input is not None:
        emission_input.default_value = emission_color
    strength_input = safe_principled_input(shader, ("Emission Strength",))
    if strength_input is not None:
        strength_input.default_value = emission_strength
    coat = safe_principled_input(shader, ("Coat Weight", "Clearcoat"))
    if coat is not None:
        coat.default_value = 0.18
    MATERIAL_CACHE[cache_key] = material
    return material


def create_image_material(name: str, asset_id: str, path: Path, opacity: float) -> bpy.types.Material:
    cache_key = f"image::{asset_id}::{path}::{opacity:.6f}"
    cached = MATERIAL_CACHE.get(cache_key)
    if cached is not None:
        return cached
    material = bpy.data.materials.new(name=name)
    tree = ensure_node_tree(material, "Image material")
    nodes = tree.nodes
    links = tree.links
    shader = nodes.get("Principled BSDF") if nodes else None
    if nodes is None or links is None or shader is None:
        raise RuntimeError("Image material node tree is unavailable")
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = "sRGB"
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = f"BCS Image::{asset_id}"
    texture.image = image
    texture.interpolation = "Linear"
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    alpha_input = shader.inputs.get("Alpha")
    if alpha_input is not None:
        alpha_input.default_value = opacity
        links.new(texture.outputs["Alpha"], alpha_input)
    roughness = safe_principled_input(shader, ("Roughness",))
    if roughness is not None:
        roughness.default_value = 0.32
    coat = safe_principled_input(shader, ("Coat Weight", "Clearcoat"))
    if coat is not None:
        coat.default_value = 0.04
    material.diffuse_color = (1.0, 1.0, 1.0, opacity)
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    elif hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    MATERIAL_CACHE[cache_key] = material
    return material


def reset_scene() -> None:
    ENTITY_OBJECTS.clear()
    MATERIAL_CACHE.clear()
    SHARD_MESH_CACHE.clear()
    ASSET_PATHS.clear()
    COMPILE_WARNINGS.clear()
    FALLBACK_FACE_ENTITY_IDS.clear()
    UNRESOLVED_ASSET_IDS.clear()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def apply_bevel(obj: bpy.types.Object, width: float) -> None:
    if width <= 0 or obj.type != "MESH":
        return
    modifier = obj.modifiers.new(name="BCS Bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = 5
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def add_primitive(entity: dict[str, Any]) -> bpy.types.Object:
    primitive = entity["primitive"]
    location = tuple(float(value) for value in entity["position"])
    dimensions = [float(entity["dimensions"][index]) * float(entity["scale"][index]) for index in range(3)]
    if primitive in ("box", "rounded-box"):
        bpy.ops.mesh.primitive_cube_add(location=location)
    elif primitive == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=location)
    elif primitive == "plane":
        bpy.ops.mesh.primitive_plane_add(size=2, location=location)
    else:
        raise ValueError(f"Unsupported primitive: {primitive}")
    obj = bpy.context.active_object
    if obj is None:
        raise RuntimeError(f"Blender did not create primitive {primitive}")
    obj.name = f"BCS::{entity['id']}"
    obj.dimensions = tuple(dimensions)
    obj.rotation_euler = tuple(math.radians(float(value)) for value in entity["rotationEulerDegrees"])
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if primitive == "rounded-box":
        maximum_bevel = max(0.0, min(dimensions) * 0.48)
        apply_bevel(obj, min(float(entity.get("bevelRadius", 0.0)), maximum_bevel))
    material = create_material(f"MAT::{entity['id']}", entity["material"])
    obj.data.materials.append(material)
    obj["bcs_id"] = entity["id"]
    obj["bcs_role"] = entity["role"]
    obj["bcs_primitive"] = primitive
    ENTITY_OBJECTS[entity["id"]] = obj
    return obj


def parent_preserve_world(child: bpy.types.Object, parent: bpy.types.Object) -> None:
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def path_is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_exchange_assets(
    exchange: dict[str, Any],
    source: Path,
    asset_root: Path | None,
) -> None:
    package_root = source.parent.resolve()
    builtin_root = asset_root.resolve() if asset_root is not None else package_root
    for asset in exchange.get("assets", []):
        asset_id = str(asset["id"])
        source_spec = asset["source"]
        if source_spec["type"] == "builtin-uri":
            uri = str(source_spec["uri"])
            candidate = (builtin_root / uri.lstrip("/\\")).resolve()
            allowed_root = builtin_root
        elif source_spec["type"] == "package-path":
            candidate = (package_root / str(source_spec["path"])).resolve()
            allowed_root = package_root
        else:
            raise ValueError(f"Unsupported asset source for {asset_id}")
        if not path_is_within(allowed_root, candidate):
            raise ValueError(f"Asset path escapes its root: {asset_id}")
        if not candidate.is_file():
            COMPILE_WARNINGS.append(f"BLENDER_ASSET_MISSING:{asset_id}:{candidate}")
            UNRESOLVED_ASSET_IDS.append(asset_id)
            continue
        expected_hash = asset.get("contentHash")
        if isinstance(expected_hash, str) and expected_hash and sha256_file(candidate).lower() != expected_hash.lower():
            raise ValueError(f"Asset hash mismatch: {asset_id}")
        ASSET_PATHS[asset_id] = candidate


def parent_local(
    child: bpy.types.Object,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
) -> None:
    child.parent = parent
    child.matrix_parent_inverse.identity()
    child.location = location


def add_image_face_layer(
    entity: dict[str, Any],
    tile: bpy.types.Object,
    layer: dict[str, Any],
    layer_index: int,
) -> bool:
    source = layer["source"]
    if source.get("kind") != "image":
        return False
    asset_id = str(source["assetId"])
    path = ASSET_PATHS.get(asset_id)
    if path is None:
        return False
    dimensions = [float(value) for value in entity["dimensions"]]
    transform = layer["transform"]
    opacity = float(transform["opacity"])
    if opacity <= 0:
        return True
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
    plane = bpy.context.active_object
    if plane is None:
        raise RuntimeError(f"Unable to create face plane for {entity['id']}")
    plane.name = f"BCS::{entity['id']}::face::{layer_index:02d}"
    # A source plane lies in XY. First turn it toward the fixed camera (-Y),
    # then rotate around that unchanged face normal. Using XYZ Euler angles here
    # tilts 90-degree treatments through the tile instead of spinning in-plane.
    plane.rotation_mode = "QUATERNION"
    plane.rotation_quaternion = (
        Quaternion((0, 1, 0), math.radians(float(transform["rotationDeg"])))
        @ Quaternion((1, 0, 0), math.radians(90))
    )
    plane.scale = (
        dimensions[0] * float(transform["scaleX"]) / 2,
        dimensions[2] * float(transform["scaleY"]) / 2,
        1,
    )
    plane.data.materials.append(create_image_material(
        f"MAT::{entity['id']}::face::{layer_index:02d}",
        asset_id,
        path,
        opacity,
    ))
    plane["bcs_id"] = f"{entity['id']}::face::{layer_index:02d}"
    plane["bcs_role"] = "tile-face"
    plane["bcs_asset_id"] = asset_id
    parent_local(
        plane,
        tile,
        (
            (float(transform["x"]) - 0.5) * dimensions[0],
            -dimensions[1] * 0.515 - layer_index * 0.001,
            -(float(transform["y"]) - 0.5) * dimensions[2],
        ),
    )
    return True


def add_tile_face(entity: dict[str, Any], tile: bpy.types.Object) -> None:
    face = entity.get("face")
    if not isinstance(face, dict):
        return
    dimensions = [float(entity["dimensions"][index]) for index in range(3)]
    layers = face.get("layers", [])
    rendered_image_layer = False
    if isinstance(layers, list):
        for layer_index, layer in enumerate(layers):
            if isinstance(layer, dict):
                rendered_image_layer = add_image_face_layer(entity, tile, layer, layer_index) or rendered_image_layer
    if rendered_image_layer:
        return

    FALLBACK_FACE_ENTITY_IDS.append(str(entity["id"]))
    face_color = str(face.get("color", "#75D94C"))
    face_entity = {
        "id": f"{entity['id']}::face",
        "role": "hero-prop",
        "primitive": "rounded-box",
        "position": [0, 0, 0],
        "rotationEulerDegrees": [0, 0, 0],
        "scale": [1, 1, 1],
        "dimensions": [dimensions[0] * 0.58, max(0.025, dimensions[1] * 0.07), dimensions[2] * 0.58],
        "bevelRadius": min(dimensions[0], dimensions[2]) * 0.12,
        "material": {
            "baseColor": face_color,
            "roughness": 0.3,
            "metallic": 0.0,
            "emissionStrength": 0.08,
            "emissionColor": face_color,
        },
    }
    face_obj = add_primitive(face_entity)
    face_obj["bcs_role"] = "tile-face"
    parent_local(face_obj, tile, (0, -dimensions[1] * 0.54, 0))

    label = str(face.get("label", ""))[:8]
    if not label:
        return
    bpy.ops.object.text_add(location=(0, 0, 0))
    text_obj = bpy.context.active_object
    if text_obj is None:
        return
    text_obj.name = f"BCS::{entity['id']}::label"
    text_obj.data.body = label
    text_obj.data.align_x = "CENTER"
    text_obj.data.align_y = "CENTER"
    label_length = max(1, len(label))
    text_obj.data.size = min(dimensions[0], dimensions[2]) * min(0.22, 1.16 / label_length)
    text_obj.data.extrude = max(0.002, dimensions[1] * 0.008)
    text_obj.rotation_euler = (math.radians(90), 0, 0)
    label_material = create_material(
        f"MAT::{entity['id']}::label",
        {"baseColor": "#173A36", "roughness": 0.45, "metallic": 0.0},
    )
    text_obj.data.materials.append(label_material)
    text_obj["bcs_id"] = f"{entity['id']}::label"
    text_obj["bcs_role"] = "tile-face-label"
    bpy.context.view_layer.objects.active = text_obj
    text_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    parent_local(text_obj, tile, (0, -dimensions[1] * 0.59, 0))


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(spec: dict[str, Any]) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("BCS Fixed Camera")
    camera = bpy.data.objects.new("BCS Fixed Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = tuple(float(value) for value in spec["location"])
    if spec["type"] == "orthographic":
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = float(spec["orthographicScale"])
    else:
        camera_data.type = "PERSP"
        camera_data.lens = float(spec["focalLengthMm"])
    camera_data.dof.use_dof = False
    point_at(camera, tuple(float(value) for value in spec["target"]))
    camera["bcs_role"] = "fixed-camera"
    bpy.context.scene.camera = camera
    return camera


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)


def configure_scene(exchange: dict[str, Any], engine: str) -> bpy.types.Scene:
    scene = bpy.context.scene
    output = exchange["output"]
    scene.render.engine = engine
    scene.render.resolution_x = int(output["width"])
    scene.render.resolution_y = int(output["height"])
    scene.render.resolution_percentage = 100
    scene.render.fps = int(output["fps"])
    scene.frame_start = int(output["frameStart"])
    scene.frame_end = int(output["frameEnd"])
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.render.film_transparent = output["alphaMode"] == "straight"
    scene.render.use_file_extension = True
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.image_settings.color_management = "FOLLOW_SCENE"
    if engine == "BLENDER_EEVEE" and hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 24
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        try:
            scene.view_settings.look = "Medium High Contrast"
        except (TypeError, ValueError):
            pass
    scene.world.color = hex_rgba(exchange["stage"]["backgroundColor"])[0:3]
    world_nodes = ensure_node_tree(scene.world, "World").nodes if scene.world else None
    if world_nodes:
        background = world_nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = hex_rgba(exchange["stage"]["backgroundColor"])
            background.inputs["Strength"].default_value = 0.24
    camera = add_camera(exchange["camera"])
    camera["bcs_id"] = "fixed-camera"
    camera["bcs_frame_start"] = int(output["frameStart"])
    camera["bcs_frame_end"] = int(output["frameEnd"])
    camera["bcs_frame_count"] = int(output["frameEnd"]) - int(output["frameStart"]) + 1
    camera["bcs_fps"] = int(output["fps"])
    add_area_light("BCS Key", (-4.6, -7.0, 7.4), (0, 0, 1.2), 980.0, 5.0, (1.0, 0.82, 0.66))
    add_area_light("BCS Fill", (4.8, -4.2, 3.0), (0, 0, 1.8), 620.0, 4.0, (0.46, 0.68, 1.0))
    add_area_light("BCS Rim", (0.0, 2.5, 6.5), (0, 0, 2.0), 820.0, 3.0, (0.38, 0.78, 1.0))
    return scene


def keyframe_scale(obj: bpy.types.Object, frame: int, scale: tuple[float, float, float]) -> None:
    obj.scale = scale
    obj.keyframe_insert(data_path="scale", frame=frame)


def create_dense_shatter_cloud(
    event: dict[str, Any],
    rng: random.Random,
    center: tuple[float, float, float],
    fragment_count: int,
    fragment_scale: float,
    radial_spread: float,
    gravity: float,
    materials: list[bpy.types.Material],
    reveal_frame: int,
    hide_frame: int,
) -> bpy.types.Object | None:
    """Create many independently shaped shards as one morph-animated mesh.

    The reference effect is dense, but one Blender object per shard would push
    glTF beyond its animation budget. Two relative shape keys retain per-shard
    travel and rotation while exporting only one semantic VFX node per match.
    """
    vertices: list[tuple[float, float, float]] = []
    spread_vertices: list[tuple[float, float, float]] = []
    fall_delta_vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    face_materials: list[int] = []
    for index in range(fragment_count):
        size = 0.09 * fragment_scale * rng.uniform(0.62, 1.42)
        half = Vector((size * rng.uniform(0.65, 1.45), size * rng.uniform(0.2, 0.48), size * rng.uniform(0.55, 1.35)))
        shard_center = Vector((rng.uniform(-1.12, 1.12), rng.uniform(-0.04, 0.04), rng.uniform(-0.25, 0.25)))
        lateral = rng.uniform(-1.0, 1.0)
        spread_offset = Vector((lateral * radial_spread * rng.uniform(0.12, 0.34), rng.uniform(-0.12, 0.08), rng.uniform(0.18, 0.82)))
        final_offset = spread_offset + Vector((lateral * radial_spread * rng.uniform(0.14, 0.42), rng.uniform(-0.25, 0.18), -gravity * rng.uniform(0.72, 1.22)))
        axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if axis.length < 0.001:
            axis = Vector((0, 1, 0))
        axis.normalize()
        spread_rotation = Quaternion(axis, rng.uniform(-1.1, 1.1))
        fall_rotation = Quaternion(axis, rng.uniform(-3.4, 3.4))
        base_index = len(vertices)
        # Thin irregular triangular/quadrilateral prisms read as broken ceramic
        # from the fixed front camera. The previous axis-aligned cuboids looked
        # like confetti blocks rather than pieces of a shattered tile.
        point_count = 3 if rng.random() < 0.76 else 4
        phase = rng.uniform(-math.pi, math.pi)
        planar_points: list[tuple[float, float]] = []
        for point_index in range(point_count):
            angle = phase + (math.tau * point_index / point_count) + rng.uniform(-0.28, 0.28)
            radius = rng.uniform(0.62, 1.12)
            planar_points.append((math.cos(angle) * half.x * radius, math.sin(angle) * half.z * radius))
        local_corners = [
            Vector((point_x, side * half.y, point_z))
            for side in (-1, 1)
            for point_x, point_z in planar_points
        ]
        for corner in local_corners:
            basis = shard_center + corner
            spread = shard_center + spread_offset + spread_rotation @ corner
            final = shard_center + final_offset + fall_rotation @ corner
            vertices.append(tuple(basis))
            spread_vertices.append(tuple(spread))
            # Relative key: Spread + Fall = final.
            fall_delta_vertices.append(tuple(basis + (final - spread)))
        local_faces: list[tuple[int, ...]] = [
            tuple(range(point_count)),
            tuple(range(point_count * 2 - 1, point_count - 1, -1)),
        ]
        for point_index in range(point_count):
            next_index = (point_index + 1) % point_count
            local_faces.append((
                point_index,
                next_index,
                point_count + next_index,
                point_count + point_index,
            ))
        for face in local_faces:
            faces.append(tuple(base_index + vertex_index for vertex_index in face))
            face_materials.append(index % max(1, len(materials)))

    mesh = bpy.data.meshes.new(f"BCS::{event['id']}::dense-shards::mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    cloud = bpy.data.objects.new(f"BCS::{event['id']}::dense-shards", mesh)
    bpy.context.collection.objects.link(cloud)
    cloud.location = center
    for material in materials:
        mesh.materials.append(material)
    for polygon, material_index in zip(mesh.polygons, face_materials):
        polygon.material_index = material_index
    cloud["bcs_role"] = "match-fragment"
    cloud["bcs_id"] = f"{event['id']}::dense-shards"
    cloud["bcs_vfx_style"] = "shatter"
    cloud["bcs_fragment_count"] = fragment_count
    cloud.shape_key_add(name="Basis")
    spread_key = cloud.shape_key_add(name="Spread")
    fall_key = cloud.shape_key_add(name="Fall")
    for index, coordinate in enumerate(spread_vertices):
        spread_key.data[index].co = coordinate
    for index, coordinate in enumerate(fall_delta_vertices):
        fall_key.data[index].co = coordinate

    preference = bpy.context.preferences.edit.keyframe_new_interpolation_type
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    try:
        keyframe_scale(cloud, max(int(bpy.context.scene.frame_start), int(event["frame"]) - 1), (0.001, 0.001, 0.001))
        keyframe_scale(cloud, reveal_frame, (1.0, 1.0, 1.0))
        spread_end = min(max(reveal_frame, hide_frame - 1), int(event["frame"]) + max(4, round((hide_frame - int(event["frame"]) + 1) * 0.34)))
        fall_end = max(reveal_frame, hide_frame - 1)
        spread_key.value = 0.0
        spread_key.keyframe_insert(data_path="value", frame=reveal_frame)
        spread_key.value = 1.0
        spread_key.keyframe_insert(data_path="value", frame=spread_end)
        fall_key.value = 0.0
        fall_key.keyframe_insert(data_path="value", frame=spread_end)
        fall_key.value = 1.0
        fall_key.keyframe_insert(data_path="value", frame=fall_end)
        keyframe_scale(cloud, fall_end, (1.0, 1.0, 1.0))
        keyframe_scale(cloud, hide_frame, (0.001, 0.001, 0.001))
    finally:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = preference
    return cloud


def apply_transform_tracks(tracks: list[dict[str, Any]]) -> set[str]:
    tracked_ids: set[str] = set()
    interpolation_before = bpy.context.preferences.edit.keyframe_new_interpolation_type
    try:
        for track in tracks:
            entity_id = str(track["entityId"])
            obj = ENTITY_OBJECTS.get(entity_id)
            if obj is None:
                raise ValueError(f"Transform track references unknown entity {entity_id}")
            tracked_ids.add(entity_id)
            bpy.context.preferences.edit.keyframe_new_interpolation_type = str(track.get("interpolation", "linear")).upper()
            for keyframe in track["keyframes"]:
                frame = int(keyframe["frame"])
                obj.location = tuple(float(value) for value in keyframe["position"])
                obj.rotation_euler = tuple(math.radians(float(value)) for value in keyframe["rotationEulerDegrees"])
                source_scale = tuple(float(value) for value in keyframe["scale"])
                obj.scale = source_scale if bool(keyframe["visible"]) else tuple(value * 0.001 for value in source_scale)
                obj.keyframe_insert(data_path="location", frame=frame)
                obj.keyframe_insert(data_path="rotation_euler", frame=frame)
                obj.keyframe_insert(data_path="scale", frame=frame)
    finally:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = interpolation_before
    return tracked_ids


def animate_match_event(event: dict[str, Any], seed: int, tracked_ids: set[str]) -> None:
    frame = int(event["frame"])
    scene_start = int(bpy.context.scene.frame_start)
    scene_end = int(bpy.context.scene.frame_end)
    intensity = float(event["intensity"])
    rng = random.Random(seed ^ sum(ord(character) for character in event["id"]))
    event_objects: list[bpy.types.Object] = []
    for entity_id in event["entityIds"]:
        obj = ENTITY_OBJECTS.get(entity_id)
        if obj is None:
            raise ValueError(f"Match event references unknown entity {entity_id}")
        event_objects.append(obj)
        if entity_id not in tracked_ids:
            keyframe_scale(obj, max(scene_start, frame - 1), (1.0, 1.0, 1.0))
            keyframe_scale(obj, min(scene_end, frame + 4), (1.08, 1.08, 1.08))
            keyframe_scale(obj, min(scene_end, frame + 12), (0.001, 0.001, 0.001))

    center = tuple(float(value) for value in event["center"])
    vfx = event.get("vfx") or {
        "style": "shatter",
        "durationFrames": 18,
        "fragmentCount": 21,
        "fragmentScale": 1.0,
        "radialSpread": 2.15,
        "gravity": 0.55,
        "shockwave": True,
        "glowStrength": 4.0,
        "palette": ["#F7F2E7", "#A7DDE4", "#DFFF9F"],
    }
    style = str(vfx.get("style", "shatter"))
    duration = max(1, min(120, int(vfx.get("durationFrames", 18))))
    fragment_count = max(0, min(96, int(vfx.get("fragmentCount", 21))))
    fragment_scale_base = max(0.01, float(vfx.get("fragmentScale", 1.0)))
    radial_spread = max(0.0, float(vfx.get("radialSpread", 2.15)))
    gravity = max(0.0, float(vfx.get("gravity", 0.55)))
    glow_strength = max(0.0, float(vfx.get("glowStrength", 4.0)))
    palette = [str(color) for color in vfx.get("palette", ["#F7F2E7", "#A7DDE4", "#DFFF9F"])]
    if not palette:
        palette = ["#F7F2E7"]
    # durationFrames is an inclusive frame count. Clamp every generated key to
    # the declared scene range so a late match cannot silently extend the GLB
    # timeline by one frame (or more).
    hide_frame = min(scene_end, frame + duration - 1)
    reveal_frame = min(hide_frame, frame + max(1, round(duration * 0.08)))
    travel_frame = min(hide_frame, frame + max(2, round(duration * 0.72)))
    shard_materials = [
        create_material(
            f"MAT::{event['id']}::shard::{index}",
            {
                "baseColor": color,
                "roughness": 0.24,
                "metallic": 0.02,
                "emissionStrength": glow_strength * (0.24 if style == "burst" else 0.08),
                "emissionColor": color,
            },
        )
        for index, color in enumerate(palette)
    ]
    if style == "shatter" and fragment_count > 0:
        create_dense_shatter_cloud(
            event,
            rng,
            center,
            fragment_count,
            fragment_scale_base,
            radial_spread,
            gravity,
            shard_materials,
            reveal_frame,
            hide_frame,
        )
    individual_fragment_count = 0 if style == "shatter" else fragment_count
    for index in range(individual_fragment_count):
        tone = index % len(shard_materials)
        mesh_key = f"{style}:{palette[tone]}"
        mesh = SHARD_MESH_CACHE.get(mesh_key)
        if mesh is None:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.1, location=center)
            shard = bpy.context.active_object
            if shard is None:
                continue
            shard.data.materials.append(shard_materials[tone])
            SHARD_MESH_CACHE[mesh_key] = shard.data
        else:
            shard = bpy.data.objects.new(f"BCS::{event['id']}::shard::{index:02d}", mesh)
            bpy.context.collection.objects.link(shard)
            shard.location = center
        shard.name = f"BCS::{event['id']}::shard::{index:02d}"
        shard["bcs_role"] = "match-fragment"
        shard["bcs_id"] = f"{event['id']}::shard::{index:02d}"
        shard["bcs_vfx_style"] = style
        direction = Vector((rng.uniform(-1.0, 1.0), rng.uniform(-0.45, -0.05), rng.uniform(-0.7, 1.25)))
        if direction.length == 0:
            direction = Vector((0, -0.2, 1))
        direction.normalize()
        distance = radial_spread * (0.42 + rng.random() * 0.58) * max(0.2, intensity)
        keyframe_scale(shard, max(scene_start, frame - 1), (0.001, 0.001, 0.001))
        fragment_scale = fragment_scale_base * (0.58 + rng.random() * 0.65)
        visible_scale = (fragment_scale * 0.34, fragment_scale * 0.34, fragment_scale * 1.55) if style == "burst" else (fragment_scale, fragment_scale, fragment_scale)
        keyframe_scale(shard, reveal_frame, visible_scale)
        shard.location = center
        shard.keyframe_insert(data_path="location", frame=reveal_frame)
        shard.location = Vector(center) + direction * distance + Vector((0, 0, -gravity * intensity))
        shard.keyframe_insert(data_path="location", frame=travel_frame)
        shard.rotation_euler = tuple(rng.uniform(-math.pi, math.pi) for _ in range(3))
        shard.keyframe_insert(data_path="rotation_euler", frame=reveal_frame)
        shard.rotation_euler = tuple(value + rng.uniform(-4.0, 4.0) for value in shard.rotation_euler)
        shard.keyframe_insert(data_path="rotation_euler", frame=travel_frame)
        keyframe_scale(shard, hide_frame, (0.001, 0.001, 0.001))

    ring_count = 2 if style == "pulse" else (1 if bool(vfx.get("shockwave", True)) else 0)
    for ring_index in range(ring_count):
        ring_start = min(hide_frame, frame + ring_index * max(2, round(duration * 0.18)))
        ring_end = hide_frame
        bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.035, major_segments=64, minor_segments=12, location=center)
        ring = bpy.context.active_object
        if ring is not None:
            ring.name = f"BCS::{event['id']}::shockwave::{ring_index:02d}"
            ring.rotation_euler = (math.radians(90), 0, 0)
            ring.data.materials.append(create_material(
                f"MAT::{event['id']}::shockwave::{ring_index:02d}",
                {
                    "baseColor": palette[0],
                    "roughness": 0.16,
                    "metallic": 0.0,
                    "emissionStrength": glow_strength,
                    "emissionColor": palette[0],
                },
            ))
            ring["bcs_role"] = "match-shockwave"
            ring["bcs_id"] = f"{event['id']}::shockwave::{ring_index:02d}"
            ring["bcs_vfx_style"] = style
            keyframe_scale(ring, max(scene_start, ring_start - 1), (0.001, 0.001, 0.001))
            keyframe_scale(ring, min(ring_end, ring_start + 1), (0.22, 0.22, 0.22))
            ring_extent = max(1.2, radial_spread * (1.65 if style == "pulse" else 1.35)) * intensity
            ring_peak = min(ring_end, max(ring_start + 2, ring_end - 2))
            keyframe_scale(ring, ring_peak, (ring_extent, ring_extent, ring_extent))
            keyframe_scale(ring, ring_end, (0.001, 0.001, 0.001))

    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.18, location=center)
    core = bpy.context.active_object
    if core is not None:
        core.name = f"BCS::{event['id']}::core"
        core["bcs_role"] = "match-core"
        core["bcs_id"] = f"{event['id']}::core"
        core["bcs_vfx_style"] = style
        core.data.materials.append(create_material(
            f"MAT::{event['id']}::core",
            {
                "baseColor": palette[0],
                "roughness": 0.12,
                "metallic": 0.0,
                "emissionStrength": glow_strength,
                "emissionColor": palette[0],
            },
        ))
        keyframe_scale(core, max(scene_start, frame - 1), (0.001, 0.001, 0.001))
        core_peak = 2.6 * intensity if style == "pulse" else (0.62 * intensity if style == "shatter" else 1.5 * intensity)
        keyframe_scale(core, reveal_frame, (core_peak, core_peak, core_peak))
        keyframe_scale(core, hide_frame, (0.001, 0.001, 0.001))


def triangle_count(objects: list[bpy.types.Object] | None = None) -> int:
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects if objects is not None else bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
        finally:
            evaluated.to_mesh_clear()
    return total


def render_frame(scene: bpy.types.Scene, frame: int, path: Path) -> None:
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError(f"Blender did not write frame {frame} to {path}")


def artifact(role: str, path: Path, frame: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "role": role,
        "path": str(path.resolve()),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
    }
    if frame is not None:
        result["frame"] = frame
    return result


def validate_exchange_shape(exchange: dict[str, Any]) -> None:
    if exchange.get("contract") != SCENE_CONTRACT or exchange.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError("Unsupported BCS Blender scene exchange contract")
    if not isinstance(exchange.get("entities"), list) or not exchange["entities"]:
        raise ValueError("Scene exchange requires at least one entity")
    if not isinstance(exchange.get("assets"), list):
        raise ValueError("Scene exchange assets must be an array")
    if not isinstance(exchange.get("events"), list):
        raise ValueError("Scene exchange events must be an array")


def compile_scene(source: Path, output: Path, engine: str, asset_root: Path | None) -> dict[str, Any]:
    started = time.perf_counter()
    exchange = json.loads(source.read_text(encoding="utf-8"))
    validate_exchange_shape(exchange)
    reset_scene()
    resolve_exchange_assets(exchange, source, asset_root)
    scene = configure_scene(exchange, engine)

    for entity in exchange["entities"]:
        obj = add_primitive(entity)
        if entity["role"] == "tile":
            add_tile_face(entity, obj)
    tracked_ids = apply_transform_tracks(exchange.get("tracks", []))
    for index, event in enumerate(exchange["events"]):
        animate_match_event(event, int(exchange["seed"]) + index * 7919, tracked_ids)

    source_hash = sha256_file(source)
    exchange_copy_path = output / "scene-exchange.json"
    source_artifact_path = output / "source-artifact.json"
    blend_path = output / "scene.normalized.blend"
    glb_path = output / "scene.glb"
    vfx_glb_path = output / "scene.vfx.glb"
    preview_path = output / "preview.png"
    frames_dir = output / "representative-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    shutil.copyfile(source, exchange_copy_path)
    write_json(source_artifact_path, {
        "contract": "bcs.source-artifact",
        "contractVersion": CONTRACT_VERSION,
        "packageId": exchange["id"],
        "producer": "blender",
        "source": {"path": str(source.resolve()), "sha256": source_hash},
        "coordinates": exchange["coordinates"],
        "output": exchange["output"],
    })

    scene.frame_set(int(exchange["output"]["frameStart"]))
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_animations=True,
        export_cameras=True,
        export_lights=True,
        export_extras=True,
    )
    vfx_objects = [
        obj for obj in scene.objects
        if str(obj.get("bcs_role", "")) == "fixed-camera"
        or str(obj.get("bcs_role", "")).startswith("match-")
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in vfx_objects:
        obj.select_set(True)
    camera = scene.camera
    if camera is not None:
        bpy.context.view_layer.objects.active = camera
    bpy.ops.export_scene.gltf(
        filepath=str(vfx_glb_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animations=True,
        export_cameras=True,
        export_lights=False,
        export_extras=True,
    )

    frame_start = int(exchange["output"]["frameStart"])
    frame_end = int(exchange["output"]["frameEnd"])
    candidate_frames = [frame_start, frame_end]
    events = exchange["events"]
    representative_events = []
    if events:
        representative_events = [events[0], events[len(events) // 2], events[-1]]
    unique_representative_events = {str(event["id"]): event for event in representative_events}.values()
    for event in unique_representative_events:
        event_frame = int(event["frame"])
        candidate_frames.extend((event_frame, min(frame_end, event_frame + 6), min(frame_end, event_frame + 14)))
    representative_frames = sorted(set(max(frame_start, min(frame_end, frame)) for frame in candidate_frames))
    frame_artifacts: list[dict[str, Any]] = []
    for frame in representative_frames:
        path = frames_dir / f"frame-{frame:04d}.png"
        render_frame(scene, frame, path)
        frame_artifacts.append(artifact("representative-frame", path, frame))

    preview_frame = min(
        representative_frames,
        key=lambda frame: abs(frame - (int(exchange["events"][0]["frame"]) + 6)),
    ) if exchange["events"] else representative_frames[0]
    preview_source = frames_dir / f"frame-{preview_frame:04d}.png"
    shutil.copyfile(preview_source, preview_path)

    outputs = [
        artifact("scene-exchange", exchange_copy_path),
        artifact("source-artifact", source_artifact_path),
        artifact("normalized-blend", blend_path),
        artifact("scene-glb", glb_path),
        artifact("vfx-glb", vfx_glb_path),
        artifact("preview", preview_path),
        *frame_artifacts,
    ]
    metrics = {
        "objectCount": len(scene.objects),
        "meshCount": sum(1 for obj in scene.objects if obj.type == "MESH"),
        "materialCount": len(bpy.data.materials),
        "triangleCount": triangle_count(),
        "compileDurationMs": round((time.perf_counter() - started) * 1000),
        "eventCount": len(exchange["events"]),
        "vfxObjectCount": sum(1 for obj in scene.objects if str(obj.get("bcs_role", "")).startswith("match-")),
        "vfxTriangleCount": triangle_count([obj for obj in vfx_objects if obj.type == "MESH"]),
        "vfxGlbByteLength": vfx_glb_path.stat().st_size,
    }
    return {
        "contract": REPORT_CONTRACT,
        "contractVersion": CONTRACT_VERSION,
        "packageId": exchange["id"],
        "status": "passed",
        "source": {"path": str(source.resolve()), "sha256": source_hash},
        "blender": {
            "version": bpy.app.version_string,
            "engine": scene.render.engine,
            "executable": str(Path(bpy.app.binary_path).resolve()),
        },
        "render": exchange["output"],
        "metrics": metrics,
        "quality": {
            "structure": "passed",
            "visual": "degraded" if FALLBACK_FACE_ENTITY_IDS or UNRESOLVED_ASSET_IDS else "passed",
            "resolvedAssetCount": len(ASSET_PATHS),
            "unresolvedAssetIds": sorted(set(UNRESOLVED_ASSET_IDS)),
            "fallbackFaceEntityIds": sorted(set(FALLBACK_FACE_ENTITY_IDS)),
        },
        "outputs": outputs,
        "warnings": sorted(set(COMPILE_WARNINGS)),
        "errors": [],
    }


def main() -> int:
    args = parse_args()
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "compile-report.json"
    try:
        if not source.is_file():
            raise FileNotFoundError(f"Source scene exchange not found: {source}")
        asset_root = Path(args.asset_root).resolve() if args.asset_root else None
        report = compile_scene(source, output, args.engine, asset_root)
        write_json(report_path, report)
        print(f"BCS_BLENDER_REPORT={report_path}")
        return 0
    except Exception as error:  # Blender must leave a machine-readable failure.
        failure = {
            "contract": REPORT_CONTRACT,
            "contractVersion": CONTRACT_VERSION,
            "packageId": source.stem,
            "status": "failed",
            "source": {
                "path": str(source),
                "sha256": sha256_file(source) if source.is_file() else "0" * 64,
            },
            "blender": {
                "version": bpy.app.version_string,
                "engine": getattr(bpy.context.scene.render, "engine", args.engine),
                "executable": str(Path(bpy.app.binary_path).resolve()),
            },
            "render": {
                "width": 1,
                "height": 1,
                "fps": 1,
                "frameStart": 1,
                "frameEnd": 1,
                "alphaMode": "opaque",
            },
            "metrics": {
                "objectCount": 0,
                "meshCount": 0,
                "materialCount": 0,
                "triangleCount": 0,
                "compileDurationMs": 0,
            },
            "quality": {
                "structure": "failed",
                "visual": "failed",
                "resolvedAssetCount": len(ASSET_PATHS),
                "unresolvedAssetIds": sorted(set(UNRESOLVED_ASSET_IDS)),
                "fallbackFaceEntityIds": sorted(set(FALLBACK_FACE_ENTITY_IDS)),
            },
            "outputs": [],
            "warnings": [],
            "errors": [f"{type(error).__name__}: {error}", traceback.format_exc()],
        }
        write_json(report_path, failure)
        print(f"BCS_BLENDER_REPORT={report_path}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
