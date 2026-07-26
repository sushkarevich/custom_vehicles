package ru.customvehicles;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    void selectsFourForwardGearsAtStableThresholds() {
        assertEquals(0, VehicleMath.forwardGear(0.0, 1.0));
        assertEquals(1, VehicleMath.forwardGear(0.10, 1.0));
        assertEquals(2, VehicleMath.forwardGear(0.30, 1.0));
        assertEquals(3, VehicleMath.forwardGear(0.60, 1.0));
        assertEquals(4, VehicleMath.forwardGear(0.90, 1.0));
    }

    @Test
    void enginePitchDropsAfterAnUpshift() {
        float endOfFirst = VehicleMath.enginePitch(0.23, 1.0, 1);
        float startOfSecond = VehicleMath.enginePitch(0.24, 1.0, 2);
        assertTrue(startOfSecond < endOfFirst);
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
