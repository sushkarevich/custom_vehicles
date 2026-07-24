package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Level;

final class VehicleStorage {
    private static final int SCHEMA_VERSION = 2;

    private final CustomVehiclesPlugin plugin;
    private final File file;

    VehicleStorage(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "vehicles.yml");
    }

    Optional<List<VehicleSnapshot>> load() {
        if (!file.exists()) {
            return Optional.of(List.of());
        }
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.load(file);
            int schemaVersion = yaml.getInt("schema-version", 1);
            if (schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) {
                throw new InvalidConfigurationException(
                        "Unsupported vehicles.yml schema-version: " + schemaVersion
                );
            }
            ConfigurationSection root = yaml.getConfigurationSection("vehicles");
            if (root == null) {
                return Optional.of(List.of());
            }
            List<VehicleSnapshot> snapshots = new ArrayList<>();
            for (String rawId : root.getKeys(false)) {
                ConfigurationSection section = root.getConfigurationSection(rawId);
                try {
                    VehicleSnapshot snapshot = read(rawId, section);
                    if (snapshot != null) {
                        snapshots.add(snapshot);
                    }
                } catch (IllegalArgumentException exception) {
                    plugin.getLogger().warning(
                            "Skipping invalid saved vehicle " + rawId + ": " + exception.getMessage()
                    );
                }
            }
            return Optional.of(List.copyOf(snapshots));
        } catch (IOException | InvalidConfigurationException | RuntimeException exception) {
            plugin.getLogger().log(
                    Level.SEVERE,
                    "Could not read vehicles.yml. The file was left untouched.",
                    exception
            );
            return Optional.empty();
        }
    }

    void save(Collection<VehicleSnapshot> snapshots) {
        plugin.getDataFolder().mkdirs();
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("schema-version", SCHEMA_VERSION);
        snapshots.stream()
                .sorted(Comparator.comparing(snapshot -> snapshot.id().toString()))
                .forEach(snapshot -> write(yaml, snapshot));

        File temporary = new File(plugin.getDataFolder(), "vehicles.yml.tmp");
        try {
            yaml.save(temporary);
            try {
                Files.move(
                        temporary.toPath(),
                        file.toPath(),
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(
                        temporary.toPath(),
                        file.toPath(),
                        StandardCopyOption.REPLACE_EXISTING
                );
            }
        } catch (IOException exception) {
            plugin.getLogger().log(Level.SEVERE, "Could not save vehicles.yml.", exception);
        } finally {
            if (temporary.exists() && !temporary.delete()) {
                temporary.deleteOnExit();
            }
        }
    }

    static VehicleSnapshot read(String rawId, ConfigurationSection section) {
        if (section == null) {
            throw new IllegalArgumentException("missing section");
        }
        UUID id = UUID.fromString(rawId);
        UUID owner = UUID.fromString(required(section, "owner"));
        UUID worldId = UUID.fromString(required(section, "world-uuid"));
        String worldName = required(section, "world");
        String rawKind = required(section, "kind");
        VehicleKind kind = VehicleKind.from(rawKind);
        if (kind == VehicleKind.WAGON || !kind.id().equalsIgnoreCase(rawKind)) {
            throw new IllegalArgumentException("unknown vehicle kind " + rawKind);
        }
        String variantId = section.getString("variant");
        if (variantId == null || variantId.isBlank()) {
            variantId = kind.defaultVariantId();
        }
        if (!DefinitionParsing.ID_PATTERN.matcher(variantId).matches()) {
            throw new IllegalArgumentException("invalid variant " + variantId);
        }
        List<String> wagonVariantIds = kind == VehicleKind.TRAIN
                ? readWagonVariants(section)
                : List.of();
        return new VehicleSnapshot(
                id,
                kind,
                owner,
                worldId,
                worldName,
                requiredNumber(section, "x"),
                requiredNumber(section, "y"),
                requiredNumber(section, "z"),
                (float) requiredNumber(section, "yaw"),
                variantId,
                wagonVariantIds
        );
    }

    static void write(YamlConfiguration yaml, VehicleSnapshot snapshot) {
        String path = "vehicles." + snapshot.id();
        yaml.set(path + ".kind", snapshot.kind().id());
        yaml.set(path + ".variant", snapshot.variantId());
        yaml.set(path + ".owner", snapshot.owner().toString());
        yaml.set(path + ".world", snapshot.worldName());
        yaml.set(path + ".world-uuid", snapshot.worldId().toString());
        yaml.set(path + ".x", snapshot.x());
        yaml.set(path + ".y", snapshot.y());
        yaml.set(path + ".z", snapshot.z());
        yaml.set(path + ".yaw", snapshot.yaw());
        if (snapshot.kind() == VehicleKind.TRAIN) {
            yaml.set(path + ".wagons", snapshot.wagonCount());
            yaml.set(path + ".wagon-variants", snapshot.wagonVariantIds());
        }
    }

    private static List<String> readWagonVariants(ConfigurationSection section) {
        Object raw = section.get("wagon-variants");
        if (raw == null) {
            int legacyCount = Math.max(
                    0,
                    section.isInt("wagons")
                            ? section.getInt("wagons")
                            : section.getInt("count", 0)
            );
            return java.util.Collections.nCopies(
                    legacyCount,
                    BuiltInDefinitions.WAGON_VARIANT
            );
        }
        if (!(raw instanceof List<?> entries)) {
            throw new IllegalArgumentException("invalid wagon-variants");
        }
        List<String> result = new ArrayList<>(entries.size());
        for (int index = 0; index < entries.size(); index++) {
            Object entry = entries.get(index);
            if (!(entry instanceof String id)
                    || !DefinitionParsing.ID_PATTERN.matcher(id).matches()) {
                throw new IllegalArgumentException(
                        "invalid wagon-variants entry at index " + index
                );
            }
            result.add(id);
        }
        return List.copyOf(result);
    }

    private static String required(ConfigurationSection section, String path) {
        String value = section.getString(path);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("missing " + path);
        }
        return value;
    }

    private static double requiredNumber(ConfigurationSection section, String path) {
        Object raw = section.get(path);
        if (!(raw instanceof Number number)) {
            throw new IllegalArgumentException("missing or invalid " + path);
        }
        double value = number.doubleValue();
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("non-finite " + path);
        }
        return value;
    }
}
