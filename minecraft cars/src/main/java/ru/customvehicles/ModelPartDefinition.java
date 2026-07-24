package ru.customvehicles;

import org.bukkit.Material;

import java.util.Objects;

record ModelPartDefinition(
        String id,
        Type type,
        Material material,
        ModelVector position,
        ModelVector scale,
        ModelVector rotationDegrees
) {
    ModelPartDefinition {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(material, "material");
        Objects.requireNonNull(position, "position");
        Objects.requireNonNull(scale, "scale");
        Objects.requireNonNull(rotationDegrees, "rotationDegrees");
    }

    enum Type {
        BLOCK
    }
}
