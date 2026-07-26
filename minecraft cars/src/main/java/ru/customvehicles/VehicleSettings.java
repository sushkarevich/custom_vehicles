package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;

public record VehicleSettings(
        double maxSpeed,
        double reverseSpeed,
        double acceleration,
        double braking,
        double passiveDrag,
        double steeringDegreesPerTick,
        double stepHeight,
        double soundVolume,
        SeatOffset seatOffset
) {
    public static VehicleSettings from(ConfigurationSection section) {
        if (section == null) {
            return defaults();
        }
        return new VehicleSettings(
                positive(section.getDouble("max-speed", 0.65), 0.65),
                positive(section.getDouble("reverse-speed", 0.30), 0.30),
                positive(section.getDouble("acceleration", 0.035), 0.035),
                positive(section.getDouble("braking", 0.055), 0.055),
                positive(section.getDouble("passive-drag", 0.004), 0.004),
                positive(section.getDouble("steering-degrees-per-tick", 2.8), 2.8),
                positive(section.getDouble("step-height", 1.0), 1.0),
                nonNegative(section.getDouble("sound-volume", 1.0), 1.0),
                SeatOffset.from(section.getConfigurationSection("seat-offset"))
        );
    }

    public static VehicleSettings defaults() {
        return new VehicleSettings(
                0.65,
                0.30,
                0.035,
                0.055,
                0.004,
                2.8,
                1.0,
                1.0,
                SeatOffset.CENTERED
        );
    }

    private static double positive(double value, double fallback) {
        return value > 0.0 ? value : fallback;
    }

    private static double nonNegative(double value, double fallback) {
        return value >= 0.0 ? value : fallback;
    }
}
