package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.util.Vector;

record RailPose(Location location, Vector forward) {
    RailPose {
        location = location.clone();
        forward = forward.clone().normalize();
    }

    float yaw() {
        return (float) Math.toDegrees(Math.atan2(-forward.getX(), forward.getZ()));
    }

    float pitch() {
        double vertical = Math.max(-1.0, Math.min(1.0, forward.getY()));
        return (float) -Math.toDegrees(Math.asin(vertical));
    }
}
