# Предпросмотр Minecraft resource pack

Это editor-side предпросмотр материалов, а не реализация Minecraft renderer. Он помогает
собирать модели из обычных блочных Material и не меняет формат CustomVehicles, серверный плагин
или содержимое YAML.

## Источники и приоритет

Редактор проверяет источники в таком порядке:

1. ручной PNG override для Bukkit/Paper Material;
2. верхний включённый resource pack;
3. следующие включённые паки по списку;
4. локальные vanilla-ресурсы выбранного Minecraft client JAR;
5. детерминированный цвет Material.

Слой применяется для каждого logical resource отдельно. Поэтому block model из верхнего пака
может наследовать parent или texture из более низкого пака либо vanilla-слоя, как в обычном pack
stack. Изменение приоритета увеличивает revision, отменяет устаревший результат renderer и
обновляет все детали с таким Material.

## Локальные vanilla-ресурсы

При первом запуске main-процесс ищет Minecraft Java Edition:

```text
macOS:   ~/Library/Application Support/minecraft/versions/
Windows: %APPDATA%/.minecraft/versions/
```

Для каждой папки читается bounded launcher JSON; его `id`, `type`, client metadata и возможный
унаследованный `jar` используются вместо слепого доверия имени каталога. `1.21.1` выбирается
первой, потому что список Material ориентирован на Paper 1.21.1. Другие обнаруженные версии
остаются в selector. Custom launcher поддерживается через **Выбрать Minecraft JAR**; соседний
version JSON читается, если существует.

JAR не запускается и не передаётся renderer. Он индексируется тем же защищённым ZIP scanner без
обязательного `pack.mcmeta`. В cache попадают только:

- `assets/minecraft/blockstates/**/*.json`;
- `assets/minecraft/models/**/*.json`;
- `assets/minecraft/textures/block/**/*.png`.

Настройки сохраняют локальный JAR path, выбор auto/manual и cache metadata. Cache identity
строится из path, версии, размера, mtime и SHA-256 исходного JAR; manifest extracted resources
имеет отдельный content fingerprint. При совпадении cache используется повторно. Изменение JAR
инвалидирует слой, а удаление/перенос даёт неблокирующую диагностику и цветовой fallback.

Доступны **Найти автоматически**, **Выбрать Minecraft JAR**, **Обновить ресурсы**,
**Открыть расположение** и **Отключить ванильные текстуры**. Автоматического downloader нет.

## Что поддерживается

- `pack.mcmeta`;
- `assets/<namespace>/blockstates/*.json`;
- `assets/<namespace>/models/**/*.json` для parent-цепочек;
- `assets/<namespace>/textures/block/*.png`;
- Material Paper 1.21.1 → lowercase `minecraft:<block_id>`;
- безопасные parent-цепочки и наследование `textures`;
- ссылки `#all`, `#side`, `#top`, `#bottom`, `#north`, `#south`, `#east`, `#west` и их aliases;
- `cube_all`, `cube`, `cube_column`, `cube_bottom_top`, `orientable`;
- стандартный единичный full-cube element;
- детерминированный выбор blockstate variant;
- консервативное multipart-приближение;
- прямой `textures/block/<block_id>.png` fallback для texture-only паков;
- отдельные текстуры граней в resolved cube preview;
- прозрачные PNG, sRGB и nearest-neighbor filtering.

Three.js `BoxGeometry` использует порядок граней `east`, `west`, `top`, `bottom`, `south`,
`north`. Декодированные texture объекты разделяются cache по opaque asset token и UV rotation.
При уходе последнего потребителя texture освобождается; материалы конкретного mesh освобождает
React Three Fiber.

## Ручные PNG

Кнопка **Назначить PNG** в карточке Material задаёт одну текстуру для всех шести граней.
Main-процесс проверяет PNG signature, ограничивает размер, декодирует изображение Electron
`nativeImage` и сохраняет нормализованную копию под content hash. Оригинал после импорта больше
не нужен. Расширенная модель данных и IPC уже различают `top`, `bottom`, `north`, `south`,
`east`, `west`; основной интерфейс версии 1 намеренно делает polished all-six workflow.

## Папки, ZIP и cache

Папка или ZIP выбирается нативным диалогом. Renderer не передаёт произвольный путь чтения.
Scanner:

- принимает `pack.mcmeta` и allowlist стандартных block resources;
- для ZIP поддерживает один wrapper-каталог вокруг корня пака;
- отклоняет absolute, drive/UNC, небезопасные backslash-form и `..` traversal paths;
- игнорирует ссылки и небезопасные entries;
- ограничивает число файлов, общий и одиночный uncompressed size и compression ratio;
- пишет только внутрь staging-каталога, затем публикует cache атомарным rename;
- сравнивает source signature и требует пересканирование после изменения архива.

Client JAR использует те же central-directory limits, path containment, CRC, symlink,
encryption и compression checks. Отличие только в фиксированном namespace `minecraft` и
отсутствии `pack.mcmeta`.

Настройки находятся в:

```text
<Electron userData>/resource-preview/settings.json
<Electron userData>/resource-preview/manual/
<Electron userData>/resource-preview/cache/
```

Пути с пробелами и Unicode сохраняются как обычные platform paths. В renderer передаётся только
состояние, диагностика и opaque asset token; произвольного файлового API нет.

## Fallback и ограничения

Не поддерживаются и не заявляются:

- OptiFine CTM/CIT и connected textures;
- shaders и emissive shader-pack conventions;
- Fabric/Forge-specific loaders;
- произвольная modded geometry вне standard JSON layout;
- animated `.png.mcmeta` playback;
- biome tint simulation;
- полное воспроизведение weighted/random multipart render;
- полная совместимость со всем Minecraft renderer.

Для нескольких variants выбирается стабильный representative variant и показывается
диагностика. Multipart и custom multi-element geometry приближаются известными texture variables
на шести гранях; если это невозможно, остаётся цвет Material. Ошибка одного файла или ссылка-цикл
не должны аварийно завершать сцену.

Редактор не содержит Mojang texture assets. Они не попадают в git, ASAR, DMG, ZIP, EXE или
installer: разрешённые копии живут только под Electron `userData/resource-preview/cache`.
Импорт и resolution выполняются локально; сеть и downloader для этой функции не используются.
Ни настройки, ни локальные пути, ни cache tokens не сериализуются в модель или вариант
CustomVehicles.
