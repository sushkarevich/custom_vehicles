package ru.customvehicles;

import org.bukkit.Material;

import java.util.Set;

final class TestMaterialClassifier implements MaterialClassifier {
    static final TestMaterialClassifier INSTANCE = new TestMaterialClassifier();

    private static final Set<Material> NON_BLOCK_ITEMS = Set.of(
            Material.MINECART,
            Material.FURNACE_MINECART,
            Material.HOPPER_MINECART,
            Material.CHEST_MINECART,
            Material.DIAMOND_SWORD
    );

    private TestMaterialClassifier() {
    }

    @Override
    public boolean isBlock(Material material) {
        return !NON_BLOCK_ITEMS.contains(material);
    }

    @Override
    public boolean isItem(Material material) {
        return material != Material.AIR;
    }
}
