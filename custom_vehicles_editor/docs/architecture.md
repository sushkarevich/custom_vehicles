# Архитектура редактора

## Процессы

Приложение разделено на три изолированных слоя.

1. `src/main` создаёт Electron-окно, системные диалоги, список недавних документов и атомарную
   запись. Main-процесс проверяет отправителя каждого IPC-запроса, абсолютность пути, расширение и
   максимальный размер.
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

`document-store.ts` хранит текущий immutable snapshot, past/future, путь, выбранную деталь,
сигнатуру последнего сохранения и dirty-флаг. Обычная операция создаёт один history snapshot.
`beginTransaction`/`endTransaction` объединяют:

- последовательность событий TransformControls;
- непрерывный ввод числового или текстового поля;
- многострочный ввод lore и menu description.

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
кубоида тем же quaternion, поэтому учитывает локальное вращение. Материалы показываются
приближёнными детерминированными цветами без распространения текстур Mojang.

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

Vitest покрывает YAML, Unicode-round-trip, значения по умолчанию, версии схемы, материалы,
дубликаты, numeric normalization, варианты/ссылки, операции с деталями, зеркала, undo/redo,
группировку transform, пути с пробелами/кириллицей, абстракцию атомарной записи и запуск renderer.

Основные команды:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
