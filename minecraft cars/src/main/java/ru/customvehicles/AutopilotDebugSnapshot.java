package ru.customvehicles;

import java.util.UUID;

record AutopilotDebugSnapshot(
        UUID vehicleId,
        VehicleKind kind,
        boolean active,
        String routeId,
        AutopilotStatus status,
        int nextStopIndex,
        String nextStopName,
        double distanceToStop,
        double speed,
        double brakingDistance,
        int direction,
        int dwellTicks,
        UUID blockingVehicleId,
        String lastSwitch,
        String decision
) {
    String shortVehicleId() {
        return vehicleId.toString().substring(0, 8);
    }
}
