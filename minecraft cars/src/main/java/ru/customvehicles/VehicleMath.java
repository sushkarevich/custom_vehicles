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

    public static double nextSpeed(
            double speed,
            double throttle,
            double maxSpeed,
            double reverseSpeed,
            double acceleration,
            double braking,
            double passiveDrag
    ) {
        if (Math.abs(throttle) < 0.01) {
            return approach(speed, 0.0, passiveDrag);
        }
        double target = throttle >= 0.0
                ? throttle * maxSpeed
                : throttle * reverseSpeed;
        double change = Math.signum(target) != Math.signum(speed)
                || Math.abs(target) < Math.abs(speed)
                ? braking
                : acceleration;
        return approach(speed, target, change);
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
