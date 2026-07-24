package ru.customvehicles;

enum AutopilotStatus {
    MANUAL("Ручное управление"),
    RUNNING("Следует по маршруту"),
    DWELLING("Стоянка на остановке"),
    WAITING_FOR_VEHICLE("Ожидает свободный путь"),
    EMERGENCY_NO_TRACK("Авария: путь оборван"),
    EMERGENCY_NO_PROGRESS("Авария: остановка недостижима"),
    INVALID_ROUTE("Маршрут недоступен"),
    LIMIT_REACHED("Достигнут лимит автопилотов");

    private final String displayName;

    AutopilotStatus(String displayName) {
        this.displayName = displayName;
    }

    String displayName() {
        return displayName;
    }

    boolean emergency() {
        return this == EMERGENCY_NO_TRACK
                || this == EMERGENCY_NO_PROGRESS
                || this == INVALID_ROUTE
                || this == LIMIT_REACHED;
    }
}
