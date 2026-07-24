package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;

import java.util.Collection;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

final class VehicleManager {
    private static final int AUTOSAVE_INTERVAL_TICKS = 200;

    private final CustomVehiclesPlugin plugin;
    private final VehicleStorage storage;
    private final Map<UUID, CustomVehicle> vehicles = new HashMap<>();
    private final Map<UUID, RailTrain> trains = new HashMap<>();
    private final List<VehicleSnapshot> deferredSnapshots = new ArrayList<>();
    private VehicleSettings vehicleSettings;
    private TrainSettings trainSettings;
    private AutopilotManager autopilotManager;
    private int autosaveTicks;

    VehicleManager(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
        this.storage = new VehicleStorage(plugin);
        reloadSettings();
    }

    void reloadSettings() {
        vehicleSettings = VehicleSettings.from(plugin.getConfig().getConfigurationSection("vehicle"));
        trainSettings = TrainSettings.from(plugin.getConfig().getConfigurationSection("train"));
    }

    void setAutopilotManager(AutopilotManager autopilotManager) {
        this.autopilotManager = autopilotManager;
    }

    CustomVehicle spawn(Location location, UUID owner) {
        return spawn(
                location,
                owner,
                plugin.variantRegistry().require(BuiltInDefinitions.CAR_VARIANT)
        );
    }

    CustomVehicle spawn(
            Location location,
            UUID owner,
            VehicleVariantDefinition variant
    ) {
        CustomVehicle vehicle = new CustomVehicle(
                plugin,
                location,
                owner,
                vehicleSettings,
                variant
        );
        vehicles.put(vehicle.id(), vehicle);
        saveNow();
        return vehicle;
    }

    RailTrain spawnTrain(Location location, UUID owner) {
        return spawnTrain(
                location,
                owner,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAIN_VARIANT)
        );
    }

    RailTrain spawnTrain(
            Location location,
            UUID owner,
            VehicleVariantDefinition variant
    ) {
        RailTrain train = RailTrain.create(
                plugin,
                location,
                owner,
                trainSettings,
                variant
        );
        if (train != null) {
            trains.put(train.id(), train);
            saveNow();
        }
        return train;
    }

    RailTrain spawnTram(Location location, UUID owner) {
        return spawnTram(
                location,
                owner,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAM_VARIANT)
        );
    }

    RailTrain spawnTram(
            Location location,
            UUID owner,
            VehicleVariantDefinition variant
    ) {
        RailTrain tram = RailTrain.createTram(
                plugin,
                location,
                owner,
                trainSettings,
                variant
        );
        if (tram != null) {
            trains.put(tram.id(), tram);
            saveNow();
        }
        return tram;
    }

    RailTrain.AttachResult attachWagon(RailTrain train) {
        return attachWagon(
                train,
                plugin.variantRegistry().require(BuiltInDefinitions.WAGON_VARIANT)
        );
    }

    RailTrain.AttachResult attachWagon(
            RailTrain train,
            VehicleVariantDefinition wagonVariant
    ) {
        RailTrain.AttachResult result = train.attachWagon(trainSettings, wagonVariant);
        if (result == RailTrain.AttachResult.ATTACHED) {
            saveNow();
        }
        return result;
    }

    VehicleVariantDefinition detachLastWagon(RailTrain train) {
        VehicleVariantDefinition detachedVariant = train.detachLastWagon(trainSettings);
        if (detachedVariant != null) {
            saveNow();
        }
        return detachedVariant;
    }

    void restoreSaved() {
        Optional<List<VehicleSnapshot>> loaded = storage.load();
        if (loaded.isEmpty()) {
            return;
        }
        deferredSnapshots.clear();
        int restored = 0;
        for (VehicleSnapshot snapshot : loaded.get()) {
            VehicleVariantDefinition variant = resolveStoredVariant(
                    snapshot.variantId(),
                    snapshot.kind().behavior(),
                    "saved vehicle " + snapshot.id()
            );
            if (variant == null) {
                deferredSnapshots.add(snapshot);
                continue;
            }
            List<VehicleVariantDefinition> wagonVariants = new ArrayList<>();
            boolean missingWagonVariant = false;
            for (String wagonVariantId : snapshot.wagonVariantIds()) {
                VehicleVariantDefinition wagonVariant = resolveStoredVariant(
                        wagonVariantId,
                        VehicleBehavior.WAGON,
                        "wagon on saved train " + snapshot.id()
                );
                if (wagonVariant == null) {
                    missingWagonVariant = true;
                    break;
                }
                wagonVariants.add(wagonVariant);
            }
            if (missingWagonVariant) {
                deferredSnapshots.add(snapshot);
                continue;
            }
            World world = plugin.getServer().getWorld(snapshot.worldId());
            if (world == null) {
                world = plugin.getServer().getWorld(snapshot.worldName());
            }
            if (world == null) {
                plugin.getLogger().warning(
                        "Could not restore vehicle " + snapshot.id()
                                + ": world " + snapshot.worldName() + " is unavailable."
                );
                deferredSnapshots.add(snapshot);
                continue;
            }
            Location location = new Location(
                    world,
                    snapshot.x(),
                    snapshot.y(),
                    snapshot.z(),
                    snapshot.yaw(),
                    0.0F
            );
            if (snapshot.kind() == VehicleKind.CAR) {
                CustomVehicle vehicle = new CustomVehicle(
                        plugin,
                        snapshot.id(),
                        location,
                        snapshot.owner(),
                        vehicleSettings,
                        variant
                );
                vehicles.put(vehicle.id(), vehicle);
                restored++;
                continue;
            }
            RailTrain train = snapshot.kind() == VehicleKind.TRAM
                    ? RailTrain.createTram(
                    plugin,
                    snapshot.id(),
                    location,
                    snapshot.owner(),
                    trainSettings,
                    variant
            )
                    : RailTrain.create(
                    plugin,
                    snapshot.id(),
                    location,
                    snapshot.owner(),
                    trainSettings,
                    variant
            );
            if (train == null) {
                plugin.getLogger().warning(
                        "Could not restore train " + snapshot.id() + ": no rail at saved position."
                );
                deferredSnapshots.add(snapshot);
                continue;
            }
            boolean completelyRestored = true;
            for (VehicleVariantDefinition wagonVariant : wagonVariants) {
                if (train.restoreWagon(trainSettings, wagonVariant)
                        != RailTrain.AttachResult.ATTACHED) {
                    plugin.getLogger().warning(
                            "Restored train " + snapshot.id() + " with "
                                    + train.wagonCount() + " of " + snapshot.wagonCount()
                                    + " saved wagons because the remaining track is unavailable."
                    );
                    completelyRestored = false;
                    break;
                }
            }
            if (!completelyRestored) {
                train.remove();
                deferredSnapshots.add(snapshot);
                continue;
            }
            trains.put(train.id(), train);
            restored++;
        }
        plugin.getLogger().info("Restored " + restored + " saved vehicles.");
    }

    private VehicleVariantDefinition resolveStoredVariant(
            String requestedId,
            VehicleBehavior expectedBehavior,
            String context
    ) {
        VehicleVariantDefinition requested = plugin.variantRegistry()
                .find(requestedId)
                .orElse(null);
        if (requested != null && requested.behavior() == expectedBehavior) {
            return requested;
        }
        plugin.getLogger().warning(
                "Could not use variant " + requestedId + " for " + context
                        + "; the original saved record is being retained until "
                        + "that definition is available again."
        );
        return null;
    }

    ManagedVehicle fromEntity(Entity entity) {
        String rawId = entity.getPersistentDataContainer()
                .get(plugin.vehicleKey(), PersistentDataType.STRING);
        if (rawId == null) {
            return null;
        }
        try {
            UUID id = UUID.fromString(rawId);
            ManagedVehicle vehicle = vehicles.get(id);
            return vehicle != null ? vehicle : trains.get(id);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    ManagedVehicle drivenBy(Player player) {
        ManagedVehicle vehicle = vehicles.values().stream()
                .filter(candidate -> candidate.hasDriver(player))
                .findFirst()
                .orElse(null);
        if (vehicle != null) {
            return vehicle;
        }
        return trains.values().stream()
                .filter(train -> train.hasDriver(player))
                .findFirst()
                .orElse(null);
    }

    ManagedVehicle byId(UUID id) {
        ManagedVehicle vehicle = vehicles.get(id);
        return vehicle != null ? vehicle : trains.get(id);
    }

    void tick(Map<UUID, VehicleInput> inputs) {
        if (autopilotManager != null) {
            autopilotManager.beginTick();
        }
        boolean removedInvalid = false;
        Iterator<CustomVehicle> iterator = vehicles.values().iterator();
        while (iterator.hasNext()) {
            CustomVehicle vehicle = iterator.next();
            if (!vehicle.seat().isValid()) {
                retainInvalidSnapshot(vehicle);
                vehicle.remove();
                iterator.remove();
                removedInvalid = true;
            }
        }
        for (CustomVehicle vehicle : vehicles.values()) {
            Player driver = vehicle.driver();
            VehicleInput input = driver == null
                    ? VehicleInput.IDLE
                    : inputs.getOrDefault(driver.getUniqueId(), VehicleInput.IDLE);
            vehicle.tick(input, vehicleSettings);
        }

        Iterator<RailTrain> trainIterator = trains.values().iterator();
        while (trainIterator.hasNext()) {
            RailTrain train = trainIterator.next();
            if (!train.seat().isValid()) {
                retainInvalidSnapshot(train);
                train.remove();
                trainIterator.remove();
                removedInvalid = true;
            }
        }
        for (RailTrain train : trains.values()) {
            Player driver = train.driver();
            VehicleInput manualInput = driver == null
                    ? VehicleInput.IDLE
                    : inputs.getOrDefault(driver.getUniqueId(), VehicleInput.IDLE);
            VehicleInput input = autopilotManager == null
                    ? manualInput
                    : autopilotManager.inputFor(train, manualInput);
            train.tick(input, trainSettings);
            if (autopilotManager != null) {
                autopilotManager.afterTick(train);
            }
        }
        autosaveTicks++;
        if (removedInvalid || autosaveTicks >= AUTOSAVE_INTERVAL_TICKS) {
            saveNow();
        }
    }

    boolean remove(ManagedVehicle vehicle) {
        if (vehicle == null) {
            return false;
        }
        boolean removed = switch (vehicle.kind()) {
            case CAR -> vehicles.remove(vehicle.id()) != null;
            case TRAIN, TRAM -> trains.remove(vehicle.id()) != null;
            case WAGON -> false;
        };
        if (!removed) {
            return false;
        }
        if (autopilotManager != null) {
            autopilotManager.remove(vehicle.id());
        }
        vehicle.remove();
        saveNow();
        return true;
    }

    Collection<ManagedVehicle> all() {
        Collection<ManagedVehicle> all = new ArrayList<>(vehicles.values());
        all.addAll(trains.values());
        return all;
    }

    String debug(Player player, Map<UUID, VehicleInput> inputs) {
        ManagedVehicle vehicle = drivenBy(player);
        if (vehicle == null) {
            return "§eИгрок не является пассажиром активной машины. Всего машин: " + vehicles.size();
        }
        VehicleInput input = inputs.getOrDefault(player.getUniqueId(), VehicleInput.IDLE);
        return String.format(
                java.util.Locale.ROOT,
                "§e%s %s: input(side=%.2f, forward=%.2f), speed=%.3f, yaw=%.1f",
                switch (vehicle.kind()) {
                    case TRAIN -> "Состав";
                    case TRAM -> "Трамвай";
                    default -> "Машина";
                },
                vehicle.id(),
                input.sideways(),
                input.forward(),
                vehicle.speed(),
                vehicle.yaw()
        );
    }

    void shutdown() {
        saveNow();
        vehicles.values().forEach(CustomVehicle::remove);
        trains.values().forEach(RailTrain::remove);
        vehicles.clear();
        trains.clear();
    }

    void saveNow() {
        autosaveTicks = 0;
        List<VehicleSnapshot> snapshots = all().stream()
                .map(ManagedVehicle::snapshot)
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        snapshots.addAll(deferredSnapshots);
        storage.save(snapshots);
    }

    private void retainInvalidSnapshot(ManagedVehicle vehicle) {
        deferredSnapshots.removeIf(snapshot -> snapshot.id().equals(vehicle.id()));
        deferredSnapshots.add(vehicle.snapshot());
        plugin.getLogger().warning(
                "Vehicle " + vehicle.id()
                        + " lost its runtime seat. Its saved record was retained for recovery."
        );
    }
}
