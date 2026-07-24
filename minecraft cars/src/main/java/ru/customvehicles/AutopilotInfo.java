package ru.customvehicles;

record AutopilotInfo(
        boolean active,
        String routeId,
        int nextStopIndex,
        String nextStopName,
        int dwellTicks,
        AutopilotStatus status
) {
    static AutopilotInfo manual() {
        return new AutopilotInfo(false, null, 0, null, 0, AutopilotStatus.MANUAL);
    }
}
