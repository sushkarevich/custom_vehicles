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

final class VehicleCatalogMenu implements Listener {
    private static final int SIZE = 27;
    private static final int CARS = 11;
    private static final int RAIL_VEHICLES = 15;
    private static final int CONTENT_FIRST = 9;
    private static final int CONTENT_LAST = 17;
    private static final int PAGE_SIZE = CONTENT_LAST - CONTENT_FIRST + 1;
    private static final int BACK = 18;
    private static final int PREVIOUS = 21;
    private static final int NEXT = 23;
    private static final int CLOSE = 26;

    private final CustomVehiclesPlugin plugin;

    VehicleCatalogMenu(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    void open(Player player) {
        open(player, Page.CATEGORIES, 0);
    }

    private void open(Player player, Page page, int pageIndex) {
        CatalogHolder holder = new CatalogHolder(page, Math.max(0, pageIndex));
        Inventory inventory = Bukkit.createInventory(
                holder,
                SIZE,
                Component.text(title(page), NamedTextColor.DARK_GRAY)
        );
        holder.inventory = inventory;
        render(holder, player);
        player.openInventory(inventory);
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder() instanceof CatalogHolder holder)) {
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
        if (slot == BACK && holder.page != Page.CATEGORIES) {
            open(player, Page.CATEGORIES, 0);
            click(player);
            return;
        }
        if (slot == PREVIOUS && holder.pageIndex > 0) {
            open(player, holder.page, holder.pageIndex - 1);
            click(player);
            return;
        }
        if (slot == NEXT && holder.hasNextPage) {
            open(player, holder.page, holder.pageIndex + 1);
            click(player);
            return;
        }
        if (holder.page == Page.CATEGORIES) {
            if (slot == CARS) {
                open(player, Page.CARS, 0);
                click(player);
            } else if (slot == RAIL_VEHICLES) {
                open(player, Page.RAIL, 0);
                click(player);
            }
            return;
        }
        String variantId = holder.variantsBySlot.get(slot);
        if (variantId != null) {
            VehicleVariantDefinition variant = plugin.variantRegistry()
                    .find(variantId)
                    .orElse(null);
            if (variant != null) {
                give(player, variant);
            }
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof CatalogHolder
                && event.getRawSlots().stream().anyMatch(slot -> slot < SIZE)) {
            event.setCancelled(true);
        }
    }

    private void give(Player player, VehicleVariantDefinition variant) {
        if (variant.permissionValue().isPresent()
                && !player.hasPermission(variant.permissionValue().orElseThrow())) {
            plugin.message(player, "no-permission");
            return;
        }
        plugin.giveVehicleItems(player, variant, List.of());
        plugin.messageVehicleGiven(player, variant);
        player.closeInventory();
        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 0.8F, 1.2F);
    }

    private void render(CatalogHolder holder, Player player) {
        Inventory inventory = holder.getInventory();
        ItemStack filler = item(
                Material.GRAY_STAINED_GLASS_PANE,
                " ",
                NamedTextColor.DARK_GRAY,
                List.of()
        );
        for (int slot = 0; slot < SIZE; slot++) {
            inventory.setItem(slot, filler);
        }
        inventory.setItem(CLOSE, item(Material.BARRIER, "Закрыть", NamedTextColor.RED, List.of()));

        switch (holder.page) {
            case CATEGORIES -> renderCategories(inventory, player);
            case CARS -> renderVariants(holder, player, VehicleBehavior.CAR);
            case RAIL -> renderVariants(holder, player, null);
        }
    }

    private void renderCategories(Inventory inventory, Player player) {
        long carCount = availableVariants(player).stream()
                .filter(variant -> variant.behavior() == VehicleBehavior.CAR)
                .count();
        long railCount = availableVariants(player).size() - carCount;
        inventory.setItem(CARS, item(
                Material.MINECART,
                "Автомобили",
                NamedTextColor.GOLD,
                List.of(
                        Component.text("Дорожный транспорт", NamedTextColor.GRAY),
                        Component.text("Доступно моделей: " + carCount, NamedTextColor.DARK_GRAY),
                        Component.text("Нажмите, чтобы открыть", NamedTextColor.GREEN)
                )
        ));
        inventory.setItem(RAIL_VEHICLES, item(
                Material.RAIL,
                "Железнодорожный транспорт",
                NamedTextColor.AQUA,
                List.of(
                        Component.text("Метро, трамваи и отдельные вагоны", NamedTextColor.GRAY),
                        Component.text("Доступно моделей: " + railCount, NamedTextColor.DARK_GRAY),
                        Component.text("Нажмите, чтобы открыть", NamedTextColor.GREEN)
                )
        ));
        inventory.setItem(4, item(
                Material.COMPASS,
                "Каталог транспорта",
                NamedTextColor.YELLOW,
                List.of(Component.text("Выберите нужную категорию", NamedTextColor.GRAY))
        ));
    }

    private void renderVariants(
            CatalogHolder holder,
            Player player,
            VehicleBehavior behavior
    ) {
        List<VehicleVariantDefinition> variants = availableVariants(player).stream()
                .filter(variant -> behavior == null
                        ? variant.behavior() != VehicleBehavior.CAR
                        : variant.behavior() == behavior)
                .toList();
        int fromIndex = Math.min(holder.pageIndex * PAGE_SIZE, variants.size());
        int toIndex = Math.min(fromIndex + PAGE_SIZE, variants.size());
        holder.hasNextPage = toIndex < variants.size();
        holder.variantsBySlot.clear();
        for (int index = fromIndex; index < toIndex; index++) {
            int slot = CONTENT_FIRST + index - fromIndex;
            VehicleVariantDefinition variant = variants.get(index);
            holder.variantsBySlot.put(slot, variant.id());
            holder.inventory.setItem(slot, catalogItem(variant));
        }

        String heading = behavior == VehicleBehavior.CAR
                ? "Автомобили"
                : "Железнодорожный транспорт";
        Material headingMaterial = behavior == VehicleBehavior.CAR ? Material.MINECART : Material.RAIL;
        holder.inventory.setItem(4, item(
                headingMaterial,
                heading,
                behavior == VehicleBehavior.CAR ? NamedTextColor.GOLD : NamedTextColor.AQUA,
                List.of(Component.text(
                        "Страница " + (holder.pageIndex + 1),
                        NamedTextColor.GRAY
                ))
        ));
        holder.inventory.setItem(BACK, back());
        if (holder.pageIndex > 0) {
            holder.inventory.setItem(PREVIOUS, item(
                    Material.ARROW,
                    "Предыдущая страница",
                    NamedTextColor.YELLOW,
                    List.of()
            ));
        }
        if (holder.hasNextPage) {
            holder.inventory.setItem(NEXT, item(
                    Material.ARROW,
                    "Следующая страница",
                    NamedTextColor.YELLOW,
                    List.of()
            ));
        }
    }

    private List<VehicleVariantDefinition> availableVariants(Player player) {
        return plugin.variantRegistry().all().stream()
                .filter(variant -> variant.permissionValue().isEmpty()
                        || player.hasPermission(variant.permissionValue().orElseThrow()))
                .toList();
    }

    private ItemStack catalogItem(VehicleVariantDefinition variant) {
        List<Component> lore = new java.util.ArrayList<>();
        variant.menuDescription().forEach(line ->
                lore.add(Component.text(line, NamedTextColor.GRAY))
        );
        lore.add(Component.text("ID: " + variant.id(), NamedTextColor.DARK_GRAY));
        lore.add(Component.text("Нажмите, чтобы получить", NamedTextColor.GREEN));
        ItemStack stack = item(
                variant.item().material(),
                variant.item().name(),
                NamedTextColor.GOLD,
                lore
        );
        if (variant.item().customModelData() != null) {
            ItemMeta meta = stack.getItemMeta();
            meta.setCustomModelData(variant.item().customModelData());
            stack.setItemMeta(meta);
        }
        return stack;
    }

    private ItemStack back() {
        return item(
                Material.ARROW,
                "Назад к категориям",
                NamedTextColor.YELLOW,
                List.of()
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

    private String title(Page page) {
        return switch (page) {
            case CATEGORIES -> "Каталог транспорта";
            case CARS -> "Каталог · Автомобили";
            case RAIL -> "Каталог · ЖД транспорт";
        };
    }

    private enum Page {
        CATEGORIES,
        CARS,
        RAIL
    }

    private static final class CatalogHolder implements InventoryHolder {
        private final Page page;
        private final int pageIndex;
        private final Map<Integer, String> variantsBySlot = new HashMap<>();
        private Inventory inventory;
        private boolean hasNextPage;

        private CatalogHolder(Page page, int pageIndex) {
            this.page = page;
            this.pageIndex = pageIndex;
        }

        @Override
        public Inventory getInventory() {
            return inventory;
        }
    }
}
