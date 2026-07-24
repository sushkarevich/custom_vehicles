#!/usr/bin/env python3
"""Reproduce and audit the six models that were hardcoded before schema v1.

This file deliberately has no Bukkit, Gradle, or third-party Python dependency.
The builders below are a direct, readable transcription of VehicleModel and
TrainUnitModel.  Their ordered IDs are part of the migration fixture: changing
an ID, order, material, position, or scale makes the audit fail.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple


Vec3 = Tuple[float, float, float]
ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")
NUMBER_PATTERN = re.compile(
    r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"
)


@dataclass(frozen=True)
class Part:
    part_id: str
    material: str
    position: Vec3
    scale: Vec3
    rotation: Vec3 = (0.0, 0.0, 0.0)

    def as_mapping(self) -> Dict[str, Any]:
        return {
            "id": self.part_id,
            "type": "block",
            "material": self.material,
            "position": vector_mapping(self.position),
            "scale": vector_mapping(self.scale),
            "rotation-degrees": vector_mapping(self.rotation),
        }


@dataclass(frozen=True)
class Model:
    model_id: str
    display_name: str
    forward: str
    interaction_offset: Vec3
    interaction_width: float
    interaction_height: float
    parts: Tuple[Part, ...]

    def as_mapping(self) -> Dict[str, Any]:
        return {
            "schema-version": 1,
            "id": self.model_id,
            "display-name": self.display_name,
            "coordinate-system": {"forward": self.forward},
            "interaction": {
                "offset": vector_mapping(self.interaction_offset),
                "width": self.interaction_width,
                "height": self.interaction_height,
            },
            "display": {
                "interpolation-duration": 2,
                "teleport-duration": 1,
            },
            "parts": [part.as_mapping() for part in self.parts],
        }


class Builder:
    def __init__(self) -> None:
        self.parts: List[Part] = []
        self.ids: set[str] = set()

    def add(
        self,
        part_id: str,
        material: str,
        x: float,
        y: float,
        z: float,
        sx: float,
        sy: float,
        sz: float,
    ) -> None:
        if not ID_PATTERN.fullmatch(part_id):
            raise ValueError("invalid generated part ID: {!r}".format(part_id))
        if part_id in self.ids:
            raise ValueError("duplicate generated part ID: {!r}".format(part_id))
        values = (x, y, z, sx, sy, sz)
        if not all(math.isfinite(float(value)) for value in values):
            raise ValueError("non-finite generated geometry for {!r}".format(part_id))
        if sx <= 0.0 or sy <= 0.0 or sz <= 0.0:
            raise ValueError("non-positive generated scale for {!r}".format(part_id))
        self.ids.add(part_id)
        self.parts.append(
            Part(
                part_id,
                material,
                (float(x), float(y), float(z)),
                (float(sx), float(sy), float(sz)),
            )
        )


def vector_mapping(vector: Vec3) -> Dict[str, float]:
    return {"x": vector[0], "y": vector[1], "z": vector[2]}


def side_name(side: float) -> str:
    return "left" if side < 0.0 else "right"


def end_name(z: float) -> str:
    return "front" if z > 0.0 else "rear"


def build_car() -> Model:
    b = Builder()
    b.add("body_base", "RED_CONCRETE", 0.0, 0.40, 0.0, 1.70, 0.38, 3.20)
    b.add("bonnet", "RED_CONCRETE", 0.0, 0.78, -0.72, 1.58, 0.36, 1.25)
    b.add(
        "cabin_glass",
        "BLACK_STAINED_GLASS",
        0.0,
        1.08,
        0.30,
        1.46,
        0.50,
        1.10,
    )
    b.add("roof", "RED_CONCRETE", 0.0, 1.42, 0.30, 1.54, 0.16, 1.18)

    b.add(
        "wheel_left_front",
        "BLACK_CONCRETE",
        -0.90,
        0.34,
        -0.88,
        0.22,
        0.70,
        0.70,
    )
    b.add(
        "wheel_right_front",
        "BLACK_CONCRETE",
        0.90,
        0.34,
        -0.88,
        0.22,
        0.70,
        0.70,
    )
    b.add(
        "wheel_left_rear",
        "BLACK_CONCRETE",
        -0.90,
        0.34,
        0.98,
        0.22,
        0.70,
        0.70,
    )
    b.add(
        "wheel_right_rear",
        "BLACK_CONCRETE",
        0.90,
        0.34,
        0.98,
        0.22,
        0.70,
        0.70,
    )

    b.add(
        "headlight_left",
        "SEA_LANTERN",
        -0.53,
        0.64,
        -1.63,
        0.34,
        0.26,
        0.08,
    )
    b.add(
        "headlight_right",
        "SEA_LANTERN",
        0.53,
        0.64,
        -1.63,
        0.34,
        0.26,
        0.08,
    )
    b.add(
        "tail_light_left",
        "REDSTONE_BLOCK",
        -0.58,
        0.59,
        1.63,
        0.28,
        0.20,
        0.08,
    )
    b.add(
        "tail_light_right",
        "REDSTONE_BLOCK",
        0.58,
        0.59,
        1.63,
        0.28,
        0.20,
        0.08,
    )
    return Model(
        "car_default",
        "Стандартный автомобиль",
        "negative-z",
        (0.0, 0.65, 0.0),
        2.2,
        1.35,
        tuple(b.parts),
    )


def add_metro_bogie(b: Builder, z: float) -> None:
    prefix = end_name(z)
    b.add(
        "{}_bogie_frame".format(prefix),
        "DEEPSLATE_TILES",
        0.0,
        0.33,
        z,
        1.72,
        0.22,
        1.22,
    )
    b.add(
        "{}_wheel_left".format(prefix),
        "BLACK_CONCRETE",
        -1.03,
        0.30,
        z,
        0.22,
        0.60,
        1.04,
    )
    b.add(
        "{}_wheel_right".format(prefix),
        "BLACK_CONCRETE",
        1.03,
        0.30,
        z,
        0.22,
        0.60,
        1.04,
    )


def add_metro_body(b: Builder) -> None:
    b.add(
        "underframe",
        "POLISHED_BLACKSTONE",
        0.0,
        0.31,
        0.0,
        1.88,
        0.24,
        5.96,
    )
    b.add("lower_body", "CYAN_TERRACOTTA", 0.0, 0.72, 0.0, 2.02, 0.72, 5.86)
    b.add("upper_body", "CYAN_CONCRETE", 0.0, 1.48, 0.0, 2.00, 1.48, 5.84)
    b.add("roof", "WEATHERED_COPPER", 0.0, 2.31, 0.0, 2.10, 0.18, 5.94)
    b.add(
        "center_chassis",
        "GRAY_CONCRETE",
        0.0,
        0.24,
        0.0,
        1.42,
        0.30,
        1.45,
    )

    for side in (-1.03, 1.03):
        name = side_name(side)
        b.add(
            "{}_lower_trim".format(name),
            "LIGHT_GRAY_CONCRETE",
            side,
            1.08,
            0.0,
            0.06,
            0.10,
            5.70,
        )
    for name, z in (("rear", -1.95), ("center", 0.0), ("front", 1.95)):
        b.add(
            "roof_vent_{}".format(name),
            "POLISHED_BLACKSTONE",
            0.0,
            2.44,
            z,
            0.58,
            0.10,
            0.42,
        )
    add_metro_bogie(b, -1.92)
    add_metro_bogie(b, 1.92)


def add_metro_door(b: Builder, side: float, z: float, index: int) -> None:
    name = side_name(side)
    outer = -1.07 if side < 0.0 else 1.07
    prefix = "{}_door_{}".format(name, index)
    b.add(
        "{}_panel".format(prefix),
        "CYAN_TERRACOTTA",
        side,
        1.48,
        z,
        0.08,
        1.48,
        0.62,
    )
    b.add(
        "{}_glass".format(prefix),
        "BLACK_STAINED_GLASS",
        outer,
        1.72,
        z,
        0.04,
        0.66,
        0.42,
    )


def add_metro_window(
    b: Builder, side: float, z: float, width: float, index: int
) -> None:
    name = side_name(side)
    outer = -1.07 if side < 0.0 else 1.07
    b.add(
        "{}_window_{}".format(name, index),
        "BLACK_STAINED_GLASS",
        outer,
        1.72,
        z,
        0.04,
        0.70,
        width,
    )


def add_head_car_sides(b: Builder) -> None:
    for side in (-1.035, 1.035):
        add_metro_window(b, side, 2.45, 0.60, 1)
        add_metro_door(b, side, 1.55, 1)
        add_metro_window(b, side, 0.72, 0.62, 2)
        add_metro_door(b, side, -0.10, 2)
        add_metro_window(b, side, -0.92, 0.62, 3)
        add_metro_door(b, side, -1.76, 3)
        add_metro_window(b, side, -2.55, 0.48, 4)


def add_passenger_car_sides(b: Builder) -> None:
    for side in (-1.035, 1.035):
        for index, z in enumerate((-2.25, -0.75, 0.75, 2.25), start=1):
            add_metro_door(b, side, z, index)
        for index, z in enumerate((-1.50, 0.0, 1.50), start=1):
            add_metro_window(b, side, z, 0.60, index)


def add_cab_front(b: Builder) -> None:
    b.add(
        "cab_front_panel",
        "GRAY_CONCRETE",
        0.0,
        1.44,
        2.96,
        1.88,
        1.78,
        0.12,
    )
    b.add(
        "cab_windscreen_center",
        "BLACK_STAINED_GLASS",
        0.0,
        1.73,
        3.04,
        0.92,
        0.72,
        0.05,
    )
    b.add(
        "cab_windscreen_left",
        "BLACK_STAINED_GLASS",
        -0.66,
        1.73,
        3.04,
        0.27,
        0.72,
        0.05,
    )
    b.add(
        "cab_windscreen_right",
        "BLACK_STAINED_GLASS",
        0.66,
        1.73,
        3.04,
        0.27,
        0.72,
        0.05,
    )
    b.add(
        "cab_route_panel",
        "YELLOW_CONCRETE",
        0.0,
        1.20,
        3.04,
        0.82,
        0.18,
        0.05,
    )
    b.add(
        "cab_marker_left",
        "REDSTONE_BLOCK",
        -0.70,
        2.08,
        3.04,
        0.22,
        0.18,
        0.06,
    )
    b.add(
        "cab_marker_right",
        "REDSTONE_BLOCK",
        0.70,
        2.08,
        3.04,
        0.22,
        0.18,
        0.06,
    )
    for index, x in enumerate((-0.76, -0.45, -0.15, 0.15, 0.45, 0.76), start=1):
        b.add(
            "cab_headlight_{}".format(index),
            "SEA_LANTERN",
            x,
            0.76,
            3.05,
            0.20,
            0.20,
            0.07,
        )
    b.add(
        "cab_bumper",
        "GRAY_CONCRETE",
        0.0,
        0.40,
        3.08,
        2.08,
        0.24,
        0.24,
    )
    b.add(
        "cab_coupler",
        "POLISHED_BLACKSTONE",
        0.0,
        0.20,
        3.34,
        0.48,
        0.24,
        0.48,
    )


def add_passenger_end(b: Builder, z: float) -> None:
    prefix = end_name(z)
    outer_z = 3.02 if z > 0.0 else -3.02
    b.add(
        "{}_end_window_left".format(prefix),
        "BLACK_STAINED_GLASS",
        -0.48,
        1.70,
        outer_z,
        0.58,
        0.68,
        0.05,
    )
    b.add(
        "{}_end_window_right".format(prefix),
        "BLACK_STAINED_GLASS",
        0.48,
        1.70,
        outer_z,
        0.58,
        0.68,
        0.05,
    )
    b.add(
        "{}_end_trim".format(prefix),
        "LIGHT_GRAY_CONCRETE",
        0.0,
        1.08,
        outer_z,
        1.86,
        0.10,
        0.06,
    )


def build_metro_head() -> Model:
    b = Builder()
    add_metro_body(b)
    add_head_car_sides(b)
    add_cab_front(b)
    add_passenger_end(b, -3.0)
    return Model(
        "metro_717_head",
        "Головной вагон метро 81-717",
        "positive-z",
        (0.0, 1.225, 0.0),
        2.25,
        2.45,
        tuple(b.parts),
    )


def build_metro_wagon() -> Model:
    b = Builder()
    add_metro_body(b)
    add_passenger_car_sides(b)
    add_passenger_end(b, 3.0)
    add_passenger_end(b, -3.0)
    return Model(
        "metro_714_wagon",
        "Пассажирский вагон метро 81-714",
        "positive-z",
        (0.0, 1.225, 0.0),
        2.25,
        2.45,
        tuple(b.parts),
    )


def add_tram_body(b: Builder, length: float) -> None:
    b.add(
        "underframe",
        "POLISHED_BLACKSTONE",
        0.0,
        0.28,
        0.0,
        1.92,
        0.22,
        length,
    )
    b.add("lower_body", "WHITE_CONCRETE", 0.0, 0.55, 0.0, 2.14, 0.42, length)
    b.add("mid_body", "RED_CONCRETE", 0.0, 1.18, 0.0, 2.12, 0.88, length)
    b.add("window_band", "BLACK_CONCRETE", 0.0, 1.86, 0.0, 2.10, 0.72, length)
    b.add("upper_body", "RED_CONCRETE", 0.0, 2.28, 0.0, 2.12, 0.18, length)
    b.add("roof", "WHITE_CONCRETE", 0.0, 2.48, 0.0, 2.18, 0.22, length)

    for side in (-1.09, 1.09):
        name = side_name(side)
        b.add(
            "{}_lower_trim".format(name),
            "LIGHT_GRAY_CONCRETE",
            side,
            0.48,
            0.0,
            0.06,
            0.20,
            length - 0.18,
        )
        b.add(
            "{}_roof_trim".format(name),
            "WHITE_CONCRETE",
            side,
            2.40,
            0.0,
            0.06,
            0.10,
            length - 0.14,
        )


def add_tram_window(b: Builder, side: float, z: float, index: int) -> None:
    name = side_name(side)
    outer = -1.115 if side < 0.0 else 1.115
    b.add(
        "{}_window_{}".format(name, index),
        "BLACK_STAINED_GLASS",
        outer,
        1.87,
        z,
        0.04,
        0.68,
        0.68,
    )


def add_tram_door(b: Builder, side: float, z: float, index: int) -> None:
    name = side_name(side)
    outer = -1.12 if side < 0.0 else 1.12
    prefix = "{}_door_{}".format(name, index)
    b.add(
        "{}_panel".format(prefix),
        "RED_CONCRETE",
        side,
        1.46,
        z,
        0.07,
        1.52,
        0.68,
    )
    b.add(
        "{}_glass".format(prefix),
        "BLACK_STAINED_GLASS",
        outer,
        1.90,
        z,
        0.04,
        0.70,
        0.48,
    )
    b.add(
        "{}_sill".format(prefix),
        "LIGHT_GRAY_CONCRETE",
        outer,
        0.74,
        z,
        0.04,
        0.13,
        0.58,
    )


def add_tram_front_sides(b: Builder) -> None:
    for side in (-1.085, 1.085):
        add_tram_window(b, side, 1.42, 1)
        add_tram_door(b, side, 0.46, 1)
        add_tram_window(b, side, -0.55, 2)
        add_tram_door(b, side, -1.48, 2)


def add_tram_middle_sides(b: Builder) -> None:
    for side in (-1.085, 1.085):
        add_tram_door(b, side, 0.0, 1)
        add_tram_window(b, side, 0.92, 1)
        add_tram_window(b, side, -0.92, 2)


def add_tram_rear_sides(b: Builder) -> None:
    for side in (-1.085, 1.085):
        add_tram_door(b, side, 1.48, 1)
        add_tram_window(b, side, 0.55, 1)
        add_tram_door(b, side, -0.46, 2)
        add_tram_window(b, side, -1.42, 2)


def add_tram_cab(b: Builder, z: float, front: bool) -> None:
    prefix = "front_cab" if front else "rear_cab"
    sign = 1.0 if z > 0.0 else -1.0
    outer = z + sign * 0.03
    b.add(
        "{}_panel".format(prefix),
        "RED_CONCRETE",
        0.0,
        1.35,
        z,
        2.02,
        1.76,
        0.12,
    )
    b.add(
        "{}_mask".format(prefix),
        "BLACK_CONCRETE",
        0.0,
        1.62,
        outer,
        1.92,
        1.58,
        0.08,
    )
    b.add(
        "{}_windscreen".format(prefix),
        "BLACK_STAINED_GLASS",
        0.0,
        1.95,
        outer + sign * 0.02,
        1.55,
        0.82,
        0.05,
    )
    b.add(
        "{}_route_display".format(prefix),
        "LIME_STAINED_GLASS",
        0.0,
        2.31,
        outer + sign * 0.04,
        0.92,
        0.14,
        0.05,
    )
    b.add(
        "{}_lower_panel".format(prefix),
        "RED_CONCRETE",
        0.0,
        0.72,
        outer,
        2.08,
        0.45,
        0.10,
    )
    b.add(
        "{}_trim".format(prefix),
        "WHITE_CONCRETE",
        0.0,
        0.47,
        outer + sign * 0.02,
        2.12,
        0.18,
        0.10,
    )
    b.add(
        "{}_bumper".format(prefix),
        "POLISHED_BLACKSTONE",
        0.0,
        0.26,
        outer + sign * 0.07,
        1.78,
        0.16,
        0.18,
    )
    marker_material = "SEA_LANTERN" if front else "REDSTONE_BLOCK"
    b.add(
        "{}_marker_left".format(prefix),
        marker_material,
        -0.70,
        0.92,
        outer + sign * 0.08,
        0.22,
        0.18,
        0.08,
    )
    b.add(
        "{}_marker_right".format(prefix),
        marker_material,
        0.70,
        0.92,
        outer + sign * 0.08,
        0.22,
        0.18,
        0.08,
    )
    b.add(
        "{}_lower_light_left".format(prefix),
        "SEA_LANTERN",
        -0.48,
        0.72,
        outer + sign * 0.09,
        0.18,
        0.14,
        0.08,
    )
    b.add(
        "{}_lower_light_right".format(prefix),
        "SEA_LANTERN",
        0.48,
        0.72,
        outer + sign * 0.09,
        0.18,
        0.14,
        0.08,
    )


def add_tram_articulation(b: Builder, z: float) -> None:
    prefix = "{}_articulation".format(end_name(z))
    b.add(
        "{}_outer".format(prefix),
        "GRAY_CONCRETE",
        0.0,
        1.38,
        z,
        1.90,
        2.10,
        0.24,
    )
    b.add(
        "{}_inner".format(prefix),
        "POLISHED_BLACKSTONE",
        0.0,
        1.38,
        z,
        1.72,
        1.92,
        0.28,
    )
    for index, y in enumerate((0.62, 0.95, 1.28, 1.61, 1.94, 2.27), start=1):
        b.add(
            "{}_rib_{}".format(prefix, index),
            "GRAY_CONCRETE",
            0.0,
            y,
            z,
            1.82,
            0.07,
            0.31,
        )


def add_tram_bogie(b: Builder, z: float) -> None:
    b.add(
        "bogie_frame",
        "DEEPSLATE_TILES",
        0.0,
        0.27,
        z,
        1.62,
        0.22,
        0.92,
    )
    b.add(
        "bogie_wheel_left",
        "BLACK_CONCRETE",
        -1.04,
        0.28,
        z,
        0.20,
        0.52,
        0.74,
    )
    b.add(
        "bogie_wheel_right",
        "BLACK_CONCRETE",
        1.04,
        0.28,
        z,
        0.20,
        0.52,
        0.74,
    )


def add_tram_roof_equipment(b: Builder, z: float) -> None:
    b.add(
        "roof_equipment_center",
        "LIGHT_GRAY_CONCRETE",
        0.0,
        2.66,
        z,
        0.78,
        0.18,
        0.72,
    )
    b.add(
        "roof_equipment_rear",
        "GRAY_CONCRETE",
        0.0,
        2.78,
        z - 0.78,
        0.58,
        0.15,
        0.45,
    )
    b.add(
        "roof_equipment_front",
        "GRAY_CONCRETE",
        0.0,
        2.78,
        z + 0.78,
        0.58,
        0.15,
        0.45,
    )


def add_pantograph(b: Builder) -> None:
    b.add(
        "pantograph_lower_left",
        "RED_CONCRETE",
        -0.38,
        2.82,
        0.0,
        0.10,
        0.58,
        0.12,
    )
    b.add(
        "pantograph_lower_right",
        "RED_CONCRETE",
        0.38,
        2.82,
        0.0,
        0.10,
        0.58,
        0.12,
    )
    b.add(
        "pantograph_upper_left",
        "RED_CONCRETE",
        -0.20,
        3.13,
        0.0,
        0.10,
        0.36,
        0.12,
    )
    b.add(
        "pantograph_upper_right",
        "RED_CONCRETE",
        0.20,
        3.13,
        0.0,
        0.10,
        0.36,
        0.12,
    )
    b.add(
        "pantograph_crossbar",
        "RED_CONCRETE",
        0.0,
        3.36,
        0.0,
        1.22,
        0.09,
        0.14,
    )
    b.add(
        "pantograph_contact",
        "POLISHED_BLACKSTONE",
        0.0,
        3.45,
        0.0,
        1.62,
        0.07,
        0.12,
    )


def build_tram_front() -> Model:
    b = Builder()
    add_tram_body(b, 4.55)
    add_tram_front_sides(b)
    add_tram_cab(b, 2.30, True)
    add_tram_articulation(b, -2.30)
    add_tram_bogie(b, -1.25)
    add_tram_roof_equipment(b, 0.15)
    return Model(
        "vityaz_m_front",
        "Трамвай «Витязь-М» — передняя секция",
        "positive-z",
        (0.0, 1.325, 0.0),
        2.35,
        2.65,
        tuple(b.parts),
    )


def build_tram_middle() -> Model:
    b = Builder()
    add_tram_body(b, 2.85)
    add_tram_middle_sides(b)
    add_tram_articulation(b, 1.47)
    add_tram_articulation(b, -1.47)
    add_tram_bogie(b, 0.0)
    add_pantograph(b)
    return Model(
        "vityaz_m_middle",
        "Трамвай «Витязь-М» — средняя секция",
        "positive-z",
        (0.0, 1.325, 0.0),
        2.35,
        2.65,
        tuple(b.parts),
    )


def build_tram_rear() -> Model:
    b = Builder()
    add_tram_body(b, 4.55)
    add_tram_rear_sides(b)
    add_tram_cab(b, -2.30, False)
    add_tram_articulation(b, 2.30)
    add_tram_bogie(b, 1.25)
    add_tram_roof_equipment(b, -0.15)
    return Model(
        "vityaz_m_rear",
        "Трамвай «Витязь-М» — задняя секция",
        "positive-z",
        (0.0, 1.325, 0.0),
        2.35,
        2.65,
        tuple(b.parts),
    )


def expected_models() -> Tuple[Model, ...]:
    models = (
        build_car(),
        build_metro_head(),
        build_metro_wagon(),
        build_tram_front(),
        build_tram_middle(),
        build_tram_rear(),
    )
    expected_counts = (12, 54, 44, 51, 45, 51)
    actual_counts = tuple(len(model.parts) for model in models)
    if actual_counts != expected_counts:
        raise AssertionError(
            "legacy builder transcription count mismatch: expected {}, got {}".format(
                expected_counts, actual_counts
            )
        )
    ids = [model.model_id for model in models]
    if len(ids) != len(set(ids)):
        raise AssertionError("duplicate built-in model ID in audit fixture")
    return models


# Minimal YAML 1.2 block parser for the model files.  It intentionally accepts
# only the mapping/list/scalar subset emitted by the editor and documented for
# schema v1.  Keeping it here avoids making an audit depend on the code it audits
# or on an optional PyYAML installation.


@dataclass(frozen=True)
class YamlToken:
    indent: int
    text: str
    line: int


class YamlSubsetError(ValueError):
    pass


def strip_yaml_comment(line: str) -> str:
    quote: Optional[str] = None
    escaped = False
    for index, character in enumerate(line):
        if quote == '"':
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quote = None
            continue
        if quote == "'":
            if character == "'":
                if index + 1 < len(line) and line[index + 1] == "'":
                    continue
                quote = None
            continue
        if character in ("'", '"'):
            quote = character
        elif character == "#" and (
            index == 0 or line[index - 1].isspace()
        ):
            return line[:index]
    return line


def yaml_tokens(text: str, source: Path) -> List[YamlToken]:
    tokens: List[YamlToken] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        if "\t" in raw_line[: len(raw_line) - len(raw_line.lstrip())]:
            raise YamlSubsetError(
                "{}:{}: tabs are not allowed for YAML indentation".format(
                    source, line_number
                )
            )
        uncommented = strip_yaml_comment(raw_line).rstrip()
        if not uncommented.strip() or uncommented.lstrip().startswith("---"):
            continue
        indent = len(uncommented) - len(uncommented.lstrip(" "))
        tokens.append(YamlToken(indent, uncommented[indent:], line_number))
    return tokens


def split_mapping_entry(text: str) -> Optional[Tuple[str, str]]:
    quote: Optional[str] = None
    escaped = False
    square_depth = 0
    curly_depth = 0
    for index, character in enumerate(text):
        if quote == '"':
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quote = None
            continue
        if quote == "'":
            if character == "'":
                quote = None
            continue
        if character in ("'", '"'):
            quote = character
        elif character == "[":
            square_depth += 1
        elif character == "]":
            square_depth -= 1
        elif character == "{":
            curly_depth += 1
        elif character == "}":
            curly_depth -= 1
        elif character == ":" and square_depth == 0 and curly_depth == 0:
            if index + 1 == len(text) or text[index + 1].isspace():
                return text[:index].strip(), text[index + 1 :].strip()
    return None


def split_flow_items(text: str) -> List[str]:
    items: List[str] = []
    start = 0
    quote: Optional[str] = None
    escaped = False
    depth = 0
    for index, character in enumerate(text):
        if quote == '"':
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quote = None
            continue
        if quote == "'":
            if character == "'":
                quote = None
            continue
        if character in ("'", '"'):
            quote = character
        elif character in "[{":
            depth += 1
        elif character in "]}":
            depth -= 1
        elif character == "," and depth == 0:
            items.append(text[start:index].strip())
            start = index + 1
    items.append(text[start:].strip())
    return items


def parse_scalar(text: str, source: Path, line: int) -> Any:
    if text.startswith('"'):
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise YamlSubsetError(
                "{}:{}: invalid double-quoted scalar: {}".format(source, line, error)
            )
    if text.startswith("'"):
        if len(text) < 2 or not text.endswith("'"):
            raise YamlSubsetError(
                "{}:{}: unterminated single-quoted scalar".format(source, line)
            )
        return text[1:-1].replace("''", "'")
    lower = text.lower()
    if lower in ("null", "~"):
        return None
    if lower in ("true", "false"):
        return lower == "true"
    if lower in (".nan", "nan"):
        return float("nan")
    if lower in (".inf", "+.inf", "inf", "+inf"):
        return float("inf")
    if lower in ("-.inf", "-inf"):
        return float("-inf")
    if NUMBER_PATTERN.fullmatch(text):
        if "." not in text and "e" not in lower:
            return int(text)
        return float(text)
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [parse_scalar(item, source, line) for item in split_flow_items(inner)]
    if text.startswith("{") and text.endswith("}"):
        inner = text[1:-1].strip()
        result: Dict[str, Any] = {}
        if not inner:
            return result
        for item in split_flow_items(inner):
            pair = split_mapping_entry(item)
            if pair is None:
                raise YamlSubsetError(
                    "{}:{}: invalid flow mapping entry {!r}".format(source, line, item)
                )
            key_text, value_text = pair
            key = parse_scalar(key_text, source, line)
            if not isinstance(key, str):
                raise YamlSubsetError(
                    "{}:{}: mapping key must be text".format(source, line)
                )
            result[key] = parse_scalar(value_text, source, line)
        return result
    if text.startswith("|") or text.startswith(">") or text.startswith("&"):
        raise YamlSubsetError(
            "{}:{}: multiline scalars and anchors are outside the model YAML subset".format(
                source, line
            )
        )
    return text


def parse_key(text: str, source: Path, line: int) -> str:
    value = parse_scalar(text, source, line)
    if not isinstance(value, str) or not value:
        raise YamlSubsetError(
            "{}:{}: mapping key must be non-empty text".format(source, line)
        )
    return value


def parse_yaml_block(
    tokens: Sequence[YamlToken], index: int, indent: int, source: Path
) -> Tuple[Any, int]:
    if index >= len(tokens) or tokens[index].indent != indent:
        line = tokens[index].line if index < len(tokens) else "EOF"
        raise YamlSubsetError(
            "{}:{}: inconsistent indentation".format(source, line)
        )
    if tokens[index].text == "-" or tokens[index].text.startswith("- "):
        return parse_yaml_sequence(tokens, index, indent, source)
    return parse_yaml_mapping(tokens, index, indent, source)


def parse_yaml_mapping(
    tokens: Sequence[YamlToken], index: int, indent: int, source: Path
) -> Tuple[Dict[str, Any], int]:
    result: Dict[str, Any] = {}
    while index < len(tokens):
        token = tokens[index]
        if token.indent < indent:
            break
        if token.indent > indent:
            raise YamlSubsetError(
                "{}:{}: unexpected indentation (expected {} spaces)".format(
                    source, token.line, indent
                )
            )
        if token.text == "-" or token.text.startswith("- "):
            break
        pair = split_mapping_entry(token.text)
        if pair is None:
            raise YamlSubsetError(
                "{}:{}: expected 'key: value'".format(source, token.line)
            )
        key_text, value_text = pair
        key = parse_key(key_text, source, token.line)
        if key in result:
            raise YamlSubsetError(
                "{}:{}: duplicate key {!r}".format(source, token.line, key)
            )
        index += 1
        if value_text:
            result[key] = parse_scalar(value_text, source, token.line)
        elif index < len(tokens) and tokens[index].indent > indent:
            child_indent = tokens[index].indent
            result[key], index = parse_yaml_block(
                tokens, index, child_indent, source
            )
        elif (
            index < len(tokens)
            and tokens[index].indent == indent
            and (
                tokens[index].text == "-"
                or tokens[index].text.startswith("- ")
            )
        ):
            # PyYAML-style "indentless" sequences are valid YAML:
            #
            # parts:
            # - id: body
            result[key], index = parse_yaml_sequence(
                tokens, index, indent, source
            )
        else:
            result[key] = None
    return result, index


def parse_yaml_sequence(
    tokens: Sequence[YamlToken], index: int, indent: int, source: Path
) -> Tuple[List[Any], int]:
    result: List[Any] = []
    while index < len(tokens):
        token = tokens[index]
        if token.indent < indent:
            break
        if token.indent != indent:
            raise YamlSubsetError(
                "{}:{}: unexpected list indentation (expected {} spaces)".format(
                    source, token.line, indent
                )
            )
        if token.text != "-" and not token.text.startswith("- "):
            break
        rest = token.text[1:].strip()
        index += 1
        if not rest:
            if index >= len(tokens) or tokens[index].indent <= indent:
                result.append(None)
            else:
                item, index = parse_yaml_block(
                    tokens, index, tokens[index].indent, source
                )
                result.append(item)
            continue

        pair = split_mapping_entry(rest)
        if pair is None:
            result.append(parse_scalar(rest, source, token.line))
            continue

        item: Dict[str, Any] = {}
        key_text, value_text = pair
        key = parse_key(key_text, source, token.line)
        virtual_indent = indent + 2
        if value_text:
            item[key] = parse_scalar(value_text, source, token.line)
        elif index < len(tokens) and tokens[index].indent > virtual_indent:
            item[key], index = parse_yaml_block(
                tokens, index, tokens[index].indent, source
            )
        else:
            item[key] = None

        if index < len(tokens) and tokens[index].indent > indent:
            if tokens[index].indent != virtual_indent:
                raise YamlSubsetError(
                    "{}:{}: list mapping fields must be indented {} spaces".format(
                        source, tokens[index].line, virtual_indent
                    )
                )
            continuation, index = parse_yaml_mapping(
                tokens, index, virtual_indent, source
            )
            duplicate_keys = set(item).intersection(continuation)
            if duplicate_keys:
                raise YamlSubsetError(
                    "{}:{}: duplicate list mapping key {!r}".format(
                        source, token.line, sorted(duplicate_keys)[0]
                    )
                )
            item.update(continuation)
        result.append(item)
    return result, index


def load_yaml_subset(path: Path) -> Any:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as error:
        raise YamlSubsetError("{}: cannot read UTF-8 YAML: {}".format(path, error))
    tokens = yaml_tokens(text, path)
    if not tokens:
        raise YamlSubsetError("{}: YAML document is empty".format(path))
    if tokens[0].indent != 0:
        raise YamlSubsetError(
            "{}:{}: top-level content must not be indented".format(
                path, tokens[0].line
            )
        )
    value, index = parse_yaml_block(tokens, 0, 0, path)
    if index != len(tokens):
        token = tokens[index]
        raise YamlSubsetError(
            "{}:{}: could not parse YAML content".format(path, token.line)
        )
    return value


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def at(mapping: Any, keys: Sequence[str], default: Any = None) -> Any:
    current = mapping
    for key in keys:
        if not isinstance(current, Mapping) or key not in current:
            return default
        current = current[key]
    return current


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def actual_number(
    value: Any, field: str, errors: List[str], source_label: str
) -> Optional[float]:
    if not is_number(value):
        errors.append(
            "{}: {} must be a number; got {!r}".format(source_label, field, value)
        )
        return None
    number = float(value)
    if not math.isfinite(number):
        errors.append(
            "{}: {} must be finite; got {!r}".format(source_label, field, value)
        )
        return None
    return number


def compare_number(
    actual: Any,
    expected: float,
    field: str,
    errors: List[str],
    source_label: str,
    tolerance: float,
    positive: bool = False,
) -> None:
    number = actual_number(actual, field, errors, source_label)
    if number is None:
        return
    if positive and number <= 0.0:
        errors.append(
            "{}: {} must be positive; got {}".format(source_label, field, number)
        )
    if not math.isclose(number, expected, rel_tol=0.0, abs_tol=tolerance):
        errors.append(
            "{}: {} expected {}, got {}".format(
                source_label, field, format(expected, ".12g"), format(number, ".12g")
            )
        )


def compare_vector(
    actual: Any,
    expected: Vec3,
    field: str,
    errors: List[str],
    source_label: str,
    tolerance: float,
    positive: bool = False,
) -> None:
    if not isinstance(actual, Mapping):
        errors.append(
            "{}: {} must be a mapping with x/y/z; got {!r}".format(
                source_label, field, actual
            )
        )
        return
    for index, axis in enumerate(("x", "y", "z")):
        compare_number(
            actual.get(axis),
            expected[index],
            "{}.{}".format(field, axis),
            errors,
            source_label,
            tolerance,
            positive,
        )


def validate_model(
    actual: Mapping[str, Any],
    expected: Model,
    path: Path,
    tolerance: float,
) -> List[str]:
    errors: List[str] = []
    source_label = "{} [{}]".format(display_path(path), expected.model_id)

    if actual.get("schema-version") != 1:
        errors.append(
            "{}: schema-version expected 1, got {!r}".format(
                source_label, actual.get("schema-version")
            )
        )
    if actual.get("id") != expected.model_id:
        errors.append(
            "{}: id expected {!r}, got {!r}".format(
                source_label, expected.model_id, actual.get("id")
            )
        )
    display_name = actual.get("display-name")
    if not isinstance(display_name, str) or not display_name.strip():
        errors.append("{}: display-name must be non-empty UTF-8 text".format(source_label))

    actual_forward = at(actual, ("coordinate-system", "forward"), "positive-z")
    if actual_forward != expected.forward:
        errors.append(
            "{}: coordinate-system.forward expected {!r}, got {!r}".format(
                source_label, expected.forward, actual_forward
            )
        )

    interaction = actual.get("interaction")
    if not isinstance(interaction, Mapping):
        errors.append("{}: interaction mapping is missing".format(source_label))
    else:
        compare_vector(
            interaction.get("offset", {}),
            expected.interaction_offset,
            "interaction.offset",
            errors,
            source_label,
            tolerance,
        )
        compare_number(
            interaction.get("width"),
            expected.interaction_width,
            "interaction.width",
            errors,
            source_label,
            tolerance,
            positive=True,
        )
        compare_number(
            interaction.get("height"),
            expected.interaction_height,
            "interaction.height",
            errors,
            source_label,
            tolerance,
            positive=True,
        )

    display = actual.get("display", {})
    if not isinstance(display, Mapping):
        errors.append("{}: display must be a mapping".format(source_label))
    else:
        interpolation = display.get("interpolation-duration", 2)
        teleport = display.get("teleport-duration", 1)
        if interpolation != 2:
            errors.append(
                "{}: display.interpolation-duration expected 2, got {!r}".format(
                    source_label, interpolation
                )
            )
        if teleport != 1:
            errors.append(
                "{}: display.teleport-duration expected 1, got {!r}".format(
                    source_label, teleport
                )
            )

    parts = actual.get("parts")
    if not isinstance(parts, list):
        errors.append("{}: parts must be a list".format(source_label))
        return errors
    if len(parts) != len(expected.parts):
        errors.append(
            "{}: parts count expected {}, got {}".format(
                source_label, len(expected.parts), len(parts)
            )
        )

    actual_ids: List[str] = []
    for index, part in enumerate(parts):
        label = "parts[{}]".format(index)
        if not isinstance(part, Mapping):
            errors.append(
                "{}: {} must be a mapping; got {!r}".format(
                    source_label, label, part
                )
            )
            continue
        part_id = part.get("id")
        if not isinstance(part_id, str) or not ID_PATTERN.fullmatch(part_id):
            errors.append(
                "{}: {}.id must match {}; got {!r}".format(
                    source_label, label, ID_PATTERN.pattern, part_id
                )
            )
        else:
            actual_ids.append(part_id)
        if part.get("type", "block") != "block":
            errors.append(
                "{}: {}.type expected 'block', got {!r}".format(
                    source_label, label, part.get("type")
                )
            )
        # Expected entries get their full numeric check below, with the stable
        # ID in the diagnostic. Extra entries still need an independent finite
        # and positive-scale check even though the count already mismatches.
        if index >= len(expected.parts):
            for vector_name in ("position", "scale", "rotation-degrees"):
                vector = part.get(
                    vector_name, {} if vector_name == "rotation-degrees" else None
                )
                if vector_name == "rotation-degrees" and vector == {}:
                    vector = {"x": 0.0, "y": 0.0, "z": 0.0}
                if not isinstance(vector, Mapping):
                    errors.append(
                        "{}: {}.{} must be a mapping with finite x/y/z".format(
                            source_label, label, vector_name
                        )
                    )
                    continue
                for axis in ("x", "y", "z"):
                    number = actual_number(
                        vector.get(
                            axis,
                            0.0 if vector_name == "rotation-degrees" else None,
                        ),
                        "{}.{}.{}".format(label, vector_name, axis),
                        errors,
                        source_label,
                    )
                    if (
                        number is not None
                        and vector_name == "scale"
                        and number <= 0.0
                    ):
                        errors.append(
                            "{}: {}.scale.{} must be positive; got {}".format(
                                source_label, label, axis, number
                            )
                        )

    duplicate_ids = sorted(
        {part_id for part_id in actual_ids if actual_ids.count(part_id) > 1}
    )
    for part_id in duplicate_ids:
        errors.append(
            "{}: duplicate part ID {!r}; every part ID must be unique".format(
                source_label, part_id
            )
        )

    for index, (actual_part, expected_part) in enumerate(zip(parts, expected.parts)):
        if not isinstance(actual_part, Mapping):
            continue
        label = "parts[{}] ({})".format(index, expected_part.part_id)
        if actual_part.get("id") != expected_part.part_id:
            errors.append(
                "{}: {}.id expected {!r}, got {!r}; part order/ID drifted".format(
                    source_label,
                    label,
                    expected_part.part_id,
                    actual_part.get("id"),
                )
            )
        if actual_part.get("material") != expected_part.material:
            errors.append(
                "{}: {}.material expected {!r}, got {!r}".format(
                    source_label,
                    label,
                    expected_part.material,
                    actual_part.get("material"),
                )
            )
        compare_vector(
            actual_part.get("position"),
            expected_part.position,
            "{}.position".format(label),
            errors,
            source_label,
            tolerance,
        )
        compare_vector(
            actual_part.get("scale"),
            expected_part.scale,
            "{}.scale".format(label),
            errors,
            source_label,
            tolerance,
            positive=True,
        )
        rotation = actual_part.get(
            "rotation-degrees", {"x": 0.0, "y": 0.0, "z": 0.0}
        )
        compare_vector(
            rotation,
            expected_part.rotation,
            "{}.rotation-degrees".format(label),
            errors,
            source_label,
            tolerance,
        )
    return errors


def discover_model_documents(
    models_dir: Path,
) -> Tuple[Dict[str, Tuple[Path, Mapping[str, Any]]], List[str]]:
    documents: Dict[str, Tuple[Path, Mapping[str, Any]]] = {}
    errors: List[str] = []
    if not models_dir.is_dir():
        return documents, [
            "models directory does not exist: {}".format(display_path(models_dir))
        ]
    paths = sorted(
        list(models_dir.rglob("*.yml")) + list(models_dir.rglob("*.yaml")),
        key=lambda path: path.as_posix(),
    )
    if not paths:
        return documents, [
            "no .yml or .yaml files found under {}".format(display_path(models_dir))
        ]
    for path in paths:
        try:
            document = load_yaml_subset(path)
        except YamlSubsetError as error:
            errors.append(str(error))
            continue
        if not isinstance(document, Mapping):
            errors.append(
                "{}: top-level YAML value must be a mapping".format(display_path(path))
            )
            continue
        model_id = document.get("id")
        if not isinstance(model_id, str) or not model_id:
            errors.append(
                "{}: top-level id must be non-empty text".format(display_path(path))
            )
            continue
        if model_id in documents:
            errors.append(
                "duplicate model ID {!r}: {} and {}".format(
                    model_id,
                    display_path(documents[model_id][0]),
                    display_path(path),
                )
            )
            continue
        documents[model_id] = (path, document)
    return documents, errors


def validate_resources(
    models: Sequence[Model], models_dir: Path, tolerance: float
) -> int:
    documents, errors = discover_model_documents(models_dir)
    passes: List[str] = []
    for expected in models:
        found = documents.get(expected.model_id)
        if found is None:
            errors.append(
                "missing built-in model {!r} (expected {} ordered parts) under {}".format(
                    expected.model_id,
                    len(expected.parts),
                    display_path(models_dir),
                )
            )
            continue
        path, document = found
        model_errors = validate_model(document, expected, path, tolerance)
        if model_errors:
            errors.extend(model_errors)
        else:
            passes.append(
                "PASS {}: {} parts ({})".format(
                    expected.model_id, len(expected.parts), display_path(path)
                )
            )

    for message in passes:
        print(message)
    sys.stdout.flush()
    if errors:
        for message in errors:
            print("ERROR: {}".format(message), file=sys.stderr)
        print(
            "Legacy model audit FAILED: {} problem(s), {} of {} built-ins passed.".format(
                len(errors), len(passes), len(models)
            ),
            file=sys.stderr,
        )
        return 1
    print(
        "Legacy model audit passed: {} built-ins, {} ordered parts.".format(
            len(models), sum(len(model.parts) for model in models)
        )
    )
    return 0


def write_fixture(models: Sequence[Model], output: Path) -> None:
    if output.suffix.lower() != ".json":
        raise ValueError(
            "--write only emits a JSON audit fixture; output must end in .json"
        )
    payload = {
        "audit-fixture-version": 1,
        "legacy-sources": [
            "src/main/java/ru/customvehicles/VehicleModel.java",
            "src/main/java/ru/customvehicles/TrainUnitModel.java",
        ],
        "models": [model.as_mapping() for model in models],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        "Wrote JSON audit fixture: {} ({} models, {} parts)".format(
            display_path(output),
            len(models),
            sum(len(model.parts) for model in models),
        )
    )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    parser = argparse.ArgumentParser(
        description=(
            "Audit schema-v1 YAML models against the six legacy Java geometries."
        )
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=project_dir / "src" / "main" / "resources" / "models",
        help="model YAML directory (default: project src/main/resources/models)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1.0e-5,
        help="absolute numeric comparison tolerance (default: 1e-5)",
    )
    parser.add_argument(
        "--write",
        nargs="?",
        const=script_dir / "legacy-models.audit.json",
        type=Path,
        metavar="JSON_PATH",
        help=(
            "also write the canonical JSON fixture; with no path, writes "
            "tools/legacy-models.audit.json"
        ),
    )
    parser.add_argument(
        "--no-validate",
        action="store_true",
        help="build/write the fixture without looking for YAML resources",
    )
    args = parser.parse_args(argv)
    if not math.isfinite(args.tolerance) or args.tolerance < 0.0:
        parser.error("--tolerance must be a finite non-negative number")
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    models = expected_models()
    if args.write is not None:
        try:
            write_fixture(models, args.write)
        except (OSError, UnicodeError, ValueError) as error:
            print("ERROR: cannot write audit fixture: {}".format(error), file=sys.stderr)
            return 1
    if args.no_validate:
        print(
            "Fixture self-check passed: counts {}.".format(
                tuple(len(model.parts) for model in models)
            )
        )
        return 0
    return validate_resources(models, args.models_dir, args.tolerance)


if __name__ == "__main__":
    sys.exit(main())
