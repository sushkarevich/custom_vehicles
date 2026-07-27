# Архитектура редактора

## Процессы

Приложение разделено на три изолированных слоя.

1. `src/main` создаёт Electron-окно, системные диалоги, список недавних документов, атомарную
   запись и app-scoped resource preview manager. Main-процесс проверяет отправителя каждого
   IPC-запроса, абсолютность пути, расширение и максимальный размер.
2. `src/preload` через `contextBridge` публикует `EditorApi`. Произвольного доступа к `fs`, shell
   или Electron API у renderer нет. Preload собирается единым CommonJS-файлом для совместимости
   с Electron sandbox; renderer и main остаются ESM.
3. `src/renderer` содержит React UI, состояние документа и React Three Fiber-сцену. Парсинг,
   сериализация и валидация импортируются из общего слоя `src/shared`.

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
Запросы browser permissions всегда отклоняются. Production renderer загружается только из
локального файла.

## Поток документа

```text
Системный диалог
    ↓
main: ограниченное чтение UTF-8
    ↓ typed IPC
shared YAML parser → canonical ModelDefinition | VehicleVariantDefinition
    ↓
Zustand history store → React inspector / R3F scene
    ↓
shared validation → stable YAML serializer
    ↓ typed IPC
main: temp file → fsync → atomic replace
```

Парсер использует безопасный YAML без aliases и merge keys. Лимит совпадает с плагином:
1 048 576 UTF-8 байт. Поддерживаемые необязательные поля нормализуются и сохраняются; неизвестные
поля дают предупреждение и намеренно не попадают в canonical-документ. `coordinate-system`
по умолчанию означает +Z, `display` — 2/1, отсутствие `interaction` означает отсутствие entity.
У детали обязательны объекты `position`/`scale`, а rotation по умолчанию нулевой. Ограничение —
512 деталей, координаты ±256, scale 0.0001…64 и rotation ±360000°. Сериализатор создаёт поля в
стабильном порядке и нормализует числа до шести знаков после запятой.

## Состояние и история

`document-store.ts` хранит текущий immutable snapshot, past/future, путь, упорядоченные
`selectedPartIds`, `activePartId`, сигнатуру последнего сохранения и dirty-флаг. Selection не
входит в YAML и её жесты не создают history/dirty, но рядом с каждым document snapshot хранится
transient selection context. Поэтому Undo/Redo атомарно восстанавливает документ и выделение
после delete/duplicate/rename. `applyEdit` меняет оба состояния одним Zustand action, а
`executeModelCommand` является общим batch-путём hierarchy, inspector и shortcuts.

Обычная операция создаёт один history snapshot.
`beginTransaction`/`endTransaction` объединяют:

- последовательность событий TransformControls;
- непрерывный ввод числового или текстового поля;
- многострочный ввод lore и menu description.

Каждая деталь владеет одним стабильным mesh и регистрируется в scene-level `id → Object3D` map.
Один `SelectionTransformController` владеет временным pivot и единственным gizmo. Для translate и
rotate `TransformControls` меняет pivot; `D = Pcurrent × inverse(Pstart)` применяется к matrix
snapshots всех выбранных mesh без постоянного reparenting и store-write на каждом кадре. На
`pointerup` весь transform map записывается один раз. Cancel, blur, смена
selection/document/mode или unmount восстанавливают pivot, snapshots и `OrbitControls`.

Scale использует отдельный `AnchoredResizeGizmo`, потому что pinned TransformControls сообщает
только unsigned ось. Шесть typed handles передают `{axis, sign}`. Для одного rotated part:

```text
direction = quaternion × localAxis
anchor = center - sign × oldSize/2 × direction
newSize = clamp(snap(oldSize + sign × pointerDistance))
newCenter = anchor + sign × newSize/2 × direction
```

Для группы центры и projected supports масштабируются относительно противоположной грани общей
model-space bounds. Если shared non-uniform scale создал бы не представимый YAML shear, деталь
масштабируется равномерно; общие anchored/moved faces остаются точными, а UI сообщает fallback.
Resize session использует те же transaction/cancel/orbit boundaries и при commit меняет только
position/positive scale, не round-trip-ит сохранённые Euler-углы.

Весь pointer lifecycle anchored resize принадлежит одному
`ResizeInteractionController`: `idle → armed → dragging → committing/cancelled → idle`.
Стабильный WebGL canvas владеет pointer capture, а window capture-listeners продолжают
проекцию ray/plane за пределами canvas. Только совпадающий `pointerId` может обновить или
завершить жест. `pointercancel`, blur, Escape, смена selection/document/mode и unmount отменяют
transaction, освобождают capture и немедленно возвращают `OrbitControls`. На macOS физический
release иногда приходит как `lostpointercapture` без наблюдаемого window-`pointerup`: после
движения больше click threshold этот terminal синхронно commit-ит последний authoritative
snapshot, а без meaningful movement отменяет жест. Обычный `pointerup` также создаёт ровно один
history entry только после meaningful movement. Resize не ставит pointer updates в RAF-очередь:
terminal
координаты самого `pointerup` синхронно проецируются, а результат math-session становится
authoritative transform map. Он применяется к live `Object3D` для preview и напрямую записывается
в store; commit больше не снимает transform обратно с mutable scene objects или `matrixWorld`.
Перед записью map ещё раз применяется к сцене с `updateMatrix()`/`updateMatrixWorld(true)`, и
только после commit снимаются listeners, pointer capture и блокировка Orbit. Поэтому release до
следующего кадра и release за пределами canvas не зависят от reconciliation/useFrame.
Каждый drag имеет generation ID и единственный terminal outcome; поздний `pointerup`,
`lostpointercapture` или click не может отменить уже committed generation.
Следующий синтетический click Chromium поглощается отдельным одноразовым gate, чтобы он не
очистил selection.

Для исследования именно физического ввода есть выключенная developer-трассировка. В DevTools
нужно выполнить `localStorage.setItem('customVehicles.resizeTrace', '1')` и перезагрузить окно.
Массив `window.__CUSTOM_VEHICLES_RESIZE_TRACE__` содержит session ID, pointer events, calculated
map, local transform, `matrix`, `matrixWorld`, parent transform, store result и terminal outcome,
а также снимки scene/store после первого и второго кадров после commit.
Записи зеркалируются в `localStorage` под ключом
`customVehicles.resizeTrace.records`, поэтому физическая трасса переживает reload и штатный
перезапуск; жёсткое завершение процесса до disk flush не гарантируется. После исследования
режим отключается и очищается через
`localStorage.removeItem('customVehicles.resizeTrace')`,
`localStorage.removeItem('customVehicles.resizeTrace.records')`; в обычном запуске trace не
создаётся.

Видимый cube и невидимый hit target имеют один world transform. В каждом кадре их world-size
пересчитывается из CSS-пикселей (12 px visual, 38 px hit target), поэтому область захвата не
уменьшается при отдалении камеры и не зависит от Retina `devicePixelRatio`.

Toolbar и команды из native-меню вызывают один `executeEditorHistoryCommand`, который работает
с этим же store. Основные accelerators принадлежат main-процессу: меню отправляет типизированную
`editor:command` через preload, а Windows/Linux `Ctrl+Shift+Z` проходит через тот же dispatcher.
Renderer сообщает только `canUndo`, `canRedo` и признак фокуса в текстовом control. При таком
фокусе main вызывает native `webContents.undo/redo`; application history не запускается. DOM
`keydown` намеренно не обрабатывает Undo/Redo, поэтому одно нажатие не может сработать дважды.

Файл помечается чистым только после подтверждённой записи main-процессом. Dirty-флаг также
передаётся main-процессу, поэтому системное закрытие окна вызывает нативное предупреждение.

## Геометрия

Каждая деталь отображается единичной `BoxGeometry` с центральным pivot. Three.js получает:

- `mesh.position = part.position`;
- `mesh.scale = part.scale`;
- `mesh.rotation = Euler(x, y, z, "XYZ")`.

Euler-углы хранятся в градусах в порядке `XYZ`; Three.js создаёт тот же quaternion, что серверный
JOML `Quaternionf.rotationXYZ`. Сервер получает итог
`Q_pose × Q_part`. Вычисление границ для фокуса камеры преобразует все восемь углов каждого
кубоида тем же quaternion, поэтому учитывает локальное вращение.

Material preview выбирает persisted режим `textures` либо прежние детерминированные цвета.
Resource manager в main хранит настройки под Electron `userData/resource-preview`, безопасно
индексирует выбранные folder/ZIP pack и разрешает standard blockstate/model/texture inheritance.
`minecraft-installation-discovery.ts` выбирает platform root (`~/Library/Application
Support/minecraft/versions` либо `%APPDATA%/.minecraft/versions`), читает bounded launcher JSON
и предпочитает metadata ID `1.21.1`. Ручной client JAR также выдаётся manager только через
нативный диалог.

Vanilla client JAR проходит тот же ZIP central-directory/security scanner в режиме без
`pack.mcmeta`. Разрешены только `assets/minecraft/blockstates`, JSON-модели и
`textures/block`; JAR никогда не исполняется. Cache identity включает canonical local selection,
версию, размер, mtime и вычисленный при rebuild SHA-256. Индекс содержит manifest fingerprint и
source SHA-256, поэтому неизменённый cache переиспользуется, а изменённый JAR публикуется через
новый staging directory. Слой resolver имеет порядок `manual → imported packs → vanilla →
color`; отдельного парсера Minecraft-моделей для vanilla нет.

Renderer получает только typed DTO и opaque asset tokens. Уникальные видимые Material
разрешаются одним batch на settings revision; устаревший batch отбрасывается.

Decoded Three.js textures кэшируются promise-aware/ref-counted по token+rotation, используют
`SRGBColorSpace`, `NearestFilter`, прозрачность/alpha test и освобождаются после последнего
потребителя. `BoxGeometry` face materials идут как east, west, top, bottom, south, north.
Обновление resource revision меняет только material props: Canvas, камеры, controls и part mesh
не получают texture-derived `key`. Mojang assets находятся только в исходном пользовательском
JAR и `userData` cache; репозиторий, ASAR, DMG/ZIP и Windows package их не включают.

ZIP scanner выполняет central-directory preflight и ограничивает entries, compressed/
uncompressed bytes, ratio и размер отдельных JSON/PNG; отбрасывает absolute/drive/UNC,
traversal и backslash-form paths, encryption, symlinks и unsupported compression, проверяет
CRC/declared size и публикует staging cache атомарным rename. Directory scanner использует lstat/realpath
containment и те же allowlist/limits. Все IPC операции повторно проверяют live sender; renderer
не может прочитать arbitrary path. Подробнее: [resource-pack-support.md](resource-pack-support.md).

Сцена поддерживает PerspectiveCamera и OrthographicCamera. Кардинальные виды учитывают знак
`coordinate-system.forward`. `interaction.offset` — location/anchor в нижнем центре Bukkit
Interaction. Поэтому каркасный кубоид имеет ширину по X/Z, высоту по Y, а его геометрический центр
рендерится в `offset + (0, height / 2, 0)`. На сервере Interaction остаётся выровненным по мировым
осям даже при pitch транспорта на рельсе; редактор показывает локальный hitbox для нулевой
ориентации транспорта и явно не симулирует мировой rail pitch.

`Canvas`, обе камеры и `OrbitControls` остаются смонтированными при выборе и редактировании
деталей. Camera placement выполняется только при новом явном command nonce или смене активной
Perspective/OrthographicCamera; callback читает актуальные model/selection только в момент такой
команды. Открытие или создание другого документа увеличивает transient `documentEpoch`, после
чего `App` явно инициализирует перспективный вид. `OrbitControls` работает без damping, поэтому
обычный React-render при смене selection не может продвинуть скрытую инерцию камеры. Эти
transient-значения не сохраняются в YAML.

`negative-z` — полноценный поворот корня на 180° вокруг Y. Поэтому авторская ось `+X` также
переходит в относительную `-X`; это намеренная совместимость со старым автомобильным
`yaw + 180°`. Новые модели следует создавать с `positive-z`.

## Проверки

Vitest покрывает YAML, Unicode-round-trip, значения по умолчанию, материалы, ordered selection,
batch operations/selection history, group matrices, signed/rotated/group anchored resize и его
termination paths, native history/menu lifetime, resource settings, directory/ZIP security,
macOS/Windows Minecraft discovery, metadata/manual JAR, vanilla cache reuse/invalidation,
pack/vanilla priority, resolver inheritance/cycles/cube layouts/fallbacks, opaque IPC, отсутствие
Mojang assets в package inputs/готовом ASAR, texture cache и renderer UI.

Основные команды:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
