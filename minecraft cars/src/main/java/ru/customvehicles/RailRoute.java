package ru.customvehicles;

import java.util.List;
import java.util.Objects;

record RailRoute(String id, List<RouteStop> stops, List<RouteSwitch> switches) {
    RailRoute {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(stops, "stops");
        Objects.requireNonNull(switches, "switches");
        if (!id.matches("[a-z0-9_-]{1,32}")) {
            throw new IllegalArgumentException("route id must match [a-z0-9_-]{1,32}");
        }
        stops = List.copyOf(stops);
        switches = List.copyOf(switches);
    }

    RailRoute withStop(RouteStop stop) {
        java.util.ArrayList<RouteStop> next = new java.util.ArrayList<>(stops);
        next.add(stop);
        return new RailRoute(id, next, switches);
    }

    RailRoute withoutStop(int index) {
        java.util.ArrayList<RouteStop> nextStops = new java.util.ArrayList<>(stops);
        nextStops.remove(index);
        java.util.ArrayList<RouteSwitch> nextSwitches = new java.util.ArrayList<>();
        for (RouteSwitch routeSwitch : switches) {
            if (routeSwitch.targetStopIndex() == index) {
                continue;
            }
            int target = routeSwitch.targetStopIndex() > index
                    ? routeSwitch.targetStopIndex() - 1
                    : routeSwitch.targetStopIndex();
            nextSwitches.add(new RouteSwitch(
                    routeSwitch.worldId(),
                    routeSwitch.worldName(),
                    routeSwitch.x(),
                    routeSwitch.y(),
                    routeSwitch.z(),
                    target,
                    routeSwitch.shape()
            ));
        }
        return new RailRoute(id, nextStops, nextSwitches);
    }

    RailRoute withSwitch(RouteSwitch routeSwitch) {
        java.util.ArrayList<RouteSwitch> next = new java.util.ArrayList<>(switches);
        next.add(routeSwitch);
        return new RailRoute(id, stops, next);
    }

    RailRoute withoutSwitch(int index) {
        java.util.ArrayList<RouteSwitch> next = new java.util.ArrayList<>(switches);
        next.remove(index);
        return new RailRoute(id, stops, next);
    }
}
