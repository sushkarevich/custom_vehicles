package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Interaction;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.util.Transformation;
import org.bukkit.util.Vector;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

final class ModelInstance {
    private final CustomVehiclesPlugin plugin;
    private final String vehicleId;
    private final ModelDefinition definition;
    private final List<PartEntity> parts = new ArrayList<>();
    private Interaction interaction;

    ModelInstance(
            CustomVehiclesPlugin plugin,
            String vehicleId,
            ModelDefinition definition
    ) {
        this.plugin = Objects.requireNonNull(plugin, "plugin");
        this.vehicleId = Objects.requireNonNull(vehicleId, "vehicleId");
        this.definition = Objects.requireNonNull(definition, "definition");
    }

    void spawn(Location center, float yaw) {
        ensureNotSpawned();
        try {
            spawnEntities(center);
            update(center, yaw);
        } catch (RuntimeException | Error exception) {
            remove();
            throw exception;
        }
    }

    void spawn(RailPose pose) {
        ensureNotSpawned();
        try {
            spawnEntities(pose.location());
            update(pose);
        } catch (RuntimeException | Error exception) {
            remove();
            throw exception;
        }
    }

    void update(Location center, float yaw) {
        update(
                center,
                VehicleMath.directionX(yaw),
                0.0,
                VehicleMath.directionZ(yaw)
        );
    }

    void update(RailPose pose) {
        Vector forward = pose.forward();
        update(
                pose.location(),
                forward.getX(),
                forward.getY(),
                forward.getZ()
        );
    }

    Interaction interaction() {
        return interaction;
    }

    boolean ownsInteraction(Entity entity) {
        return interaction != null
                && interaction.isValid()
                && interaction.getUniqueId().equals(entity.getUniqueId());
    }

    ModelDefinition definition() {
        return definition;
    }

    void remove() {
        if (interaction != null) {
            interaction.remove();
            interaction = null;
        }
        parts.stream().map(PartEntity::display).forEach(Entity::remove);
        parts.clear();
    }

    private void spawnEntities(Location origin) {
        World world = Objects.requireNonNull(origin.getWorld(), "Model world");
        definition.interaction().ifPresent(interactionDefinition -> {
            interaction = world.spawn(origin, Interaction.class);
            interaction.setInteractionWidth(interactionDefinition.width());
            interaction.setInteractionHeight(interactionDefinition.height());
            interaction.setResponsive(true);
            interaction.setPersistent(true);
            tag(interaction);
        });
        for (ModelPartDefinition part : definition.parts()) {
            BlockDisplay display = world.spawn(origin, BlockDisplay.class);
            parts.add(new PartEntity(display, part));
            display.setBlock(part.material().createBlockData());
            display.setBillboard(Display.Billboard.FIXED);
            display.setInterpolationDuration(definition.display().interpolationDuration());
            display.setTeleportDuration(definition.display().teleportDuration());
            display.setPersistent(true);
            tag(display);

            Quaternionf localRotation = ModelTransforms.localRotation(
                    definition.forwardDirection(),
                    part.rotationDegrees()
            );
            Transformation transformation = display.getTransformation();
            transformation.getTranslation().set(
                    ModelTransforms.centeredTranslation(part.scale(), localRotation)
            );
            transformation.getLeftRotation().set(localRotation);
            transformation.getScale().set(
                    (float) part.scale().x(),
                    (float) part.scale().y(),
                    (float) part.scale().z()
            );
            transformation.getRightRotation().identity();
            display.setTransformation(transformation);
        }
    }

    private void ensureNotSpawned() {
        if (interaction != null || !parts.isEmpty()) {
            throw new IllegalStateException("Model instance has already been spawned");
        }
    }

    private void update(
            Location origin,
            double forwardX,
            double forwardY,
            double forwardZ
    ) {
        Quaternionf orientation = ModelTransforms.orientation(
                forwardX,
                forwardY,
                forwardZ,
                definition.forwardDirection()
        );
        double directionLength = Math.sqrt(
                forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ
        );
        double normalizedX = forwardX / directionLength;
        double normalizedY = forwardY / directionLength;
        double normalizedZ = forwardZ / directionLength;
        float yaw = (float) Math.toDegrees(Math.atan2(-normalizedX, normalizedZ));
        float pitch = (float) -Math.toDegrees(Math.asin(
                Math.max(-1.0, Math.min(1.0, normalizedY))
        ));
        if (interaction != null && interaction.isValid()) {
            ModelDefinition.Interaction interactionDefinition = definition.interaction()
                    .orElseThrow();
            Vector3f offset = ModelTransforms.worldOffset(
                    orientation,
                    interactionDefinition.offset()
            );
            Location location = origin.clone().add(offset.x, offset.y, offset.z);
            location.setYaw(yaw);
            location.setPitch(pitch);
            interaction.teleport(location);
        }
        for (PartEntity partEntity : parts) {
            BlockDisplay display = partEntity.display();
            if (!display.isValid()) {
                continue;
            }
            ModelPartDefinition part = partEntity.definition();
            Vector3f offset = ModelTransforms.worldOffset(orientation, part.position());
            Location location = origin.clone().add(offset.x, offset.y, offset.z);
            location.setYaw(yaw);
            location.setPitch(pitch);
            display.teleport(location);
        }
    }

    private void tag(Entity entity) {
        entity.getPersistentDataContainer()
                .set(plugin.vehicleKey(), PersistentDataType.STRING, vehicleId);
    }

    private record PartEntity(
            BlockDisplay display,
            ModelPartDefinition definition
    ) {
    }
}
