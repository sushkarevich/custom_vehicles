package ru.customvehicles;

import org.bukkit.Material;

interface MaterialClassifier {
    MaterialClassifier PAPER = new MaterialClassifier() {
        @Override
        public boolean isBlock(Material material) {
            return !material.isLegacy() && material.isBlock();
        }

        @Override
        public boolean isItem(Material material) {
            return !material.isLegacy() && material.isItem() && !material.isAir();
        }
    };

    boolean isBlock(Material material);

    boolean isItem(Material material);
}
