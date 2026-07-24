package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;

record SeatOffset(double x, double y, double z) {
    static final SeatOffset CENTERED = new SeatOffset(0.0, 0.0, 0.0);

    static SeatOffset from(ConfigurationSection section) {
        if (section == null) {
            return CENTERED;
        }
        return new SeatOffset(
                section.getDouble("x", 0.0),
                section.getDouble("y", 0.0),
                section.getDouble("z", 0.0)
        );
    }
}
