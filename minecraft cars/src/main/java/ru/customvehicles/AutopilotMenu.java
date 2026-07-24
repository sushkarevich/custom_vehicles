package ru.customvehicles;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AutopilotMenu implements Listener {
    private static final int SIZE = 54;
    private static final int INFO = 4;
    private static final int FIRST_ROUTE_SLOT = 9;
    private static final int LAST_ROUTE_SLOT = 44;
    private static final int BACK = 45;
    private static final int MANUAL = 48;
    private static final int REFRESH = 49;
    private static final int CLOSE = 53;

    private final CustomVehiclesPlugin plugin;

    AutopilotMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player, RailTrain train) {
        if (!plugin.canManage(player, train)) {
            plugin.message(player, "no-permission");
            return;
        }
        MenuHolder holder = new MenuHolder(train.id());
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text("Автопилот · Маршруты", NamedTextColor.DARK_GRAY)
        );
        holder.inventory = inventory;
        render(holder, train);
        player.openInventory(inventory);
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder() instanceof MenuHolder holder)) {
            return;
        }
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)
                || event.getRawSlot() < 0
                || event.getRawSlot() >= SIZE) {
            return;
        }
        ManagedVehicle managed = plugin.vehicleManager().byId(holder.vehicleId);
        if (!(managed instanceof RailTrain train)) {
            player.closeInventory();
            plugin.message(player, "vehicle-missing");
            return;
        }
        if (!plugin.canManage(player, train)) {
            player.closeInventory();
            plugin.message(player, "no-permission");
            return;
        }

        int slot = event.getRawSlot();
        if (slot == CLOSE) {
            player.closeInventory();
            return;
        }
        if (slot == BACK) {
            plugin.openVehicleMenu(player, train);
            click(player);
            return;
        }
        if (slot == REFRESH) {
            render(holder, train);
            click(player);
            return;
        }
        if (slot == MANUAL) {
            plugin.autopilotManager().disable(train);
            render(holder, train);
            player.sendMessage("§6[CustomVehicles] §eВключено ручное управление.");
            click(player);
            return;
        }
        String routeId = holder.routeSlots.get(slot);
        if (routeId == null) {
            return;
        }
        AutopilotManager.StartResult result = plugin.autopilotManager().enable(train, routeId);
        switch (result) {
            case STARTED -> {
                player.sendMessage("§6[CustomVehicles] §aАвтопилот включён: маршрут §f" + routeId + "§a.");
                player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 0.8F, 1.35F);
            }
            case ROUTE_MISSING -> player.sendMessage("§cМаршрут больше не существует.");
            case NOT_ENOUGH_STOPS -> player.sendMessage("§cВ маршруте должно быть минимум две остановки.");
            case LIMIT_REACHED -> player.sendMessage("§cДостигнут лимит одновременно работающих автопилотов.");
        }
        render(holder, train);
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof MenuHolder
                && event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void render(MenuHolder holder, RailTrain train) {
        Inventory inventory = holder.getInventory();
        inventory.clear();
        holder.routeSlots.clear();
        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = 0; slot < SIZE; slot++) {
            inventory.setItem(slot, filler);
        }

        AutopilotInfo info = plugin.autopilotManager().info(train.id());
        NamedTextColor statusColor = info.status().emergency()
                ? NamedTextColor.RED
                : info.active() ? NamedTextColor.GREEN : NamedTextColor.YELLOW;
        java.util.ArrayList<Component> statusLore = new java.util.ArrayList<>();
        statusLore.add(Component.text("Режим: " + (info.active() ? "Автопилот" : "Ручной"), statusColor));
        statusLore.add(Component.text("Состояние: " + info.status().displayName(), statusColor));
        statusLore.add(Component.text(
                "Маршрут: " + (info.routeId() == null ? "не выбран" : info.routeId()),
                NamedTextColor.GRAY
        ));
        if (info.nextStopName() != null) {
            statusLore.add(Component.text(
                    "Следующая: " + info.nextStopName().replace('_', ' '),
                    NamedTextColor.AQUA
            ));
        }
        statusLore.add(Component.text(
                "Активно: " + plugin.autopilotManager().activeCount()
                        + " / " + plugin.autopilotManager().maxActive(),
                NamedTextColor.DARK_GRAY
        ));
        if (info.status().emergency()) {
            statusLore.add(Component.empty());
            statusLore.add(Component.text("Выберите маршрут заново или включите ручной режим", NamedTextColor.RED));
        }
        inventory.setItem(INFO, item(
                info.status().emergency() ? Material.REDSTONE_BLOCK
                        : info.active() ? Material.LIME_CONCRETE : Material.LEVER,
                "Состояние автопилота",
                statusColor,
                statusLore
        ));

        int slot = FIRST_ROUTE_SLOT;
        for (RailRoute route : plugin.routeManager().all()) {
            if (slot > LAST_ROUTE_SLOT) {
                break;
            }
            holder.routeSlots.put(slot, route.id());
            inventory.setItem(slot, routeItem(route, info));
            slot++;
        }
        if (plugin.routeManager().all().isEmpty()) {
            inventory.setItem(22, item(
                    Material.BARRIER,
                    "Маршрутов пока нет",
                    NamedTextColor.RED,
                    List.of(
                            Component.text("/cv route create <id>", NamedTextColor.GRAY),
                            Component.text("/cv route stop <id> <название> [секунды]", NamedTextColor.GRAY)
                    )
            ));
        }

        inventory.setItem(BACK, item(
                Material.ARROW,
                "Назад к транспорту",
                NamedTextColor.YELLOW,
                List.of()
        ));
        inventory.setItem(MANUAL, item(
                Material.LEVER,
                "Ручное управление",
                NamedTextColor.YELLOW,
                List.of(Component.text("Остановить автопилот и вернуть управление водителю", NamedTextColor.GRAY))
        ));
        inventory.setItem(REFRESH, item(
                Material.COMPASS,
                "Обновить",
                NamedTextColor.GREEN,
                List.of(Component.text("Обновить состояние и маршруты", NamedTextColor.GRAY))
        ));
        inventory.setItem(CLOSE, item(Material.BARRIER, "Закрыть", NamedTextColor.RED, List.of()));
    }

    private ItemStack routeItem(RailRoute route, AutopilotInfo info) {
        boolean selected = route.id().equals(info.routeId());
        java.util.ArrayList<Component> lore = new java.util.ArrayList<>();
        lore.add(Component.text("Остановок: " + route.stops().size(), NamedTextColor.AQUA));
        lore.add(Component.text("Инструкций стрелок: " + route.switches().size(), NamedTextColor.GRAY));
        lore.add(Component.empty());
        int shown = Math.min(8, route.stops().size());
        for (int index = 0; index < shown; index++) {
            RouteStop stop = route.stops().get(index);
            lore.add(Component.text(
                    (index + 1) + ". " + stop.name().replace('_', ' ')
                            + " · " + stop.dwellTicks() / 20 + " сек.",
                    selected && index == info.nextStopIndex() ? NamedTextColor.GREEN : NamedTextColor.GRAY
            ));
        }
        if (route.stops().size() > shown) {
            lore.add(Component.text("…ещё " + (route.stops().size() - shown), NamedTextColor.DARK_GRAY));
        }
        lore.add(Component.empty());
        lore.add(Component.text(
                route.stops().size() < 2
                        ? "Нужно минимум две остановки"
                        : selected && info.active() ? "Маршрут активен" : "Нажмите, чтобы запустить",
                route.stops().size() < 2 ? NamedTextColor.RED : NamedTextColor.GREEN
        ));
        return item(
                selected ? Material.POWERED_RAIL : Material.RAIL,
                route.id(),
                selected ? NamedTextColor.GREEN : NamedTextColor.GOLD,
                lore
        );
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

    private static final class MenuHolder implements InventoryHolder {
        private final UUID vehicleId;
        private final Map<Integer, String> routeSlots = new HashMap<>();
        private Inventory inventory;

        private MenuHolder(UUID vehicleId) {
            this.vehicleId = vehicleId;
        }

        @Override
        public Inventory getInventory() {
            return inventory;
        }
    }
}
