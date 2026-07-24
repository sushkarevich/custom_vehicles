package ru.customvehicles;

import org.bukkit.block.data.Rail;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Level;

final class RouteStorage {
    private static final int SCHEMA_VERSION = 1;

    private final CustomVehiclesPlugin plugin;
    private final File file;

    RouteStorage(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "routes.yml");
    }

    Optional<List<RailRoute>> load() {
        if (!file.exists()) {
            return Optional.of(List.of());
        }
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.load(file);
            ConfigurationSection root = yaml.getConfigurationSection("routes");
            if (root == null) {
                return Optional.of(List.of());
            }
            List<RailRoute> routes = new ArrayList<>();
            for (String id : root.getKeys(false)) {
                try {
                    routes.add(read(id.toLowerCase(java.util.Locale.ROOT), root.getConfigurationSection(id)));
                } catch (IllegalArgumentException exception) {
                    plugin.getLogger().warning("Skipping invalid route " + id + ": " + exception.getMessage());
                }
            }
            return Optional.of(List.copyOf(routes));
        } catch (IOException | InvalidConfigurationException | RuntimeException exception) {
            plugin.getLogger().log(Level.SEVERE, "Could not read routes.yml.", exception);
            return Optional.empty();
        }
    }

    void save(List<RailRoute> routes) {
        plugin.getDataFolder().mkdirs();
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("schema-version", SCHEMA_VERSION);
        routes.stream()
                .sorted(Comparator.comparing(RailRoute::id))
                .forEach(route -> write(yaml, route));
        File temporary = new File(plugin.getDataFolder(), "routes.yml.tmp");
        try {
            yaml.save(temporary);
            move(temporary, file);
        } catch (IOException exception) {
            plugin.getLogger().log(Level.SEVERE, "Could not save routes.yml.", exception);
        } finally {
            if (temporary.exists() && !temporary.delete()) {
                temporary.deleteOnExit();
            }
        }
    }

    private RailRoute read(String id, ConfigurationSection section) {
        if (section == null) {
            throw new IllegalArgumentException("missing route section");
        }
        List<RouteStop> stops = new ArrayList<>();
        for (java.util.Map<?, ?> raw : section.getMapList("stops")) {
            stops.add(new RouteStop(
                    text(raw, "name"),
                    UUID.fromString(text(raw, "world-uuid")),
                    text(raw, "world"),
                    number(raw, "x"),
                    number(raw, "y"),
                    number(raw, "z"),
                    (int) number(raw, "dwell-ticks")
            ));
        }
        List<RouteSwitch> switches = new ArrayList<>();
        for (java.util.Map<?, ?> raw : section.getMapList("switches")) {
            switches.add(new RouteSwitch(
                    UUID.fromString(text(raw, "world-uuid")),
                    text(raw, "world"),
                    (int) number(raw, "x"),
                    (int) number(raw, "y"),
                    (int) number(raw, "z"),
                    (int) number(raw, "target-stop"),
                    Rail.Shape.valueOf(text(raw, "shape").toUpperCase(java.util.Locale.ROOT))
            ));
        }
        return new RailRoute(id, stops, switches);
    }

    private void write(YamlConfiguration yaml, RailRoute route) {
        String path = "routes." + route.id();
        List<java.util.Map<String, Object>> stops = new ArrayList<>();
        for (RouteStop stop : route.stops()) {
            java.util.Map<String, Object> value = new java.util.LinkedHashMap<>();
            value.put("name", stop.name());
            value.put("world-uuid", stop.worldId().toString());
            value.put("world", stop.worldName());
            value.put("x", stop.x());
            value.put("y", stop.y());
            value.put("z", stop.z());
            value.put("dwell-ticks", stop.dwellTicks());
            stops.add(value);
        }
        List<java.util.Map<String, Object>> switches = new ArrayList<>();
        for (RouteSwitch routeSwitch : route.switches()) {
            java.util.Map<String, Object> value = new java.util.LinkedHashMap<>();
            value.put("world-uuid", routeSwitch.worldId().toString());
            value.put("world", routeSwitch.worldName());
            value.put("x", routeSwitch.x());
            value.put("y", routeSwitch.y());
            value.put("z", routeSwitch.z());
            value.put("target-stop", routeSwitch.targetStopIndex());
            value.put("shape", routeSwitch.shape().name());
            switches.add(value);
        }
        yaml.set(path + ".stops", stops);
        yaml.set(path + ".switches", switches);
    }

    private String text(java.util.Map<?, ?> map, String key) {
        Object value = map.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("missing " + key);
        }
        return text;
    }

    private double number(java.util.Map<?, ?> map, String key) {
        Object value = map.get(key);
        if (!(value instanceof Number number) || !Double.isFinite(number.doubleValue())) {
            throw new IllegalArgumentException("missing or invalid " + key);
        }
        return number.doubleValue();
    }

    private void move(File source, File target) throws IOException {
        try {
            Files.move(
                    source.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
            );
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
