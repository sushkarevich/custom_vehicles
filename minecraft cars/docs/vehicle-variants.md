# Vehicle variant format

A visual model contains geometry. A vehicle variant is the thing a player can
receive, select, save, and spawn. It binds one of the existing behavior families
to one model or a fixed set of model roles.

Variant files use UTF-8 YAML with `schema-version: 1` and are normally stored in:

- packaged defaults: `src/main/resources/vehicles/`;
- editable server definitions: `plugins/CustomVehicles/vehicles/`.

## Car example

```yaml
schema-version: 1
id: red_sedan
display-name: "Красный седан"
behavior: car
model: red_sedan
permission: customvehicles.variant.red_sedan
menu-description: "Городской автомобиль"
item:
  material: MINECART
  name: "Красный седан"
  lore:
    - "ПКМ по блоку — установить"
    - "Пробел во время езды — гудок"
  custom-model-data: 1201
```

## Rail compositions

A train variant names its head and the default detachable wagon model:

```yaml
schema-version: 1
id: metro_blue
display-name: "Метропоезд 81-717"
behavior: train
models:
  locomotive: metro_717_head
  wagon: metro_714_wagon
item:
  material: FURNACE_MINECART
  name: "Головной вагон 81-717"
  lore:
    - "ПКМ по рельсам — установить"
```

A tram variant is a fixed composition:

```yaml
schema-version: 1
id: vityaz_m
display-name: "Трамвай Витязь-М"
behavior: tram
models:
  front: vityaz_m_front
  middle: vityaz_m_middle
  rear: vityaz_m_rear
item:
  material: HOPPER_MINECART
  name: "Трамвай Витязь-М"
  lore:
    - "ПКМ по рельсам — установить"
```

An attachable wagon uses `behavior: wagon` and a single `model`. It is not an
independently driven or persisted vehicle.

## Fields and behavior roles

| Field | Meaning |
| --- | --- |
| `schema-version` | Must be `1`. |
| `id` | Stable lowercase variant ID. This is persisted; do not casually change it. |
| `display-name` | Russian-facing name used by menus and diagnostics. |
| `behavior` | `car`, `train`, `tram`, or `wagon`. No scripting or new physics is introduced. |
| `model` | Required by `car` and `wagon`. |
| `models.locomotive` / `models.wagon` | Required train roles. |
| `models.front` / `middle` / `rear` | Required tram roles. |
| `permission` | Optional extra permission. The existing command/drive permissions still apply. |
| `menu-description` | Optional Russian catalog description. |
| `item.material` | Optional item icon; safe behavior-specific default when omitted. |
| `item.name` | Optional item display name; `display-name` is the default. |
| `item.lore` | Optional list of Russian item instructions. |
| `item.custom-model-data` | Optional positive integer for servers that use item model data. |

All referenced models must exist in the staged model registry. A bad custom
variant is skipped without disabling the plugin. Definitions are published only
after model references and behavior-specific roles validate.

## Built-in variants and compatibility aliases

| Variant ID | Behavior |
| --- | --- |
| `car_default` | car |
| `paz_3205` | car |
| `metro_717` | train |
| `metro_714_wagon` | wagon |
| `vityaz_m` | tram |

The commands `car`, `train`, `wagon`, and `tram` remain aliases for those IDs.
New IDs can be used directly:

```text
/cv give red_sedan
/cv give PlayerName red_sedan
```

Legacy vehicle items contain only `vehicle-type`; the plugin maps them to the
built-in IDs above. New items also carry `vehicle-variant`. Existing
`vehicles.yml` records without a variant map by their saved `kind`. Unknown
explicit variant IDs are retained/reported rather than silently becoming a car.
Legacy train wagon counts map to the built-in passenger-wagon variant.

## Server workflow

1. Export the model to `plugins/CustomVehicles/models/red_sedan.yml`.
2. Export the variant to `plugins/CustomVehicles/vehicles/red_sedan.yml`.
3. Run `/cv reload`.
4. Check the Russian reload summary and console diagnostics.
5. Use `/cv give red_sedan` or select the variant in `/cv catalog`.

Reload stages a new immutable registry. Existing active vehicles keep their
current resolved definitions; newly spawned and subsequently restored vehicles
use the new definitions. This avoids rebuilding a multi-entity train in the
middle of a server tick.

The existing physics profiles remain deliberately behavior-based:
`vehicle.*` for cars and `train.*` for trains/trams. Model dimensions do not
create new collision physics, train spacing, aircraft, boats, or arbitrary
scripts.
