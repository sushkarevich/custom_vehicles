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
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Level;

final class AutopilotStorage {
    private final CustomVehiclesPlugin plugin;
    private final File file;

    AutopilotStorage(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "autopilot.yml");
    }

    Optional<List<AutopilotSavedState>> load() {
        if (!file.exists()) {
            return Optional.of(List.of());
        }
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.load(file);
            ConfigurationSection root = yaml.getConfigurationSection("vehicles");
            if (root == null) {
                return Optional.of(List.of());
            }
            List<AutopilotSavedState> states = new ArrayList<>();
            for (String rawId : root.getKeys(false)) {
                ConfigurationSection section = root.getConfigurationSection(rawId);
                if (section == null) {
                    continue;
                }
                String route = section.getString("route");
                if (route == null || route.isBlank()) {
                    continue;
                }
                states.add(new AutopilotSavedState(
                        UUID.fromString(rawId),
                        route,
                        Math.max(0, section.getInt("next-stop")),
                        section.getInt("direction", 1),
                        section.getBoolean("active")
                ));
            }
            return Optional.of(List.copyOf(states));
        } catch (IOException | InvalidConfigurationException | RuntimeException exception) {
            plugin.getLogger().log(Level.SEVERE, "Could not read autopilot.yml.", exception);
            return Optional.empty();
        }
    }

    void save(Collection<AutopilotSavedState> states) {
        plugin.getDataFolder().mkdirs();
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("schema-version", 1);
        for (AutopilotSavedState state : states) {
            String path = "vehicles." + state.vehicleId();
            yaml.set(path + ".route", state.routeId());
            yaml.set(path + ".next-stop", state.nextStopIndex());
            yaml.set(path + ".direction", state.direction());
            yaml.set(path + ".active", state.active());
        }
        File temporary = new File(plugin.getDataFolder(), "autopilot.yml.tmp");
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
            plugin.getLogger().log(Level.SEVERE, "Could not save autopilot.yml.", exception);
        } finally {
            if (temporary.exists() && !temporary.delete()) {
                temporary.deleteOnExit();
            }
        }
    }
}
