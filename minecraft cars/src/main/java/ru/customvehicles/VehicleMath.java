package ru.customvehicles;

public final class VehicleMath {
    private VehicleMath() {
    }

    public static double approach(double value, double target, double amount) {
        if (value < target) {
            return Math.min(value + amount, target);
        }
        if (value > target) {
            return Math.max(value - amount, target);
        }
        return value;
    }

    public static double directionX(float yawDegrees) {
        return -Math.sin(Math.toRadians(yawDegrees));
    }

    public static double directionZ(float yawDegrees) {
        return Math.cos(Math.toRadians(yawDegrees));
    }

    public static double rotateX(double localX, double localZ, float yawDegrees) {
        double radians = Math.toRadians(yawDegrees);
        return localX * Math.cos(radians) - localZ * Math.sin(radians);
    }

    public static double rotateZ(double localX, double localZ, float yawDegrees) {
        double radians = Math.toRadians(yawDegrees);
        return localX * Math.sin(radians) + localZ * Math.cos(radians);
    }
}
