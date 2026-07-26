package ru.customvehicles;

public final class VehicleMath {
    private static final double[] FORWARD_GEAR_LIMITS = {0.0, 0.23, 0.48, 0.73, 1.0};

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

    public static int forwardGear(double speed, double maxSpeed) {
        if (speed <= 0.0 || maxSpeed <= 0.0) {
            return 0;
        }
        double ratio = Math.min(1.0, speed / maxSpeed);
        for (int gear = 1; gear < FORWARD_GEAR_LIMITS.length; gear++) {
            if (ratio <= FORWARD_GEAR_LIMITS[gear]) {
                return gear;
            }
        }
        return FORWARD_GEAR_LIMITS.length - 1;
    }

    public static float enginePitch(double speed, double maxSpeed, int gear) {
        if (speed <= 0.0 || maxSpeed <= 0.0 || gear <= 0) {
            double reverseRatio = maxSpeed <= 0.0
                    ? 0.0
                    : Math.min(1.0, Math.abs(speed) / maxSpeed);
            return (float) (0.55 + reverseRatio * 0.55);
        }
        int boundedGear = Math.min(gear, FORWARD_GEAR_LIMITS.length - 1);
        double ratio = Math.min(1.0, speed / maxSpeed);
        double lower = FORWARD_GEAR_LIMITS[boundedGear - 1];
        double upper = FORWARD_GEAR_LIMITS[boundedGear];
        double progress = Math.max(0.0, Math.min(1.0, (ratio - lower) / (upper - lower)));
        return (float) (0.62 + progress * 0.68);
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
