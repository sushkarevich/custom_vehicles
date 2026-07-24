package ru.customvehicles;

import org.bukkit.Material;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;

record VehicleVariantDefinition(
        int schemaVersion,
        String id,
        String displayName,
        VehicleBehavior behavior,
        Map<String, String> models,
        Item item,
        List<String> menuDescription,
        String permission
) {
    VehicleVariantDefinition {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(displayName, "displayName");
        Objects.requireNonNull(behavior, "behavior");
        models = Collections.unmodifiableMap(new TreeMap<>(models));
        Objects.requireNonNull(item, "item");
        menuDescription = List.copyOf(menuDescription);
        permission = permission == null || permission.isBlank() ? null : permission;
    }

    String model(String role) {
        return models.get(role);
    }

    Optional<String> permissionValue() {
        return Optional.ofNullable(permission);
    }

    record Item(
            Material material,
            String name,
            List<String> lore,
            Integer customModelData
    ) {
        Item {
            Objects.requireNonNull(material, "material");
            Objects.requireNonNull(name, "name");
            lore = List.copyOf(lore);
        }
    }
}
