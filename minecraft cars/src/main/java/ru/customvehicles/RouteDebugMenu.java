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
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class RouteDebugMenu implements Listener {
    private static final int SIZE = 54;
    private static final int FIRST_VEHICLE_SLOT = 9;
    private static final int LAST_VEHICLE_SLOT = 44;
    private static final int STOP_DEBUG = 48;
    private static final int REFRESH = 49;
    private static final int CLOSE = 53;

    private final CustomVehiclesPlugin plugin;

    RouteDebugMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player, String routeId) {
        RailRoute route = plugin.routeManager().byId(routeId);
        if (route == null) {
            player.sendMessage("§cМаршрут не найден.");
            return;
        }
        Holder holder = new Holder(route.id());
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text("Debug · " + route.id(), NamedTextColor.DARK_GRAY)
        );
        holder.inventory = inventory;
        render(player, holder);
        player.openInventory(inventory);
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder() instanceof Holder holder)) {
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
            render(player, holder);
            click(player);
            return;
        }
        if (slot == STOP_DEBUG) {
            boolean stopped = plugin.autopilotManager().stopDebug(player);
            player.sendMessage(stopped
                    ? "§6[CustomVehicles] §eВывод диагностики остановлен."
                    : "§6[CustomVehicles] §7Диагностика и так не была включена.");
            render(player, holder);
            click(player);
            return;
        }

        UUID vehicleId = holder.vehicleSlots.get(slot);
        if (vehicleId == null) {
            return;
        }
        ManagedVehicle vehicle = plugin.vehicleManager().byId(vehicleId);
        if (!(vehicle instanceof RailTrain train)) {
            player.sendMessage("§cЭтот состав больше не существует.");
            render(player, holder);
            return;
        }
        if (!plugin.canManage(player, train)) {
            plugin.message(player, "no-permission");
            return;
        }
        if (!plugin.autopilotManager().startDebug(player, train.id())) {
            player.sendMessage("§cНе удалось включить диагностику этого состава.");
            return;
        }

        player.closeInventory();
        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 0.7F, 1.35F);
        player.sendMessage("§6[CustomVehicles] §aДиагностика включена для §f"
                + train.id().toString().substring(0, 8)
                + "§a. Отчёт приходит раз в две секунды.");
        AutopilotDebugFormatter.format(plugin.autopilotManager().debugSnapshot(train))
                .forEach(player::sendMessage);
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof Holder
                && event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void render(Player player, Holder holder) {
        Inventory inventory = holder.getInventory();
        inventory.clear();
        holder.vehicleSlots.clear();

        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = 0; slot < SIZE; slot++) {
            inventory.setItem(slot, filler);
        }

        RailRoute route = plugin.routeManager().byId(holder.routeId);
        if (route == null) {
            player.closeInventory();
            player.sendMessage("§cМаршрут был удалён.");
            return;
        }
        List<RailTrain> vehicles = plugin.autopilotManager().vehiclesOnRoute(route.id());
        inventory.setItem(4, item(
                Material.COMPARATOR,
                "Диагностика маршрута " + route.id(),
                NamedTextColor.GOLD,
                List.of(
                        Component.text("Остановок: " + route.stops().size(), NamedTextColor.AQUA),
                        Component.text("Стрелок: " + route.switches().size(), NamedTextColor.GRAY),
                        Component.text("Назначено составов: " + vehicles.size(), NamedTextColor.GRAY),
                        Component.empty(),
                        Component.text("Выберите состав для вывода его решений в чат", NamedTextColor.GREEN)
                )
        ));

        int slot = FIRST_VEHICLE_SLOT;
        UUID watched = plugin.autopilotManager().debugVehicle(player);
        for (RailTrain train : vehicles) {
            if (slot > LAST_VEHICLE_SLOT) {
                break;
            }
            holder.vehicleSlots.put(slot, train.id());
            AutopilotDebugSnapshot snapshot = plugin.autopilotManager().debugSnapshot(train);
            boolean selected = train.id().equals(watched);
            VehicleSnapshot position = train.snapshot();
            inventory.setItem(slot, item(
                    train.kind() == VehicleKind.TRAM ? Material.HOPPER_MINECART : Material.FURNACE_MINECART,
                    (train.kind() == VehicleKind.TRAM ? "Трамвай " : "Состав ")
                            + snapshot.shortVehicleId(),
                    selected ? NamedTextColor.GREEN : NamedTextColor.AQUA,
                    List.of(
                            Component.text(
                                    "Состояние: " + snapshot.status().displayName(),
                                    snapshot.status().emergency() ? NamedTextColor.RED : NamedTextColor.YELLOW
                            ),
                            Component.text("Решение: " + snapshot.decision(), NamedTextColor.GRAY),
                            Component.text(
                                    "Следующая: " + (snapshot.nextStopName() == null
                                            ? "—"
                                            : snapshot.nextStopName().replace('_', ' ')),
                                    NamedTextColor.AQUA
                            ),
                            Component.text(
                                    String.format(
                                            Locale.ROOT,
                                            "X %.1f  Y %.1f  Z %.1f · скорость %.3f",
                                            position.x(),
                                            position.y(),
                                            position.z(),
                                            snapshot.speed()
                                    ),
                                    NamedTextColor.DARK_GRAY
                            ),
                            Component.empty(),
                            Component.text(
                                    selected ? "Диагностика уже включена" : "Нажмите, чтобы следить в чате",
                                    selected ? NamedTextColor.GREEN : NamedTextColor.YELLOW
                            )
                    )
            ));
            slot++;
        }

        if (vehicles.isEmpty()) {
            inventory.setItem(22, item(
                    Material.BARRIER,
                    "На маршрут не назначен транспорт",
                    NamedTextColor.RED,
                    List.of(Component.text(
                            "Сначала запустите трамвай или поезд по этому маршруту",
                            NamedTextColor.GRAY
                    ))
            ));
        }

        inventory.setItem(STOP_DEBUG, item(
                Material.REDSTONE_TORCH,
                "Остановить диагностику",
                NamedTextColor.RED,
                List.of(Component.text("Прекратить сообщения в чат", NamedTextColor.GRAY))
        ));
        inventory.setItem(REFRESH, item(
                Material.COMPASS,
                "Обновить",
                NamedTextColor.GREEN,
                List.of(Component.text("Обновить составы и их состояние", NamedTextColor.GRAY))
        ));
        inventory.setItem(CLOSE, item(Material.BARRIER, "Закрыть", NamedTextColor.RED, List.of()));
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

    private static final class Holder implements InventoryHolder {
        private final String routeId;
        private final Map<Integer, UUID> vehicleSlots = new HashMap<>();
        private Inventory inventory;

        private Holder(String routeId) {
            this.routeId = routeId;
        }

        @Override
        public Inventory getInventory() {
            return inventory;
        }
    }
}
