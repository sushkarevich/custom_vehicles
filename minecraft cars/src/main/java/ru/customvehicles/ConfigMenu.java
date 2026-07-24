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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class ConfigMenu implements Listener {
    private static final int SIZE = 45;
    private static final int CAR_TAB = 2;
    private static final int TRAIN_TAB = 6;
    private static final int RESET = 36;
    private static final int SAVE = 40;
    private static final int CLOSE = 44;

    private static final Map<Integer, Setting> CAR_SETTINGS = settings(
            new SlotSetting(10, setting(
                    "vehicle.max-speed", "Максимальная скорость",
                    Material.FEATHER, 0.10, 1.50, 0.05, 2, 0.65
            )),
            new SlotSetting(12, setting(
                    "vehicle.reverse-speed", "Скорость заднего хода",
                    Material.RABBIT_FOOT, 0.05, 1.00, 0.05, 2, 0.30
            )),
            new SlotSetting(14, setting(
                    "vehicle.acceleration", "Ускорение",
                    Material.FIREWORK_ROCKET, 0.005, 0.100, 0.005, 3, 0.035
            )),
            new SlotSetting(16, setting(
                    "vehicle.steering-degrees-per-tick", "Чувствительность руля",
                    Material.RECOVERY_COMPASS, 0.50, 8.00, 0.25, 2, 2.80
            )),
            new SlotSetting(20, setting(
                    "vehicle.seat-offset.x", "Посадка: влево / вправо",
                    Material.COMPASS, -1.50, 1.50, 0.05, 2, 0.0
            )),
            new SlotSetting(22, setting(
                    "vehicle.seat-offset.y", "Посадка: высота",
                    Material.SCAFFOLDING, -1.00, 2.00, 0.05, 2, 0.0
            )),
            new SlotSetting(24, setting(
                    "vehicle.seat-offset.z", "Посадка: назад / вперёд",
                    Material.SPYGLASS, -2.00, 2.00, 0.05, 2, 0.0
            )),
            new SlotSetting(31, setting(
                    "vehicle.step-height", "Высота преодоления",
                    Material.STONE_SLAB, 0.25, 1.50, 0.25, 2, 1.0
            )),
            new SlotSetting(33, setting(
                    "vehicle.sound-volume", "Громкость звуков",
                    Material.JUKEBOX, 0.0, 2.0, 0.10, 2, 1.0
            ))
    );

    private static final Map<Integer, Setting> TRAIN_SETTINGS = settings(
            new SlotSetting(10, setting(
                    "train.max-speed", "Максимальная скорость",
                    Material.POWERED_RAIL, 0.10, 1.20, 0.05, 2, 0.42
            )),
            new SlotSetting(12, setting(
                    "train.reverse-speed", "Скорость заднего хода",
                    Material.DETECTOR_RAIL, 0.05, 1.00, 0.05, 2, 0.22
            )),
            new SlotSetting(14, setting(
                    "train.acceleration", "Ускорение",
                    Material.FIREWORK_ROCKET, 0.005, 0.100, 0.005, 3, 0.018
            )),
            new SlotSetting(16, setting(
                    "train.braking", "Сила торможения",
                    Material.ACTIVATOR_RAIL, 0.005, 0.150, 0.005, 3, 0.035
            )),
            new SlotSetting(20, setting(
                    "train.seat-offset.x", "Посадка: влево / вправо",
                    Material.COMPASS, -1.50, 1.50, 0.05, 2, 0.0
            )),
            new SlotSetting(22, setting(
                    "train.seat-offset.y", "Посадка: высота",
                    Material.SCAFFOLDING, -1.00, 2.00, 0.05, 2, 0.0
            )),
            new SlotSetting(24, setting(
                    "train.seat-offset.z", "Посадка: назад / вперёд",
                    Material.SPYGLASS, -2.00, 2.00, 0.05, 2, 0.0
            )),
            new SlotSetting(29, setting(
                    "train.max-wagons", "Максимум вагонов",
                    Material.CHEST_MINECART, 1.0, 8.0, 1.0, 0, 6.0
            )),
            new SlotSetting(31, setting(
                    "train.wagon-spacing", "Расстояние до вагона",
                    Material.CHAIN, 5.80, 8.00, 0.10, 2, 6.20
            )),
            new SlotSetting(33, setting(
                    "train.sound-volume", "Громкость звуков",
                    Material.JUKEBOX, 0.0, 2.0, 0.10, 2, 1.0
            ))
    );

    private final CustomVehiclesPlugin plugin;

    ConfigMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player) {
        MenuHolder holder = new MenuHolder();
        loadValues(holder);
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text("Настройка транспорта", NamedTextColor.DARK_GRAY)
        );
        holder.inventory = inventory;
        render(holder);
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

        int slot = event.getRawSlot();
        if (slot == CAR_TAB || slot == TRAIN_TAB) {
            holder.kind = slot == CAR_TAB ? VehicleKind.CAR : VehicleKind.TRAIN;
            render(holder);
            click(player);
            return;
        }
        if (slot == RESET) {
            resetSelected(holder);
            render(holder);
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BASS, 0.7F, 1.0F);
            return;
        }
        if (slot == SAVE) {
            save(holder);
            render(holder);
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 0.8F, 1.5F);
            player.sendActionBar(Component.text(
                    "Настройки сохранены и уже применены",
                    NamedTextColor.GREEN
            ));
            return;
        }
        if (slot == CLOSE) {
            player.closeInventory();
            return;
        }

        Setting setting = selectedSettings(holder).get(slot);
        if (setting == null || (!event.isLeftClick() && !event.isRightClick())) {
            return;
        }
        double direction = event.isLeftClick() ? 1.0 : -1.0;
        double multiplier = event.isShiftClick() ? 5.0 : 1.0;
        double current = holder.values.getOrDefault(setting.path(), setting.defaultValue());
        double next = clamp(
                current + direction * setting.step() * multiplier,
                setting.minimum(),
                setting.maximum()
        );
        holder.values.put(setting.path(), round(next, setting.decimals()));
        render(holder);
        click(player);
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof MenuHolder)) {
            return;
        }
        if (event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void loadValues(MenuHolder holder) {
        for (Setting setting : allSettings().values()) {
            holder.values.put(
                    setting.path(),
                    plugin.getConfig().getDouble(setting.path(), setting.defaultValue())
            );
        }
    }

    private void save(MenuHolder holder) {
        holder.values.forEach((path, value) -> plugin.getConfig().set(path, value));
        plugin.saveConfig();
        plugin.vehicleManager().reloadSettings();
    }

    private void resetSelected(MenuHolder holder) {
        selectedSettings(holder).values().forEach(setting ->
                holder.values.put(setting.path(), setting.defaultValue())
        );
    }

    private void render(MenuHolder holder) {
        Inventory inventory = holder.getInventory();
        inventory.clear();
        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = 0; slot < inventory.getSize(); slot++) {
            inventory.setItem(slot, filler);
        }

        inventory.setItem(CAR_TAB, tab(
                Material.MINECART,
                "Автомобиль",
                holder.kind == VehicleKind.CAR
        ));
        inventory.setItem(TRAIN_TAB, tab(
                Material.FURNACE_MINECART,
                "Рельсовый транспорт",
                holder.kind == VehicleKind.TRAIN
        ));
        inventory.setItem(4, item(
                Material.WRITABLE_BOOK,
                "Как менять значения",
                NamedTextColor.GOLD,
                List.of(
                        Component.text("ЛКМ — увеличить", NamedTextColor.GRAY),
                        Component.text("ПКМ — уменьшить", NamedTextColor.GRAY),
                        Component.text("Shift — изменить в 5 раз быстрее", NamedTextColor.DARK_GRAY),
                        Component.text("Изменения вступят в силу после сохранения", NamedTextColor.YELLOW)
                )
        ));

        for (Map.Entry<Integer, Setting> entry : selectedSettings(holder).entrySet()) {
            Setting setting = entry.getValue();
            double value = holder.values.getOrDefault(setting.path(), setting.defaultValue());
            inventory.setItem(entry.getKey(), settingItem(setting, value));
        }

        inventory.setItem(RESET, item(
                Material.REDSTONE,
                "Сбросить выбранный раздел",
                NamedTextColor.RED,
                List.of(Component.text("Вернуть стандартные значения", NamedTextColor.GRAY))
        ));
        inventory.setItem(SAVE, item(
                Material.LIME_DYE,
                "Сохранить и применить",
                NamedTextColor.GREEN,
                List.of(Component.text("Настройки сразу подхватит активный транспорт", NamedTextColor.GRAY))
        ));
        inventory.setItem(CLOSE, item(
                Material.BARRIER,
                "Закрыть без сохранения",
                NamedTextColor.RED,
                List.of()
        ));
    }

    private ItemStack tab(Material material, String name, boolean selected) {
        return item(
                material,
                name,
                selected ? NamedTextColor.GREEN : NamedTextColor.YELLOW,
                List.of(Component.text(
                        selected ? "Выбрано" : "Нажмите, чтобы выбрать",
                        selected ? NamedTextColor.GREEN : NamedTextColor.GRAY
                ))
        );
    }

    private ItemStack settingItem(Setting setting, double value) {
        return item(
                setting.material(),
                setting.label() + ": " + format(value, setting.decimals()),
                NamedTextColor.AQUA,
                List.of(
                        Component.text(
                                "Диапазон: " + format(setting.minimum(), setting.decimals())
                                        + " … " + format(setting.maximum(), setting.decimals()),
                                NamedTextColor.DARK_GRAY
                        ),
                        Component.text("ЛКМ +  |  ПКМ −", NamedTextColor.GRAY),
                        Component.text("Shift: шаг ×5", NamedTextColor.GRAY)
                )
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

    private Map<Integer, Setting> selectedSettings(MenuHolder holder) {
        return holder.kind == VehicleKind.CAR ? CAR_SETTINGS : TRAIN_SETTINGS;
    }

    private Map<String, Setting> allSettings() {
        Map<String, Setting> settings = new LinkedHashMap<>();
        CAR_SETTINGS.values().forEach(setting -> settings.put(setting.path(), setting));
        TRAIN_SETTINGS.values().forEach(setting -> settings.put(setting.path(), setting));
        return settings;
    }

    private static Setting setting(
            String path,
            String label,
            Material material,
            double minimum,
            double maximum,
            double step,
            int decimals,
            double defaultValue
    ) {
        return new Setting(path, label, material, minimum, maximum, step, decimals, defaultValue);
    }

    private static Map<Integer, Setting> settings(SlotSetting... entries) {
        Map<Integer, Setting> settings = new LinkedHashMap<>();
        for (SlotSetting entry : entries) {
            settings.put(entry.slot(), entry.setting());
        }
        return Map.copyOf(settings);
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static double round(double value, int decimals) {
        double scale = Math.pow(10.0, decimals);
        return Math.round(value * scale) / scale;
    }

    private static String format(double value, int decimals) {
        return String.format(Locale.ROOT, "%." + decimals + "f", value);
    }

    private static final class MenuHolder implements InventoryHolder {
        private final Map<String, Double> values = new HashMap<>();
        private VehicleKind kind = VehicleKind.CAR;
        private Inventory inventory;

        @Override
        public Inventory getInventory() {
            return inventory;
        }
    }

    private record Setting(
            String path,
            String label,
            Material material,
            double minimum,
            double maximum,
            double step,
            int decimals,
            double defaultValue
    ) {
    }

    private record SlotSetting(int slot, Setting setting) {
    }
}
