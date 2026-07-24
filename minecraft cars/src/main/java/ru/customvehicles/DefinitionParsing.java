package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.events.AliasEvent;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class DefinitionParsing {
    static final int SCHEMA_VERSION = 1;
    static final int MAX_DEFINITION_BYTES = 1_048_576;
    static final Pattern ID_PATTERN = Pattern.compile("[a-z0-9][a-z0-9_-]{0,63}");

    private DefinitionParsing() {
    }

    static YamlConfiguration yaml(
            DefinitionSource source,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (source.readError() != null) {
            error(diagnostics, source.name(), "", source.readError());
            return null;
        }
        int byteLength = source.content().getBytes(StandardCharsets.UTF_8).length;
        if (byteLength > MAX_DEFINITION_BYTES) {
            error(
                    diagnostics,
                    source.name(),
                    "",
                    "файл слишком велик: максимум " + MAX_DEFINITION_BYTES + " байт"
            );
            return null;
        }
        try {
            validateSafeYaml(source.content());
        } catch (YAMLException | IllegalArgumentException exception) {
            error(diagnostics, source.name(), "", "небезопасный YAML: " + safeMessage(exception));
            return null;
        }
        YamlConfiguration yaml = new YamlConfiguration();
        try {
            yaml.loadFromString(source.content());
            return yaml;
        } catch (InvalidConfigurationException | RuntimeException exception) {
            error(diagnostics, source.name(), "", "некорректный YAML: " + safeMessage(exception));
            return null;
        }
    }

    static String requiredString(
            Object raw,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (!(raw instanceof String value) || value.isBlank()) {
            error(diagnostics, source, field, "обязательная непустая строка");
            return "";
        }
        return value;
    }

    static String optionalString(
            Object raw,
            String fallback,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (raw == null) {
            return fallback;
        }
        if (!(raw instanceof String value) || value.isBlank()) {
            error(diagnostics, source, field, "ожидалась непустая строка");
            return fallback;
        }
        return value;
    }

    static int integer(
            Object raw,
            int fallback,
            int minimum,
            int maximum,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (raw == null) {
            return fallback;
        }
        if (!(raw instanceof Number number)) {
            error(diagnostics, source, field, "ожидалось целое число");
            return fallback;
        }
        double decimal = number.doubleValue();
        int value = number.intValue();
        if (!Double.isFinite(decimal) || decimal != value || value < minimum || value > maximum) {
            error(
                    diagnostics,
                    source,
                    field,
                    "ожидалось целое число от " + minimum + " до " + maximum
            );
            return fallback;
        }
        return value;
    }

    static double number(
            Object raw,
            double fallback,
            double minimum,
            double maximum,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (raw == null) {
            return fallback;
        }
        if (!(raw instanceof Number number)) {
            error(diagnostics, source, field, "ожидалось число");
            return fallback;
        }
        double value = number.doubleValue();
        if (!Double.isFinite(value) || value < minimum || value > maximum) {
            error(
                    diagnostics,
                    source,
                    field,
                    "ожидалось конечное число от " + minimum + " до " + maximum
            );
            return fallback;
        }
        return value;
    }

    static ModelVector vector(
            Object raw,
            ModelVector fallback,
            double minimum,
            double maximum,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (raw == null) {
            return fallback;
        }
        if (raw instanceof ConfigurationSection section) {
            warnUnknown(
                    section.getKeys(false),
                    Set.of("x", "y", "z"),
                    source,
                    field,
                    diagnostics
            );
            return new ModelVector(
                    number(
                            section.get("x"),
                            fallback.x(),
                            minimum,
                            maximum,
                            source,
                            field + ".x",
                            diagnostics
                    ),
                    number(
                            section.get("y"),
                            fallback.y(),
                            minimum,
                            maximum,
                            source,
                            field + ".y",
                            diagnostics
                    ),
                    number(
                            section.get("z"),
                            fallback.z(),
                            minimum,
                            maximum,
                            source,
                            field + ".z",
                            diagnostics
                    )
            );
        }
        if (!(raw instanceof Map<?, ?> map)) {
            error(diagnostics, source, field, "ожидался объект с координатами x, y, z");
            return fallback;
        }
        Set<String> keys = map.keySet().stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .collect(java.util.stream.Collectors.toSet());
        warnUnknown(keys, Set.of("x", "y", "z"), source, field, diagnostics);
        return new ModelVector(
                number(map.get("x"), fallback.x(), minimum, maximum, source, field + ".x", diagnostics),
                number(map.get("y"), fallback.y(), minimum, maximum, source, field + ".y", diagnostics),
                number(map.get("z"), fallback.z(), minimum, maximum, source, field + ".z", diagnostics)
        );
    }

    static List<String> stringList(
            Object raw,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof String scalar) {
            return scalar.isBlank() ? List.of() : List.of(scalar);
        }
        if (!(raw instanceof Collection<?> collection)) {
            error(diagnostics, source, field, "ожидалась строка или список строк");
            return List.of();
        }
        List<String> result = new ArrayList<>(collection.size());
        int index = 0;
        for (Object entry : collection) {
            if (!(entry instanceof String value) || value.isBlank()) {
                error(diagnostics, source, field + "[" + index + "]", "ожидалась непустая строка");
            } else {
                result.add(value);
            }
            index++;
        }
        return List.copyOf(result);
    }

    static void validateId(
            String id,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        if (!id.isEmpty() && !ID_PATTERN.matcher(id).matches()) {
            error(
                    diagnostics,
                    source,
                    field,
                    "ID должен содержать только строчные латинские буквы, цифры, _ или -"
            );
        }
    }

    static void warnUnknown(
            Set<String> actual,
            Set<String> known,
            String source,
            String field,
            List<DefinitionDiagnostic> diagnostics
    ) {
        actual.stream()
                .filter(key -> !known.contains(key))
                .sorted()
                .forEach(key -> warning(
                        diagnostics,
                        source,
                        field.isBlank() ? key : field + "." + key,
                        "неизвестное поле проигнорировано"
                ));
    }

    static boolean hasErrors(List<DefinitionDiagnostic> diagnostics) {
        return diagnostics.stream().anyMatch(diagnostic ->
                diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR
        );
    }

    static void error(
            List<DefinitionDiagnostic> diagnostics,
            String source,
            String field,
            String message
    ) {
        diagnostics.add(new DefinitionDiagnostic(
                DefinitionDiagnostic.Severity.ERROR,
                source,
                field,
                message
        ));
    }

    static void warning(
            List<DefinitionDiagnostic> diagnostics,
            String source,
            String field,
            String message
    ) {
        diagnostics.add(new DefinitionDiagnostic(
                DefinitionDiagnostic.Severity.WARNING,
                source,
                field,
                message
        ));
    }

    private static String safeMessage(Exception exception) {
        return exception.getMessage() == null
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
    }

    private static void validateSafeYaml(String content) {
        LoaderOptions options = new LoaderOptions();
        options.setAllowDuplicateKeys(false);
        options.setMaxAliasesForCollections(0);
        options.setCodePointLimit(MAX_DEFINITION_BYTES);
        options.setNestingDepthLimit(64);
        Yaml yaml = new Yaml(new SafeConstructor(options));
        Object parsed = yaml.load(content);
        rejectSerializedTypeKeys(parsed);
        for (var event : yaml.parse(new StringReader(content))) {
            if (event instanceof AliasEvent) {
                throw new YAMLException("YAML aliases are not supported");
            }
        }
    }

    private static void rejectSerializedTypeKeys(Object value) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if ("==".equals(entry.getKey())) {
                    throw new YAMLException("reserved YAML key == is not supported");
                }
                rejectSerializedTypeKeys(entry.getValue());
            }
            return;
        }
        if (value instanceof Collection<?> collection) {
            collection.forEach(DefinitionParsing::rejectSerializedTypeKeys);
        }
    }
}
