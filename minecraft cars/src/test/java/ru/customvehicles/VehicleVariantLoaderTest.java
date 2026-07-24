package ru.customvehicles;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VehicleVariantLoaderTest {
    private final VehicleVariantLoader loader = new VehicleVariantLoader(
            TestMaterialClassifier.INSTANCE
    );

    @Test
    void parsesCompositionItemAndScalarMenuDescription() {
        DefinitionLoadResult<VehicleVariantDefinition> loaded = loader.load(new DefinitionSource(
                "train.yml",
                """
                        schema-version: 1
                        id: blue_train
                        display-name: "Синий поезд"
                        behavior: train
                        models:
                          locomotive: blue_head
                          wagon: blue_wagon
                        item:
                          material: FURNACE_MINECART
                          name: "Синий поезд"
                          lore: ["Первая строка", "Вторая строка"]
                          custom-model-data: 17
                        menu-description: "Поезд для теста"
                        permission: customvehicles.variant.blue
                        """
        ));

        assertTrue(loaded.valid(), () -> loaded.diagnostics().toString());
        VehicleVariantDefinition variant = loaded.value().orElseThrow();
        assertEquals(VehicleBehavior.TRAIN, variant.behavior());
        assertEquals("blue_head", variant.model("locomotive"));
        assertEquals(Material.FURNACE_MINECART, variant.item().material());
        assertEquals(17, variant.item().customModelData());
        assertEquals(List.of("Поезд для теста"), variant.menuDescription());
    }

    @Test
    void rejectsWrongRoleShapeAndUnknownBehavior() {
        DefinitionLoadResult<VehicleVariantDefinition> loaded = loader.load(new DefinitionSource(
                "broken.yml",
                """
                        schema-version: 1
                        id: broken
                        display-name: "Сломанный"
                        behavior: plane
                        models:
                          nose: missing
                        """
        ));

        assertFalse(loaded.valid());
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("behavior")
        ));
        assertTrue(loaded.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.field().equals("model")
        ));
    }
}
