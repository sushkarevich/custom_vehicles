package ru.customvehicles;

import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

final class ModelLoader {
    private static final int MAX_PARTS = 512;
    private static final double MAX_POSITION = 256.0;
    private static final double MAX_SCALE = 64.0;
    private static final double MAX_ROTATION = 360_000.0;
    private static final Set<String> ROOT_FIELDS = Set.of(
            "schema-version",
            "id",
            "display-name",
            "coordinate-system",
            "interaction",
            "display",
            "parts"
    );
    private static final Set<String> PART_FIELDS = Set.of(
            "id",
            "type",
            "material",
            "position",
            "scale",
            "rotation-degrees"
    );
    private final MaterialClassifier materials;

    ModelLoader() {
        this(MaterialClassifier.PAPER);
    }

    ModelLoader(MaterialClassifier materials) {
        this.materials = java.util.Objects.requireNonNull(materials, "materials");
    }

    DefinitionLoadResult<ModelDefinition> load(DefinitionSource source) {
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

        ModelDefinition.ForwardDirection forward = readForward(yaml, source, diagnostics);
        Optional<ModelDefinition.Interaction> interaction = readInteraction(
                yaml,
                source,
                diagnostics
        );
        ModelDefinition.DisplaySettings display = readDisplay(yaml, source, diagnostics);
        List<ModelPartDefinition> parts = readParts(yaml, source, diagnostics);

        if (DefinitionParsing.hasErrors(diagnostics)) {
            return new DefinitionLoadResult<>(Optional.empty(), id, diagnostics);
        }
        ModelDefinition definition = new ModelDefinition(
                schemaVersion,
                id,
                displayName,
                forward,
                interaction,
                display,
                parts
        );
        return new DefinitionLoadResult<>(Optional.of(definition), id, diagnostics);
    }

    private ModelDefinition.ForwardDirection readForward(
            YamlConfiguration yaml,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        ConfigurationSection section = yaml.getConfigurationSection("coordinate-system");
        if (section == null) {
            if (yaml.get("coordinate-system") != null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "coordinate-system",
                        "ожидался объект"
                );
            }
            return ModelDefinition.ForwardDirection.POSITIVE_Z;
        }
        DefinitionParsing.warnUnknown(
                section.getKeys(false),
                Set.of("forward"),
                source.name(),
                "coordinate-system",
                diagnostics
        );
        String raw = DefinitionParsing.optionalString(
                section.get("forward"),
                "positive-z",
                source.name(),
                "coordinate-system.forward",
                diagnostics
        );
        ModelDefinition.ForwardDirection direction = ModelDefinition.ForwardDirection.from(raw);
        if (direction == null) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "coordinate-system.forward",
                    "допустимы positive-z или negative-z"
            );
            return ModelDefinition.ForwardDirection.POSITIVE_Z;
        }
        return direction;
    }

    private Optional<ModelDefinition.Interaction> readInteraction(
            YamlConfiguration yaml,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        ConfigurationSection section = yaml.getConfigurationSection("interaction");
        if (section == null) {
            if (yaml.get("interaction") != null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "interaction",
                        "ожидался объект"
                );
            }
            return Optional.empty();
        }
        DefinitionParsing.warnUnknown(
                section.getKeys(false),
                Set.of("offset", "width", "height"),
                source.name(),
                "interaction",
                diagnostics
        );
        ModelVector offset = DefinitionParsing.vector(
                section.get("offset"),
                ModelVector.ZERO,
                -MAX_POSITION,
                MAX_POSITION,
                source.name(),
                "interaction.offset",
                diagnostics
        );
        if (section.get("width") == null) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "interaction.width",
                    "обязательное поле"
            );
        }
        if (section.get("height") == null) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "interaction.height",
                    "обязательное поле"
            );
        }
        float width = (float) DefinitionParsing.number(
                section.get("width"),
                1.0,
                0.01,
                64.0,
                source.name(),
                "interaction.width",
                diagnostics
        );
        float height = (float) DefinitionParsing.number(
                section.get("height"),
                1.0,
                0.01,
                64.0,
                source.name(),
                "interaction.height",
                diagnostics
        );
        return Optional.of(new ModelDefinition.Interaction(offset, width, height));
    }

    private ModelDefinition.DisplaySettings readDisplay(
            YamlConfiguration yaml,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        ConfigurationSection section = yaml.getConfigurationSection("display");
        if (section == null) {
            if (yaml.get("display") != null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "display",
                        "ожидался объект"
                );
            }
            return new ModelDefinition.DisplaySettings(2, 1);
        }
        DefinitionParsing.warnUnknown(
                section.getKeys(false),
                Set.of("interpolation-duration", "teleport-duration"),
                source.name(),
                "display",
                diagnostics
        );
        return new ModelDefinition.DisplaySettings(
                DefinitionParsing.integer(
                        section.get("interpolation-duration"),
                        2,
                        0,
                        59,
                        source.name(),
                        "display.interpolation-duration",
                        diagnostics
                ),
                DefinitionParsing.integer(
                        section.get("teleport-duration"),
                        1,
                        0,
                        59,
                        source.name(),
                        "display.teleport-duration",
                        diagnostics
                )
        );
    }

    private List<ModelPartDefinition> readParts(
            YamlConfiguration yaml,
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        Object rawParts = yaml.get("parts");
        if (!(rawParts instanceof List<?> entries) || entries.isEmpty()) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "parts",
                    "требуется непустой список деталей"
            );
            return List.of();
        }
        if (entries.size() > MAX_PARTS) {
            DefinitionParsing.error(
                    diagnostics,
                    source.name(),
                    "parts",
                    "слишком много деталей: максимум " + MAX_PARTS
            );
        }
        List<ModelPartDefinition> result = new ArrayList<>(Math.min(entries.size(), MAX_PARTS));
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < entries.size() && index < MAX_PARTS; index++) {
            Object rawEntry = entries.get(index);
            String field = "parts[" + index + "]";
            if (!(rawEntry instanceof Map<?, ?> map)) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field,
                        "ожидался объект детали"
                );
                continue;
            }
            Set<String> keys = map.keySet().stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .collect(java.util.stream.Collectors.toSet());
            DefinitionParsing.warnUnknown(keys, PART_FIELDS, source.name(), field, diagnostics);

            String partId = DefinitionParsing.requiredString(
                    map.get("id"),
                    source.name(),
                    field + ".id",
                    diagnostics
            );
            DefinitionParsing.validateId(partId, source.name(), field + ".id", diagnostics);
            if (!partId.isEmpty() && !ids.add(partId)) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field + ".id",
                        "ID детали уже используется: " + partId
                );
            }
            String rawType = DefinitionParsing.optionalString(
                    map.get("type"),
                    "block",
                    source.name(),
                    field + ".type",
                    diagnostics
            );
            ModelPartDefinition.Type type = rawType.equalsIgnoreCase("block")
                    ? ModelPartDefinition.Type.BLOCK
                    : null;
            if (type == null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field + ".type",
                        "поддерживается только тип block"
                );
                type = ModelPartDefinition.Type.BLOCK;
            }
            String rawMaterial = DefinitionParsing.requiredString(
                    map.get("material"),
                    source.name(),
                    field + ".material",
                    diagnostics
            );
            Material material = rawMaterial.isEmpty()
                    ? null
                    : Material.getMaterial(rawMaterial.toUpperCase(Locale.ROOT));
            if (material == null || !materials.isBlock(material)) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field + ".material",
                        "неизвестный или не являющийся блоком Material: " + rawMaterial
                );
                material = Material.STONE;
            }
            Object rawPosition = map.get("position");
            if (rawPosition == null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field + ".position",
                        "обязательное поле"
                );
            }
            ModelVector position = DefinitionParsing.vector(
                    rawPosition,
                    ModelVector.ZERO,
                    -MAX_POSITION,
                    MAX_POSITION,
                    source.name(),
                    field + ".position",
                    diagnostics
            );
            Object rawScale = map.get("scale");
            if (rawScale == null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        field + ".scale",
                        "обязательное поле"
                );
            }
            ModelVector scale = DefinitionParsing.vector(
                    rawScale,
                    ModelVector.ONE,
                    0.0001,
                    MAX_SCALE,
                    source.name(),
                    field + ".scale",
                    diagnostics
            );
            ModelVector rotation = DefinitionParsing.vector(
                    map.get("rotation-degrees"),
                    ModelVector.ZERO,
                    -MAX_ROTATION,
                    MAX_ROTATION,
                    source.name(),
                    field + ".rotation-degrees",
                    diagnostics
            );
            result.add(new ModelPartDefinition(
                    partId,
                    type,
                    material,
                    position,
                    scale,
                    rotation
            ));
        }
        return List.copyOf(result);
    }
}
