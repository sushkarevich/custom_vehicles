# Visual model format

CustomVehicles uses the same YAML files in the plugin and in the desktop editor.
The current format is `schema-version: 1`. Files are UTF-8 and are normally
stored in:

- packaged defaults: `src/main/resources/models/`;
- editable server definitions: `plugins/CustomVehicles/models/`.

The file name is not an identity. References always use the stable `id`.

## Complete example

```yaml
schema-version: 1
id: red_sedan
display-name: "Красный седан"
coordinate-system:
  forward: positive-z
interaction:
  offset:
    x: 0.0
    y: 0.65
    z: 0.0
  width: 2.2
  height: 1.35
display:
  interpolation-duration: 2
  teleport-duration: 1
parts:
  - id: body
    type: block
    material: RED_CONCRETE
    position:
      x: 0.0
      y: 0.4
      z: 0.0
    scale:
      x: 1.7
      y: 0.38
      z: 3.2
    rotation-degrees:
      x: 0.0
      y: 0.0
      z: 0.0
```

## Fields

| Path | Required | Meaning |
| --- | --- | --- |
| `schema-version` | yes | Must be `1`. |
| `id` | yes | Stable lowercase identifier used by variants. |
| `display-name` | yes | Human-readable UTF-8 name. |
| `coordinate-system.forward` | no | `positive-z` by default; `negative-z` is supported for legacy authored models. |
| `interaction` | no | Model-specific interaction entity. If omitted, no interaction is created. |
| `interaction.offset.{x,y,z}` | no | Bottom-centre entity anchor in model-local coordinates. Components default to `0`. |
| `interaction.width` / `height` | yes when `interaction` exists | Positive interaction dimensions. |
| `display.interpolation-duration` | no | BlockDisplay interpolation ticks, default `2`. |
| `display.teleport-duration` | no | BlockDisplay teleport interpolation ticks, default `1`. |
| `parts` | yes | Ordered list of block display parts. |
| `parts[].id` | yes | Unique stable ID inside this model. |
| `parts[].type` | no | `block`; this is the only type in schema 1. |
| `parts[].material` | yes | Exact Paper 1.21.1 `Material` enum name whose `isBlock()` value is true. |
| `parts[].position` | yes | Centre of the part in local block units. |
| `parts[].scale` | yes | Positive X/Y/Z dimensions in block units. |
| `parts[].rotation-degrees` | no | Finite local Euler angles; components default to `0`. |

The editor may add a top-level `editor` section for hidden/locked state. It is
editor-only and has no gameplay effect. Schema 1 readers deliberately ignore
unknown optional fields so a newer editor does not make an otherwise usable model
unloadable. An unsupported `schema-version`, invalid required field, or invalid
part still rejects that file.

## Coordinate and transform contract

- Model origin is the location passed by the behavior implementation. For a car
  this is the chassis/surface origin. For rail vehicles it is the point snapped
  to the analytic rail path, normally `block Y + 0.14`.
- `+X` is right, `+Y` is up, and `+Z` is forward for a
  `coordinate-system.forward: positive-z` model.
- `position` is the centre of a part. It is not the minimum corner and is not the
  vanilla BlockDisplay pivot.
- The vanilla block geometry occupies `[0, 1]` on every axis. CustomVehicles
  centres it by compensating for that default geometry before applying scale and
  rotation.
- Local part rotations use degrees and the `XYZ` Euler convention implemented by
  JOML `Quaternionf.rotationXYZ` and Three.js `Euler(..., "XYZ")`. These produce
  the same part quaternion. The final quaternion is
  `Q = Q_pose × Q_part`; the plugin never adds Euler angles to vehicle yaw.
- With local quaternion `Q` and scale `S`, the display transformation translation
  is `Q * (-S / 2)`, left rotation is `Q`, scale is `S`, and right rotation is the
  identity. Consequently the requested `position` remains the cuboid centre even
  for a rotated, non-uniformly scaled block.
- Cars remain upright and rotate around world Y. Rail models use
  `world = origin + right*x + up*y + forward*z`, where
  `right = (forward.z, 0, -forward.x)` and `up = forward × right`. Rail yaw and
  pitch therefore compose correctly on straight, curved, ascending, and
  descending track. Roll is not used by the existing rail behavior.
- `interaction.offset` is the Bukkit Interaction entity location: the lower
  centre of its axis-aligned box. The box centre is therefore
  `offset + (0, height / 2, 0)`. The offset follows the model pose, but Bukkit
  interaction boxes remain aligned with world axes on pitched rails.
- `negative-z` applies a proper 180-degree Y model-root turn. It exists so the
  original car model can retain its audited source coordinates and exactly match
  the old `yaw + 180°` renderer. As a consequence, authored `+X` maps to
  behavior-relative `-X` for such a model. Seat configuration remains in
  behavior-relative axes. New models should normally use `positive-z`.

The editor previews centred cuboids and uses this same coordinate, pivot, Euler,
and forward-axis contract.

## Validation and safety limits

- definition files are UTF-8 and at most 1,048,576 bytes;
- aliases, duplicate YAML keys, merge expansion, and Bukkit's reserved `==`
  serialized-object key are rejected;
- a model contains 1–512 parts;
- position components are within ±256 blocks;
- scale components are from `0.0001` to `64`;
- rotation components are within ±360,000 degrees;
- hitbox width and height are from `0.01` to `64`;
- interpolation and teleport durations are integer ticks from `0` to `59`;
- only modern non-legacy block materials are accepted.

## Built-in models

| ID | Role | Parts |
| --- | --- | ---: |
| `car_default` | Original road car | 12 |
| `metro_717_head` | 81-717 head car | 54 |
| `metro_714_wagon` | 81-714 passenger wagon | 44 |
| `vityaz_m_front` | Vityaz-M front section | 51 |
| `vityaz_m_middle` | Vityaz-M middle section | 45 |
| `vityaz_m_rear` | Vityaz-M rear section | 51 |

Packaged defaults are always available. On the first start the plugin writes
editable copies to its data directory. A valid custom file with the same `id`
overrides the packaged definition. Delete the custom override and run
`/cv reload` to reveal the packaged version again.

Files are scanned in deterministic path order. A duplicate ID or invalid file is
reported with its path. An invalid override does not remove a valid packaged
definition with the same ID.
