package ru.customvehicles;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;

class AutopilotDebugFormatterTest {
    @Test
    void explainsTargetDecisionAndBlocker() {
        UUID vehicleId = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID blockerId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        AutopilotDebugSnapshot snapshot = new AutopilotDebugSnapshot(
                vehicleId,
                VehicleKind.TRAM,
                true,
                "line_1",
                AutopilotStatus.WAITING_FOR_VEHICLE,
                1,
                "Центр",
                12.345,
                0.075,
                2.4,
                -1,
                60,
                blockerId,
                "10,64,20 → north_east",
                "Тормозит: впереди другой транспорт"
        );

        List<String> lines = AutopilotDebugFormatter.format(snapshot);
        String joined = String.join("\n", lines);

        assertTrue(joined.contains("Трамвай"));
        assertTrue(joined.contains("line_1"));
        assertTrue(joined.contains("#2 Центр"));
        assertTrue(joined.contains("12.35 бл."));
        assertTrue(joined.contains("22222222"));
        assertTrue(joined.contains("Тормозит: впереди другой транспорт"));
    }
}
