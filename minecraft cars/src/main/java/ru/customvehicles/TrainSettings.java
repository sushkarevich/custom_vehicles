package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;

record TrainSettings(
        double maxSpeed,
        double reverseSpeed,
        double acceleration,
        double braking,
        double passiveDrag,
        double wagonSpacing,
        int maxWagons,
        double soundVolume,
        SeatOffset seatOffset
) {
    static TrainSettings from(ConfigurationSection section) {
        if (section == null) {
            return defaults();
        }
        return new TrainSettings(
                positive(section.getDouble("max-speed", 0.42), 0.42),
                positive(section.getDouble("reverse-speed", 0.22), 0.22),
                positive(section.getDouble("acceleration", 0.018), 0.018),
                positive(section.getDouble("braking", 0.035), 0.035),
                positive(section.getDouble("passive-drag", 0.002), 0.002),
                positive(section.getDouble("wagon-spacing", 6.20), 6.20),
                positive(section.getInt("max-wagons", 6), 6),
                nonNegative(section.getDouble("sound-volume", 1.0), 1.0),
                SeatOffset.from(section.getConfigurationSection("seat-offset"))
        );
    }

    static TrainSettings defaults() {
        return new TrainSettings(
                0.42,
                0.22,
                0.018,
                0.035,
                0.002,
                6.20,
                6,
                1.0,
                SeatOffset.CENTERED
        );
    }

    private static double positive(double value, double fallback) {
        return value > 0.0 ? value : fallback;
    }

    private static int positive(int value, int fallback) {
        return value > 0 ? value : fallback;
    }

    private static double nonNegative(double value, double fallback) {
        return value >= 0.0 ? value : fallback;
    }
}
