package ru.customvehicles;

import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class VehicleSnapshotTest {
    private static final UUID ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID OWNER = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID WORLD = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

    @Test
    void clampsNegativeWagonCountWithoutChangingIdentityOrPosition() {
        VehicleSnapshot snapshot = new VehicleSnapshot(
                ID,
                VehicleKind.TRAIN,
                OWNER,
                WORLD,
                "world",
                12.5,
                64.25,
                -8.0,
                90.0F,
                -3
        );

        assertEquals(ID, snapshot.id());
        assertEquals(0, snapshot.wagonCount());
        assertEquals(12.5, snapshot.x());
        assertEquals(90.0F, snapshot.yaw());
    }

    @Test
    void rejectsCoordinatesThatCannotBePersistedSafely() {
        assertThrows(IllegalArgumentException.class, () -> new VehicleSnapshot(
                ID,
                VehicleKind.CAR,
                OWNER,
                WORLD,
                "world",
                Double.NaN,
                64.0,
                0.0,
                0.0F,
                0
        ));
    }

    @Test
    void recognizesTramAsIndependentPersistentVehicleKind() {
        VehicleSnapshot snapshot = new VehicleSnapshot(
                ID,
                VehicleKind.TRAM,
                OWNER,
                WORLD,
                "world",
                4.5,
                70.14,
                -12.5,
                -90.0F,
                0
        );

        assertEquals(VehicleKind.TRAM, VehicleKind.from("tram"));
        assertEquals(VehicleKind.TRAM, snapshot.kind());
        assertEquals(0, snapshot.wagonCount());
    }

    @Test
    void preservesCustomVariantAndOrderedWagonVariants() {
        VehicleSnapshot snapshot = new VehicleSnapshot(
                ID,
                VehicleKind.TRAIN,
                OWNER,
                WORLD,
                "world",
                0.0,
                64.0,
                0.0,
                0.0F,
                "custom_train",
                List.of("wagon_red", "wagon_blue")
        );

        assertEquals("custom_train", snapshot.variantId());
        assertEquals(List.of("wagon_red", "wagon_blue"), snapshot.wagonVariantIds());
        assertEquals(2, snapshot.wagonCount());
    }
}
