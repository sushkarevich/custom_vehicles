package ru.customvehicles;

import org.bukkit.block.Block;
import org.bukkit.block.data.Rail;

import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class RouteManager {
    private final RouteStorage storage;
    private final Map<String, RailRoute> routes = new LinkedHashMap<>();

    RouteManager(CustomVehiclesPlugin plugin) {
        storage = new RouteStorage(plugin);
        storage.load().ifPresent(loaded -> loaded.forEach(route -> routes.put(route.id(), route)));
    }

    Collection<RailRoute> all() {
        return routes.values().stream().sorted(Comparator.comparing(RailRoute::id)).toList();
    }

    RailRoute byId(String id) {
        return id == null ? null : routes.get(id.toLowerCase(Locale.ROOT));
    }

    boolean create(String rawId) {
        String id = normalize(rawId);
        if (id == null || routes.containsKey(id)) {
            return false;
        }
        routes.put(id, new RailRoute(id, List.of(), List.of()));
        save();
        return true;
    }

    boolean delete(String rawId) {
        String id = normalize(rawId);
        if (id == null || routes.remove(id) == null) {
            return false;
        }
        save();
        return true;
    }

    boolean addStop(String routeId, RouteStop stop) {
        RailRoute route = byId(routeId);
        if (route == null) {
            return false;
        }
        routes.put(route.id(), route.withStop(stop));
        save();
        return true;
    }

    boolean removeStop(String routeId, int index) {
        RailRoute route = byId(routeId);
        if (route == null || index < 0 || index >= route.stops().size()) {
            return false;
        }
        routes.put(route.id(), route.withoutStop(index));
        save();
        return true;
    }

    boolean addSwitch(String routeId, int targetStopIndex, Block block, Rail.Shape shape) {
        RailRoute route = byId(routeId);
        if (route == null || targetStopIndex < 0 || targetStopIndex >= route.stops().size()) {
            return false;
        }
        RouteSwitch routeSwitch = new RouteSwitch(
                block.getWorld().getUID(),
                block.getWorld().getName(),
                block.getX(),
                block.getY(),
                block.getZ(),
                targetStopIndex,
                shape
        );
        routes.put(route.id(), route.withSwitch(routeSwitch));
        save();
        return true;
    }

    boolean removeSwitch(String routeId, int index) {
        RailRoute route = byId(routeId);
        if (route == null || index < 0 || index >= route.switches().size()) {
            return false;
        }
        routes.put(route.id(), route.withoutSwitch(index));
        save();
        return true;
    }

    private String normalize(String rawId) {
        if (rawId == null) {
            return null;
        }
        String id = rawId.toLowerCase(Locale.ROOT);
        return id.matches("[a-z0-9_-]{1,32}") ? id : null;
    }

    private void save() {
        storage.save(List.copyOf(routes.values()));
    }
}
