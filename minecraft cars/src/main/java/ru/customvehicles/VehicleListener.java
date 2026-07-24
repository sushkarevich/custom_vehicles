package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Rail;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDismountEvent;
import org.bukkit.event.player.PlayerInteractAtEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

final class VehicleListener implements Listener {
    private final CustomVehiclesPlugin plugin;

    VehicleListener(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPlace(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND || event.getAction() != Action.RIGHT_CLICK_BLOCK) {
            return;
        }
        ItemStack item = event.getItem();
        if (!plugin.isVehicleItem(item)) {
            return;
        }
        event.setCancelled(true);
        Player player = event.getPlayer();
        if (!player.hasPermission("customvehicles.drive")) {
            plugin.message(player, "no-permission");
            return;
        }
        VehicleVariantDefinition variant = plugin.vehicleVariant(item);
        if (variant == null) {
            plugin.messageVariantUnavailable(player, item);
            return;
        }
        if (variant.permissionValue().isPresent()
                && !player.hasPermission(variant.permissionValue().orElseThrow())) {
            plugin.message(player, "no-permission");
            return;
        }
        Block block = event.getClickedBlock();
        if (block == null) {
            return;
        }
        VehicleKind kind = VehicleKind.fromBehavior(variant.behavior());
        if (kind == VehicleKind.WAGON) {
            plugin.message(player, "wagon-use-on-train");
            return;
        }
        if ((kind == VehicleKind.TRAIN || kind == VehicleKind.TRAM)
                && !Tag.RAILS.isTagged(block.getType())) {
            plugin.message(player, "train-rails-only");
            return;
        }
        Location spawn = placementLocation(block, event.getBlockFace());
        spawn.setYaw(placementYaw(block, player.getLocation().getYaw()));
        ManagedVehicle spawned = switch (kind) {
            case TRAIN -> plugin.vehicleManager().spawnTrain(
                    spawn,
                    player.getUniqueId(),
                    variant
            );
            case TRAM -> plugin.vehicleManager().spawnTram(
                    spawn,
                    player.getUniqueId(),
                    variant
            );
            case CAR -> plugin.vehicleManager().spawn(
                    spawn,
                    player.getUniqueId(),
                    variant
            );
            case WAGON -> null;
        };
        if (spawned == null) {
            plugin.messagePlacementFailed(player, variant);
            return;
        }
        if (player.getGameMode().isInvulnerable()) {
            // Keep the reusable item in creative mode.
        } else {
            item.setAmount(item.getAmount() - 1);
        }
        plugin.messageVehiclePlaced(player, variant);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onVehicleInteract(PlayerInteractAtEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) {
            return;
        }
        ManagedVehicle vehicle = plugin.vehicleManager().fromEntity(event.getRightClicked());
        if (vehicle == null) {
            return;
        }
        event.setCancelled(true);
        Player player = event.getPlayer();
        ItemStack heldItem = player.getInventory().getItemInMainHand();
        if (plugin.isVehicleItem(heldItem)
                && plugin.vehicleKind(heldItem) == VehicleKind.WAGON) {
            attachWagon(player, vehicle, heldItem);
            return;
        }
        if (player.isSneaking()
                && heldItem.getType() == org.bukkit.Material.LEAD
                && vehicle instanceof RailTrain train
                && train.kind() == VehicleKind.TRAIN) {
            if (!plugin.canManage(player, train)) {
                plugin.message(player, "no-permission");
                return;
            }
            VehicleVariantDefinition detachedVariant = plugin.vehicleManager()
                    .detachLastWagon(train);
            if (detachedVariant != null) {
                plugin.giveVehicleItem(player, detachedVariant);
                plugin.message(player, "wagon-detached");
            } else {
                plugin.message(player, "wagon-none");
            }
            return;
        }
        if (player.isSneaking()) {
            if (plugin.canManage(player, vehicle)) {
                plugin.openVehicleMenu(player, vehicle);
            } else {
                plugin.message(player, "no-permission");
            }
            return;
        }
        if (player.hasPermission("customvehicles.drive")) {
            if (vehicle instanceof RailTrain train) {
                train.mountFrom(event.getRightClicked(), player);
            } else {
                vehicle.mount(player);
            }
        } else {
            plugin.message(player, "no-permission");
        }
    }

    private void attachWagon(Player player, ManagedVehicle vehicle, ItemStack wagonItem) {
        if (!(vehicle instanceof RailTrain train)) {
            plugin.message(player, "wagon-train-only");
            return;
        }
        if (train.kind() != VehicleKind.TRAIN) {
            plugin.message(player, "wagon-train-only");
            return;
        }
        if (!plugin.canManage(player, train)) {
            plugin.message(player, "no-permission");
            return;
        }
        VehicleVariantDefinition wagonVariant = plugin.vehicleVariant(wagonItem);
        if (wagonVariant == null) {
            plugin.messageVariantUnavailable(player, wagonItem);
            return;
        }
        if (wagonVariant.permissionValue().isPresent()
                && !player.hasPermission(wagonVariant.permissionValue().orElseThrow())) {
            plugin.message(player, "no-permission");
            return;
        }
        RailTrain.AttachResult result = plugin.vehicleManager().attachWagon(
                train,
                wagonVariant
        );
        switch (result) {
            case ATTACHED -> {
                if (!player.getGameMode().isInvulnerable()) {
                    wagonItem.setAmount(wagonItem.getAmount() - 1);
                }
                plugin.message(player, "wagon-attached");
            }
            case LIMIT_REACHED -> plugin.message(player, "wagon-limit");
            case NO_TRACK -> plugin.message(player, "wagon-no-track");
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        plugin.endDriving(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDismount(EntityDismountEvent event) {
        if (!(event.getEntity() instanceof Player player)
                || plugin.vehicleManager().fromEntity(event.getDismounted()) == null) {
            return;
        }
        plugin.endDriving(player);
    }

    private float snapYaw(float yaw) {
        return Math.round(yaw / 15.0F) * 15.0F;
    }

    private Location placementLocation(Block block, BlockFace face) {
        if (Tag.RAILS.isTagged(block.getType())) {
            double railHeight = 0.14;
            if (block.getBlockData() instanceof Rail rail && isAscending(rail.getShape())) {
                railHeight = 0.56;
            }
            return new Location(
                    block.getWorld(),
                    block.getX() + 0.5,
                    block.getY() + railHeight,
                    block.getZ() + 0.5
            );
        }
        return block.getRelative(face).getLocation().add(0.5, 0.05, 0.5);
    }

    private float placementYaw(Block block, float playerYaw) {
        if (!(block.getBlockData() instanceof Rail rail)) {
            return snapYaw(playerYaw);
        }
        return switch (rail.getShape()) {
            case EAST_WEST, ASCENDING_EAST, ASCENDING_WEST -> nearestYaw(playerYaw, 90.0F, -90.0F);
            case NORTH_SOUTH, ASCENDING_NORTH, ASCENDING_SOUTH -> nearestYaw(playerYaw, 0.0F, 180.0F);
            case SOUTH_EAST -> nearestYaw(playerYaw, 0.0F, -90.0F);
            case SOUTH_WEST -> nearestYaw(playerYaw, 0.0F, 90.0F);
            case NORTH_WEST -> nearestYaw(playerYaw, 180.0F, 90.0F);
            case NORTH_EAST -> nearestYaw(playerYaw, 180.0F, -90.0F);
        };
    }

    private float nearestYaw(float current, float first, float second) {
        return angularDistance(current, first) <= angularDistance(current, second) ? first : second;
    }

    private float angularDistance(float first, float second) {
        float delta = (first - second) % 360.0F;
        if (delta > 180.0F) {
            delta -= 360.0F;
        } else if (delta < -180.0F) {
            delta += 360.0F;
        }
        return Math.abs(delta);
    }

    private boolean isAscending(Rail.Shape shape) {
        return switch (shape) {
            case ASCENDING_EAST, ASCENDING_WEST, ASCENDING_NORTH, ASCENDING_SOUTH -> true;
            default -> false;
        };
    }
}
