package ru.customvehicles;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefinitionResourcesTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void bundledIndexesLoadAndDefaultsAreCopiedOnlyOnce() throws Exception {
        ClassLoader classLoader = getClass().getClassLoader();
        assertEquals(6, DefinitionResources.bundledModels(classLoader).size());
        assertEquals(4, DefinitionResources.bundledVariants(classLoader).size());

        DefinitionResources.CopyResult first = DefinitionResources.copyDefaultsOnce(
                classLoader,
                temporaryDirectory
        );
        assertTrue(first.attempted());
        assertEquals(10, first.copiedFiles().size());
        Path car = temporaryDirectory.resolve("models/car_default.yml");
        assertTrue(Files.exists(car));
        assertTrue(Files.exists(temporaryDirectory.resolve(DefinitionResources.COPY_MARKER)));

        Files.writeString(car, "custom edit\n", StandardCharsets.UTF_8);
        Files.delete(temporaryDirectory.resolve("models/metro_714_wagon.yml"));
        DefinitionResources.CopyResult second = DefinitionResources.copyDefaultsOnce(
                classLoader,
                temporaryDirectory
        );

        assertFalse(second.attempted());
        assertEquals("custom edit\n", Files.readString(car, StandardCharsets.UTF_8));
        assertFalse(Files.exists(temporaryDirectory.resolve("models/metro_714_wagon.yml")));
    }

    @Test
    void oneOversizedCustomFileDoesNotHideValidSibling() throws Exception {
        Path models = temporaryDirectory.resolve("models");
        Files.createDirectories(models);
        Files.writeString(
                models.resolve("a-valid.yml"),
                """
                        schema-version: 1
                        id: valid
                        display-name: "Рабочая"
                        parts:
                          - id: body
                            material: STONE
                            position: {x: 0.0, y: 0.0, z: 0.0}
                            scale: {x: 1.0, y: 1.0, z: 1.0}
                        """,
                StandardCharsets.UTF_8
        );
        Files.writeString(
                models.resolve("z-too-large.yml"),
                "x".repeat(DefinitionParsing.MAX_DEFINITION_BYTES + 1),
                StandardCharsets.UTF_8
        );

        List<DefinitionSource> sources = DefinitionResources.customDefinitions(models);
        ModelRegistry registry = ModelRegistry.load(
                List.of(),
                sources,
                TestMaterialClassifier.INSTANCE
        );

        assertTrue(registry.find("valid").isPresent());
        assertTrue(registry.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.source().equals("z-too-large.yml")
                        && diagnostic.message().contains("слишком велик")
        ));
    }
}
