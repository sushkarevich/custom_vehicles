package ru.customvehicles;

record DefinitionReloadResult(
        boolean successful,
        int modelCount,
        int variantCount,
        long warningCount,
        long errorCount
) {
}
