import { VANILLA_RESOURCE_PACK_ID } from '../../../shared/resource-preview'
import { useResourcePreviewStore } from '../../store/resource-preview-store'

export function ResourcePackManager({
  onClose
}: {
  onClose: () => void
}): React.JSX.Element {
  const preview = useResourcePreviewStore((state) => state.preview)
  const progress = useResourcePreviewStore((state) => state.progress)
  const busy = useResourcePreviewStore((state) => state.busy)
  const error = useResourcePreviewStore((state) => state.error)
  const setMode = useResourcePreviewStore((state) => state.setMode)
  const addDirectory = useResourcePreviewStore((state) => state.addDirectory)
  const addZip = useResourcePreviewStore((state) => state.addZip)
  const setPackEnabled = useResourcePreviewStore(
    (state) => state.setPackEnabled
  )
  const movePack = useResourcePreviewStore((state) => state.movePack)
  const removePack = useResourcePreviewStore((state) => state.removePack)
  const rescanPack = useResourcePreviewStore((state) => state.rescanPack)
  const revealPack = useResourcePreviewStore((state) => state.revealPack)
  const discoverVanilla = useResourcePreviewStore(
    (state) => state.discoverVanilla
  )
  const selectVanillaJar = useResourcePreviewStore(
    (state) => state.selectVanillaJar
  )
  const selectVanillaVersion = useResourcePreviewStore(
    (state) => state.selectVanillaVersion
  )
  const setVanillaEnabled = useResourcePreviewStore(
    (state) => state.setVanillaEnabled
  )
  const refreshVanilla = useResourcePreviewStore(
    (state) => state.refreshVanilla
  )
  const revealVanilla = useResourcePreviewStore(
    (state) => state.revealVanilla
  )
  const vanillaProgress = progress[VANILLA_RESOURCE_PACK_ID]
  const selectedVanillaCandidate =
    preview.vanilla.detectedVersions.find(
      (version) =>
        version.jarPath === preview.vanilla.sourcePath &&
        version.version === preview.vanilla.version
    )?.id ?? ''

  return (
    <div
      className="resource-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="resource-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-manager-title"
      >
        <header className="resource-modal-heading">
          <div>
            <span className="eyebrow">Настройки предпросмотра</span>
            <h2 id="resource-manager-title">Ресурс-паки</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="resource-modal-toolbar">
          <div className="resource-mode-switch" aria-label="Режим материалов">
            <button
              type="button"
              className={preview.mode === 'textures' ? 'is-active' : ''}
              onClick={() => void setMode('textures')}
            >
              Текстуры
            </button>
            <button
              type="button"
              className={preview.mode === 'colors' ? 'is-active' : ''}
              onClick={() => void setMode('colors')}
            >
              Цвета материалов
            </button>
          </div>
          <div className="resource-add-actions">
            <button type="button" disabled={busy} onClick={() => void addDirectory()}>
              Добавить папку
            </button>
            <button type="button" disabled={busy} onClick={() => void addZip()}>
              Добавить ZIP
            </button>
          </div>
        </div>

        {error !== null && <p className="resource-error">{error}</p>}

        <section className="vanilla-resource-card" aria-labelledby="vanilla-title">
          <div className="vanilla-resource-heading">
            <div>
              <span className="eyebrow">Базовый слой</span>
              <h3 id="vanilla-title">
                {preview.vanilla.version === null
                  ? 'Ванильные ресурсы Minecraft'
                  : `Ванильные ресурсы Minecraft ${preview.vanilla.version}`}
              </h3>
            </div>
            <span
              className={`vanilla-resource-status ${
                preview.vanilla.ready ? 'is-ready' : ''
              }`}
            >
              {preview.vanilla.scanning
                ? 'Индексирование…'
                : preview.vanilla.ready
                  ? 'Готово'
                  : 'Недоступно'}
            </span>
          </div>

          <div className="vanilla-resource-copy">
            {preview.vanilla.sourcePath === null ? (
              <p>
                Локальная установка Minecraft Java Edition не найдена.
                Предпросмотр продолжает использовать цвета материалов.
              </p>
            ) : (
              <>
                <p>
                  Источник:{' '}
                  <strong>
                    {preview.vanilla.sourceKind === 'automatic'
                      ? 'найден автоматически'
                      : 'выбран вручную'}
                  </strong>
                  {preview.vanilla.cacheReused ? ' · cache переиспользован' : ''}
                </p>
                <code title={preview.vanilla.sourcePath}>
                  {preview.vanilla.sourcePath}
                </code>
              </>
            )}
            {(preview.vanilla.scanning || vanillaProgress !== undefined) && (
              <small>
                {preview.vanilla.scanning
                  ? `Ресурсов обработано: ${vanillaProgress?.processed ?? 0}${
                      vanillaProgress?.total === null ||
                      vanillaProgress?.total === undefined
                        ? ''
                        : ` / ${vanillaProgress.total}`
                    }`
                  : 'Индекс ванильных ресурсов обновлён'}
              </small>
            )}
            {preview.vanilla.diagnostics.map((diagnostic, index) => (
              <small
                className={`resource-diagnostic ${diagnostic.severity}`}
                key={`${diagnostic.code}:${index}`}
              >
                {diagnostic.message}
              </small>
            ))}
          </div>

          {preview.vanilla.detectedVersions.length > 0 && (
            <label className="vanilla-version-select">
              <span>Обнаруженная версия</span>
              <select
                value={selectedVanillaCandidate}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.value.length > 0) {
                    void selectVanillaVersion(event.target.value)
                  }
                }}
              >
                {selectedVanillaCandidate.length === 0 && (
                  <option value="">Выбран пользовательский JAR</option>
                )}
                {preview.vanilla.detectedVersions.map((version) => (
                  <option value={version.id} key={version.id}>
                    {version.version}
                    {version.preferred ? ' — рекомендуется' : ''}
                    {!version.compatible ? ' — другая версия' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="vanilla-resource-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void discoverVanilla()}
            >
              Найти автоматически
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void selectVanillaJar()}
            >
              Выбрать Minecraft JAR
            </button>
            <button
              type="button"
              disabled={busy || preview.vanilla.sourcePath === null}
              onClick={() => void refreshVanilla()}
            >
              Обновить ресурсы
            </button>
            <button
              type="button"
              disabled={preview.vanilla.sourcePath === null}
              onClick={() => void revealVanilla()}
            >
              Открыть расположение
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void setVanillaEnabled(!preview.vanilla.enabled)
              }
            >
              {preview.vanilla.enabled
                ? 'Отключить ванильные текстуры'
                : 'Включить ванильные текстуры'}
            </button>
          </div>
        </section>

        <div className="resource-section-heading">
          <span className="eyebrow">Слои переопределений</span>
          <h3>Импортированные ресурс-паки</h3>
        </div>

        <div className="resource-pack-list">
          {preview.packs.length === 0 ? (
            <div className="resource-empty">
              <strong>Ресурс-паки ещё не добавлены</strong>
              <p>
                Выберите папку или ZIP обычного Minecraft resource pack.
                Файлы индексируются локально и никуда не отправляются.
              </p>
            </div>
          ) : (
            preview.packs.map((pack, index) => {
              const scan = progress[pack.id]
              return (
                <article
                  className={`resource-pack-row ${pack.missing ? 'is-missing' : ''}`}
                  key={pack.id}
                >
                  <label className="resource-pack-enabled">
                    <input
                      type="checkbox"
                      checked={pack.enabled}
                      onChange={(event) =>
                        void setPackEnabled(pack.id, event.target.checked)
                      }
                    />
                    <span className="resource-pack-type">
                      {pack.type === 'zip' ? 'ZIP' : 'ПАПКА'}
                    </span>
                  </label>
                  <div className="resource-pack-copy">
                    <strong>{pack.name}</strong>
                    <span>
                      {pack.metadata === null
                        ? 'pack.mcmeta не прочитан'
                        : `pack_format ${pack.metadata.packFormat ?? '—'} · ${pack.metadata.description}`}
                    </span>
                    <code title={pack.sourcePath}>{pack.sourcePath}</code>
                    {(pack.scanning || scan !== undefined) && (
                      <small>
                        {pack.scanning
                          ? `Сканирование: ${scan?.processed ?? 0}${
                              scan?.total === null || scan?.total === undefined
                                ? ''
                                : ` / ${scan.total}`
                            }`
                          : 'Индекс обновлён'}
                      </small>
                    )}
                    {pack.diagnostics.map((diagnostic, diagnosticIndex) => (
                      <small
                        className={`resource-diagnostic ${diagnostic.severity}`}
                        key={`${diagnostic.code}:${diagnosticIndex}`}
                      >
                        {diagnostic.message}
                      </small>
                    ))}
                  </div>
                  <div className="resource-pack-actions">
                    <button
                      type="button"
                      title="Повысить приоритет"
                      disabled={index === 0 || busy}
                      onClick={() => void movePack(pack.id, 'higher')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Понизить приоритет"
                      disabled={index === preview.packs.length - 1 || busy}
                      onClick={() => void movePack(pack.id, 'lower')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void rescanPack(pack.id)}
                    >
                      Пересканировать
                    </button>
                    <button
                      type="button"
                      onClick={() => void revealPack(pack.id)}
                    >
                      Показать в папке
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Удалить «${pack.name}» из настроек предпросмотра?`
                          )
                        ) {
                          void removePack(pack.id)
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>

        <footer className="resource-modal-footer">
          <span>
            Ручных назначений: {preview.manualTextures.length}
          </span>
          <span>
            Приоритет: ручной PNG → включённые паки → ваниль Minecraft →
            цвет материала.
          </span>
          <span>
            Настройки хранятся в userData редактора и не попадают в YAML.
          </span>
        </footer>
      </section>
    </div>
  )
}
