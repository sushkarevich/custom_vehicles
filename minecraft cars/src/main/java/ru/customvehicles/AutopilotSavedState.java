package ru.customvehicles;

import java.util.UUID;

record AutopilotSavedState(
        UUID vehicleId,
        String routeId,
        int nextStopIndex,
        int direction,
        boolean active
) {
    AutopilotSavedState {
        nextStopIndex = Math.max(0, nextStopIndex);
        direction = direction < 0 ? -1 : 1;
    }
}
