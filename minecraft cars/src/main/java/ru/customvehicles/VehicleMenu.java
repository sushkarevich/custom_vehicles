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

import java.util.List;
import java.util.Locale;
import java.util.UUID;

final class VehicleMenu implements Listener {
    private static final int SIZE = 27;
    private static final int INFO = 4;
    private static final int MOUNT = 10;
    private static final int ATTACH = 12;
    private static final int DETACH = 14;
    private static final int CONFIG = 16;
    private static final int AUTOPILOT = 18;
    private static final int PICK_UP = 22;
    private static final int CLOSE = 26;

    private final CustomVehiclesPlugin plugin;

    VehicleMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player, ManagedVehicle vehicle) {
        if (!plugin.canManage(player, vehicle)) {
            plugin.message(player, "no-permission");
            return;
        }
        MenuHolder holder = new MenuHolder(vehicle.id());
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text(
                        switch (vehicle.kind()) {
                            case TRAIN -> "Управление составом";
                            case TRAM -> "Управление трамваем";
                            default -> "Управление машиной";
                        },
                        NamedTextColor.DARK_GRAY
                )
        );
        holder.inventory = inventory;
        render(holder, vehicle);
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
                || event.getRawSlot() >= top.getSize()) {
            return;
        }
        ManagedVehicle vehicle = plugin.vehicleManager().byId(holder.vehicleId);
        if (vehicle == null) {
            player.closeInventory();
            plugin.message(player, "vehicle-missing");
            return;
        }
        if (!plugin.canManage(player, vehicle)) {
            player.closeInventory();
            plugin.message(player, "no-permission");
            return;
        }

        switch (event.getRawSlot()) {
            case MOUNT -> {
                player.closeInventory();
                vehicle.mount(player);
                click(player);
            }
            case ATTACH -> attach(player, holder, vehicle);
            case DETACH -> detach(player, holder, vehicle);
            case CONFIG -> {
                click(player);
                plugin.openConfigMenu(player);
            }
            case AUTOPILOT -> {
                if (vehicle instanceof RailTrain train) {
                    click(player);
                    plugin.openAutopilotMenu(player, train);
                }
            }
            case PICK_UP -> pickUp(player, vehicle);
            case CLOSE -> player.closeInventory();
            default -> {
            }
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof MenuHolder
                && event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void attach(Player player, MenuHolder holder, ManagedVehicle vehicle) {
        if (!(vehicle instanceof RailTrain train) || train.kind() != VehicleKind.TRAIN) {
            return;
        }
        int wagonSlot = findWagon(player);
        if (wagonSlot < 0 && !player.getGameMode().isInvulnerable()) {
            plugin.message(player, "wagon-item-required");
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BASS, 0.7F, 0.8F);
            return;
        }
        VehicleVariantDefinition wagonVariant = plugin.variantRegistry()
                .require(BuiltInDefinitions.WAGON_VARIANT);
        if (wagonSlot >= 0) {
            ItemStack wagonItem = player.getInventory().getItem(wagonSlot);
            if (wagonItem != null) {
                wagonVariant = plugin.vehicleVariant(wagonItem);
                if (wagonVariant == null) {
                    plugin.messageVariantUnavailable(player, wagonItem);
                    return;
                }
            }
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
                    ItemStack item = player.getInventory().getItem(wagonSlot);
                    if (item != null) {
                        item.setAmount(item.getAmount() - 1);
                    }
                }
                plugin.message(player, "wagon-attached");
                render(holder, train);
                click(player);
            }
            case LIMIT_REACHED -> plugin.message(player, "wagon-limit");
            case NO_TRACK -> plugin.message(player, "wagon-no-track");
        }
    }

    private void detach(Player player, MenuHolder holder, ManagedVehicle vehicle) {
        if (!(vehicle instanceof RailTrain train) || train.kind() != VehicleKind.TRAIN) {
            return;
        }
        VehicleVariantDefinition detachedVariant = plugin.vehicleManager()
                .detachLastWagon(train);
        if (detachedVariant == null) {
            plugin.message(player, "wagon-none");
            return;
        }
        plugin.giveVehicleItem(player, detachedVariant);
        plugin.message(player, "wagon-detached");
        render(holder, train);
        click(player);
    }

    private void pickUp(Player player, ManagedVehicle vehicle) {
        VehicleVariantDefinition variant = vehicle.variantDefinition();
        List<VehicleVariantDefinition> wagonVariants = vehicle.wagonVariantDefinitions();
        if (!plugin.vehicleManager().remove(vehicle)) {
            plugin.message(player, "vehicle-missing");
            return;
        }
        plugin.giveVehicleItems(player, variant, wagonVariants);
        player.closeInventory();
        plugin.message(player, "vehicle-removed");
        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 0.8F, 1.1F);
    }

    private int findWagon(Player player) {
        for (int slot = 0; slot < player.getInventory().getSize(); slot++) {
            ItemStack item = player.getInventory().getItem(slot);
            if (plugin.isVehicleItem(item) && plugin.vehicleKind(item) == VehicleKind.WAGON) {
                return slot;
            }
        }
        return -1;
    }

    private void render(MenuHolder holder, ManagedVehicle vehicle) {
        Inventory inventory = holder.getInventory();
        inventory.clear();
        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = 0; slot < SIZE; slot++) {
            inventory.setItem(slot, filler);
        }

        String shortId = vehicle.id().toString().substring(0, 8);
        VehicleVariantDefinition variant = vehicle.variantDefinition();
        inventory.setItem(INFO, item(
                variant.item().material(),
                variant.displayName(),
                NamedTextColor.GOLD,
                List.of(
                        Component.text("ID: " + shortId, NamedTextColor.DARK_GRAY),
                        Component.text(
                                String.format(Locale.ROOT, "Скорость: %.2f", vehicle.speed()),
                                NamedTextColor.GRAY
                        ),
                        Component.text(
                                switch (vehicle.kind()) {
                                    case TRAIN -> "Вагонов: " + vehicle.wagonCount();
                                    case TRAM -> "Секций: 3";
                                    default -> "Состояние: готов к поездке";
                                },
                                NamedTextColor.AQUA
                        ),
                        Component.text("Положение сохраняется автоматически", NamedTextColor.GREEN)
                )
        ));
        inventory.setItem(MOUNT, item(
                Material.SADDLE,
                switch (vehicle.kind()) {
                    case TRAIN -> "Сесть машинистом";
                    case TRAM -> "Сесть водителем";
                    default -> "Сесть за руль";
                },
                NamedTextColor.GREEN,
                List.of(Component.text("Закрыть меню и занять водительское место", NamedTextColor.GRAY))
        ));
        inventory.setItem(CONFIG, item(
                Material.COMPARATOR,
                "Настройки транспорта",
                NamedTextColor.YELLOW,
                List.of(Component.text("Скорость, посадка, звуки и сцепка", NamedTextColor.GRAY))
        ));
        inventory.setItem(PICK_UP, item(
                Material.CHEST,
                "Забрать транспорт",
                NamedTextColor.RED,
                List.of(
                        Component.text("Вернуть транспорт предметом", NamedTextColor.GRAY),
                        Component.text("Все вагоны также вернутся в инвентарь", NamedTextColor.DARK_GRAY)
                )
        ));
        inventory.setItem(CLOSE, item(Material.BARRIER, "Закрыть", NamedTextColor.RED, List.of()));

        if (vehicle.kind() == VehicleKind.TRAIN) {
            inventory.setItem(ATTACH, item(
                    Material.CHEST_MINECART,
                    "Подцепить вагон",
                    NamedTextColor.GREEN,
                    List.of(Component.text("Использует вагон из инвентаря", NamedTextColor.GRAY))
            ));
            inventory.setItem(DETACH, item(
                    Material.LEAD,
                    "Отцепить последний вагон",
                    NamedTextColor.YELLOW,
                    List.of(Component.text("Вагон вернётся в инвентарь", NamedTextColor.GRAY))
            ));
        }
        if (vehicle instanceof RailTrain train) {
            AutopilotInfo autopilot = plugin.autopilotManager().info(train.id());
            inventory.setItem(AUTOPILOT, item(
                    autopilot.status().emergency() ? Material.REDSTONE_BLOCK
                            : autopilot.active() ? Material.LIME_CONCRETE : Material.LEVER,
                    "Режим движения",
                    autopilot.status().emergency() ? NamedTextColor.RED
                            : autopilot.active() ? NamedTextColor.GREEN : NamedTextColor.YELLOW,
                    List.of(
                            Component.text(
                                    autopilot.active() ? "Автопилот" : "Ручное управление",
                                    autopilot.active() ? NamedTextColor.GREEN : NamedTextColor.YELLOW
                            ),
                            Component.text(autopilot.status().displayName(), NamedTextColor.GRAY),
                            Component.text(
                                    autopilot.nextStopName() == null
                                            ? "Маршрут не выбран"
                                            : "Следующая: " + autopilot.nextStopName().replace('_', ' '),
                                    NamedTextColor.AQUA
                            ),
                            Component.text("Нажмите, чтобы открыть маршруты", NamedTextColor.GREEN)
                    )
            ));
        }
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
