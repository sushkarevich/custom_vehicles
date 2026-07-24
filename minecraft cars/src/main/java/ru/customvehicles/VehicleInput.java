package ru.customvehicles;

public record VehicleInput(float sideways, float forward, boolean horn) {
    public static final VehicleInput IDLE = new VehicleInput(0.0F, 0.0F, false);

    public VehicleInput {
        sideways = clamp(sideways);
        forward = clamp(forward);
    }

    private static float clamp(float value) {
        return Math.max(-1.0F, Math.min(1.0F, value));
    }
}
