package ru.customvehicles;

import org.bukkit.block.data.Rail;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RailRouteTest {
    private static final UUID WORLD = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

    @Test
    void removingStopDropsItsSwitchesAndRenumbersFollowingTargets() {
        RailRoute route = new RailRoute(
                "line_1",
                List.of(stop("first", 0), stop("middle", 10), stop("last", 20)),
                List.of(
                        routeSwitch(0, Rail.Shape.NORTH_SOUTH),
                        routeSwitch(1, Rail.Shape.SOUTH_EAST),
                        routeSwitch(2, Rail.Shape.EAST_WEST)
                )
        );

        RailRoute changed = route.withoutStop(1);

        assertEquals(List.of("first", "last"), changed.stops().stream().map(RouteStop::name).toList());
        assertEquals(2, changed.switches().size());
        assertEquals(0, changed.switches().get(0).targetStopIndex());
        assertEquals(1, changed.switches().get(1).targetStopIndex());
        assertTrue(changed.switches().stream().noneMatch(value -> value.shape() == Rail.Shape.SOUTH_EAST));
    }

    @Test
    void savedDirectionIsAlwaysNormalized() {
        AutopilotSavedState state = new AutopilotSavedState(
                UUID.randomUUID(),
                "line_1",
                2,
                0,
                true
        );

        assertEquals(1, state.direction());
    }

    private RouteStop stop(String name, double x) {
        return new RouteStop(name, WORLD, "world", x, 64.14, 0.5, 200);
    }

    private RouteSwitch routeSwitch(int target, Rail.Shape shape) {
        return new RouteSwitch(WORLD, "world", target, 64, 0, target, shape);
    }
}
