package ru.customvehicles;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefinitionRegistryTest {
    @Test
    void lexicographicallyLastCustomDefinitionWinsWithDuplicateDiagnostic() {
        DefinitionSource builtIn = model("built-in.yml", "shared", "STONE", 1.0);
        DefinitionSource first = model("a.yml", "shared", "BLUE_CONCRETE", 1.0);
        DefinitionSource last = model("z.yml", "shared", "GREEN_CONCRETE", 1.0);

        ModelRegistry registry = ModelRegistry.load(
                List.of(builtIn),
                List.of(last, first),
                TestMaterialClassifier.INSTANCE
        );

        assertEquals(
                Material.GREEN_CONCRETE,
                registry.require("shared").parts().getFirst().material()
        );
        assertTrue(registry.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("лексикографический приоритет")
        ));
    }

    @Test
    void invalidCustomOverrideFallsBackToBuiltIn() {
        ModelRegistry registry = ModelRegistry.load(
                List.of(model("built-in.yml", "shared", "STONE", 1.0)),
                List.of(model("override.yml", "shared", "RED_CONCRETE", -1.0)),
                TestMaterialClassifier.INSTANCE
        );

        assertEquals(Material.STONE, registry.require("shared").parts().getFirst().material());
        assertTrue(registry.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("используется встроенная модель")
        ));
    }

    @Test
    void invalidLaterDuplicateDoesNotRemoveValidEarlierCustomDefinition() {
        ModelRegistry registry = ModelRegistry.load(
                List.of(),
                List.of(
                        model("a-valid.yml", "custom_only", "BLUE_CONCRETE", 1.0),
                        model("z-invalid.yml", "custom_only", "RED_CONCRETE", -1.0)
                ),
                TestMaterialClassifier.INSTANCE
        );

        assertEquals(
                Material.BLUE_CONCRETE,
                registry.require("custom_only").parts().getFirst().material()
        );
        assertTrue(registry.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.source().equals("z-invalid.yml")
                        && diagnostic.message().contains("сохраняется корректное определение")
        ));
    }

    @Test
    void invalidVariantReferenceFallsBackToBuiltInVariant() {
        ModelRegistry models = ModelRegistry.load(
                List.of(model("model.yml", "shared", "STONE", 1.0)),
                List.of(),
                TestMaterialClassifier.INSTANCE
        );
        DefinitionSource builtIn = variant("built-in.yml", "shared_variant", "shared");
        DefinitionSource invalidOverride = variant(
                "override.yml",
                "shared_variant",
                "does_not_exist"
        );

        VehicleVariantRegistry variants = VehicleVariantRegistry.load(
                List.of(builtIn),
                List.of(invalidOverride),
                models,
                TestMaterialClassifier.INSTANCE
        );

        assertEquals("shared", variants.require("shared_variant").model("model"));
        assertTrue(variants.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.message().contains("используется встроенный вариант")
        ));
    }

    @Test
    void reservedBuiltInVariantCannotChangeBehavior() {
        ModelRegistry models = ModelRegistry.load(
                List.of(model("model.yml", "shared", "STONE", 1.0)),
                List.of(),
                TestMaterialClassifier.INSTANCE
        );
        DefinitionSource builtIn = variant("built-in.yml", "reserved", "shared");
        DefinitionSource wrongBehavior = new DefinitionSource(
                "override.yml",
                """
                        schema-version: 1
                        id: reserved
                        display-name: "Неверный вагон"
                        behavior: wagon
                        model: shared
                        """
        );

        VehicleVariantRegistry variants = VehicleVariantRegistry.load(
                List.of(builtIn),
                List.of(wrongBehavior),
                models,
                TestMaterialClassifier.INSTANCE
        );

        assertEquals(VehicleBehavior.CAR, variants.require("reserved").behavior());
        assertTrue(variants.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("behavior")
                        && diagnostic.message().contains("зарезервированный ID")
        ));
    }

    private DefinitionSource model(
            String source,
            String id,
            String material,
            double scaleX
    ) {
        return new DefinitionSource(
                source,
                """
                        schema-version: 1
                        id: %s
                        display-name: "Модель"
                        parts:
                          - id: body
                            material: %s
                            position: {x: 0.0, y: 0.0, z: 0.0}
                            scale: {x: %s, y: 1.0, z: 1.0}
                        """.formatted(id, material, scaleX)
        );
    }

    private DefinitionSource variant(String source, String id, String model) {
        return new DefinitionSource(
                source,
                """
                        schema-version: 1
                        id: %s
                        display-name: "Вариант"
                        behavior: car
                        model: %s
                        """.formatted(id, model)
        );
    }
}
