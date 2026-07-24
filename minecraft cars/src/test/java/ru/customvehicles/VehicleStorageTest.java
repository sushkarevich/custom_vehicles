package ru.customvehicles;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class VehicleStorageTest {
    private static final String VEHICLE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private static final String OWNER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private static final String WORLD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    @Test
    void legacyKindAndWagonCountMapToBuiltInVariantIds() throws Exception {
        YamlConfiguration yaml = yaml("""
                owner: %s
                world: world
                world-uuid: %s
                kind: train
                x: 1.0
                y: 64.0
                z: -2.0
                yaw: 90.0
                wagons: 3
                """.formatted(OWNER_ID, WORLD_ID));

        VehicleSnapshot snapshot = VehicleStorage.read(VEHICLE_ID, yaml);

        assertEquals(BuiltInDefinitions.TRAIN_VARIANT, snapshot.variantId());
        assertEquals(
                List.of(
                        BuiltInDefinitions.WAGON_VARIANT,
                        BuiltInDefinitions.WAGON_VARIANT,
                        BuiltInDefinitions.WAGON_VARIANT
                ),
                snapshot.wagonVariantIds()
        );
    }

    @Test
    void variantAndOrderedWagonVariantsRoundTripWithoutLosingLegacyCount() throws Exception {
        VehicleSnapshot source = new VehicleSnapshot(
                UUID.fromString(VEHICLE_ID),
                VehicleKind.TRAIN,
                UUID.fromString(OWNER_ID),
                UUID.fromString(WORLD_ID),
                "Мир с пробелом",
                12.5,
                70.25,
                -8.75,
                -37.5F,
                "custom_train",
                List.of("blue_wagon", "metro_714_wagon", "red_wagon")
        );
        YamlConfiguration yaml = new YamlConfiguration();
        VehicleStorage.write(yaml, source);
        ConfigurationSection section = yaml.getConfigurationSection("vehicles." + VEHICLE_ID);

        VehicleSnapshot restored = VehicleStorage.read(VEHICLE_ID, section);

        assertEquals(source, restored);
        assertEquals(3, section.getInt("wagons"));
        assertEquals(source.wagonVariantIds(), section.getStringList("wagon-variants"));
    }

    @Test
    void olderCountAliasIsAlsoAccepted() throws Exception {
        YamlConfiguration yaml = yaml("""
                owner: %s
                world: world
                world-uuid: %s
                kind: train
                x: 0.0
                y: 64.0
                z: 0.0
                yaw: 0.0
                count: 2
                """.formatted(OWNER_ID, WORLD_ID));

        VehicleSnapshot snapshot = VehicleStorage.read(VEHICLE_ID, yaml);

        assertEquals(2, snapshot.wagonCount());
    }

    private YamlConfiguration yaml(String source) throws Exception {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.loadFromString(source);
        return yaml;
    }
}
