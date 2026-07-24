package ru.customvehicles;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

final class ModelRegistry {
    private final Map<String, ModelDefinition> definitions;
    private final List<DefinitionDiagnostic> diagnostics;

    private ModelRegistry(
            Map<String, ModelDefinition> definitions,
            List<DefinitionDiagnostic> diagnostics
    ) {
        this.definitions = Collections.unmodifiableMap(new TreeMap<>(definitions));
        this.diagnostics = List.copyOf(diagnostics);
    }

    static ModelRegistry load(
            Collection<DefinitionSource> builtIns,
            Collection<DefinitionSource> custom
    ) {
        return load(builtIns, custom, MaterialClassifier.PAPER);
    }

    static ModelRegistry load(
            Collection<DefinitionSource> builtIns,
            Collection<DefinitionSource> custom,
            MaterialClassifier materials
    ) {
        ModelLoader loader = new ModelLoader(materials);
        List<DefinitionDiagnostic> diagnostics = new ArrayList<>();
        Map<String, ModelDefinition> result = loadBuiltIns(loader, builtIns, diagnostics);
        Map<String, SourcedModel> customDefinitions = new LinkedHashMap<>();

        for (DefinitionSource source : custom.stream().sorted().toList()) {
            DefinitionLoadResult<ModelDefinition> loaded = loader.load(source);
            diagnostics.addAll(loaded.diagnostics());
            if (!loaded.valid()) {
                String invalidId = loaded.declaredId();
                SourcedModel shadowed = invalidId.isBlank()
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
                            "некорректное переопределение пропущено; используется встроенная модель "
                                    + invalidId
                    );
                }
                continue;
            }
            ModelDefinition definition = loaded.value().orElseThrow();
            SourcedModel previous = customDefinitions.put(
                    definition.id(),
                    new SourcedModel(source.name(), definition)
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
        return new ModelRegistry(result, diagnostics);
    }

    Optional<ModelDefinition> find(String id) {
        return Optional.ofNullable(definitions.get(id));
    }

    ModelDefinition require(String id) {
        ModelDefinition definition = definitions.get(id);
        if (definition == null) {
            throw new IllegalArgumentException("Unknown model: " + id);
        }
        return definition;
    }

    List<ModelDefinition> all() {
        return List.copyOf(definitions.values());
    }

    Map<String, ModelDefinition> asMap() {
        return definitions;
    }

    List<DefinitionDiagnostic> diagnostics() {
        return diagnostics;
    }

    private static Map<String, ModelDefinition> loadBuiltIns(
            ModelLoader loader,
            Collection<DefinitionSource> sources,
            List<DefinitionDiagnostic> diagnostics
    ) {
        Map<String, SourcedModel> sourcedDefinitions = new LinkedHashMap<>();
        for (DefinitionSource source : sources.stream().sorted().toList()) {
            DefinitionLoadResult<ModelDefinition> loaded = loader.load(source);
            diagnostics.addAll(loaded.diagnostics());
            if (!loaded.valid()) {
                continue;
            }
            ModelDefinition definition = loaded.value().orElseThrow();
            SourcedModel previous = sourcedDefinitions.put(
                    definition.id(),
                    new SourcedModel(source.name(), definition)
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
        Map<String, ModelDefinition> result = new LinkedHashMap<>();
        sourcedDefinitions.values().forEach(sourced ->
                result.put(sourced.definition().id(), sourced.definition())
        );
        return result;
    }

    private record SourcedModel(String source, ModelDefinition definition) {
    }
}
