package ru.customvehicles;

import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

record VehicleSnapshot(
        UUID id,
        VehicleKind kind,
        UUID owner,
        UUID worldId,
        String worldName,
        double x,
        double y,
        double z,
        float yaw,
        String variantId,
        List<String> wagonVariantIds
) {
    VehicleSnapshot {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(owner, "owner");
        Objects.requireNonNull(worldId, "worldId");
        Objects.requireNonNull(worldName, "worldName");
        Objects.requireNonNull(variantId, "variantId");
        Objects.requireNonNull(wagonVariantIds, "wagonVariantIds");
        if (worldName.isBlank()) {
            throw new IllegalArgumentException("worldName must not be blank");
        }
        if (!DefinitionParsing.ID_PATTERN.matcher(variantId).matches()) {
            throw new IllegalArgumentException("invalid variantId");
        }
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || !Float.isFinite(yaw)) {
            throw new IllegalArgumentException("vehicle coordinates must be finite");
        }
        wagonVariantIds = kind == VehicleKind.TRAIN
                ? List.copyOf(wagonVariantIds)
                : List.of();
        for (String wagonVariantId : wagonVariantIds) {
            if (wagonVariantId == null
                    || !DefinitionParsing.ID_PATTERN.matcher(wagonVariantId).matches()) {
                throw new IllegalArgumentException("invalid wagon variant ID");
            }
        }
    }

    VehicleSnapshot(
            UUID id,
            VehicleKind kind,
            UUID owner,
            UUID worldId,
            String worldName,
            double x,
            double y,
            double z,
            float yaw,
            int wagonCount
    ) {
        this(
                id,
                kind,
                owner,
                worldId,
                worldName,
                x,
                y,
                z,
                yaw,
                kind.defaultVariantId(),
                kind == VehicleKind.TRAIN
                        ? Collections.nCopies(
                                Math.max(0, wagonCount),
                                BuiltInDefinitions.WAGON_VARIANT
                        )
                        : List.of()
        );
    }

    int wagonCount() {
        return wagonVariantIds.size();
    }
}
