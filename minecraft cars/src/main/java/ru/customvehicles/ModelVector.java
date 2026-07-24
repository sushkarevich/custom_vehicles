package ru.customvehicles;

record ModelVector(double x, double y, double z) {
    static final ModelVector ZERO = new ModelVector(0.0, 0.0, 0.0);
    static final ModelVector ONE = new ModelVector(1.0, 1.0, 1.0);

    boolean finite() {
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z);
    }
}
