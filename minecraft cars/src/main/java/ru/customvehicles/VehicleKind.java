package ru.customvehicles;

enum VehicleKind {
    CAR("car"),
    TRAIN("train"),
    TRAM("tram"),
    WAGON("wagon");

    private final String id;

    VehicleKind(String id) {
        this.id = id;
    }

    String id() {
        return id;
    }

    VehicleBehavior behavior() {
        return VehicleBehavior.valueOf(name());
    }

    String defaultVariantId() {
        return BuiltInDefinitions.defaultVariant(behavior());
    }

    static VehicleKind fromBehavior(VehicleBehavior behavior) {
        return VehicleKind.valueOf(behavior.name());
    }

    static VehicleKind from(String raw) {
        if (raw == null) {
            return CAR;
        }
        for (VehicleKind kind : values()) {
            if (kind.id.equalsIgnoreCase(raw)) {
                return kind;
            }
        }
        return CAR;
    }
}
