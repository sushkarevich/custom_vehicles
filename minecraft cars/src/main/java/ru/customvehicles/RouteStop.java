package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.World;

import java.util.Objects;
import java.util.UUID;

record RouteStop(
        String name,
        UUID worldId,
        String worldName,
        double x,
        double y,
        double z,
        int dwellTicks
) {
    RouteStop {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(worldId, "worldId");
        Objects.requireNonNull(worldName, "worldName");
        if (name.isBlank() || worldName.isBlank()) {
            throw new IllegalArgumentException("stop name and world must not be blank");
        }
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
            throw new IllegalArgumentException("stop coordinates must be finite");
        }
        dwellTicks = Math.max(0, dwellTicks);
    }

    Location location(World world) {
        return new Location(world, x, y, z);
    }
}
