import { useEffect, useMemo, useRef, useState } from 'react'
import { BLOCK_MATERIALS } from '../../../shared/materials'
import { useResourcePreviewStore } from '../../store/resource-preview-store'
import { materialColor } from '../materialColor'

const RECENT_MATERIALS_KEY = 'customvehicles.recent-materials'

function loadRecentMaterials(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_MATERIALS_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 8)
      : []
  } catch {
    return []
  }
}

function readableMaterial(material: string): string {
  return material
    .toLocaleLowerCase('en-US')
    .split('_')
    .map((word) => word.charAt(0).toLocaleUpperCase('en-US') + word.slice(1))
    .join(' ')
}

function usePreviewAssetUrl(assetToken: string | null): string | null {
  const [loaded, setLoaded] = useState<{
    assetToken: string
    url: string
  } | null>(null)
  useEffect(() => {
    if (assetToken === null || window.editorApi.resourcePreview === undefined) {
      return
    }
    let active = true
    let objectUrl: string | null = null
    void window.editorApi.resourcePreview.readAsset(assetToken).then(
      (bytes) => {
        if (!active) return
        const copy = Uint8Array.from(bytes)
        objectUrl = URL.createObjectURL(
          new Blob([copy.buffer], { type: 'image/png' })
        )
        setLoaded({ assetToken, url: objectUrl })
      },
      () => undefined
    )
    return () => {
      active = false
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [assetToken])
  return loaded?.assetToken === assetToken ? loaded.url : null
}

export function MaterialPicker({
  value,
  onChange
}: {
  value: string | null
  onChange: (material: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [pathsOpen, setPathsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState(loadRecentMaterials)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewState = useResourcePreviewStore((state) => state.preview)
  const resolved = useResourcePreviewStore((state) =>
    value === null ? undefined : state.resolved[value]
  )
  const assignManualTexture = useResourcePreviewStore(
    (state) => state.assignManualTexture
  )
  const clearManualTexture = useResourcePreviewStore(
    (state) => state.clearManualTexture
  )
  const manual =
    value === null
      ? undefined
      : previewState.manualTextures.find(
          (entry) => entry.material === value && entry.face === 'all'
        )
  const firstResolvedFace =
    resolved?.faces.east ??
    resolved?.faces.west ??
    resolved?.faces.top ??
    resolved?.faces.bottom ??
    resolved?.faces.south ??
    resolved?.faces.north
  const thumbnailUrl = usePreviewAssetUrl(
    manual?.assetToken ?? firstResolvedFace?.assetToken ?? null
  )
  const resolvedPaths = useMemo(
    () => [
      ...(resolved?.modelPath === null || resolved?.modelPath === undefined
        ? []
        : [`Модель: ${resolved.modelPath}`]),
      ...[
        ...new Set(
          Object.values(resolved?.faces ?? {}).map((face) => face.logicalPath)
        )
      ].map((path) => `Текстура: ${path}`)
    ],
    [resolved]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleUpperCase('en-US').replaceAll(' ', '_')
    if (needle.length === 0) {
      return [...recent, ...BLOCK_MATERIALS.filter((material) => !recent.includes(material))].slice(0, 80)
    }
    return BLOCK_MATERIALS.filter(
      (material) =>
        material.includes(needle) ||
        readableMaterial(material).toLocaleUpperCase('en-US').includes(query.toLocaleUpperCase('en-US'))
    ).slice(0, 80)
  }, [query, recent])

  const choose = (material: string): void => {
    onChange(material)
    const nextRecent = [material, ...recent.filter((entry) => entry !== material)].slice(0, 8)
    setRecent(nextRecent)
    try {
      localStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(nextRecent))
    } catch {
      // Local storage is only a convenience; editing remains fully functional without it.
    }
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="material-picker">
      <span className="field-label">Материал</span>
      <button type="button" className="material-current" onClick={() => {
        setOpen((current) => !current)
        queueMicrotask(() => inputRef.current?.focus())
      }}>
        <span
          className="material-swatch large"
          style={{
            '--swatch-color': value === null ? '#566171' : materialColor(value)
          } as React.CSSProperties}
        />
        <span>
          <strong>{value ?? 'Разные материалы'}</strong>
          <small>{value === null ? 'Смешанное значение' : readableMaterial(value)}</small>
        </span>
        <span className="chevron">⌄</span>
      </button>
      {open && (
        <div className="material-popover">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Поиск блочного материала"
            aria-expanded="true"
            aria-controls="material-options"
            placeholder="Поиск: concrete, glass…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const material = filtered[activeIndex]
                if (material !== undefined) choose(material)
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          <div className="material-options" id="material-options" role="listbox">
            {filtered.length === 0 ? (
              <p className="empty-state">Материал не найден</p>
            ) : (
              filtered.map((material, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={material === value}
                  className={`${material === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-keyboard-active' : ''}`}
                  key={material}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(material)}
                >
                  <span
                    className="material-swatch"
                    style={{ '--swatch-color': materialColor(material) } as React.CSSProperties}
                  />
                  <span>
                    <strong>{material}</strong>
                    <small>{readableMaterial(material)}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {value !== null && (
        <div className="material-resource-info">
          <div className="material-resource-summary">
            {thumbnailUrl === null ? (
              <span
                className="material-swatch resource-thumbnail"
                style={{ '--swatch-color': materialColor(value) } as React.CSSProperties}
              />
            ) : (
              <img src={thumbnailUrl} alt={`Текстура ${value}`} />
            )}
            <span>
              <strong>
                {manual !== undefined
                  ? 'Ручная текстура'
                  : resolved?.sourceName ?? 'Цвет материала'}
              </strong>
              <small>
                {resolved?.modelPath ??
                  firstResolvedFace?.logicalPath ??
                  'Текстура не найдена — используется цвет'}
              </small>
            </span>
          </div>
          {resolved?.diagnostics.slice(0, 2).map((diagnostic, index) => (
            <small
              className={`resource-diagnostic ${diagnostic.severity}`}
              key={`${diagnostic.code}:${index}`}
            >
              {diagnostic.message}
            </small>
          ))}
          <div className="material-resource-actions">
            <button
              type="button"
              onClick={() => void assignManualTexture(value, 'all')}
            >
              {manual === undefined ? 'Назначить PNG' : 'Заменить PNG'}
            </button>
            <button
              type="button"
              disabled={manual === undefined}
              onClick={() => void clearManualTexture(value, 'all')}
            >
              Очистить
            </button>
            <button
              type="button"
              className="resource-path-toggle"
              disabled={resolvedPaths.length === 0}
              aria-expanded={pathsOpen}
              onClick={() => setPathsOpen((current) => !current)}
            >
              {pathsOpen ? 'Скрыть пути' : 'Показать пути'}
            </button>
          </div>
          {pathsOpen && resolvedPaths.length > 0 && (
            <div className="material-resource-paths" aria-label="Пути ресурсов">
              {resolvedPaths.map((path) => <code key={path}>{path}</code>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
