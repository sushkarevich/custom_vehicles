package ru.customvehicles;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class VehicleMathTest {
    @Test
    void approachesTargetWithoutOvershooting() {
        assertEquals(0.3, VehicleMath.approach(0.0, 0.3, 0.5), 0.000001);
        assertEquals(0.2, VehicleMath.approach(0.5, 0.0, 0.3), 0.000001);
        assertEquals(-0.2, VehicleMath.approach(-0.5, 0.0, 0.3), 0.000001);
    }

    @Test
    void neutralThrottleUsesOnlyPassiveDrag() {
        assertEquals(
                0.646,
                VehicleMath.nextSpeed(0.65, 0.0, 0.65, 0.30, 0.035, 0.055, 0.004),
                0.000001
        );
    }

    @Test
    void oppositeThrottleUsesFullBraking() {
        assertEquals(
                0.595,
                VehicleMath.nextSpeed(0.65, -1.0, 0.65, 0.30, 0.035, 0.055, 0.004),
                0.000001
        );
    }

    @Test
    void rotatesOffsetsAroundVehicleCenter() {
        assertEquals(0.0, VehicleMath.rotateX(1.0, 0.0, 90.0F), 0.000001);
        assertEquals(1.0, VehicleMath.rotateZ(1.0, 0.0, 90.0F), 0.000001);
    }

    @Test
    void producesMinecraftForwardVector() {
        assertEquals(0.0, VehicleMath.directionX(0.0F), 0.000001);
        assertEquals(1.0, VehicleMath.directionZ(0.0F), 0.000001);
        assertEquals(-1.0, VehicleMath.directionX(90.0F), 0.000001);
        assertEquals(0.0, VehicleMath.directionZ(90.0F), 0.000001);
    }
}
