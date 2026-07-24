package ru.customvehicles;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.util.Vector;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class ActiveVehiclesMenu implements Listener {
    private static final int SIZE = 54;
    private static final int VEHICLES_PER_PAGE = 45;
    private static final int PREVIOUS_PAGE = 45;
    private static final int REFRESH = 49;
    private static final int NEXT_PAGE = 52;
    private static final int CLOSE = 53;

    private final CustomVehiclesPlugin plugin;

    ActiveVehiclesMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player) {
        open(player, 0);
    }

    private void open(Player player, int requestedPage) {
        List<ManagedVehicle> vehicles = plugin.vehicleManager().all().stream()
                .sorted(Comparator
                        .comparing((ManagedVehicle vehicle) -> vehicle.kind().ordinal())
                        .thenComparing(vehicle -> vehicle.id().toString()))
                .toList();
        int pageCount = Math.max(1, (vehicles.size() + VEHICLES_PER_PAGE - 1) / VEHICLES_PER_PAGE);
        int page = Math.max(0, Math.min(requestedPage, pageCount - 1));

        ActiveVehiclesHolder holder = new ActiveVehiclesHolder(page);
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text("Активный транспорт", NamedTextColor.DARK_GRAY)
        );
        holder.inventory = inventory;
        render(holder, vehicles, pageCount);
        player.openInventory(inventory);
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder() instanceof ActiveVehiclesHolder holder)) {
            return;
        }
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)
                || event.getRawSlot() < 0
                || event.getRawSlot() >= SIZE) {
            return;
        }

        int slot = event.getRawSlot();
        if (slot == CLOSE) {
            player.closeInventory();
            return;
        }
        if (slot == REFRESH) {
            open(player, holder.page);
            click(player);
            return;
        }
        if (slot == PREVIOUS_PAGE && holder.page > 0) {
            open(player, holder.page - 1);
            click(player);
            return;
        }
        if (slot == NEXT_PAGE && holder.hasNextPage) {
            open(player, holder.page + 1);
            click(player);
            return;
        }

        UUID vehicleId = holder.vehicleSlots.get(slot);
        if (vehicleId == null) {
            return;
        }
        ManagedVehicle vehicle = plugin.vehicleManager().byId(vehicleId);
        if (vehicle == null) {
            player.sendMessage("§cЭтот транспорт уже не активен.");
            open(player, holder.page);
            return;
        }
        teleport(player, vehicle);
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof ActiveVehiclesHolder
                && event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void render(
            ActiveVehiclesHolder holder,
            List<ManagedVehicle> vehicles,
            int pageCount
    ) {
        Inventory inventory = holder.getInventory();
        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = VEHICLES_PER_PAGE; slot < SIZE; slot++) {
            inventory.setItem(slot, filler);
        }

        int firstIndex = holder.page * VEHICLES_PER_PAGE;
        int lastIndex = Math.min(firstIndex + VEHICLES_PER_PAGE, vehicles.size());
        for (int index = firstIndex; index < lastIndex; index++) {
            int slot = index - firstIndex;
            ManagedVehicle vehicle = vehicles.get(index);
            holder.vehicleSlots.put(slot, vehicle.id());
            inventory.setItem(slot, vehicleItem(vehicle, index + 1));
        }

        if (vehicles.isEmpty()) {
            inventory.setItem(22, item(
                    Material.BARRIER,
                    "Активного транспорта нет",
                    NamedTextColor.RED,
                    List.of(Component.text("Установленные машины и составы появятся здесь", NamedTextColor.GRAY))
            ));
        }
        if (holder.page > 0) {
            inventory.setItem(PREVIOUS_PAGE, item(
                    Material.ARROW,
                    "Предыдущая страница",
                    NamedTextColor.YELLOW,
                    List.of(Component.text("Страница " + holder.page + " из " + pageCount, NamedTextColor.GRAY))
            ));
        }
        holder.hasNextPage = holder.page + 1 < pageCount;
        if (holder.hasNextPage) {
            inventory.setItem(NEXT_PAGE, item(
                    Material.ARROW,
                    "Следующая страница",
                    NamedTextColor.YELLOW,
                    List.of(Component.text("Страница " + (holder.page + 2) + " из " + pageCount, NamedTextColor.GRAY))
            ));
        }
        inventory.setItem(REFRESH, item(
                Material.COMPASS,
                "Обновить список",
                NamedTextColor.GREEN,
                List.of(
                        Component.text("Активно: " + vehicles.size(), NamedTextColor.AQUA),
                        Component.text(
                                "Страница " + (holder.page + 1) + " из " + pageCount,
                                NamedTextColor.GRAY
                        ),
                        Component.text("Нажмите, чтобы обновить координаты", NamedTextColor.GREEN)
                )
        ));
        inventory.setItem(CLOSE, item(Material.BARRIER, "Закрыть", NamedTextColor.RED, List.of()));
    }

    private ItemStack vehicleItem(ManagedVehicle vehicle, int number) {
        VehicleSnapshot snapshot = vehicle.snapshot();
        boolean train = vehicle.kind() == VehicleKind.TRAIN;
        boolean tram = vehicle.kind() == VehicleKind.TRAM;
        OfflinePlayer owner = Bukkit.getOfflinePlayer(vehicle.owner());
        String ownerName = owner.getName() == null
                ? vehicle.owner().toString().substring(0, 8)
                : owner.getName();
        List<Component> lore = new java.util.ArrayList<>();
        lore.add(Component.text("Владелец: " + ownerName, NamedTextColor.GRAY));
        lore.add(Component.text("Мир: " + snapshot.worldName(), NamedTextColor.GRAY));
        lore.add(Component.text(
                String.format(Locale.ROOT, "X: %.2f   Y: %.2f   Z: %.2f", snapshot.x(), snapshot.y(), snapshot.z()),
                NamedTextColor.AQUA
        ));
        lore.add(Component.text(
                "Направление: " + Math.round(normalizeYaw(snapshot.yaw())) + "°",
                NamedTextColor.DARK_GRAY
        ));
        if (train) {
            lore.add(Component.text("Пассажирских вагонов: " + vehicle.wagonCount(), NamedTextColor.GRAY));
        } else if (tram) {
            lore.add(Component.text("Секций: 3", NamedTextColor.GRAY));
        }
        lore.add(Component.empty());
        lore.add(Component.text("Нажмите, чтобы телепортироваться", NamedTextColor.GREEN));
        VehicleVariantDefinition variant = vehicle.variantDefinition();

        return item(
                variant.item().material(),
                "#" + number + " · " + variant.displayName(),
                train || tram ? NamedTextColor.AQUA : NamedTextColor.GOLD,
                lore
        );
    }

    private void teleport(Player player, ManagedVehicle vehicle) {
        VehicleSnapshot snapshot = vehicle.snapshot();
        World world = plugin.getServer().getWorld(snapshot.worldId());
        if (world == null) {
            world = plugin.getServer().getWorld(snapshot.worldName());
        }
        if (world == null) {
            player.closeInventory();
            player.sendMessage("§cМир этого транспорта сейчас недоступен.");
            return;
        }

        Location destination = nearbyLocation(world, snapshot, vehicle.kind());
        player.closeInventory();
        player.leaveVehicle();
        if (!player.teleport(destination)) {
            player.sendMessage("§cНе удалось телепортироваться к транспорту.");
            return;
        }
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.7F, 1.2F);
        player.sendMessage(String.format(
                Locale.ROOT,
                "§6[CustomVehicles] §aТелепортация к транспорту: §f%s §7(%.2f, %.2f, %.2f)",
                snapshot.worldName(),
                snapshot.x(),
                snapshot.y(),
                snapshot.z()
        ));
    }

    private Location nearbyLocation(World world, VehicleSnapshot snapshot, VehicleKind kind) {
        double radians = Math.toRadians(snapshot.yaw());
        double distance = kind == VehicleKind.TRAIN || kind == VehicleKind.TRAM ? 3.4 : 2.4;
        double rightX = Math.cos(radians) * distance;
        double rightZ = Math.sin(radians) * distance;
        double y = snapshot.y() + 0.2;
        Location target = new Location(world, snapshot.x(), snapshot.y() + 1.0, snapshot.z());

        Location right = new Location(world, snapshot.x() + rightX, y, snapshot.z() + rightZ);
        Location left = new Location(world, snapshot.x() - rightX, y, snapshot.z() - rightZ);
        Location destination = isSafe(right) ? right : isSafe(left) ? left : target.clone().add(0.0, 1.6, 0.0);
        Vector lookDirection = target.toVector().subtract(destination.toVector());
        if (lookDirection.lengthSquared() > 0.0001) {
            destination.setDirection(lookDirection);
        }
        return destination;
    }

    private boolean isSafe(Location location) {
        return location.getBlock().isPassable()
                && location.clone().add(0.0, 1.0, 0.0).getBlock().isPassable();
    }

    private float normalizeYaw(float yaw) {
        float normalized = yaw % 360.0F;
        return normalized < 0.0F ? normalized + 360.0F : normalized;
    }

    private ItemStack item(
            Material material,
            String name,
            NamedTextColor color,
            List<Component> lore
    ) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(Component.text(name, color));
        meta.lore(lore);
        stack.setItemMeta(meta);
        return stack;
    }

    private void click(Player player) {
        player.playSound(player, Sound.UI_BUTTON_CLICK, 0.6F, 1.2F);
    }

    private static final class ActiveVehiclesHolder implements InventoryHolder {
        private final int page;
        private final Map<Integer, UUID> vehicleSlots = new HashMap<>();
        private Inventory inventory;
        private boolean hasNextPage;

        private ActiveVehiclesHolder(int page) {
            this.page = page;
        }

        @Override
        public Inventory getInventory() {
            return inventory;
        }
    }
}
