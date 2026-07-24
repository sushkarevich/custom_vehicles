package ru.customvehicles;

enum VehicleBehavior {
    CAR("car"),
    TRAIN("train"),
    TRAM("tram"),
    WAGON("wagon");

    private final String id;

    VehicleBehavior(String id) {
        this.id = id;
    }

    String id() {
        return id;
    }

    static VehicleBehavior from(String raw) {
        if (raw == null) {
            return null;
        }
        for (VehicleBehavior behavior : values()) {
            if (behavior.id.equalsIgnoreCase(raw)) {
                return behavior;
            }
        }
        return null;
    }
}
