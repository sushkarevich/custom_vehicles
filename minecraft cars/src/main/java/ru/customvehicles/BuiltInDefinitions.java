package ru.customvehicles;

import java.util.Map;

final class BuiltInDefinitions {
    static final String MODEL_INDEX = "models/index.txt";
    static final String VARIANT_INDEX = "vehicles/index.txt";

    static final String CAR_MODEL = "car_default";
    static final String METRO_HEAD_MODEL = "metro_717_head";
    static final String METRO_WAGON_MODEL = "metro_714_wagon";
    static final String TRAM_FRONT_MODEL = "vityaz_m_front";
    static final String TRAM_MIDDLE_MODEL = "vityaz_m_middle";
    static final String TRAM_REAR_MODEL = "vityaz_m_rear";

    static final String CAR_VARIANT = "car_default";
    static final String TRAIN_VARIANT = "metro_717";
    static final String WAGON_VARIANT = "metro_714_wagon";
    static final String TRAM_VARIANT = "vityaz_m";

    private static final Map<VehicleBehavior, String> DEFAULT_VARIANTS = Map.of(
            VehicleBehavior.CAR, CAR_VARIANT,
            VehicleBehavior.TRAIN, TRAIN_VARIANT,
            VehicleBehavior.WAGON, WAGON_VARIANT,
            VehicleBehavior.TRAM, TRAM_VARIANT
    );

    private BuiltInDefinitions() {
    }

    static String defaultVariant(VehicleBehavior behavior) {
        return DEFAULT_VARIANTS.get(behavior);
    }
}
