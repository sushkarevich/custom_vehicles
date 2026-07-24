package ru.customvehicles;

import org.bukkit.block.data.Rail;

import java.util.Objects;
import java.util.UUID;

record RouteSwitch(
        UUID worldId,
        String worldName,
        int x,
        int y,
        int z,
        int targetStopIndex,
        Rail.Shape shape
) {
    RouteSwitch {
        Objects.requireNonNull(worldId, "worldId");
        Objects.requireNonNull(worldName, "worldName");
        Objects.requireNonNull(shape, "shape");
        if (worldName.isBlank()) {
            throw new IllegalArgumentException("switch world must not be blank");
        }
        targetStopIndex = Math.max(0, targetStopIndex);
    }
}
