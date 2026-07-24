package ru.customvehicles;

import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.UUID;

interface ManagedVehicle {
    UUID id();

    UUID owner();

    Entity seat();

    boolean hasDriver(Player player);

    Player driver();

    void mount(Player player);

    void remove();

    double speed();

    float yaw();

    VehicleKind kind();

    VehicleVariantDefinition variantDefinition();

    default String variantId() {
        return variantDefinition().id();
    }

    default List<VehicleVariantDefinition> wagonVariantDefinitions() {
        return List.of();
    }

    default List<String> wagonVariantIds() {
        return wagonVariantDefinitions().stream()
                .map(VehicleVariantDefinition::id)
                .toList();
    }

    VehicleSnapshot snapshot();

    default int wagonCount() {
        return 0;
    }
}
