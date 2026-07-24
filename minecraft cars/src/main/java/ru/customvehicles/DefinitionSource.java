package ru.customvehicles;

import java.util.Objects;

record DefinitionSource(
        String name,
        String content,
        String readError
) implements Comparable<DefinitionSource> {
    DefinitionSource(String name, String content) {
        this(name, content, null);
    }

    DefinitionSource {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(content, "content");
        if (name.isBlank()) {
            throw new IllegalArgumentException("Definition source name must not be blank");
        }
    }

    static DefinitionSource unreadable(String name, String message) {
        return new DefinitionSource(name, "", Objects.requireNonNull(message, "message"));
    }

    @Override
    public int compareTo(DefinitionSource other) {
        return name.compareTo(other.name);
    }
}
