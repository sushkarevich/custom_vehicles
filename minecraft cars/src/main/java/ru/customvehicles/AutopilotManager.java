package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Rail;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AutopilotManager {
    private final CustomVehiclesPlugin plugin;
    private final RouteManager routeManager;
    private final VehicleManager vehicleManager;
    private final AutopilotStorage storage;
    private final Map<UUID, State> states = new HashMap<>();
    private final Map<UUID, UUID> debugViewers = new HashMap<>();
    private int maxActive;
    private double obstacleDistance;
    private double switchActivationDistance;
    private int noProgressTimeoutTicks;
    private int debugIntervalTicks;
    private long ticks;

    AutopilotManager(
            CustomVehiclesPlugin plugin,
            RouteManager routeManager,
            VehicleManager vehicleManager
    ) {
        this.plugin = plugin;
        this.routeManager = routeManager;
        this.vehicleManager = vehicleManager;
        storage = new AutopilotStorage(plugin);
        reloadSettings();
    }

    void reloadSettings() {
        maxActive = Math.max(1, plugin.getConfig().getInt("autopilot.max-active-vehicles", 6));
        obstacleDistance = positive(
                plugin.getConfig().getDouble("autopilot.obstacle-distance", 10.0),
                10.0
        );
        switchActivationDistance = positive(
                plugin.getConfig().getDouble("autopilot.switch-activation-distance", 12.0),
                12.0
        );
        noProgressTimeoutTicks = Math.max(
                200,
                plugin.getConfig().getInt("autopilot.no-progress-timeout-ticks", 600)
        );
        debugIntervalTicks = Math.max(
                20,
                plugin.getConfig().getInt("autopilot.debug-interval-ticks", 40)
        );
    }

    void restore() {
        storage.load().ifPresent(saved -> {
            for (AutopilotSavedState snapshot : saved) {
                ManagedVehicle vehicle = vehicleManager.byId(snapshot.vehicleId());
                RailRoute route = routeManager.byId(snapshot.routeId());
                if (!(vehicle instanceof RailTrain train) || route == null) {
                    continue;
                }
                State state = new State(snapshot.vehicleId());
                state.routeId = route.id();
                state.nextStopIndex = route.stops().isEmpty()
                        ? 0
                        : Math.min(snapshot.nextStopIndex(), route.stops().size() - 1);
                state.direction = snapshot.direction();
                state.active = snapshot.active() && activeCount() < maxActive && route.stops().size() >= 2;
                state.status = state.active ? AutopilotStatus.RUNNING : AutopilotStatus.MANUAL;
                state.lastProgressTick = ticks;
                state.decision = state.active
                        ? "Восстановлен после запуска сервера"
                        : "Ожидает ручного запуска";
                states.put(snapshot.vehicleId(), state);
                train.setAutopilotChunkLoading(state.active);
            }
        });
    }

    StartResult enable(RailTrain train, String routeId) {
        RailRoute route = routeManager.byId(routeId);
        if (route == null) {
            return StartResult.ROUTE_MISSING;
        }
        if (route.stops().size() < 2) {
            return StartResult.NOT_ENOUGH_STOPS;
        }
        State existing = states.get(train.id());
        if ((existing == null || !existing.active) && activeCount() >= maxActive) {
            if (existing != null) {
                existing.status = AutopilotStatus.LIMIT_REACHED;
            }
            return StartResult.LIMIT_REACHED;
        }
        State state = existing == null ? new State(train.id()) : existing;
        state.routeId = route.id();
        state.nextStopIndex = nearestStopIndex(train.snapshot(), route);
        state.direction = directionToStop(train, route.stops().get(state.nextStopIndex));
        state.active = true;
        state.status = AutopilotStatus.RUNNING;
        state.dwellRemaining = 0;
        state.lastDistance = Double.MAX_VALUE;
        state.lastProgressTick = ticks;
        state.notifiedEmergency = false;
        state.decision = "Выбирает направление и начинает движение";
        state.blockingVehicleId = null;
        state.lastSwitch = null;
        states.put(train.id(), state);
        train.clearPathBlocked();
        train.setAutopilotChunkLoading(true);
        save();
        return StartResult.STARTED;
    }

    void disable(RailTrain train) {
        State state = states.computeIfAbsent(train.id(), State::new);
        state.active = false;
        state.status = AutopilotStatus.MANUAL;
        state.dwellRemaining = 0;
        state.decision = "Автопилот выключен игроком";
        state.blockingVehicleId = null;
        train.setAutopilotChunkLoading(false);
        save();
    }

    void remove(UUID vehicleId) {
        if (states.remove(vehicleId) != null) {
            debugViewers.entrySet().removeIf(entry -> entry.getValue().equals(vehicleId));
            save();
        }
    }

    VehicleInput inputFor(RailTrain train, VehicleInput manualInput) {
        State state = states.get(train.id());
        if (state == null || !state.active) {
            train.setAutopilotChunkLoading(false);
            if (state != null) {
                state.decision = "Ручное управление";
                state.targetDistance = Double.NaN;
                state.brakingDistance = 0.0;
                state.blockingVehicleId = null;
            }
            return manualInput;
        }
        RailRoute route = routeManager.byId(state.routeId);
        if (route == null || route.stops().size() < 2) {
            state.decision = "Маршрут отсутствует или содержит меньше двух остановок";
            emergency(train, state, AutopilotStatus.INVALID_ROUTE);
            return VehicleInput.IDLE;
        }
        state.nextStopIndex %= route.stops().size();
        applySwitches(train, state, route);

        if (state.status.emergency()) {
            state.decision = state.status.displayName();
            return VehicleInput.IDLE;
        }
        if (state.dwellRemaining > 0) {
            state.dwellRemaining--;
            state.status = AutopilotStatus.DWELLING;
            state.decision = "Стоит на остановке до времени отправления";
            state.targetDistance = 0.0;
            state.brakingDistance = 0.0;
            state.blockingVehicleId = null;
            if (state.dwellRemaining == 0) {
                advanceNextStop(state, route);
                state.status = AutopilotStatus.RUNNING;
                state.lastDistance = Double.MAX_VALUE;
                state.lastProgressTick = ticks;
                state.decision = "Стоянка завершена, отправляется к следующей остановке";
                save();
            }
            return VehicleInput.IDLE;
        }
        UUID blockingVehicle = vehicleAhead(train);
        if (blockingVehicle != null) {
            state.status = AutopilotStatus.WAITING_FOR_VEHICLE;
            state.lastProgressTick = ticks;
            state.decision = "Тормозит: впереди другой транспорт";
            state.blockingVehicleId = blockingVehicle;
            return VehicleInput.IDLE;
        }
        state.blockingVehicleId = null;

        RouteStop stop = route.stops().get(state.nextStopIndex);
        World world = world(stop.worldId(), stop.worldName());
        Location location = train.snapshotLocation();
        if (world == null || location.getWorld() == null
                || !location.getWorld().getUID().equals(world.getUID())) {
            state.decision = "Целевая остановка находится в недоступном мире";
            emergency(train, state, AutopilotStatus.INVALID_ROUTE);
            return VehicleInput.IDLE;
        }
        double distance = location.distance(stop.location(world));
        state.targetDistance = distance;
        if (distance + 0.35 < state.lastDistance) {
            state.lastDistance = distance;
            state.lastProgressTick = ticks;
        } else if (ticks - state.lastProgressTick > noProgressTimeoutTicks) {
            state.decision = "Расстояние до остановки долго не уменьшается";
            emergency(train, state, AutopilotStatus.EMERGENCY_NO_PROGRESS);
            return VehicleInput.IDLE;
        }

        double speed = Math.abs(train.speed());
        if (distance <= 0.90 && speed <= 0.025) {
            state.dwellRemaining = Math.max(1, stop.dwellTicks());
            state.status = AutopilotStatus.DWELLING;
            state.lastDistance = Double.MAX_VALUE;
            state.brakingDistance = 0.0;
            state.decision = "Прибыл на остановку и начал стоянку";
            save();
            return VehicleInput.IDLE;
        }

        state.status = AutopilotStatus.RUNNING;
        double brakingDistance = Math.max(1.8, speed * speed / 0.07 + 0.8);
        state.brakingDistance = brakingDistance;
        if (distance <= 0.90) {
            state.decision = "Удерживает состав в точке остановки";
            return VehicleInput.IDLE;
        }
        if (distance <= brakingDistance) {
            if (speed > 0.055) {
                state.decision = "Тормозит перед остановкой";
                return VehicleInput.IDLE;
            }
            state.decision = "Подъезжает к остановке на малой скорости";
            return new VehicleInput(0.0F, 0.18F * state.direction, false);
        }
        state.decision = "Разгоняется и следует к остановке";
        return new VehicleInput(0.0F, state.direction, false);
    }

    void afterTick(RailTrain train) {
        State state = states.get(train.id());
        if (state == null) {
            return;
        }
        if (state.active && !state.status.emergency() && train.consumePathBlocked()) {
            state.decision = "Навигатор не нашёл продолжение рельсов";
            emergency(train, state, AutopilotStatus.EMERGENCY_NO_TRACK);
        }
        if (ticks % debugIntervalTicks == 0) {
            emitDebug(train, state);
        }
    }

    AutopilotInfo info(UUID vehicleId) {
        State state = states.get(vehicleId);
        if (state == null) {
            return AutopilotInfo.manual();
        }
        RailRoute route = routeManager.byId(state.routeId);
        String nextName = route == null || route.stops().isEmpty()
                ? null
                : route.stops().get(Math.min(state.nextStopIndex, route.stops().size() - 1)).name();
        return new AutopilotInfo(
                state.active,
                state.routeId,
                state.nextStopIndex,
                nextName,
                state.dwellRemaining,
                state.status
        );
    }

    int activeCount() {
        return (int) states.values().stream().filter(state -> state.active).count();
    }

    int maxActive() {
        return maxActive;
    }

    List<RailTrain> vehiclesOnRoute(String routeId) {
        return vehicleManager.all().stream()
                .filter(RailTrain.class::isInstance)
                .map(RailTrain.class::cast)
                .filter(train -> {
                    State state = states.get(train.id());
                    return state != null && state.routeId != null
                            && state.routeId.equalsIgnoreCase(routeId);
                })
                .sorted(Comparator.comparing(train -> train.id().toString()))
                .toList();
    }

    AutopilotDebugSnapshot debugSnapshot(RailTrain train) {
        State state = states.get(train.id());
        if (state == null) {
            return new AutopilotDebugSnapshot(
                    train.id(),
                    train.kind(),
                    false,
                    null,
                    AutopilotStatus.MANUAL,
                    0,
                    null,
                    Double.NaN,
                    Math.abs(train.speed()),
                    0.0,
                    1,
                    0,
                    null,
                    null,
                    "Маршрут не назначен"
            );
        }
        RailRoute route = routeManager.byId(state.routeId);
        String nextStop = route == null || route.stops().isEmpty()
                ? null
                : route.stops().get(Math.min(state.nextStopIndex, route.stops().size() - 1)).name();
        return new AutopilotDebugSnapshot(
                train.id(),
                train.kind(),
                state.active,
                state.routeId,
                state.status,
                state.nextStopIndex,
                nextStop,
                state.targetDistance,
                Math.abs(train.speed()),
                state.brakingDistance,
                state.direction,
                state.dwellRemaining,
                state.blockingVehicleId,
                state.lastSwitch,
                state.decision
        );
    }

    boolean startDebug(Player player, UUID vehicleId) {
        ManagedVehicle vehicle = vehicleManager.byId(vehicleId);
        if (!(vehicle instanceof RailTrain) || !states.containsKey(vehicleId)) {
            return false;
        }
        debugViewers.put(player.getUniqueId(), vehicleId);
        return true;
    }

    boolean stopDebug(Player player) {
        return debugViewers.remove(player.getUniqueId()) != null;
    }

    UUID debugVehicle(Player player) {
        return debugViewers.get(player.getUniqueId());
    }

    void beginTick() {
        ticks++;
    }

    void shutdown() {
        save();
        debugViewers.clear();
        vehicleManager.all().stream()
                .filter(RailTrain.class::isInstance)
                .map(RailTrain.class::cast)
                .forEach(train -> train.setAutopilotChunkLoading(false));
    }

    private void applySwitches(RailTrain train, State state, RailRoute route) {
        Location trainLocation = train.snapshotLocation();
        double maximumDistanceSquared = switchActivationDistance * switchActivationDistance;
        for (RouteSwitch routeSwitch : route.switches()) {
            if (routeSwitch.targetStopIndex() != state.nextStopIndex) {
                continue;
            }
            World world = world(routeSwitch.worldId(), routeSwitch.worldName());
            if (world == null || trainLocation.getWorld() == null
                    || !world.getUID().equals(trainLocation.getWorld().getUID())) {
                continue;
            }
            Location switchLocation = new Location(
                    world,
                    routeSwitch.x() + 0.5,
                    routeSwitch.y() + 0.14,
                    routeSwitch.z() + 0.5
            );
            if (trainLocation.distanceSquared(switchLocation) > maximumDistanceSquared) {
                continue;
            }
            Block block = world.getBlockAt(routeSwitch.x(), routeSwitch.y(), routeSwitch.z());
            if (!Tag.RAILS.isTagged(block.getType()) || !(block.getBlockData() instanceof Rail rail)) {
                continue;
            }
            try {
                rail.setShape(routeSwitch.shape());
            } catch (IllegalArgumentException ignored) {
                continue;
            }
            if (!block.getBlockData().equals(rail)) {
                block.setBlockData(rail, false);
            }
            state.lastSwitch = routeSwitch.x() + "," + routeSwitch.y() + "," + routeSwitch.z()
                    + " → " + routeSwitch.shape().name().toLowerCase();
        }
    }

    private UUID vehicleAhead(RailTrain train) {
        Location origin = train.snapshotLocation();
        State state = states.get(train.id());
        int direction = state == null ? 1 : state.direction;
        Vector forward = new Vector(
                VehicleMath.directionX(train.yaw()),
                0.0,
                VehicleMath.directionZ(train.yaw())
        ).normalize().multiply(direction);
        double maximumSquared = obstacleDistance * obstacleDistance;
        for (ManagedVehicle candidate : vehicleManager.all()) {
            if (!(candidate instanceof RailTrain other) || other.id().equals(train.id())) {
                continue;
            }
            for (Location occupied : other.occupiedLocations()) {
                if (occupied.getWorld() == null || origin.getWorld() == null
                        || !occupied.getWorld().getUID().equals(origin.getWorld().getUID())) {
                    continue;
                }
                Vector delta = occupied.toVector().subtract(origin.toVector());
                double distanceSquared = delta.lengthSquared();
                if (distanceSquared < 0.25 || distanceSquared > maximumSquared) {
                    continue;
                }
                double ahead = delta.dot(forward);
                if (ahead <= 0.0) {
                    continue;
                }
                double lateralSquared = Math.max(0.0, distanceSquared - ahead * ahead);
                if (lateralSquared <= 1.8 * 1.8) {
                    return other.id();
                }
            }
        }
        return null;
    }

    private int nearestStopIndex(VehicleSnapshot snapshot, RailRoute route) {
        return java.util.stream.IntStream.range(0, route.stops().size())
                .boxed()
                .filter(index -> route.stops().get(index).worldId().equals(snapshot.worldId()))
                .min(Comparator.comparingDouble(index -> {
                    RouteStop stop = route.stops().get(index);
                    double dx = stop.x() - snapshot.x();
                    double dy = stop.y() - snapshot.y();
                    double dz = stop.z() - snapshot.z();
                    return dx * dx + dy * dy + dz * dz;
                }))
                .orElse(0);
    }

    private int directionToStop(RailTrain train, RouteStop stop) {
        Location location = train.snapshotLocation();
        World world = world(stop.worldId(), stop.worldName());
        if (world == null || location.getWorld() == null
                || !world.getUID().equals(location.getWorld().getUID())) {
            return 1;
        }
        Vector delta = stop.location(world).toVector().subtract(location.toVector());
        if (delta.lengthSquared() < 2.25) {
            return 1;
        }
        Vector forward = new Vector(
                VehicleMath.directionX(train.yaw()),
                0.0,
                VehicleMath.directionZ(train.yaw())
        );
        return delta.dot(forward) < 0.0 ? -1 : 1;
    }

    private void advanceNextStop(State state, RailRoute route) {
        int size = route.stops().size();
        if (isLoop(route)) {
            state.direction = 1;
            state.nextStopIndex = state.nextStopIndex >= size - 1
                    ? 1
                    : state.nextStopIndex + 1;
            return;
        }
        if (state.direction > 0 && state.nextStopIndex >= size - 1) {
            state.direction = -1;
            state.nextStopIndex = size - 2;
        } else if (state.direction < 0 && state.nextStopIndex <= 0) {
            state.direction = 1;
            state.nextStopIndex = 1;
        } else {
            state.nextStopIndex += state.direction;
        }
    }

    private boolean isLoop(RailRoute route) {
        if (route.stops().size() < 3) {
            return false;
        }
        RouteStop first = route.stops().get(0);
        RouteStop last = route.stops().get(route.stops().size() - 1);
        if (!first.worldId().equals(last.worldId())) {
            return false;
        }
        double dx = first.x() - last.x();
        double dy = first.y() - last.y();
        double dz = first.z() - last.z();
        return dx * dx + dy * dy + dz * dz <= 2.25;
    }

    private void emergency(RailTrain train, State state, AutopilotStatus status) {
        state.status = status;
        state.active = true;
        train.setAutopilotChunkLoading(true);
        if (!state.notifiedEmergency) {
            Player owner = plugin.getServer().getPlayer(train.owner());
            if (owner != null) {
                owner.sendMessage("§6[CustomVehicles] §c" + status.displayName()
                        + ". Откройте меню транспорта.");
            }
            state.notifiedEmergency = true;
        }
        save();
    }

    private void emitDebug(RailTrain train, State state) {
        List<UUID> stale = new ArrayList<>();
        AutopilotDebugSnapshot snapshot = debugSnapshot(train);
        for (Map.Entry<UUID, UUID> entry : debugViewers.entrySet()) {
            if (!entry.getValue().equals(train.id())) {
                continue;
            }
            Player viewer = plugin.getServer().getPlayer(entry.getKey());
            if (viewer == null || !viewer.isOnline()) {
                stale.add(entry.getKey());
                continue;
            }
            AutopilotDebugFormatter.format(snapshot).forEach(viewer::sendMessage);
        }
        stale.forEach(debugViewers::remove);
    }

    private World world(UUID id, String name) {
        World world = plugin.getServer().getWorld(id);
        return world != null ? world : plugin.getServer().getWorld(name);
    }

    private void save() {
        List<AutopilotSavedState> snapshots = new ArrayList<>();
        for (State state : states.values()) {
            if (state.routeId != null) {
                snapshots.add(new AutopilotSavedState(
                        state.vehicleId,
                        state.routeId,
                        state.nextStopIndex,
                        state.direction,
                        state.active && !state.status.emergency()
                ));
            }
        }
        storage.save(snapshots);
    }

    private double positive(double value, double fallback) {
        return value > 0.0 ? value : fallback;
    }

    enum StartResult {
        STARTED,
        ROUTE_MISSING,
        NOT_ENOUGH_STOPS,
        LIMIT_REACHED
    }

    private static final class State {
        private final UUID vehicleId;
        private String routeId;
        private int nextStopIndex;
        private int direction = 1;
        private boolean active;
        private AutopilotStatus status = AutopilotStatus.MANUAL;
        private int dwellRemaining;
        private double lastDistance = Double.MAX_VALUE;
        private long lastProgressTick;
        private boolean notifiedEmergency;
        private double targetDistance = Double.NaN;
        private double brakingDistance;
        private UUID blockingVehicleId;
        private String lastSwitch;
        private String decision = "Ожидает назначения маршрута";

        private State(UUID vehicleId) {
            this.vehicleId = vehicleId;
        }
    }
}
