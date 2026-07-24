package ru.customvehicles;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

final class VehicleVariantRegistry {
    private final Map<String, VehicleVariantDefinition> definitions;
    private final List<DefinitionDiagnostic> diagnostics;

    private VehicleVariantRegistry(
            Map<String, VehicleVariantDefinition> definitions,
            List<DefinitionDiagnostic> diagnostics
    ) {
        this.definitions = Collections.unmodifiableMap(new TreeMap<>(definitions));
        this.diagnostics = List.copyOf(diagnostics);
    }

    static VehicleVariantRegistry load(
            Collection<DefinitionSource> builtIns,
            Collection<DefinitionSource> custom,
            ModelRegistry models
    ) {
        return load(builtIns, custom, models, MaterialClassifier.PAPER);
    }

    static VehicleVariantRegistry load(
            Collection<DefinitionSource> builtIns,
            Collection<DefinitionSource> custom,
            ModelRegistry models,
            MaterialClassifier materials
    ) {
        VehicleVariantLoader loader = new VehicleVariantLoader(materials);
        List<DefinitionDiagnostic> diagnostics = new ArrayList<>();
        Map<String, VehicleVariantDefinition> result = loadBuiltIns(
                loader,
                builtIns,
                models,
                diagnostics
        );
        Map<String, SourcedVariant> customDefinitions = new LinkedHashMap<>();
        for (DefinitionSource source : custom.stream().sorted().toList()) {
            DefinitionLoadResult<VehicleVariantDefinition> loaded = loader.load(source);
            diagnostics.addAll(loaded.diagnostics());
            VehicleVariantDefinition definition = loaded.valid()
                    ? loaded.value().orElseThrow()
                    : null;
            if (definition != null
                    && !validateModelReferences(definition, source.name(), models, diagnostics)) {
                definition = null;
            }
            VehicleVariantDefinition builtIn = definition == null
                    ? null
                    : result.get(definition.id());
            if (definition != null
                    && builtIn != null
                    && definition.behavior() != builtIn.behavior()) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "behavior",
                        "зарезервированный ID " + definition.id()
                                + " должен сохранять поведение " + builtIn.behavior().id()
                );
                definition = null;
            }
            if (definition == null) {
                String invalidId = loaded.declaredId();
                SourcedVariant shadowed = invalidId.isBlank()
                        ? null
                        : customDefinitions.get(invalidId);
                if (shadowed != null) {
                    DefinitionParsing.warning(
                            diagnostics,
                            source.name(),
                            "id",
                            "некорректный дубликат " + invalidId + " пропущен; "
                                    + "сохраняется корректное определение из "
                                    + shadowed.source()
                    );
                }
                if (shadowed == null
                        && !invalidId.isBlank()
                        && result.containsKey(invalidId)) {
                    DefinitionParsing.warning(
                            diagnostics,
                            source.name(),
                            "id",
                            "некорректное переопределение пропущено; используется встроенный вариант "
                                    + invalidId
                    );
                }
                continue;
            }
            SourcedVariant previous = customDefinitions.put(
                    definition.id(),
                    new SourcedVariant(source.name(), definition)
            );
            if (previous != null) {
                DefinitionParsing.warning(
                        diagnostics,
                        source.name(),
                        "id",
                        "дубликат ID " + definition.id() + "; файл " + source.name()
                                + " имеет лексикографический приоритет над " + previous.source()
                );
            }
        }
        customDefinitions.values().forEach(sourced ->
                result.put(sourced.definition().id(), sourced.definition())
        );
        return new VehicleVariantRegistry(result, diagnostics);
    }

    Optional<VehicleVariantDefinition> find(String id) {
        return Optional.ofNullable(definitions.get(id));
    }

    VehicleVariantDefinition require(String id) {
        VehicleVariantDefinition definition = definitions.get(id);
        if (definition == null) {
            throw new IllegalArgumentException("Unknown vehicle variant: " + id);
        }
        return definition;
    }

    List<VehicleVariantDefinition> all() {
        return List.copyOf(definitions.values());
    }

    List<VehicleVariantDefinition> byBehavior(VehicleBehavior behavior) {
        return definitions.values().stream()
                .filter(definition -> definition.behavior() == behavior)
                .toList();
    }

    List<DefinitionDiagnostic> diagnostics() {
        return diagnostics;
    }

    private static Map<String, VehicleVariantDefinition> loadBuiltIns(
            VehicleVariantLoader loader,
            Collection<DefinitionSource> sources,
            ModelRegistry models,
            List<DefinitionDiagnostic> diagnostics
    ) {
        Map<String, SourcedVariant> sourcedDefinitions = new LinkedHashMap<>();
        for (DefinitionSource source : sources.stream().sorted().toList()) {
            DefinitionLoadResult<VehicleVariantDefinition> loaded = loader.load(source);
            diagnostics.addAll(loaded.diagnostics());
            if (!loaded.valid()) {
                continue;
            }
            VehicleVariantDefinition definition = loaded.value().orElseThrow();
            if (!validateModelReferences(definition, source.name(), models, diagnostics)) {
                continue;
            }
            SourcedVariant previous = sourcedDefinitions.put(
                    definition.id(),
                    new SourcedVariant(source.name(), definition)
            );
            if (previous != null) {
                DefinitionParsing.error(
                        diagnostics,
                        source.name(),
                        "id",
                        "дубликат встроенного ID " + definition.id()
                                + "; выбран лексикографически последний файл"
                );
            }
        }
        Map<String, VehicleVariantDefinition> result = new LinkedHashMap<>();
        sourcedDefinitions.values().forEach(sourced ->
                result.put(sourced.definition().id(), sourced.definition())
        );
        return result;
    }

    private static boolean validateModelReferences(
            VehicleVariantDefinition definition,
            String source,
            ModelRegistry models,
            List<DefinitionDiagnostic> diagnostics
    ) {
        boolean valid = true;
        for (Map.Entry<String, String> entry : definition.models().entrySet()) {
            if (models.find(entry.getValue()).isPresent()) {
                continue;
            }
            DefinitionParsing.error(
                    diagnostics,
                    source,
                    definition.behavior() == VehicleBehavior.CAR
                            || definition.behavior() == VehicleBehavior.WAGON
                            ? "model"
                            : "models." + entry.getKey(),
                    "модель не найдена: " + entry.getValue()
            );
            valid = false;
        }
        return valid;
    }

    private record SourcedVariant(String source, VehicleVariantDefinition definition) {
    }
}
