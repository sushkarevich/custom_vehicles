package ru.customvehicles;

import io.papermc.paper.entity.TeleportFlag;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

final class RailTrain implements ManagedVehicle {
    private static final double[] PASSENGER_SEAT_X = {-0.48, 0.48};
    private static final double TRAM_SECTION_SPACING = 3.72;

    private final CustomVehiclesPlugin plugin;
    private final UUID id;
    private final UUID owner;
    private final VehicleKind kind;
    private final VehicleVariantDefinition variant;
    private final ArmorStand seat;
    private final RailNavigator navigator;
    private final World ticketWorld;
    private final Set<Long> chunkTickets = new HashSet<>();
    private final ModelInstance locomotiveModel;
    private final List<ModelInstance> wagonModels = new ArrayList<>();
    private final List<RailPose> wagonPoses = new ArrayList<>();
    private final List<List<ArmorStand>> wagonSeats = new ArrayList<>();
    private final List<Double> unitSpacings = new ArrayList<>();
    private final List<VehicleVariantDefinition> wagonVariants = new ArrayList<>();
    private RailPose locomotivePose;
    private double speed;
    private double railSoundDistance;
    private int soundTicks;
    private int hornCooldown;
    private boolean hornHeld;
    private boolean pathBlocked;
    private boolean autopilotChunkLoading;

    static RailTrain create(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            TrainSettings settings
    ) {
        return create(
                plugin,
                UUID.randomUUID(),
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAIN_VARIANT)
        );
    }

    static RailTrain create(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            TrainSettings settings,
            VehicleVariantDefinition variant
    ) {
        return createRailVehicle(
                plugin,
                UUID.randomUUID(),
                location,
                owner,
                settings,
                variant
        );
    }

    static RailTrain create(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            TrainSettings settings
    ) {
        return create(
                plugin,
                id,
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAIN_VARIANT)
        );
    }

    static RailTrain create(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            TrainSettings settings,
            VehicleVariantDefinition variant
    ) {
        return createRailVehicle(plugin, id, location, owner, settings, variant);
    }

    static RailTrain createTram(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            TrainSettings settings
    ) {
        return create(
                plugin,
                UUID.randomUUID(),
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAM_VARIANT)
        );
    }

    static RailTrain createTram(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            TrainSettings settings,
            VehicleVariantDefinition variant
    ) {
        return createRailVehicle(
                plugin,
                UUID.randomUUID(),
                location,
                owner,
                settings,
                variant
        );
    }

    static RailTrain createTram(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            TrainSettings settings
    ) {
        return create(
                plugin,
                id,
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.TRAM_VARIANT)
        );
    }

    static RailTrain createTram(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            TrainSettings settings,
            VehicleVariantDefinition variant
    ) {
        return createRailVehicle(plugin, id, location, owner, settings, variant);
    }

    private static RailTrain createRailVehicle(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            TrainSettings settings,
            VehicleVariantDefinition variant
    ) {
        VehicleKind kind = switch (variant.behavior()) {
            case TRAIN -> VehicleKind.TRAIN;
            case TRAM -> VehicleKind.TRAM;
            default -> throw new IllegalArgumentException(
                    "Rail vehicle requires train or tram variant: " + variant.id()
            );
        };
        RailNavigator navigator = new RailNavigator();
        RailPose locomotive = navigator.snap(location, location.getYaw());
        if (locomotive == null) {
            return null;
        }
        RailTrain railVehicle = new RailTrain(
                plugin,
                id,
                owner,
                kind,
                variant,
                navigator,
                locomotive,
                settings
        );
        if (kind == VehicleKind.TRAM && !railVehicle.addTramSections(settings)) {
            railVehicle.remove();
            return null;
        }
        return railVehicle;
    }

    private RailTrain(
            CustomVehiclesPlugin plugin,
            UUID id,
            UUID owner,
            VehicleKind kind,
            VehicleVariantDefinition variant,
            RailNavigator navigator,
            RailPose locomotivePose,
            TrainSettings settings
    ) {
        this.plugin = plugin;
        this.id = id;
        this.owner = owner;
        this.kind = kind;
        this.variant = variant;
        this.navigator = navigator;
        this.locomotivePose = locomotivePose;
        this.ticketWorld = locomotivePose.location().getWorld();
        refreshChunkTickets();
        this.locomotiveModel = new ModelInstance(
                plugin,
                id.toString(),
                plugin.modelRegistry().require(
                        variant.model(kind == VehicleKind.TRAM ? "front" : "locomotive")
                )
        );
        this.seat = spawnSeat(seatLocation(
                locomotivePose,
                settings.seatOffset(),
                0.0,
                kind == VehicleKind.TRAM ? 1.35 : 0.0
        ));
        locomotiveModel.spawn(locomotivePose);
        updateEntities(settings);
    }

    @Override
    public UUID id() {
        return id;
    }

    @Override
    public UUID owner() {
        return owner;
    }

    @Override
    public ArmorStand seat() {
        return seat;
    }

    @Override
    public boolean hasDriver(Player player) {
        return seat.getPassengers().contains(player);
    }

    @Override
    public Player driver() {
        return seat.getPassengers().stream()
                .filter(Player.class::isInstance)
                .map(Player.class::cast)
                .findFirst()
                .orElse(null);
    }

    @Override
    public void mount(Player player) {
        if (seat.getPassengers().isEmpty() && seat.addPassenger(player)) {
            plugin.beginDriving(player);
        }
    }

    void mountFrom(Entity clicked, Player player) {
        if (locomotiveModel.ownsInteraction(clicked)) {
            mount(player);
            return;
        }
        for (int index = 0; index < wagonModels.size(); index++) {
            if (!wagonModels.get(index).ownsInteraction(clicked)) {
                continue;
            }
            for (ArmorStand passengerSeat : wagonSeats.get(index)) {
                if (passengerSeat.getPassengers().isEmpty()
                        && passengerSeat.addPassenger(player)) {
                    return;
                }
            }
            plugin.message(player, "wagon-seats-full");
            return;
        }
    }

    void tick(VehicleInput input, TrainSettings settings) {
        if (!seat.isValid()) {
            return;
        }
        pathBlocked = false;

        double throttle = input.forward();
        speed = VehicleMath.nextSpeed(
                speed,
                throttle,
                settings.maxSpeed(),
                settings.reverseSpeed(),
                settings.acceleration(),
                settings.braking(),
                settings.passiveDrag()
        );
        if (Math.abs(speed) < 0.001) {
            speed = 0.0;
        }
        if (speed == 0.0) {
            updateEntities(settings);
            updateSounds(input, settings, 0.0);
            return;
        }

        RailPose nextLocomotive = navigator.advance(locomotivePose, speed);
        if (nextLocomotive == null) {
            speed = 0.0;
            pathBlocked = true;
            updateSounds(input, settings, 0.0);
            return;
        }
        List<RailPose> nextWagons = new ArrayList<>(wagonModels.size());
        RailPose anchor = nextLocomotive;
        for (int index = 0; index < wagonModels.size(); index++) {
            RailPose nextWagon = navigator.behind(anchor, unitSpacings.get(index));
            if (nextWagon == null) {
                speed = 0.0;
                pathBlocked = true;
                updateSounds(input, settings, 0.0);
                return;
            }
            nextWagons.add(nextWagon);
            anchor = nextWagon;
        }

        locomotivePose = nextLocomotive;
        wagonPoses.clear();
        wagonPoses.addAll(nextWagons);
        refreshChunkTickets();
        updateEntities(settings);
        updateSounds(input, settings, Math.abs(speed));
    }

    private void updateSounds(VehicleInput input, TrainSettings settings, double movedDistance) {
        soundTicks++;
        if (hornCooldown > 0) {
            hornCooldown--;
        }
        if (input.horn() && !hornHeld && hornCooldown == 0) {
            playHorn(settings);
            hornCooldown = 30;
        }
        hornHeld = input.horn();
        updateSpeedometer(input, settings);

        if (settings.soundVolume() <= 0.0) {
            return;
        }
        float volume = soundVolume(settings.soundVolume());
        railSoundDistance += movedDistance;
        if (movedDistance > 0.0) {
            while (railSoundDistance >= 2.4) {
                playRailClack(volume);
                railSoundDistance -= 2.4;
            }
            if (soundTicks % 10 == 0) {
                double speedRatio = Math.min(
                        1.0,
                        Math.abs(speed) / Math.max(0.01, settings.maxSpeed())
                );
                locomotivePose.location().getWorld().playSound(
                        locomotivePose.location(),
                        Sound.ENTITY_MINECART_RIDING,
                        SoundCategory.PLAYERS,
                        volume * 0.34F,
                        (float) (0.65 + speedRatio * 0.65)
                );
            }
        } else if (driver() != null && soundTicks % 30 == 0) {
            locomotivePose.location().getWorld().playSound(
                    locomotivePose.location(),
                    Sound.BLOCK_FURNACE_FIRE_CRACKLE,
                    SoundCategory.PLAYERS,
                    volume * 0.22F,
                    0.7F
            );
        }
    }

    private void updateSpeedometer(VehicleInput input, TrainSettings settings) {
        Player player = driver();
        if (player == null || !settings.speedometerEnabled() || soundTicks % 4 != 0) {
            return;
        }
        AutopilotInfo autopilot = plugin.autopilotManager().info(id);
        Component display = Component.text("Скорость: ", NamedTextColor.GRAY)
                .append(Component.text(
                        VehicleMath.speedKmh(speed) + " км/ч",
                        NamedTextColor.AQUA
                ))
                .append(Component.text("  |  ", NamedTextColor.DARK_GRAY));
        if (autopilot.active()) {
            display = display.append(Component.text("АВТО", NamedTextColor.GREEN));
            if (autopilot.nextStopName() != null) {
                display = display
                        .append(Component.text("  |  → ", NamedTextColor.DARK_GRAY))
                        .append(Component.text(
                                autopilot.nextStopName().replace('_', ' '),
                                NamedTextColor.YELLOW
                        ));
            }
        } else {
            String motion;
            NamedTextColor motionColor;
            if (Math.abs(speed) < 0.01) {
                motion = "СТОП";
                motionColor = NamedTextColor.GRAY;
            } else if ((input.forward() < -0.1 && speed > 0.0)
                    || (input.forward() > 0.1 && speed < 0.0)) {
                motion = "ТОРМОЗ";
                motionColor = NamedTextColor.RED;
            } else if (Math.abs(input.forward()) < 0.1) {
                motion = "НАКАТ";
                motionColor = NamedTextColor.YELLOW;
            } else {
                motion = "ТЯГА";
                motionColor = NamedTextColor.GREEN;
            }
            display = display
                    .append(Component.text("РУЧНОЙ", NamedTextColor.GOLD))
                    .append(Component.text("  |  ", NamedTextColor.DARK_GRAY))
                    .append(Component.text(motion, motionColor));
        }
        player.sendActionBar(display);
    }

    private void playRailClack(float volume) {
        locomotivePose.location().getWorld().playSound(
                locomotivePose.location(),
                Sound.BLOCK_CHAIN_STEP,
                SoundCategory.PLAYERS,
                volume * 0.38F,
                0.9F
        );
        for (int index = 0; index < wagonPoses.size(); index++) {
            RailPose wagonPose = wagonPoses.get(index);
            wagonPose.location().getWorld().playSound(
                    wagonPose.location(),
                    Sound.BLOCK_CHAIN_STEP,
                    SoundCategory.PLAYERS,
                    volume * 0.16F,
                    index % 2 == 0 ? 0.82F : 0.95F
            );
        }
    }

    private void playHorn(TrainSettings settings) {
        if (settings.soundVolume() <= 0.0) {
            return;
        }
        float volume = soundVolume(settings.soundVolume());
        if (kind == VehicleKind.TRAM) {
            locomotivePose.location().getWorld().playSound(
                    locomotivePose.location(),
                    Sound.BLOCK_BELL_USE,
                    SoundCategory.PLAYERS,
                    volume * 1.15F,
                    1.25F
            );
            locomotivePose.location().getWorld().playSound(
                    locomotivePose.location(),
                    Sound.BLOCK_NOTE_BLOCK_BELL,
                    SoundCategory.PLAYERS,
                    volume * 0.75F,
                    1.45F
            );
            return;
        }
        locomotivePose.location().getWorld().playSound(
                locomotivePose.location(),
                Sound.ITEM_GOAT_HORN_SOUND_0,
                SoundCategory.PLAYERS,
                volume * 1.4F,
                0.72F
        );
        locomotivePose.location().getWorld().playSound(
                locomotivePose.location(),
                Sound.BLOCK_NOTE_BLOCK_BASS,
                SoundCategory.PLAYERS,
                volume * 0.65F,
                0.55F
        );
    }

    private void updateEntities(TrainSettings settings) {
        Location nextSeatLocation = seatLocation(
                locomotivePose,
                settings.seatOffset(),
                0.0,
                kind == VehicleKind.TRAM ? 1.35 : 0.0
        );
        if (!seat.teleport(nextSeatLocation, TeleportFlag.EntityState.RETAIN_PASSENGERS)) {
            speed = 0.0;
            pathBlocked = true;
            return;
        }
        locomotiveModel.update(locomotivePose);
        for (int index = 0; index < wagonModels.size(); index++) {
            RailPose wagonPose = wagonPoses.get(index);
            List<ArmorStand> passengerSeats = wagonSeats.get(index);
            for (int seatIndex = 0; seatIndex < passengerSeats.size(); seatIndex++) {
                Location location = seatLocation(
                        wagonPose,
                        settings.seatOffset(),
                        PASSENGER_SEAT_X[seatIndex]
                );
                if (!passengerSeats.get(seatIndex).teleport(
                        location,
                        TeleportFlag.EntityState.RETAIN_PASSENGERS
                )) {
                    speed = 0.0;
                    pathBlocked = true;
                    return;
                }
            }
            wagonModels.get(index).update(wagonPose);
        }
    }

    AttachResult attachWagon(TrainSettings settings) {
        return attachWagon(
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.WAGON_VARIANT)
        );
    }

    AttachResult attachWagon(
            TrainSettings settings,
            VehicleVariantDefinition wagonVariant
    ) {
        if (kind != VehicleKind.TRAIN) {
            return AttachResult.LIMIT_REACHED;
        }
        return attachWagon(settings, wagonVariant, true);
    }

    AttachResult restoreWagon(TrainSettings settings) {
        return restoreWagon(
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.WAGON_VARIANT)
        );
    }

    AttachResult restoreWagon(
            TrainSettings settings,
            VehicleVariantDefinition wagonVariant
    ) {
        if (kind != VehicleKind.TRAIN) {
            return AttachResult.LIMIT_REACHED;
        }
        return attachWagon(settings, wagonVariant, false);
    }

    private AttachResult attachWagon(
            TrainSettings settings,
            VehicleVariantDefinition wagonVariant,
            boolean playSound
    ) {
        if (wagonVariant.behavior() != VehicleBehavior.WAGON) {
            throw new IllegalArgumentException(
                    "Expected wagon variant, got " + wagonVariant.id()
            );
        }
        if (wagonCount() >= settings.maxWagons()) {
            return AttachResult.LIMIT_REACHED;
        }
        RailPose anchor = wagonPoses.isEmpty()
                ? locomotivePose
                : wagonPoses.get(wagonPoses.size() - 1);
        RailPose wagonPose = navigator.behind(anchor, settings.wagonSpacing());
        if (wagonPose == null) {
            return AttachResult.NO_TRACK;
        }
        ensureChunkTicket(wagonPose.location());
        String modelId = wagonVariant.id().equals(BuiltInDefinitions.WAGON_VARIANT)
                ? variant.model("wagon")
                : wagonVariant.model("model");
        ModelInstance model = new ModelInstance(
                plugin,
                id.toString(),
                plugin.modelRegistry().require(modelId)
        );
        model.spawn(wagonPose);
        List<ArmorStand> passengerSeats = new ArrayList<>(PASSENGER_SEAT_X.length);
        for (double additionalX : PASSENGER_SEAT_X) {
            passengerSeats.add(spawnSeat(
                    seatLocation(wagonPose, settings.seatOffset(), additionalX)
            ));
        }
        wagonModels.add(model);
        wagonPoses.add(wagonPose);
        wagonSeats.add(passengerSeats);
        unitSpacings.add(settings.wagonSpacing());
        wagonVariants.add(wagonVariant);
        if (playSound) {
            playCouplingSound(wagonPose.location(), settings.soundVolume(), true);
        }
        return AttachResult.ATTACHED;
    }

    VehicleVariantDefinition detachLastWagon(TrainSettings settings) {
        if (kind != VehicleKind.TRAIN || wagonCount() == 0) {
            return null;
        }
        int lastIndex = wagonModels.size() - 1;
        Location couplingLocation = wagonPoses.get(lastIndex).location();
        wagonModels.remove(lastIndex).remove();
        wagonPoses.remove(wagonPoses.size() - 1);
        removeSeats(wagonSeats.remove(lastIndex));
        unitSpacings.remove(lastIndex);
        VehicleVariantDefinition detachedVariant = wagonVariants.remove(
                wagonVariants.size() - 1
        );
        refreshChunkTickets();
        playCouplingSound(couplingLocation, settings.soundVolume(), false);
        return detachedVariant;
    }

    @Override
    public int wagonCount() {
        return wagonVariants.size();
    }

    @Override
    public List<VehicleVariantDefinition> wagonVariantDefinitions() {
        return List.copyOf(wagonVariants);
    }

    private boolean addTramSections(TrainSettings settings) {
        RailPose middlePose = navigator.behind(locomotivePose, TRAM_SECTION_SPACING);
        if (middlePose == null) {
            return false;
        }
        RailPose rearPose = navigator.behind(middlePose, TRAM_SECTION_SPACING);
        if (rearPose == null) {
            return false;
        }

        ensureChunkTicket(middlePose.location());
        ensureChunkTicket(rearPose.location());
        ModelInstance middleModel = new ModelInstance(
                plugin,
                id.toString(),
                plugin.modelRegistry().require(variant.model("middle"))
        );
        ModelInstance rearModel = new ModelInstance(
                plugin,
                id.toString(),
                plugin.modelRegistry().require(variant.model("rear"))
        );
        middleModel.spawn(middlePose);
        rearModel.spawn(rearPose);

        wagonModels.add(middleModel);
        wagonModels.add(rearModel);
        wagonPoses.add(middlePose);
        wagonPoses.add(rearPose);
        wagonSeats.add(spawnPassengerSeats(middlePose, settings));
        wagonSeats.add(spawnPassengerSeats(rearPose, settings));
        unitSpacings.add(TRAM_SECTION_SPACING);
        unitSpacings.add(TRAM_SECTION_SPACING);
        refreshChunkTickets();
        updateEntities(settings);
        return true;
    }

    private List<ArmorStand> spawnPassengerSeats(RailPose pose, TrainSettings settings) {
        List<ArmorStand> passengerSeats = new ArrayList<>(PASSENGER_SEAT_X.length);
        for (double additionalX : PASSENGER_SEAT_X) {
            passengerSeats.add(spawnSeat(seatLocation(pose, settings.seatOffset(), additionalX)));
        }
        return passengerSeats;
    }

    private ArmorStand spawnSeat(Location location) {
        return location.getWorld().spawn(location, ArmorStand.class, stand -> {
            stand.setVisible(false);
            stand.setMarker(true);
            stand.setSmall(true);
            stand.setBasePlate(false);
            stand.setArms(false);
            stand.setSilent(true);
            stand.setInvulnerable(true);
            stand.setCollidable(false);
            stand.setGravity(false);
            stand.setPersistent(true);
            stand.customName(Component.text("CustomVehicles Seat"));
            stand.setCustomNameVisible(false);
            stand.getPersistentDataContainer()
                    .set(plugin.vehicleKey(), PersistentDataType.STRING, id.toString());
        });
    }

    private Location seatLocation(RailPose pose, SeatOffset offset, double additionalX) {
        return seatLocation(pose, offset, additionalX, 0.0);
    }

    private Location seatLocation(
            RailPose pose,
            SeatOffset offset,
            double additionalX,
            double additionalZ
    ) {
        Vector forward = pose.forward().clone().normalize();
        Vector right = new Vector(forward.getZ(), 0.0, -forward.getX()).normalize();
        Vector up = forward.clone().crossProduct(right).normalize();
        Vector displacement = right.multiply(offset.x() + additionalX)
                .add(up.multiply(offset.y()))
                .add(forward.multiply(offset.z() + additionalZ));
        Location location = pose.location().clone().add(displacement);
        location.setYaw(pose.yaw());
        location.setPitch(pose.pitch());
        return location;
    }

    private void removeSeats(List<ArmorStand> seats) {
        for (ArmorStand passengerSeat : seats) {
            passengerSeat.eject();
            passengerSeat.remove();
        }
    }

    private void ensureChunkTicket(Location location) {
        long key = chunkKey(location.getBlockX() >> 4, location.getBlockZ() >> 4);
        if (chunkTickets.add(key)) {
            ticketWorld.addPluginChunkTicket(chunkX(key), chunkZ(key), plugin);
        }
    }

    private void refreshChunkTickets() {
        Set<Long> desired = new HashSet<>();
        addDesiredChunk(desired, locomotivePose.location());
        wagonPoses.forEach(pose -> addDesiredChunk(desired, pose.location()));
        if (autopilotChunkLoading) {
            int centerX = locomotivePose.location().getBlockX() >> 4;
            int centerZ = locomotivePose.location().getBlockZ() >> 4;
            desired.add(chunkKey(centerX + 1, centerZ));
            desired.add(chunkKey(centerX - 1, centerZ));
            desired.add(chunkKey(centerX, centerZ + 1));
            desired.add(chunkKey(centerX, centerZ - 1));
        }
        for (long key : desired) {
            if (!chunkTickets.contains(key)) {
                ticketWorld.addPluginChunkTicket(chunkX(key), chunkZ(key), plugin);
            }
        }
        for (long key : new HashSet<>(chunkTickets)) {
            if (!desired.contains(key)) {
                ticketWorld.removePluginChunkTicket(chunkX(key), chunkZ(key), plugin);
            }
        }
        chunkTickets.clear();
        chunkTickets.addAll(desired);
    }

    private void addDesiredChunk(Set<Long> desired, Location location) {
        desired.add(chunkKey(location.getBlockX() >> 4, location.getBlockZ() >> 4));
    }

    private long chunkKey(int x, int z) {
        return ((long) x << 32) ^ (z & 0xffffffffL);
    }

    private int chunkX(long key) {
        return (int) (key >> 32);
    }

    private int chunkZ(long key) {
        return (int) key;
    }

    private void playCouplingSound(Location location, double configuredVolume, boolean attaching) {
        if (configuredVolume <= 0.0) {
            return;
        }
        float volume = soundVolume(configuredVolume);
        location.getWorld().playSound(
                location,
                attaching ? Sound.BLOCK_CHAIN_PLACE : Sound.BLOCK_CHAIN_BREAK,
                SoundCategory.PLAYERS,
                volume * 0.9F,
                attaching ? 0.75F : 1.05F
        );
        location.getWorld().playSound(
                location,
                attaching ? Sound.BLOCK_PISTON_CONTRACT : Sound.BLOCK_PISTON_EXTEND,
                SoundCategory.PLAYERS,
                volume * 0.45F,
                0.7F
        );
    }

    private float soundVolume(double configured) {
        return (float) Math.min(2.0, configured);
    }

    @Override
    public void remove() {
        Player driver = driver();
        if (driver != null) {
            plugin.endDriving(driver);
        }
        seat.eject();
        seat.remove();
        locomotiveModel.remove();
        wagonModels.forEach(ModelInstance::remove);
        wagonSeats.forEach(this::removeSeats);
        wagonModels.clear();
        wagonPoses.clear();
        wagonSeats.clear();
        unitSpacings.clear();
        wagonVariants.clear();
        for (long key : chunkTickets) {
            ticketWorld.removePluginChunkTicket(chunkX(key), chunkZ(key), plugin);
        }
        chunkTickets.clear();
    }

    @Override
    public double speed() {
        return speed;
    }

    @Override
    public float yaw() {
        return locomotivePose.yaw();
    }

    Location snapshotLocation() {
        return locomotivePose.location().clone();
    }

    List<Location> occupiedLocations() {
        List<Location> locations = new ArrayList<>(wagonPoses.size() + 1);
        locations.add(locomotivePose.location().clone());
        wagonPoses.stream().map(RailPose::location).map(Location::clone).forEach(locations::add);
        return List.copyOf(locations);
    }

    void setAutopilotChunkLoading(boolean enabled) {
        if (autopilotChunkLoading == enabled) {
            return;
        }
        autopilotChunkLoading = enabled;
        refreshChunkTickets();
    }

    boolean consumePathBlocked() {
        boolean blocked = pathBlocked;
        pathBlocked = false;
        return blocked;
    }

    void clearPathBlocked() {
        pathBlocked = false;
    }

    @Override
    public VehicleKind kind() {
        return kind;
    }

    @Override
    public VehicleVariantDefinition variantDefinition() {
        return variant;
    }

    @Override
    public VehicleSnapshot snapshot() {
        Location location = locomotivePose.location();
        return new VehicleSnapshot(
                id,
                kind,
                owner,
                location.getWorld().getUID(),
                location.getWorld().getName(),
                location.getX(),
                location.getY(),
                location.getZ(),
                locomotivePose.yaw(),
                variant.id(),
                wagonVariantIds()
        );
    }

    enum AttachResult {
        ATTACHED,
        LIMIT_REACHED,
        NO_TRACK
    }

}
