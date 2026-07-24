package ru.customvehicles;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class DefinitionResources {
    static final String COPY_MARKER = ".definitions-v1-copied";

    private DefinitionResources() {
    }

    static List<DefinitionSource> bundledModels(ClassLoader classLoader) throws IOException {
        return readResourceIndex(classLoader, BuiltInDefinitions.MODEL_INDEX);
    }

    static List<DefinitionSource> bundledVariants(ClassLoader classLoader) throws IOException {
        return readResourceIndex(classLoader, BuiltInDefinitions.VARIANT_INDEX);
    }

    static List<DefinitionSource> customDefinitions(Path directory) throws IOException {
        if (!Files.isDirectory(directory)) {
            return List.of();
        }
        List<Path> files;
        try (var stream = Files.list(directory)) {
            files = stream
                    .filter(Files::isRegularFile)
                    .filter(DefinitionResources::isYaml)
                    .sorted((first, second) -> first.getFileName().toString()
                            .compareTo(second.getFileName().toString()))
                    .toList();
        }
        List<DefinitionSource> result = new ArrayList<>(files.size());
        for (Path file : files) {
            String name = file.getFileName().toString();
            try {
                long size = Files.size(file);
                if (size > DefinitionParsing.MAX_DEFINITION_BYTES) {
                    result.add(DefinitionSource.unreadable(
                            name,
                            "файл слишком велик: максимум "
                                    + DefinitionParsing.MAX_DEFINITION_BYTES + " байт"
                    ));
                    continue;
                }
                result.add(new DefinitionSource(
                        name,
                        Files.readString(file, StandardCharsets.UTF_8)
                ));
            } catch (IOException exception) {
                result.add(DefinitionSource.unreadable(
                        name,
                        "не удалось прочитать файл: " + exception.getMessage()
                ));
            }
        }
        return List.copyOf(result);
    }

    static CopyResult copyDefaultsOnce(ClassLoader classLoader, Path dataDirectory)
            throws IOException {
        Path normalizedData = dataDirectory.toAbsolutePath().normalize();
        Files.createDirectories(normalizedData);
        Path marker = normalizedData.resolve(COPY_MARKER);
        if (Files.exists(marker)) {
            return new CopyResult(false, List.of());
        }

        List<String> resources = new ArrayList<>();
        resources.addAll(readIndexEntries(classLoader, BuiltInDefinitions.MODEL_INDEX));
        resources.addAll(readIndexEntries(classLoader, BuiltInDefinitions.VARIANT_INDEX));
        resources.sort(String::compareTo);
        List<Path> copied = new ArrayList<>();
        for (String resource : resources) {
            Path target = normalizedData.resolve(resource).normalize();
            if (!target.startsWith(normalizedData)) {
                throw new IOException("Unsafe bundled resource path: " + resource);
            }
            if (Files.exists(target)) {
                continue;
            }
            Files.createDirectories(target.getParent());
            Path temporary = Files.createTempFile(
                    target.getParent(),
                    "." + target.getFileName(),
                    ".tmp"
            );
            boolean moved = false;
            try (InputStream input = requiredResource(classLoader, resource)) {
                Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING);
                moveAtomically(temporary, target);
                moved = true;
                copied.add(target);
            } finally {
                if (!moved) {
                    Files.deleteIfExists(temporary);
                }
            }
        }
        Path temporaryMarker = Files.createTempFile(normalizedData, "." + COPY_MARKER, ".tmp");
        boolean markerMoved = false;
        try {
            Files.writeString(
                    temporaryMarker,
                    "schema-version: 1\n",
                    StandardCharsets.UTF_8,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE
            );
            moveAtomically(temporaryMarker, marker);
            markerMoved = true;
        } finally {
            if (!markerMoved) {
                Files.deleteIfExists(temporaryMarker);
            }
        }
        return new CopyResult(true, copied);
    }

    private static List<DefinitionSource> readResourceIndex(
            ClassLoader classLoader,
            String indexResource
    ) throws IOException {
        List<String> entries = readIndexEntries(classLoader, indexResource);
        List<DefinitionSource> result = new ArrayList<>(entries.size());
        for (String resource : entries) {
            try (InputStream input = requiredResource(classLoader, resource)) {
                byte[] content = input.readNBytes(DefinitionParsing.MAX_DEFINITION_BYTES + 1);
                if (content.length > DefinitionParsing.MAX_DEFINITION_BYTES) {
                    throw new IOException("Bundled definition is too large: " + resource);
                }
                result.add(new DefinitionSource(
                        resource,
                        new String(content, StandardCharsets.UTF_8)
                ));
            }
        }
        return List.copyOf(result);
    }

    private static List<String> readIndexEntries(
            ClassLoader classLoader,
            String indexResource
    ) throws IOException {
        String content;
        try (InputStream input = requiredResource(classLoader, indexResource)) {
            content = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        List<String> entries = content.lines()
                .map(String::trim)
                .filter(line -> !line.isEmpty())
                .filter(line -> !line.startsWith("#"))
                .sorted()
                .toList();
        for (String entry : entries) {
            if (entry.startsWith("/") || entry.contains("..")) {
                throw new IOException("Unsafe entry in " + indexResource + ": " + entry);
            }
        }
        return entries;
    }

    private static InputStream requiredResource(ClassLoader classLoader, String resource)
            throws IOException {
        InputStream input = classLoader.getResourceAsStream(resource);
        if (input == null) {
            throw new IOException("Bundled definition resource is missing: " + resource);
        }
        return input;
    }

    private static boolean isYaml(Path path) {
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return name.endsWith(".yml") || name.endsWith(".yaml");
    }

    private static void moveAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(source, target);
        }
    }

    record CopyResult(boolean attempted, List<Path> copiedFiles) {
        CopyResult {
            copiedFiles = List.copyOf(copiedFiles);
        }
    }
}
