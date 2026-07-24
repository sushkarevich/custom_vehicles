package ru.customvehicles;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BuiltInDefinitionsTest {
    @Test
    void migratedModelsKeepStableIdsCountsAndSelectedGeometry() throws Exception {
        ModelRegistry registry = ModelRegistry.load(
                DefinitionResources.bundledModels(getClass().getClassLoader()),
                List.of(),
                TestMaterialClassifier.INSTANCE
        );

        assertTrue(
                registry.diagnostics().stream().noneMatch(diagnostic ->
                        diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR
                ),
                () -> registry.diagnostics().toString()
        );
        assertEquals(
                Map.of(
                        "car_default", 12,
                        "metro_717_head", 54,
                        "metro_714_wagon", 44,
                        "vityaz_m_front", 51,
                        "vityaz_m_middle", 45,
                        "vityaz_m_rear", 51
                ),
                registry.all().stream().collect(Collectors.toMap(
                        ModelDefinition::id,
                        model -> model.parts().size()
                ))
        );

        ModelDefinition car = registry.require("car_default");
        assertEquals(ModelDefinition.ForwardDirection.NEGATIVE_Z, car.forwardDirection());
        assertEquals(2.2F, car.interaction().orElseThrow().width());
        ModelPartDefinition carHeadlight = parts(car).get("headlight_left");
        assertEquals(Material.SEA_LANTERN, carHeadlight.material());
        assertEquals(new ModelVector(-0.53, 0.64, -1.63), carHeadlight.position());
        assertEquals(new ModelVector(0.34, 0.26, 0.08), carHeadlight.scale());

        ModelDefinition head = registry.require("metro_717_head");
        ModelPartDefinition cabGlass = parts(head).get("cab_windscreen_center");
        assertEquals(Material.BLACK_STAINED_GLASS, cabGlass.material());
        assertEquals(new ModelVector(0.0, 1.73, 3.04), cabGlass.position());

        ModelDefinition wagon = registry.require("metro_714_wagon");
        assertEquals(
                Material.BLACK_STAINED_GLASS,
                parts(wagon).get("front_end_window_left").material()
        );

        ModelDefinition middle = registry.require("vityaz_m_middle");
        ModelPartDefinition pantograph = parts(middle).get("pantograph_contact");
        assertEquals(Material.POLISHED_BLACKSTONE, pantograph.material());
        assertEquals(new ModelVector(1.62, 0.07, 0.12), pantograph.scale());
    }

    @Test
    void builtInVariantsReferenceAllSixMigratedModels() throws Exception {
        ClassLoader classLoader = getClass().getClassLoader();
        ModelRegistry models = ModelRegistry.load(
                DefinitionResources.bundledModels(classLoader),
                List.of(),
                TestMaterialClassifier.INSTANCE
        );
        VehicleVariantRegistry variants = VehicleVariantRegistry.load(
                DefinitionResources.bundledVariants(classLoader),
                List.of(),
                models,
                TestMaterialClassifier.INSTANCE
        );

        assertEquals(
                List.of("car_default", "metro_714_wagon", "metro_717", "vityaz_m"),
                variants.all().stream().map(VehicleVariantDefinition::id).toList()
        );
        assertEquals("car_default", variants.require("car_default").model("model"));
        assertEquals("metro_717_head", variants.require("metro_717").model("locomotive"));
        assertEquals("metro_714_wagon", variants.require("metro_717").model("wagon"));
        assertEquals("vityaz_m_front", variants.require("vityaz_m").model("front"));
        assertEquals("vityaz_m_middle", variants.require("vityaz_m").model("middle"));
        assertEquals("vityaz_m_rear", variants.require("vityaz_m").model("rear"));
        assertTrue(
                variants.diagnostics().stream().noneMatch(diagnostic ->
                        diagnostic.severity() == DefinitionDiagnostic.Severity.ERROR
                ),
                () -> variants.diagnostics().toString()
        );
    }

    private Map<String, ModelPartDefinition> parts(ModelDefinition definition) {
        return definition.parts().stream().collect(Collectors.toMap(
                ModelPartDefinition::id,
                Function.identity()
        ));
    }
}
