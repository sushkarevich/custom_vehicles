package ru.customvehicles;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelLoaderTest {
    private final ModelLoader loader = new ModelLoader(TestMaterialClassifier.INSTANCE);

    @Test
    void parsesVersionOneModelAndSafeDefaults() {
        DefinitionLoadResult<ModelDefinition> loaded = loader.load(new DefinitionSource(
                "valid.yml",
                """
                        schema-version: 1
                        id: test_model
                        display-name: "Тестовая модель"
                        parts:
                          - id: body
                            material: RED_CONCRETE
                            position: {x: 1.0, y: 2.0, z: 3.0}
                            scale: {x: 2.0, y: 0.5, z: 4.0}
                        """
        ));

        assertTrue(loaded.valid(), () -> loaded.diagnostics().toString());
        ModelDefinition model = loaded.value().orElseThrow();
        assertEquals("test_model", model.id());
        assertEquals(ModelDefinition.ForwardDirection.POSITIVE_Z, model.forwardDirection());
        assertTrue(model.interaction().isEmpty());
        assertEquals(2, model.display().interpolationDuration());
        assertEquals(1, model.display().teleportDuration());
        assertEquals(Material.RED_CONCRETE, model.parts().getFirst().material());
        assertEquals(ModelVector.ZERO, model.parts().getFirst().rotationDegrees());
    }

    @Test
    void rejectsDuplicatePartsNonBlockMaterialAndUnsafeScale() {
        DefinitionLoadResult<ModelDefinition> loaded = loader.load(new DefinitionSource(
                "invalid.yml",
                """
                        schema-version: 1
                        id: broken
                        display-name: "Сломанная"
                        parts:
                          - id: same
                            material: DIAMOND_SWORD
                            scale: {x: -1.0, y: 1.0, z: 1.0}
                          - id: same
                            material: STONE
                        """
        ));

        assertFalse(loaded.valid());
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("parts[0].material")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("parts[0].scale.x")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("уже используется")
        ));
    }

    @Test
    void rejectsUnsupportedSchemaAndWarnsAboutUnknownFields() {
        DefinitionLoadResult<ModelDefinition> loaded = loader.load(new DefinitionSource(
                "future.yml",
                """
                        schema-version: 2
                        id: future
                        display-name: "Будущее"
                        editor:
                          hidden-parts: [body]
                        parts:
                          - id: body
                            material: STONE
                        """
        ));

        assertFalse(loaded.valid());
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.severity() == DefinitionDiagnostic.Severity.WARNING
                        && diagnostic.field().equals("editor")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("schema-version")
        ));
    }

    @Test
    void rejectsDuplicateKeysAliasesAndOversizedDocuments() {
        DefinitionLoadResult<ModelDefinition> duplicate = loader.load(new DefinitionSource(
                "duplicate.yml",
                """
                        schema-version: 1
                        schema-version: 1
                        id: duplicate
                        display-name: "Дубликат"
                        parts:
                          - id: body
                            material: STONE
                        """
        ));
        DefinitionLoadResult<ModelDefinition> alias = loader.load(new DefinitionSource(
                "alias.yml",
                """
                        schema-version: 1
                        id: alias
                        display-name: "Псевдоним"
                        parts: &parts
                          - id: body
                            material: STONE
                        editor-copy: *parts
                        """
        ));
        DefinitionLoadResult<ModelDefinition> oversized = loader.load(new DefinitionSource(
                "oversized.yml",
                "x".repeat(DefinitionParsing.MAX_DEFINITION_BYTES + 1)
        ));

        assertFalse(duplicate.valid());
        assertTrue(duplicate.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("небезопасный YAML")
        ));
        assertFalse(alias.valid());
        assertTrue(alias.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("aliases")
                        || diagnostic.message().contains("псевдоним")
                        || diagnostic.message().contains("небезопасный YAML")
        ));
        assertFalse(oversized.valid());
        assertTrue(oversized.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("слишком велик")
        ));
    }

    @Test
    void rejectsBukkitSerializedTypeKeyAtAnyDepth() {
        DefinitionLoadResult<ModelDefinition> loaded = loader.load(new DefinitionSource(
                "serialized.yml",
                """
                        schema-version: 1
                        id: serialized
                        display-name: "Опасная"
                        parts:
                          - id: body
                            material: STONE
                            position:
                              x: 0.0
                              y: 0.0
                              z: 0.0
                              ==: org.bukkit.Location
                            scale: {x: 1.0, y: 1.0, z: 1.0}
                        """
        ));

        assertFalse(loaded.valid());
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("reserved YAML key ==")
        ));
    }

    @Test
    void requiresPartPositionScaleAndExplicitHitboxDimensions() {
        DefinitionLoadResult<ModelDefinition> loaded = loader.load(new DefinitionSource(
                "missing.yml",
                """
                        schema-version: 1
                        id: missing
                        display-name: "Неполная"
                        interaction:
                          offset: {x: 0.0, y: 0.0, z: 0.0}
                        parts:
                          - id: body
                            material: STONE
                        """
        ));

        assertFalse(loaded.valid());
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("interaction.width")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("interaction.height")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("parts[0].position")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("parts[0].scale")
        ));
    }
}
