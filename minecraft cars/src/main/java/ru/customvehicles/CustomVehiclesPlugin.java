package ru.customvehicles;

import com.comphenix.protocol.ProtocolLibrary;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.command.PluginCommand;
import org.bukkit.entity.Player;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.io.IOException;
import java.nio.file.Path;
import java.util.logging.Level;

public final class CustomVehiclesPlugin extends JavaPlugin {
    private final Map<UUID, VehicleInput> inputs = new ConcurrentHashMap<>();
    private final Set<UUID> customDrivers = ConcurrentHashMap.newKeySet();
    private VehicleManager vehicleManager;
    private ConfigMenu configMenu;
    private VehicleMenu vehicleMenu;
    private VehicleCatalogMenu vehicleCatalogMenu;
    private ActiveVehiclesMenu activeVehiclesMenu;
    private AutopilotMenu autopilotMenu;
    private RouteDebugMenu routeDebugMenu;
    private RouteManager routeManager;
    private AutopilotManager autopilotManager;
    private NamespacedKey vehicleKey;
    private NamespacedKey itemKey;
    private NamespacedKey itemTypeKey;
    private NamespacedKey itemVariantKey;
    private ModelRegistry modelRegistry;
    private VehicleVariantRegistry variantRegistry;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getConfig().options().copyDefaults(true);
        migrateLegacyDefaults();
        saveConfig();
        vehicleKey = new NamespacedKey(this, "vehicle-id");
        itemKey = new NamespacedKey(this, "vehicle-item");
        itemTypeKey = new NamespacedKey(this, "vehicle-type");
        itemVariantKey = new NamespacedKey(this, "vehicle-variant");
        DefinitionReloadResult definitions = reloadDefinitions(true);
        if (!definitions.successful()) {
            throw new IllegalStateException("Could not load built-in vehicle definitions");
        }
        removeOrphanedEntities();
        routeManager = new RouteManager(this);
        vehicleManager = new VehicleManager(this);
        autopilotManager = new AutopilotManager(this, routeManager, vehicleManager);
        vehicleManager.setAutopilotManager(autopilotManager);
        configMenu = new ConfigMenu(this);
        vehicleMenu = new VehicleMenu(this);
        vehicleCatalogMenu = new VehicleCatalogMenu(this);
        activeVehiclesMenu = new ActiveVehiclesMenu(this);
        autopilotMenu = new AutopilotMenu(this);
        routeDebugMenu = new RouteDebugMenu(this);

        getServer().getPluginManager().registerEvents(new VehicleListener(this), this);
        getServer().getPluginManager().registerEvents(configMenu, this);
        getServer().getPluginManager().registerEvents(vehicleMenu, this);
        getServer().getPluginManager().registerEvents(vehicleCatalogMenu, this);
        getServer().getPluginManager().registerEvents(activeVehiclesMenu, this);
        getServer().getPluginManager().registerEvents(autopilotMenu, this);
        getServer().getPluginManager().registerEvents(routeDebugMenu, this);
        ProtocolLibrary.getProtocolManager().addPacketListener(new InputPacketListener(this));

        CustomVehiclesCommand commandHandler = new CustomVehiclesCommand(this);
        PluginCommand command = getCommand("customvehicles");
        if (command == null) {
            throw new IllegalStateException("Command customvehicles is missing from plugin.yml");
        }
        command.setExecutor(commandHandler);
        command.setTabCompleter(commandHandler);

        vehicleManager.restoreSaved();
        autopilotManager.restore();
        getServer().getScheduler().runTaskTimer(this, () -> vehicleManager.tick(inputs), 1L, 1L);
        getLogger().info("CustomVehicles " + getPluginMeta().getVersion() + " is ready.");
    }

    @Override
    public void onDisable() {
        ProtocolLibrary.getProtocolManager().removePacketListeners(this);
        if (autopilotManager != null) {
            autopilotManager.shutdown();
        }
        if (vehicleManager != null) {
            vehicleManager.shutdown();
        }
        inputs.clear();
        customDrivers.clear();
    }

    NamespacedKey vehicleKey() {
        return vehicleKey;
    }

    VehicleManager vehicleManager() {
        return vehicleManager;
    }

    ModelRegistry modelRegistry() {
        return modelRegistry;
    }

    VehicleVariantRegistry variantRegistry() {
        return variantRegistry;
    }

    RouteManager routeManager() {
        return routeManager;
    }

    AutopilotManager autopilotManager() {
        return autopilotManager;
    }

    void openConfigMenu(Player player) {
        configMenu.open(player);
    }

    void openVehicleMenu(Player player, ManagedVehicle vehicle) {
        vehicleMenu.open(player, vehicle);
    }

    void openVehicleCatalog(Player player) {
        vehicleCatalogMenu.open(player);
    }

    void openActiveVehiclesMenu(Player player) {
        activeVehiclesMenu.open(player);
    }

    void openAutopilotMenu(Player player, RailTrain train) {
        autopilotMenu.open(player, train);
    }

    void openRouteDebugMenu(Player player, String routeId) {
        routeDebugMenu.open(player, routeId);
    }

    boolean canManage(Player player, ManagedVehicle vehicle) {
        return vehicle.owner().equals(player.getUniqueId())
                || player.hasPermission("customvehicles.command");
    }

    void giveVehicleItems(Player player, VehicleKind kind, int wagonCount) {
        giveVehicleItems(
                player,
                kind.defaultVariantId(),
                kind == VehicleKind.TRAIN
                        ? java.util.Collections.nCopies(
                        Math.max(0, wagonCount),
                        BuiltInDefinitions.WAGON_VARIANT
                )
                        : List.of()
        );
    }

    void giveVehicleItems(Player player, String variantId, int wagonCount) {
        VehicleVariantDefinition variant = variantRegistry.require(variantId);
        giveVehicleItems(
                player,
                variantId,
                variant.behavior() == VehicleBehavior.TRAIN
                        ? java.util.Collections.nCopies(
                        Math.max(0, wagonCount),
                        BuiltInDefinitions.WAGON_VARIANT
                )
                        : List.of()
        );
    }

    void giveVehicleItems(
            Player player,
            String variantId,
            List<String> wagonVariantIds
    ) {
        giveVehicleItems(
                player,
                variantRegistry.require(variantId),
                wagonVariantIds.stream().map(variantRegistry::require).toList()
        );
    }

    void giveVehicleItems(
            Player player,
            VehicleVariantDefinition variant,
            List<VehicleVariantDefinition> wagonVariants
    ) {
        giveItem(player, createVehicleItem(variant));
        wagonVariants.forEach(wagonVariant ->
                giveItem(player, createVehicleItem(wagonVariant))
        );
    }

    void giveVehicleItem(Player player, VehicleVariantDefinition variant) {
        giveItem(player, createVehicleItem(variant));
    }

    private void giveItem(Player player, ItemStack item) {
        player.getInventory().addItem(item).values().forEach(overflow ->
                player.getWorld().dropItemNaturally(player.getLocation(), overflow)
        );
    }

    void updateInput(Player player, VehicleInput input) {
        inputs.put(player.getUniqueId(), input);
    }

    void clearInput(Player player) {
        inputs.remove(player.getUniqueId());
    }

    void beginDriving(Player player) {
        customDrivers.add(player.getUniqueId());
        clearInput(player);
    }

    void endDriving(Player player) {
        customDrivers.remove(player.getUniqueId());
        clearInput(player);
    }

    boolean isCustomDriver(Player player) {
        return customDrivers.contains(player.getUniqueId());
    }

    Map<UUID, VehicleInput> inputs() {
        return inputs;
    }

    ItemStack createVehicleItem() {
        return createVehicleItem(BuiltInDefinitions.CAR_VARIANT);
    }

    ItemStack createVehicleItem(VehicleKind kind) {
        return createVehicleItem(kind.defaultVariantId());
    }

    ItemStack createVehicleItem(String variantId) {
        return createVehicleItem(variantRegistry.require(variantId));
    }

    ItemStack createVehicleItem(VehicleVariantDefinition variant) {
        ItemStack item = new ItemStack(variant.item().material());
        ItemMeta meta = item.getItemMeta();
        meta.displayName(Component.text(variant.item().name(), NamedTextColor.GOLD));
        List<Component> lore = variant.item().lore().stream()
                .map(line -> (Component) Component.text(line, NamedTextColor.GRAY))
                .toList();
        meta.lore(lore);
        if (variant.item().customModelData() != null) {
            meta.setCustomModelData(variant.item().customModelData());
        }
        meta.getPersistentDataContainer().set(itemKey, PersistentDataType.BYTE, (byte) 1);
        meta.getPersistentDataContainer().set(
                itemTypeKey,
                PersistentDataType.STRING,
                variant.behavior().id()
        );
        meta.getPersistentDataContainer().set(
                itemVariantKey,
                PersistentDataType.STRING,
                variant.id()
        );
        item.setItemMeta(meta);
        return item;
    }

    boolean isVehicleItem(ItemStack item) {
        return item != null
                && item.hasItemMeta()
                && item.getItemMeta().getPersistentDataContainer().has(itemKey, PersistentDataType.BYTE);
    }

    VehicleKind vehicleKind(ItemStack item) {
        VehicleVariantDefinition variant = vehicleVariant(item);
        if (variant != null) {
            return VehicleKind.fromBehavior(variant.behavior());
        }
        if (item == null || !item.hasItemMeta()) {
            return VehicleKind.CAR;
        }
        String legacyType = item.getItemMeta().getPersistentDataContainer()
                .get(itemTypeKey, PersistentDataType.STRING);
        return VehicleKind.from(legacyType);
    }

    VehicleVariantDefinition vehicleVariant(ItemStack item) {
        if (item == null || !item.hasItemMeta()) {
            return variantRegistry.require(BuiltInDefinitions.CAR_VARIANT);
        }
        var data = item.getItemMeta().getPersistentDataContainer();
        String variantId = data.get(itemVariantKey, PersistentDataType.STRING);
        if (variantId != null) {
            VehicleVariantDefinition variant = variantRegistry.find(variantId).orElse(null);
            if (variant != null) {
                return variant;
            }
            return null;
        }
        VehicleKind legacyKind = VehicleKind.from(
                data.get(itemTypeKey, PersistentDataType.STRING)
        );
        return variantRegistry.require(legacyKind.defaultVariantId());
    }

    String explicitVehicleVariantId(ItemStack item) {
        if (item == null || !item.hasItemMeta()) {
            return null;
        }
        return item.getItemMeta().getPersistentDataContainer()
                .get(itemVariantKey, PersistentDataType.STRING);
    }

    void messageVariantUnavailable(Player player, ItemStack item) {
        String variantId = explicitVehicleVariantId(item);
        messageText(
                player,
                "&cВариант транспорта «" + (variantId == null ? "неизвестный" : variantId)
                        + "» не загружен. Верните его YAML-файл и выполните /cv reload."
        );
    }

    VehicleVariantDefinition findVariantOrLegacy(String raw) {
        VehicleVariantDefinition direct = variantRegistry.find(raw).orElse(null);
        if (direct != null) {
            return direct;
        }
        for (VehicleKind kind : VehicleKind.values()) {
            if (kind.id().equalsIgnoreCase(raw)) {
                return variantRegistry.require(kind.defaultVariantId());
            }
        }
        return null;
    }

    void message(Player player, String key) {
        String prefix = getConfig().getString("messages.prefix", "&6[CustomVehicles] ");
        String value = getConfig().getString("messages." + key, key);
        player.sendMessage(color(prefix + value));
    }

    void messageVehicleGiven(Player player, VehicleVariantDefinition variant) {
        if (isDefaultVariant(variant)) {
            String key = switch (variant.behavior()) {
                case CAR -> "vehicle-given";
                case TRAIN -> "train-given";
                case TRAM -> "tram-given";
                case WAGON -> "wagon-given";
            };
            message(player, key);
            return;
        }
        messageText(player, "&aВыдан транспорт «" + variant.displayName() + "».");
    }

    void messageVehiclePlaced(Player player, VehicleVariantDefinition variant) {
        if (isDefaultVariant(variant)) {
            String key = switch (variant.behavior()) {
                case CAR -> "vehicle-placed";
                case TRAIN -> "train-placed";
                case TRAM -> "tram-placed";
                case WAGON -> "wagon-use-on-train";
            };
            message(player, key);
            return;
        }
        String suffix = variant.behavior() == VehicleBehavior.TRAIN
                ? " Пассажирские вагоны подцепляются отдельно."
                : "";
        messageText(
                player,
                "&aТранспорт «" + variant.displayName() + "» установлен." + suffix
        );
    }

    void messagePlacementFailed(Player player, VehicleVariantDefinition variant) {
        if (isDefaultVariant(variant)) {
            message(
                    player,
                    variant.behavior() == VehicleBehavior.TRAM
                            ? "tram-placement-failed"
                            : "train-placement-failed"
            );
            return;
        }
        String text = variant.behavior() == VehicleBehavior.TRAM
                ? "&cДля трёх секций «" + variant.displayName()
                + "» не хватает непрерывного пути позади."
                : "&cНе удалось определить направление рельсов для «"
                + variant.displayName() + "».";
        messageText(player, text);
    }

    private String color(String message) {
        return message.replace('&', '§');
    }

    private void messageText(Player player, String value) {
        String prefix = getConfig().getString("messages.prefix", "&6[CustomVehicles] ");
        player.sendMessage(color(prefix + value));
    }

    private boolean isDefaultVariant(VehicleVariantDefinition variant) {
        return variant.id().equals(BuiltInDefinitions.defaultVariant(variant.behavior()));
    }

    DefinitionReloadResult reloadDefinitions() {
        return reloadDefinitions(false);
    }

    private DefinitionReloadResult reloadDefinitions(boolean copyDefaults) {
        ClassLoader classLoader = getClass().getClassLoader();
        Path dataDirectory = getDataFolder().toPath();
        try {
            if (copyDefaults) {
                DefinitionResources.CopyResult copied = DefinitionResources.copyDefaultsOnce(
                        classLoader,
                        dataDirectory
                );
                if (copied.attempted()) {
                    getLogger().info(
                            "Copied " + copied.copiedFiles().size()
                                    + " editable vehicle definition defaults."
                    );
                }
            }
            ModelRegistry loadedModels = ModelRegistry.load(
                    DefinitionResources.bundledModels(classLoader),
                    DefinitionResources.customDefinitions(dataDirectory.resolve("models"))
            );
            VehicleVariantRegistry loadedVariants = VehicleVariantRegistry.load(
                    DefinitionResources.bundledVariants(classLoader),
                    DefinitionResources.customDefinitions(dataDirectory.resolve("vehicles")),
                    loadedModels
            );
            List<DefinitionDiagnostic> diagnostics = new ArrayList<>();
            diagnostics.addAll(loadedModels.diagnostics());
            diagnostics.addAll(loadedVariants.diagnostics());
            diagnostics.forEach(this::logDefinitionDiagnostic);
            long errors = diagnostics.stream().filter(diagnostic ->
                    diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR
            ).count();
            long warnings = diagnostics.size() - errors;

            loadedModels.require(BuiltInDefinitions.CAR_MODEL);
            loadedModels.require(BuiltInDefinitions.METRO_HEAD_MODEL);
            loadedModels.require(BuiltInDefinitions.METRO_WAGON_MODEL);
            loadedModels.require(BuiltInDefinitions.TRAM_FRONT_MODEL);
            loadedModels.require(BuiltInDefinitions.TRAM_MIDDLE_MODEL);
            loadedModels.require(BuiltInDefinitions.TRAM_REAR_MODEL);
            loadedVariants.require(BuiltInDefinitions.CAR_VARIANT);
            loadedVariants.require(BuiltInDefinitions.TRAIN_VARIANT);
            loadedVariants.require(BuiltInDefinitions.WAGON_VARIANT);
            loadedVariants.require(BuiltInDefinitions.TRAM_VARIANT);

            modelRegistry = loadedModels;
            variantRegistry = loadedVariants;
            return new DefinitionReloadResult(
                    true,
                    loadedModels.all().size(),
                    loadedVariants.all().size(),
                    warnings,
                    errors
            );
        } catch (IOException | RuntimeException exception) {
            getLogger().log(
                    Level.SEVERE,
                    "Could not reload vehicle model and variant definitions; "
                            + "the previous registries remain active.",
                    exception
            );
            return new DefinitionReloadResult(
                    false,
                    modelRegistry == null ? 0 : modelRegistry.all().size(),
                    variantRegistry == null ? 0 : variantRegistry.all().size(),
                    0,
                    1
            );
        }
    }

    private void logDefinitionDiagnostic(DefinitionDiagnostic diagnostic) {
        if (diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR) {
            getLogger().severe(diagnostic.formatted());
        } else {
            getLogger().warning(diagnostic.formatted());
        }
    }

    private void migrateLegacyDefaults() {
        double oldWagonSpacing = getConfig().getDouble("train.wagon-spacing", 4.35);
        if (Math.abs(oldWagonSpacing - 4.35) < 0.0001) {
            getConfig().set("train.wagon-spacing", 6.20);
        }
        String oldTrainGiven = "&aВыдан тестовый состав: локомотив и один вагон.";
        if (oldTrainGiven.equals(getConfig().getString("messages.train-given"))) {
            getConfig().set("messages.train-given", "&aВыдан тестовый локомотив.");
        }
        String prototypeVehicleGiven = "&aВыдан тестовый автомобиль.";
        if (prototypeVehicleGiven.equals(getConfig().getString("messages.vehicle-given"))) {
            getConfig().set("messages.vehicle-given", "&aВыдан легковой автомобиль.");
        }
        String prototypeTrainGiven = "&aВыдан тестовый локомотив.";
        if (prototypeTrainGiven.equals(getConfig().getString("messages.train-given"))) {
            getConfig().set("messages.train-given", "&aВыдан головной вагон 81-717.");
        }
        String prototypeTrainPlaced = "&aЛокомотив установлен. Вагоны подцепляются отдельным предметом.";
        if (prototypeTrainPlaced.equals(getConfig().getString("messages.train-placed"))) {
            getConfig().set(
                    "messages.train-placed",
                    "&aГоловной вагон 81-717 установлен. Пассажирские вагоны подцепляются отдельно."
            );
        }
        String oldTrainPlaced = "&aСостав установлен. Управление: W/S, направление задают рельсы.";
        if (oldTrainPlaced.equals(getConfig().getString("messages.train-placed"))) {
            getConfig().set(
                    "messages.train-placed",
                    "&aЛокомотив установлен. Вагоны подцепляются отдельным предметом."
            );
        }
        String oldPlacementFailed = "&cНе хватает непрерывного пути позади локомотива для вагона.";
        if (oldPlacementFailed.equals(getConfig().getString("messages.train-placement-failed"))) {
            getConfig().set(
                    "messages.train-placement-failed",
                    "&cНе удалось определить направление рельсов для локомотива."
            );
        }
        String oldRemoved = "&eАвтомобиль убран.";
        if (oldRemoved.equals(getConfig().getString("messages.vehicle-removed"))) {
            getConfig().set("messages.vehicle-removed", "&eТранспорт убран и возвращён предметами.");
        }
    }

    private void removeOrphanedEntities() {
        int removed = 0;
        for (org.bukkit.World world : getServer().getWorlds()) {
            List<org.bukkit.Location> oldRoots = new ArrayList<>();
            for (Entity entity : world.getEntities()) {
                if (entity.getPersistentDataContainer().has(vehicleKey, PersistentDataType.STRING)) {
                    oldRoots.add(entity.getLocation());
                    entity.remove();
                    removed++;
                }
            }
            Set<Material> legacyPartMaterials = Set.of(
                    Material.RED_CONCRETE,
                    Material.BLACK_STAINED_GLASS,
                    Material.BLACK_CONCRETE,
                    Material.SEA_LANTERN,
                    Material.REDSTONE_BLOCK
            );
            for (Entity entity : world.getEntities()) {
                if (!(entity instanceof BlockDisplay display)
                        || !legacyPartMaterials.contains(display.getBlock().getMaterial())) {
                    continue;
                }
                boolean belongsToLegacyVehicle = oldRoots.stream().anyMatch(root ->
                        root.getWorld() == display.getWorld()
                                && root.distanceSquared(display.getLocation()) <= 16.0
                );
                if (belongsToLegacyVehicle) {
                    display.remove();
                    removed++;
                }
            }
        }
        if (removed > 0) {
            getLogger().info("Removed " + removed + " stale CustomVehicles entities.");
        }
    }
}
