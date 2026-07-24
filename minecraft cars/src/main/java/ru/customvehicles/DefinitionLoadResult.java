package ru.customvehicles;

import java.util.List;
import java.util.Optional;

record DefinitionLoadResult<T>(
        Optional<T> value,
        String declaredId,
        List<DefinitionDiagnostic> diagnostics
) {
    DefinitionLoadResult {
        value = value == null ? Optional.empty() : value;
        declaredId = declaredId == null ? "" : declaredId;
        diagnostics = List.copyOf(diagnostics);
    }

    boolean valid() {
        return value.isPresent()
                && diagnostics.stream().noneMatch(diagnostic ->
                diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR
        );
    }
}
