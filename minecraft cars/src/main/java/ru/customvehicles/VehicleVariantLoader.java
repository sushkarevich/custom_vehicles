package ru.customvehicles;

import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

final class VehicleVariantLoader {
    private static final Set<String> ROOT_FIELDS = Set.of(
            "schema-version",
            "id",
            "display-name",
            "behavior",
            "model",
            "models",
            "item",
            "menu-description",
            "permission"
    );
    private static final Pattern PERMISSION_PATTERN = Pattern.compile("[A-Za-z0-9_.-]{1,128}");
    private final MaterialClassifier materials;

    VehicleVariantLoader() {
        this(MaterialClassifier.PAPER);
    }

    VehicleVariantLoader(MaterialClassifier materials) {
        this.materials = java.util.Objects.requireNonNull(materials, "materials");
    }

    DefinitionLoadResult<VehicleVariantDefinition> load(DefinitionSource source) {
        List<DefinitionDiagnostic> diagnostics = new ArrayList<>();
        YamlConfiguration yaml = DefinitionParsing.yaml(source, diagnostics);
        if (yaml == null) {
            return new DefinitionLoadResult<>(Optional.empty(), "", diagnostics);
        }
        DefinitionParsing.warnUnknown(
                yaml.getKeys(false),
                ROOT_FIELDS,
                source.name(),
                "",
                diagnostics
        );
        int schemaVersion = DefinitionParsing.integer(
                yaml.get("schema-version"),
                -1,
                1,
                Integer.MAX_VALUE,
                source.name(),
                "schema-version",
                diagnostics
        );
        if (schemaVersion != DefinitionParsing.SCHEMA_VERSION) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "schema-version",
                    "поддерживается только версия " + DefinitionParsing.SCHEMA_VERSION
            );
        }
        String id = DefinitionParsing.requiredString(
                yaml.get("id"),
                source.name(),
                "id",
                diagnostics
        );
        DefinitionParsing.validateId(id, source.name(), "id", diagnostics);
        String displayName = DefinitionParsing.requiredString(
                yaml.get("display-name"),
                source.name(),
                "display-name",
                diagnostics
        );
        String rawBehavior = DefinitionParsing.requiredString(
                yaml.get("behavior"),
                source.name(),
                "behavior",
                diagnostics
        );
        VehicleBehavior behavior = VehicleBehavior.from(rawBehavior);
        if (behavior == null) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "behavior",
                    "допустимы car, train, tram или wagon"
            );
            behavior = VehicleBehavior.CAR;
        }
        Map<String, String> models = readModels(yaml, behavior, source, diagnostics);
        VehicleVariantDefinition.Item item = readItem(
                yaml,
                behavior,
                displayName,
                source,
                diagnostics
        );
        List<String> menuDescription = DefinitionParsing.stringList(
                yaml.get("menu-description"),
                source.name(),
                "menu-description",
                diagnostics
        );
        String permission = null;
        if (yaml.get("permission") != null) {
            permission = DefinitionParsing.optionalString(
                    yaml.get("permission"),
                    "",
                    source.name(),
                    "permission",
                    diagnostics
            );
            if (!permission.isEmpty() && !PERMISSION_PATTERN.matcher(permission).matches()) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "permission",
                        "некорректный permission"
                );
            }
        }
        if (DefinitionParsing.hasErrors(diagnostics)) {
            return new DefinitionLoadResult<>(Optional.empty(), id, diagnostics);
        }
        return new DefinitionLoadResult<>(
                Optional.of(new VehicleVariantDefinition(
                        schemaVersion,
                        id,
                        displayName,
                        behavior,
                        models,
                        item,
                        menuDescription,
                        permission
                )),
                id,
                diagnostics
        );
    }

    private Map<String, String> readModels(
            YamlConfiguration yaml,
            VehicleBehavior behavior,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        boolean hasModel = yaml.get("model") != null;
        boolean hasModels = yaml.get("models") != null;
        if (hasModel && hasModels) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "models",
                    "нельзя одновременно указывать model и models"
            );
        }
        Map<String, String> result = new LinkedHashMap<>();
        if (behavior == VehicleBehavior.CAR || behavior == VehicleBehavior.WAGON) {
            String model = DefinitionParsing.requiredString(
                    yaml.get("model"),
                    source.name(),
                    "model",
                    diagnostics
            );
            DefinitionParsing.validateId(model, source.name(), "model", diagnostics);
            if (!model.isEmpty()) {
                result.put("model", model);
            }
            if (hasModels) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "models",
                        "для поведения " + behavior.id() + " используется поле model"
                );
            }
            return result;
        }

        Set<String> requiredRoles = behavior == VehicleBehavior.TRAIN
                ? Set.of("locomotive", "wagon")
                : Set.of("front", "middle", "rear");
        ConfigurationSection section = yaml.getConfigurationSection("models");
        if (section == null) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "models",
                    hasModels
                            ? "ожидался объект ролей " + requiredRoles
                            : "требуется объект ролей " + requiredRoles
            );
            return result;
        }
        DefinitionParsing.warnUnknown(
                section.getKeys(false),
                requiredRoles,
                source.name(),
                "models",
                diagnostics
        );
        for (String role : requiredRoles.stream().sorted().toList()) {
            String model = DefinitionParsing.requiredString(
                    section.get(role),
                    source.name(),
                    "models." + role,
                    diagnostics
            );
            DefinitionParsing.validateId(model, source.name(), "models." + role, diagnostics);
            if (!model.isEmpty()) {
                result.put(role, model);
            }
        }
        if (hasModel) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "model",
                    "для поведения " + behavior.id() + " используется поле models"
            );
        }
        return result;
    }

    private VehicleVariantDefinition.Item readItem(
            YamlConfiguration yaml,
            VehicleBehavior behavior,
            String displayName,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        Material fallbackMaterial = switch (behavior) {
            case CAR -> Material.MINECART;
            case TRAIN -> Material.FURNACE_MINECART;
            case TRAM -> Material.HOPPER_MINECART;
            case WAGON -> Material.CHEST_MINECART;
        };
        ConfigurationSection section = yaml.getConfigurationSection("item");
        if (section == null) {
            if (yaml.get("item") != null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "item",
                        "ожидался объект"
                );
            }
            return new VehicleVariantDefinition.Item(
                    fallbackMaterial,
                    displayName,
                    defaultLore(behavior),
                    null
            );
        }
        DefinitionParsing.warnUnknown(
                section.getKeys(false),
                Set.of("material", "name", "lore", "custom-model-data"),
                source.name(),
                "item",
                diagnostics
        );
        String rawMaterial = DefinitionParsing.optionalString(
                section.get("material"),
                fallbackMaterial.name(),
                source.name(),
                "item.material",
                diagnostics
        );
        Material material = Material.getMaterial(rawMaterial.toUpperCase(Locale.ROOT));
        if (material == null || !materials.isItem(material)) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "item.material",
                    "неизвестный или недоступный как предмет Material: " + rawMaterial
            );
            material = fallbackMaterial;
        }
        String name = DefinitionParsing.optionalString(
                section.get("name"),
                displayName,
                source.name(),
                "item.name",
                diagnostics
        );
        List<String> lore = section.get("lore") == null
                ? defaultLore(behavior)
                : DefinitionParsing.stringList(
                        section.get("lore"),
                        source.name(),
                        "item.lore",
                        diagnostics
                );
        Integer customModelData = section.get("custom-model-data") == null
                ? null
                : DefinitionParsing.integer(
                        section.get("custom-model-data"),
                        0,
                        0,
                        Integer.MAX_VALUE,
                        source.name(),
                        "item.custom-model-data",
                        diagnostics
                );
        return new VehicleVariantDefinition.Item(material, name, lore, customModelData);
    }

    private List<String> defaultLore(VehicleBehavior behavior) {
        return switch (behavior) {
            case CAR -> List.of(
                    "ПКМ по блоку — установить",
                    "Пробел во время езды — гудок",
                    "Shift + ПКМ — меню транспорта"
            );
            case TRAIN, TRAM -> List.of(
                    "ПКМ по рельсам — установить",
                    "Пробел во время езды — гудок",
                    "Shift + ПКМ — меню транспорта"
            );
            case WAGON -> List.of(
                    "ПКМ по локомотиву или вагону — подцепить",
                    "Shift + ПКМ с поводком — отцепить последний"
            );
        };
    }
}
