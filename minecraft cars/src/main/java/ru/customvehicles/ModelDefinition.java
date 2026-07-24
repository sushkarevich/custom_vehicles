package ru.customvehicles;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

record ModelDefinition(
        int schemaVersion,
        String id,
        String displayName,
        ForwardDirection forwardDirection,
        Optional<Interaction> interaction,
        DisplaySettings display,
        List<ModelPartDefinition> parts
) {
    ModelDefinition {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(displayName, "displayName");
        Objects.requireNonNull(forwardDirection, "forwardDirection");
        interaction = interaction == null ? Optional.empty() : interaction;
        Objects.requireNonNull(display, "display");
        parts = List.copyOf(parts);
    }

    enum ForwardDirection {
        POSITIVE_Z("positive-z"),
        NEGATIVE_Z("negative-z");

        private final String id;

        ForwardDirection(String id) {
            this.id = id;
        }

        String id() {
            return id;
        }

        static ForwardDirection from(String raw) {
            for (ForwardDirection direction : values()) {
                if (direction.id.equalsIgnoreCase(raw)) {
                    return direction;
                }
            }
            return null;
        }
    }

    record Interaction(ModelVector offset, float width, float height) {
        Interaction {
            Objects.requireNonNull(offset, "offset");
        }
    }

    record DisplaySettings(int interpolationDuration, int teleportDuration) {
    }
}
