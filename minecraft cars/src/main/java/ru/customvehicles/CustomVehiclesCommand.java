package ru.customvehicles;

import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.Rail;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

final class CustomVehiclesCommand implements CommandExecutor, TabCompleter {
    private final CustomVehiclesPlugin plugin;

    CustomVehiclesCommand(CustomVehiclesPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("customvehicles.command")) {
            if (sender instanceof Player player) {
                plugin.message(player, "no-permission");
            }
            return true;
        }
        String subcommand = args.length == 0 && sender instanceof Player
                ? "catalog"
                : args.length == 0 ? "help" : args[0].toLowerCase();
        switch (subcommand) {
            case "give" -> {
                if (args.length == 1 && sender instanceof Player player) {
                    plugin.openVehicleCatalog(player);
                    return true;
                }
                Player target = sender instanceof Player player ? player : null;
                VehicleVariantDefinition variant = plugin.variantRegistry()
                        .require(BuiltInDefinitions.CAR_VARIANT);
                if (args.length >= 2) {
                    VehicleVariantDefinition requested = plugin.findVariantOrLegacy(args[1]);
                    if (requested != null) {
                        variant = requested;
                    } else {
                        target = plugin.getServer().getPlayerExact(args[1]);
                    }
                }
                if (args.length >= 3) {
                    VehicleVariantDefinition requested = plugin.findVariantOrLegacy(args[2]);
                    if (requested == null) {
                        sender.sendMessage("§cВариант транспорта не найден: " + args[2]);
                        return true;
                    }
                    variant = requested;
                }
                if (target == null) {
                    sender.sendMessage(
                            "§cИгрок не найден. Использование: /cv give [игрок] [вариант]"
                    );
                    return true;
                }
                plugin.giveVehicleItems(target, variant, List.of());
                plugin.messageVehicleGiven(target, variant);
                sender.sendMessage(
                        "§a" + variant.displayName() + " выдан игроку " + target.getName() + "."
                );
            }
            case "catalog", "vehicles" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§cКаталог транспорта доступен только игроку.");
                    return true;
                }
                plugin.openVehicleCatalog(player);
            }
            case "list", "active" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§eАктивного транспорта: " + plugin.vehicleManager().all().size());
                    return true;
                }
                plugin.openActiveVehiclesMenu(player);
            }
            case "debug" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§cДиагностика ввода доступна только игроку.");
                    return true;
                }
                sender.sendMessage(plugin.vehicleManager().debug(player, plugin.inputs()));
            }
            case "config" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§cМеню настроек доступно только игроку.");
                    return true;
                }
                plugin.openConfigMenu(player);
            }
            case "menu" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§cМеню транспорта доступно только игроку.");
                    return true;
                }
                ManagedVehicle vehicle = plugin.vehicleManager().drivenBy(player);
                if (vehicle == null) {
                    sender.sendMessage("§cСначала сядьте в машину или откройте меню через Shift + ПКМ.");
                    return true;
                }
                plugin.openVehicleMenu(player, vehicle);
            }
            case "route", "routes", "road" -> handleRoute(sender, args);
            case "remove" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§cЭту команду должен выполнить игрок.");
                    return true;
                }
                ManagedVehicle vehicle = plugin.vehicleManager().drivenBy(player);
                if (vehicle == null) {
                    sender.sendMessage("§cСначала сядьте в машину.");
                    return true;
                }
                VehicleVariantDefinition variant = vehicle.variantDefinition();
                List<VehicleVariantDefinition> wagonVariants =
                        vehicle.wagonVariantDefinitions();
                if (plugin.vehicleManager().remove(vehicle)) {
                    plugin.giveVehicleItems(player, variant, wagonVariants);
                    plugin.message(player, "vehicle-removed");
                }
            }
            case "reload" -> {
                plugin.reloadConfig();
                plugin.vehicleManager().reloadSettings();
                plugin.autopilotManager().reloadSettings();
                DefinitionReloadResult result = plugin.reloadDefinitions();
                if (result.successful()) {
                    sender.sendMessage(
                            "§aКонфигурация перечитана: моделей " + result.modelCount()
                                    + ", вариантов " + result.variantCount() + "."
                    );
                    if (result.warningCount() > 0 || result.errorCount() > 0) {
                        sender.sendMessage(
                                "§eДиагностика загрузки: предупреждений "
                                        + result.warningCount() + ", ошибок "
                                        + result.errorCount()
                                        + ". Подробности записаны в консоль."
                        );
                    }
                } else {
                    sender.sendMessage(
                            "§cНе удалось перечитать модели транспорта. "
                                    + "Предыдущие определения оставлены активными."
                    );
                }
            }
            default -> sender.sendMessage(
                    "§e/cv, /cv catalog, /cv list, /cv menu, /cv config, /cv route, /cv give [игрок] [вариант], /cv remove, /cv debug, /cv reload"
            );
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(
            CommandSender sender,
            Command command,
            String alias,
            String[] args
    ) {
        if (args.length == 1) {
            return List.of(
                            "catalog", "vehicles", "menu", "config", "give",
                            "list", "active", "route", "routes", "road", "remove", "debug", "reload"
                    ).stream()
                    .filter(option -> option.startsWith(args[0].toLowerCase()))
                    .toList();
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("give")) {
            return java.util.stream.Stream.concat(
                            variantArguments(),
                            plugin.getServer().getOnlinePlayers().stream().map(Player::getName)
                    )
                    .distinct()
                    .filter(option -> option.toLowerCase().startsWith(args[1].toLowerCase()))
                    .toList();
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("give")) {
            return variantArguments()
                    .filter(option -> option.startsWith(args[2].toLowerCase()))
                    .toList();
        }
        if (args.length == 2 && isRouteCommand(args[0])) {
            return List.of(
                            "list", "info", "create", "delete",
                            "stop", "switch", "removestop", "removeswitch", "debug"
                    ).stream()
                    .filter(option -> option.startsWith(args[1].toLowerCase(Locale.ROOT)))
                    .toList();
        }
        if (args.length == 3 && isRouteCommand(args[0])
                && !args[1].equalsIgnoreCase("create")
                && !args[1].equalsIgnoreCase("list")) {
            java.util.stream.Stream<String> options = plugin.routeManager().all().stream()
                    .map(RailRoute::id);
            if (args[1].equalsIgnoreCase("debug")) {
                options = java.util.stream.Stream.concat(java.util.stream.Stream.of("stop"), options);
            }
            return options
                    .filter(id -> id.startsWith(args[2].toLowerCase(Locale.ROOT)))
                    .toList();
        }
        if (args.length == 5 && isRouteCommand(args[0])
                && args[1].equalsIgnoreCase("switch")) {
            return java.util.Arrays.stream(Rail.Shape.values())
                    .map(shape -> shape.name().toLowerCase(Locale.ROOT))
                    .filter(shape -> shape.startsWith(args[4].toLowerCase(Locale.ROOT)))
                    .toList();
        }
        return List.of();
    }

    private void handleRoute(CommandSender sender, String[] args) {
        if (args.length < 2 || args[1].equalsIgnoreCase("list")) {
            CollectionMessage.sendRoutes(sender, plugin.routeManager().all());
            return;
        }
        String action = args[1].toLowerCase(Locale.ROOT);
        if (action.equals("create")) {
            if (args.length < 3) {
                sender.sendMessage("§cИспользование: /cv route create <id>");
                return;
            }
            sender.sendMessage(plugin.routeManager().create(args[2])
                    ? "§aМаршрут " + args[2].toLowerCase(Locale.ROOT) + " создан."
                    : "§cНе удалось создать маршрут. ID: латиница, цифры, _ или -, максимум 32 символа.");
            return;
        }
        if (action.equals("delete")) {
            if (args.length < 3) {
                sender.sendMessage("§cИспользование: /cv route delete <id>");
                return;
            }
            sender.sendMessage(plugin.routeManager().delete(args[2])
                    ? "§eМаршрут удалён."
                    : "§cМаршрут не найден.");
            return;
        }
        if (action.equals("info")) {
            if (args.length < 3) {
                sender.sendMessage("§cИспользование: /cv route info <id>");
                return;
            }
            sendRouteInfo(sender, plugin.routeManager().byId(args[2]));
            return;
        }
        if (action.equals("debug")) {
            handleRouteDebug(sender, args);
            return;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cРазмечать остановки и стрелки должен игрок.");
            return;
        }
        if (action.equals("stop")) {
            addStop(player, args);
            return;
        }
        if (action.equals("switch")) {
            addSwitch(player, args);
            return;
        }
        if (action.equals("removestop")) {
            removeStop(player, args);
            return;
        }
        if (action.equals("removeswitch")) {
            removeSwitch(player, args);
            return;
        }
        player.sendMessage(
                "§e/cv route <list|info|create|delete|stop|switch|removestop|removeswitch|debug>"
        );
    }

    private void handleRouteDebug(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cМеню диагностики доступно только игроку.");
            return;
        }
        if (args.length >= 3 && args[2].equalsIgnoreCase("stop")) {
            player.sendMessage(plugin.autopilotManager().stopDebug(player)
                    ? "§6[CustomVehicles] §eВывод диагностики остановлен."
                    : "§6[CustomVehicles] §7Диагностика и так не была включена.");
            return;
        }

        String routeId = args.length >= 3 ? args[2] : null;
        if (routeId == null) {
            ManagedVehicle driven = plugin.vehicleManager().drivenBy(player);
            if (driven instanceof RailTrain) {
                routeId = plugin.autopilotManager().info(driven.id()).routeId();
            }
        }
        if (routeId == null) {
            player.sendMessage("§cИспользование: /cv route debug <маршрут>");
            player.sendMessage("§7Остановить вывод: /cv route debug stop");
            return;
        }
        plugin.openRouteDebugMenu(player, routeId);
    }

    private void addStop(Player player, String[] args) {
        if (args.length < 4) {
            player.sendMessage("§cИспользование: /cv route stop <маршрут> <название> [секунды]");
            return;
        }
        RailRoute route = plugin.routeManager().byId(args[2]);
        if (route == null) {
            player.sendMessage("§cМаршрут не найден.");
            return;
        }
        Block rail = nearestRail(player);
        if (rail == null) {
            player.sendMessage("§cВ радиусе двух блоков не найдены рельсы.");
            return;
        }
        int seconds = args.length >= 5 ? integer(args[4], 10) : 10;
        seconds = Math.max(1, Math.min(300, seconds));
        RouteStop stop = new RouteStop(
                args[3],
                rail.getWorld().getUID(),
                rail.getWorld().getName(),
                rail.getX() + 0.5,
                rail.getY() + 0.14,
                rail.getZ() + 0.5,
                seconds * 20
        );
        plugin.routeManager().addStop(route.id(), stop);
        player.sendMessage("§aОстановка №" + (route.stops().size() + 1)
                + " добавлена: §f" + args[3].replace('_', ' ')
                + " §7(" + seconds + " сек.).");
    }

    private void addSwitch(Player player, String[] args) {
        if (args.length < 5) {
            player.sendMessage(
                    "§cИспользование: /cv route switch <маршрут> <номер следующей остановки> <shape>"
            );
            return;
        }
        RailRoute route = plugin.routeManager().byId(args[2]);
        if (route == null) {
            player.sendMessage("§cМаршрут не найден.");
            return;
        }
        int target = integer(args[3], -1) - 1;
        Rail.Shape shape;
        try {
            shape = Rail.Shape.valueOf(args[4].toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            player.sendMessage("§cНеизвестная форма рельса. Используйте автодополнение команды.");
            return;
        }
        Block block = player.getTargetBlockExact(8);
        if (block == null || !Tag.RAILS.isTagged(block.getType())
                || !(block.getBlockData() instanceof Rail rail)) {
            player.sendMessage("§cСмотрите на подходящий рельс стрелки не дальше восьми блоков.");
            return;
        }
        try {
            rail.setShape(shape);
        } catch (IllegalArgumentException exception) {
            player.sendMessage("§cЭтот тип рельса не поддерживает выбранное направление.");
            return;
        }
        if (!plugin.routeManager().addSwitch(route.id(), target, block, shape)) {
            player.sendMessage("§cПроверьте номер следующей остановки.");
            return;
        }
        player.sendMessage("§aСтрелка добавлена для движения к остановке №" + (target + 1)
                + ": §f" + shape.name().toLowerCase(Locale.ROOT) + "§a.");
    }

    private void removeStop(Player player, String[] args) {
        if (args.length < 4) {
            player.sendMessage("§cИспользование: /cv route removestop <маршрут> <номер>");
            return;
        }
        int index = integer(args[3], -1) - 1;
        player.sendMessage(plugin.routeManager().removeStop(args[2], index)
                ? "§eОстановка удалена."
                : "§cМаршрут или остановка не найдены.");
    }

    private void removeSwitch(Player player, String[] args) {
        if (args.length < 4) {
            player.sendMessage("§cИспользование: /cv route removeswitch <маршрут> <номер>");
            return;
        }
        int index = integer(args[3], -1) - 1;
        player.sendMessage(plugin.routeManager().removeSwitch(args[2], index)
                ? "§eИнструкция стрелки удалена."
                : "§cМаршрут или инструкция не найдены.");
    }

    private void sendRouteInfo(CommandSender sender, RailRoute route) {
        if (route == null) {
            sender.sendMessage("§cМаршрут не найден.");
            return;
        }
        sender.sendMessage("§6Маршрут §f" + route.id() + "§6: остановок "
                + route.stops().size() + ", стрелок " + route.switches().size() + ".");
        for (int index = 0; index < route.stops().size(); index++) {
            RouteStop stop = route.stops().get(index);
            sender.sendMessage(String.format(
                    Locale.ROOT,
                    "§e%d. §f%s §7— %s (%.1f, %.1f, %.1f), %d сек.",
                    index + 1,
                    stop.name().replace('_', ' '),
                    stop.worldName(),
                    stop.x(),
                    stop.y(),
                    stop.z(),
                    stop.dwellTicks() / 20
            ));
        }
        for (int index = 0; index < route.switches().size(); index++) {
            RouteSwitch routeSwitch = route.switches().get(index);
            sender.sendMessage("§7Стрелка " + (index + 1) + ": "
                    + routeSwitch.x() + ", " + routeSwitch.y() + ", " + routeSwitch.z()
                    + " → остановка " + (routeSwitch.targetStopIndex() + 1)
                    + " / " + routeSwitch.shape().name().toLowerCase(Locale.ROOT));
        }
    }

    private Block nearestRail(Player player) {
        Block origin = player.getLocation().getBlock();
        return java.util.stream.IntStream.rangeClosed(-3, 2)
                .boxed()
                .flatMap(y -> java.util.stream.IntStream.rangeClosed(-2, 2)
                        .boxed()
                        .flatMap(x -> java.util.stream.IntStream.rangeClosed(-2, 2)
                                .mapToObj(z -> origin.getRelative(x, y, z))))
                .filter(block -> Tag.RAILS.isTagged(block.getType()))
                .min(Comparator.comparingDouble(block ->
                        block.getLocation().add(0.5, 0.5, 0.5).distanceSquared(player.getLocation())
                ))
                .orElse(null);
    }

    private int integer(String raw, int fallback) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private boolean isRouteCommand(String raw) {
        return raw.equalsIgnoreCase("route")
                || raw.equalsIgnoreCase("routes")
                || raw.equalsIgnoreCase("road");
    }

    private java.util.stream.Stream<String> variantArguments() {
        return java.util.stream.Stream.concat(
                plugin.variantRegistry().all().stream().map(VehicleVariantDefinition::id),
                java.util.stream.Stream.of("car", "train", "tram", "wagon")
        );
    }

    private static final class CollectionMessage {
        private static void sendRoutes(
                CommandSender sender,
                java.util.Collection<RailRoute> routes
        ) {
            if (routes.isEmpty()) {
                sender.sendMessage("§eМаршрутов пока нет. Создание: /cv route create <id>");
                return;
            }
            sender.sendMessage("§6Маршруты:");
            routes.forEach(route -> sender.sendMessage(
                    "§e- §f" + route.id() + " §7(остановок: " + route.stops().size()
                            + ", стрелок: " + route.switches().size() + ")"
            ));
        }
    }
}
