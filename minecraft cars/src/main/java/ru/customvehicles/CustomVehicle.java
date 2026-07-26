package ru.customvehicles;

import io.papermc.paper.entity.TeleportFlag;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;

import java.util.UUID;

final class CustomVehicle implements ManagedVehicle {
    private static final double HALF_WIDTH = 0.82;
    private static final double HALF_LENGTH = 1.48;

    private final CustomVehiclesPlugin plugin;
    private final UUID id;
    private final UUID owner;
    private final VehicleVariantDefinition variant;
    private final ArmorStand seat;
    private final ModelInstance model;
    private Location chassisLocation;
    private int ticketChunkX;
    private int ticketChunkZ;
    private boolean chunkTicketHeld;
    private double speed;
    private float yaw;
    private int soundTicks;
    private int hornCooldown;
    private int collisionCooldown;
    private int gearShiftCooldown;
    private int currentGear = 1;
    private boolean hornHeld;

    CustomVehicle(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            VehicleSettings settings
    ) {
        this(
                plugin,
                UUID.randomUUID(),
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.CAR_VARIANT)
        );
    }

    CustomVehicle(
            CustomVehiclesPlugin plugin,
            Location location,
            UUID owner,
            VehicleSettings settings,
            VehicleVariantDefinition variant
    ) {
        this(plugin, UUID.randomUUID(), location, owner, settings, variant);
    }

    CustomVehicle(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            VehicleSettings settings
    ) {
        this(
                plugin,
                id,
                location,
                owner,
                settings,
                plugin.variantRegistry().require(BuiltInDefinitions.CAR_VARIANT)
        );
    }

    CustomVehicle(
            CustomVehiclesPlugin plugin,
            UUID id,
            Location location,
            UUID owner,
            VehicleSettings settings,
            VehicleVariantDefinition variant
    ) {
        if (variant.behavior() != VehicleBehavior.CAR) {
            throw new IllegalArgumentException("Car requires a car variant: " + variant.id());
        }
        this.plugin = plugin;
        this.id = id;
        this.owner = owner;
        this.variant = variant;
        this.yaw = location.getYaw();
        this.chassisLocation = location.clone();
        holdInitialChunkTicket();
        this.model = new ModelInstance(
                plugin,
                id.toString(),
                plugin.modelRegistry().require(variant.model("model"))
        );
        Location initialSeatLocation = seatLocation(chassisLocation, settings.seatOffset());
        this.seat = location.getWorld().spawn(initialSeatLocation, ArmorStand.class, stand -> {
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
            stand.customName(net.kyori.adventure.text.Component.text("CustomVehicles Seat"));
            stand.setCustomNameVisible(false);
            stand.getPersistentDataContainer()
                    .set(plugin.vehicleKey(), PersistentDataType.STRING, id.toString());
        });
        model.spawn(chassisLocation, yaw);
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

    void tick(VehicleInput input, VehicleSettings settings) {
        if (!seat.isValid()) {
            return;
        }

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

        double speedRatio = Math.min(1.0, Math.abs(speed) / Math.max(0.01, settings.maxSpeed()));
        if (Math.abs(input.sideways()) > 0.01 && speedRatio > 0.02) {
            double direction = speed >= 0.0 ? 1.0 : -1.0;
            yaw += (float) (-input.sideways() * settings.steeringDegreesPerTick()
                    * Math.max(0.25, speedRatio) * direction);
        }

        Location current = chassisLocation.clone();
        Location targetLocation = current.clone().add(
                VehicleMath.directionX(yaw) * speed,
                0.0,
                VehicleMath.directionZ(yaw) * speed
        );
        Location adjusted = adjustHeight(targetLocation, settings.stepHeight());
        if (adjusted != null && canOccupy(adjusted)) {
            moveTo(adjusted, settings.seatOffset());
        } else {
            playCollision(settings, Math.abs(speed));
            speed = 0.0;
        }
        updateTransmission(input, settings);
        updateSounds(input, settings);
        updateSpeedometer(input, settings);
    }

    private void updateTransmission(VehicleInput input, VehicleSettings settings) {
        int targetGear = VehicleMath.forwardGear(speed, settings.maxSpeed());
        if (targetGear == 0) {
            currentGear = 1;
            return;
        }
        if (targetGear == currentGear) {
            return;
        }
        boolean upshift = targetGear > currentGear;
        currentGear = targetGear;
        if (upshift
                && input.forward() > 0.1
                && gearShiftCooldown == 0
                && driver() != null
                && settings.soundVolume() > 0.0) {
            playGearShift(settings, targetGear);
            gearShiftCooldown = 8;
        }
    }

    private void updateSounds(VehicleInput input, VehicleSettings settings) {
        soundTicks++;
        if (hornCooldown > 0) {
            hornCooldown--;
        }
        if (collisionCooldown > 0) {
            collisionCooldown--;
        }
        if (gearShiftCooldown > 0) {
            gearShiftCooldown--;
        }

        if (input.horn() && !hornHeld && hornCooldown == 0) {
            playHorn(settings);
            hornCooldown = 12;
        }
        hornHeld = input.horn();

        if (driver() == null || settings.soundVolume() <= 0.0) {
            return;
        }
        float volume = soundVolume(settings.soundVolume());
        if (Math.abs(speed) > 0.015) {
            if (soundTicks % 6 == 0) {
                chassisLocation.getWorld().playSound(
                        chassisLocation,
                        Sound.ENTITY_MINECART_RIDING,
                        SoundCategory.PLAYERS,
                        volume * 0.28F,
                        VehicleMath.enginePitch(speed, settings.maxSpeed(), currentGear)
                );
            }
        } else if (soundTicks % 24 == 0) {
            chassisLocation.getWorld().playSound(
                    chassisLocation,
                    Sound.BLOCK_BLASTFURNACE_FIRE_CRACKLE,
                    SoundCategory.PLAYERS,
                    volume * 0.16F,
                    0.65F
            );
        }
    }

    private void updateSpeedometer(VehicleInput input, VehicleSettings settings) {
        Player player = driver();
        if (player == null || !settings.speedometerEnabled() || soundTicks % 4 != 0) {
            return;
        }
        int kmh = VehicleMath.speedKmh(speed);
        String transmission = speed < -0.01
                ? "R"
                : Math.abs(speed) < 0.01 ? "N" : "D" + currentGear;
        String motion;
        NamedTextColor motionColor;
        if (Math.abs(speed) < 0.01) {
            motion = "СТОП";
            motionColor = NamedTextColor.GRAY;
        } else if (input.forward() < -0.1 && speed > 0.0
                || input.forward() > 0.1 && speed < 0.0) {
            motion = "ТОРМОЗ";
            motionColor = NamedTextColor.RED;
        } else if (Math.abs(input.forward()) < 0.1) {
            motion = "НАКАТ";
            motionColor = NamedTextColor.YELLOW;
        } else {
            motion = "ГАЗ";
            motionColor = NamedTextColor.GREEN;
        }
        player.sendActionBar(
                Component.text("Скорость: ", NamedTextColor.GRAY)
                        .append(Component.text(kmh + " км/ч", NamedTextColor.AQUA))
                        .append(Component.text("  |  ", NamedTextColor.DARK_GRAY))
                        .append(Component.text(transmission, NamedTextColor.GOLD))
                        .append(Component.text("  |  ", NamedTextColor.DARK_GRAY))
                        .append(Component.text(motion, motionColor))
        );
    }

    private void playGearShift(VehicleSettings settings, int gear) {
        float volume = soundVolume(settings.soundVolume());
        World world = chassisLocation.getWorld();
        world.playSound(
                chassisLocation,
                Sound.BLOCK_PISTON_CONTRACT,
                SoundCategory.PLAYERS,
                volume * 0.18F,
                1.35F + gear * 0.08F
        );
        world.playSound(
                chassisLocation,
                Sound.ENTITY_MINECART_RIDING,
                SoundCategory.PLAYERS,
                volume * 0.22F,
                0.58F
        );
    }

    private void playHorn(VehicleSettings settings) {
        if (settings.soundVolume() <= 0.0) {
            return;
        }
        float volume = soundVolume(settings.soundVolume());
        chassisLocation.getWorld().playSound(
                chassisLocation,
                Sound.BLOCK_NOTE_BLOCK_DIDGERIDOO,
                SoundCategory.PLAYERS,
                volume * 0.9F,
                1.25F
        );
        chassisLocation.getWorld().playSound(
                chassisLocation,
                Sound.BLOCK_NOTE_BLOCK_BELL,
                SoundCategory.PLAYERS,
                volume * 0.45F,
                0.85F
        );
    }

    private void playCollision(VehicleSettings settings, double impactSpeed) {
        if (impactSpeed < 0.10
                || collisionCooldown > 0
                || settings.soundVolume() <= 0.0) {
            return;
        }
        float volume = soundVolume(settings.soundVolume());
        chassisLocation.getWorld().playSound(
                chassisLocation,
                Sound.BLOCK_ANVIL_LAND,
                SoundCategory.PLAYERS,
                volume * (float) Math.min(0.9, 0.25 + impactSpeed),
                0.8F
        );
        collisionCooldown = 12;
    }

    private float soundVolume(double configured) {
        return (float) Math.min(2.0, configured);
    }

    private Location adjustHeight(Location target, double stepHeight) {
        if (canOccupy(target) && hasGround(target)) {
            return target;
        }
        for (double offset = 0.25; offset <= stepHeight + 0.001; offset += 0.25) {
            Location up = target.clone().add(0, offset, 0);
            if (canOccupy(up) && hasGround(up)) {
                return up;
            }
            Location down = target.clone().add(0, -offset, 0);
            if (canOccupy(down) && hasGround(down)) {
                return down;
            }
        }
        return null;
    }

    private boolean canOccupy(Location center) {
        double[][] points = {
                {-HALF_WIDTH, -HALF_LENGTH},
                {HALF_WIDTH, -HALF_LENGTH},
                {-HALF_WIDTH, HALF_LENGTH},
                {HALF_WIDTH, HALF_LENGTH}
        };
        for (double[] point : points) {
            double x = center.getX() + VehicleMath.rotateX(point[0], point[1], yaw);
            double z = center.getZ() + VehicleMath.rotateZ(point[0], point[1], yaw);
            if (!passable(center.getWorld(), x, center.getY() + 0.20, z)
                    || !passable(center.getWorld(), x, center.getY() + 1.10, z)) {
                return false;
            }
        }
        return true;
    }

    private boolean hasGround(Location center) {
        double[][] supportPoints = {
                {0.0, 0.0},
                {-HALF_WIDTH, -HALF_LENGTH},
                {HALF_WIDTH, -HALF_LENGTH},
                {-HALF_WIDTH, HALF_LENGTH},
                {HALF_WIDTH, HALF_LENGTH},
                {0.0, -HALF_LENGTH},
                {0.0, HALF_LENGTH}
        };
        for (double[] point : supportPoints) {
            double x = center.getX() + VehicleMath.rotateX(point[0], point[1], yaw);
            double z = center.getZ() + VehicleMath.rotateZ(point[0], point[1], yaw);
            if (!passable(center.getWorld(), x, center.getY() - 0.15, z)) {
                return true;
            }
        }
        return false;
    }

    private boolean passable(World world, double x, double y, double z) {
        Block block = world.getBlockAt(
                (int) Math.floor(x),
                (int) Math.floor(y),
                (int) Math.floor(z)
        );
        return block.isPassable() || !block.getBoundingBox().contains(x, y, z);
    }

    private void moveTo(Location base, SeatOffset offset) {
        Location nextSeatLocation = seatLocation(base, offset);
        int nextChunkX = base.getBlockX() >> 4;
        int nextChunkZ = base.getBlockZ() >> 4;
        boolean chunkChanged = nextChunkX != ticketChunkX || nextChunkZ != ticketChunkZ;
        if (chunkChanged) {
            base.getWorld().addPluginChunkTicket(nextChunkX, nextChunkZ, plugin);
        }
        if (seat.teleport(nextSeatLocation, TeleportFlag.EntityState.RETAIN_PASSENGERS)) {
            if (chunkChanged) {
                base.getWorld().removePluginChunkTicket(ticketChunkX, ticketChunkZ, plugin);
                ticketChunkX = nextChunkX;
                ticketChunkZ = nextChunkZ;
            }
            chassisLocation = base.clone();
            updateModel();
        } else {
            if (chunkChanged) {
                base.getWorld().removePluginChunkTicket(nextChunkX, nextChunkZ, plugin);
            }
            speed = 0.0;
        }
    }

    private void holdInitialChunkTicket() {
        ticketChunkX = chassisLocation.getBlockX() >> 4;
        ticketChunkZ = chassisLocation.getBlockZ() >> 4;
        chassisLocation.getWorld().addPluginChunkTicket(ticketChunkX, ticketChunkZ, plugin);
        chunkTicketHeld = true;
    }

    private Location seatLocation(Location base, SeatOffset offset) {
        double x = base.getX() + VehicleMath.rotateX(offset.x(), offset.z(), yaw);
        double z = base.getZ() + VehicleMath.rotateZ(offset.x(), offset.z(), yaw);
        Location location = new Location(
                base.getWorld(),
                x,
                base.getY() + offset.y(),
                z,
                yaw,
                0.0F
        );
        return location;
    }

    private void updateModel() {
        model.update(chassisLocation, yaw);
    }

    @Override
    public void remove() {
        Player driver = driver();
        if (driver != null) {
            plugin.endDriving(driver);
        }
        seat.eject();
        seat.remove();
        model.remove();
        if (chunkTicketHeld) {
            chassisLocation.getWorld().removePluginChunkTicket(
                    ticketChunkX,
                    ticketChunkZ,
                    plugin
            );
            chunkTicketHeld = false;
        }
    }

    @Override
    public double speed() {
        return speed;
    }

    @Override
    public float yaw() {
        return yaw;
    }

    @Override
    public VehicleKind kind() {
        return VehicleKind.CAR;
    }

    @Override
    public VehicleVariantDefinition variantDefinition() {
        return variant;
    }

    @Override
    public VehicleSnapshot snapshot() {
        World world = chassisLocation.getWorld();
        return new VehicleSnapshot(
                id,
                VehicleKind.CAR,
                owner,
                world.getUID(),
                world.getName(),
                chassisLocation.getX(),
                chassisLocation.getY(),
                chassisLocation.getZ(),
                yaw,
                variant.id(),
                java.util.List.of()
        );
    }

}
