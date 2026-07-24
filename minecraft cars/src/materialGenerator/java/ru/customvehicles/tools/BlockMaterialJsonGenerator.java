package ru.customvehicles.tools;

import io.papermc.paper.registry.keys.BlockTypeKeys;
import org.bukkit.Material;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.SortedSet;
import java.util.TreeSet;

/**
 * Builds the editor material catalog from Paper's block registry key declarations.
 *
 * <p>Paper 1.21.1 resolves {@code Material.isBlock()} through live registry access,
 * which is unavailable in a standalone Gradle process. {@link BlockTypeKeys} is
 * the corresponding Paper API source of block-only keys and remains safe to
 * inspect without starting a Minecraft server.</p>
 */
public final class BlockMaterialJsonGenerator {
    private BlockMaterialJsonGenerator() {
    }

    public static void main(String[] arguments) throws IOException {
        if (arguments.length != 1) {
            throw new IllegalArgumentException(
                    "Expected exactly one output path, got " + arguments.length
            );
        }

        SortedSet<String> materialNames = new TreeSet<>();
        for (Field field : BlockTypeKeys.class.getFields()) {
            int modifiers = field.getModifiers();
            if (!Modifier.isPublic(modifiers) || !Modifier.isStatic(modifiers)) {
                continue;
            }
            Material material = Material.getMaterial(field.getName());
            if (material != null) {
                materialNames.add(material.name());
            }
        }
        if (materialNames.isEmpty()) {
            throw new IllegalStateException("Paper block material catalog is empty");
        }

        Path output = Path.of(arguments[0]).toAbsolutePath().normalize();
        Path parent = output.getParent();
        if (parent == null) {
            throw new IllegalArgumentException("Output path must have a parent: " + output);
        }
        Files.createDirectories(parent);

        StringBuilder json = new StringBuilder(materialNames.size() * 24);
        json.append("[\n");
        int index = 0;
        for (String materialName : materialNames) {
            json.append("  \"").append(materialName).append('"');
            if (++index < materialNames.size()) {
                json.append(',');
            }
            json.append('\n');
        }
        json.append("]\n");

        Path temporary = Files.createTempFile(parent, output.getFileName() + ".", ".tmp");
        try {
            Files.writeString(temporary, json, StandardCharsets.UTF_8);
            try {
                Files.move(
                        temporary,
                        output,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }

        System.out.println(
                "Generated " + materialNames.size() + " block materials at " + output
        );
    }
}
