package ru.customvehicles;

import java.util.List;
import java.util.Locale;

final class AutopilotDebugFormatter {
    private AutopilotDebugFormatter() {
    }

    static List<String> format(AutopilotDebugSnapshot snapshot) {
        String vehicleName = snapshot.kind() == VehicleKind.TRAM ? "Трамвай" : "Состав";
        String target = snapshot.nextStopName() == null
                ? "не определена"
                : "#" + (snapshot.nextStopIndex() + 1) + " "
                + snapshot.nextStopName().replace('_', ' ');
        String distance = Double.isFinite(snapshot.distanceToStop())
                ? String.format(Locale.ROOT, "%.2f бл.", snapshot.distanceToStop())
                : "—";
        String blocker = snapshot.blockingVehicleId() == null
                ? "нет"
                : snapshot.blockingVehicleId().toString().substring(0, 8);
        String direction = snapshot.direction() >= 0 ? "вперёд" : "назад";
        String switchInfo = snapshot.lastSwitch() == null ? "нет" : snapshot.lastSwitch();

        return List.of(
                "§8§m----------------------------------------",
                "§6[CV Debug] §f" + vehicleName + " §7" + snapshot.shortVehicleId()
                        + " §8· §e" + (snapshot.routeId() == null ? "без маршрута" : snapshot.routeId()),
                "§7Состояние: §f" + snapshot.status().displayName()
                        + " §8| §7Решение: §b" + snapshot.decision(),
                "§7Цель: §f" + target + " §8· §7дистанция §f" + distance
                        + " §8· §7направление §f" + direction,
                String.format(
                        Locale.ROOT,
                        "§7Скорость: §f%.3f §8· §7тормозной путь: §f%.2f §8· §7стоянка: §f%.1f сек.",
                        snapshot.speed(),
                        snapshot.brakingDistance(),
                        snapshot.dwellTicks() / 20.0
                ),
                "§7Транспорт впереди: §f" + blocker + " §8· §7последняя стрелка: §f" + switchInfo
        );
    }
}
