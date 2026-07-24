package ru.customvehicles;

import java.util.Objects;

record DefinitionDiagnostic(
        Severity severity,
        String source,
        String field,
        String message
) {
    DefinitionDiagnostic {
        Objects.requireNonNull(severity, "severity");
        source = source == null || source.isBlank() ? "<unknown>" : source;
        field = field == null ? "" : field;
        Objects.requireNonNull(message, "message");
    }

    String formatted() {
        String location = field.isBlank() ? source : source + " [" + field + "]";
        return severity + " " + location + ": " + message;
    }

    enum Severity {
        WARNING,
        ERROR
    }
}
