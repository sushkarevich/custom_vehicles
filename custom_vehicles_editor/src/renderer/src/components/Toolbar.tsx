import type { RecentDocument } from '../../../shared/ipc'
import type { EditorHistoryCommand } from '../../../shared/history-commands'
import type { DocumentKind } from '../../../shared/schema'
import type { ResourcePreviewMode } from '../../../shared/resource-preview'
import type {
  CameraCommand,
  CameraType,
  CameraView,
  TransformMode,
  ViewportSettings
} from '../types'

interface ToolbarProps {
  kind: DocumentKind
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  recent: RecentDocument[]
  settings: ViewportSettings
  onSettings: (settings: Partial<ViewportSettings>) => void
  onCameraCommand: (view: CameraView) => void
  cameraCommand: CameraCommand
  onNewModel: () => void
  onNewVariant: () => void
  onOpen: () => void
  onOpenRecent: (filePath: string) => void
  onSave: () => void
  onSaveAs: () => void
  onExport: () => void
  onHistoryCommand: (command: EditorHistoryCommand) => void
  resourceMode: ResourcePreviewMode
  onResourceMode: (mode: ResourcePreviewMode) => void
  onOpenResources: () => void
}

function ToolButton({
  label,
  title,
  active = false,
  disabled = false,
  onClick,
  className = ''
}: {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tool-button ${active ? 'is-active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

const TRANSFORMS: Array<{ mode: TransformMode; label: string; title: string }> = [
  { mode: 'translate', label: 'W', title: 'Перемещение (W)' },
  { mode: 'rotate', label: 'E', title: 'Вращение (E)' },
  { mode: 'scale', label: 'R', title: 'Масштаб (R)' }
]

const VIEWS: Array<{ view: CameraView; label: string; title: string }> = [
  { view: 'front', label: 'Ф', title: 'Вид спереди' },
  { view: 'rear', label: 'Т', title: 'Вид сзади' },
  { view: 'left', label: 'Л', title: 'Вид слева' },
  { view: 'right', label: 'П', title: 'Вид справа' },
  { view: 'top', label: 'В', title: 'Вид сверху' },
  { view: 'perspective', label: '3D', title: 'Перспективный вид' }
]

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="brand" aria-label="Редактор CustomVehicles">
        <span className="brand-cube" aria-hidden="true" />
        <span className="brand-copy">
          <strong>CustomVehicles</strong>
          <small>{props.kind === 'model' ? 'Модель' : 'Вариант транспорта'}{props.dirty ? ' •' : ''}</small>
        </span>
      </div>

      <div className="tool-group" aria-label="Файл">
        <div className="new-document">
          <ToolButton label="+ Модель" title="Новая модель" onClick={props.onNewModel} />
          <ToolButton label="+ Вариант" title="Новый вариант транспорта" onClick={props.onNewVariant} />
        </div>
        <ToolButton label="Открыть" title="Открыть YAML (Ctrl/Cmd+O)" onClick={props.onOpen} />
        <details className="toolbar-menu">
          <summary className="tool-button" aria-label="Недавние файлы">Недавние</summary>
          <div className="toolbar-menu-popover">
            {props.recent.length === 0 ? (
              <p className="empty-menu">Недавних файлов нет</p>
            ) : (
              props.recent.map((entry) => (
                <button
                  type="button"
                  key={entry.filePath}
                  title={entry.filePath}
                  onClick={() => props.onOpenRecent(entry.filePath)}
                >
                  <span>{entry.displayName}</span>
                  <small>{entry.filePath}</small>
                </button>
              ))
            )}
          </div>
        </details>
        <ToolButton label="Сохранить" title="Сохранить (Ctrl/Cmd+S)" onClick={props.onSave} />
        <ToolButton label="Как…" title="Сохранить как (Ctrl/Cmd+Shift+S)" onClick={props.onSaveAs} />
        <ToolButton label="Экспорт" title="Экспортировать YAML в каталог плагина" onClick={props.onExport} />
      </div>

      <div className="toolbar-spacer" />

      <div className="tool-group" aria-label="История">
        <ToolButton
          label="↶"
          title="Отменить (Ctrl/Cmd+Z)"
          disabled={!props.canUndo}
          onClick={() => props.onHistoryCommand('undo')}
        />
        <ToolButton
          label="↷"
          title="Повторить (Ctrl+Y / Ctrl/Cmd+Shift+Z)"
          disabled={!props.canRedo}
          onClick={() => props.onHistoryCommand('redo')}
        />
      </div>

      {props.kind === 'model' && (
        <>
          <div className="tool-group segmented" aria-label="Режим трансформации">
            {TRANSFORMS.map((entry) => (
              <ToolButton
                key={entry.mode}
                label={entry.label}
                title={entry.title}
                active={props.settings.transformMode === entry.mode}
                onClick={() => props.onSettings({ transformMode: entry.mode })}
              />
            ))}
          </div>

          <details className="toolbar-menu snap-menu">
            <summary
              className={`tool-button ${props.settings.snapping ? 'is-active' : ''}`}
              aria-label="Настройки привязки"
            >
              Шаг
            </summary>
            <div className="toolbar-menu-popover snap-popover">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={props.settings.snapping}
                  onChange={(event) => props.onSettings({ snapping: event.target.checked })}
                />
                <span>Включить привязку</span>
              </label>
              <label>
                <span>Перемещение</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.05"
                  value={props.settings.translationSnap}
                  onChange={(event) => props.onSettings({ translationSnap: Number(event.target.value) || 0.25 })}
                />
              </label>
              <label>
                <span>Вращение, °</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={props.settings.rotationSnap}
                  onChange={(event) => props.onSettings({ rotationSnap: Number(event.target.value) || 15 })}
                />
              </label>
              <label>
                <span>Масштаб</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.05"
                  value={props.settings.scaleSnap}
                  onChange={(event) => props.onSettings({ scaleSnap: Number(event.target.value) || 0.1 })}
                />
              </label>
            </div>
          </details>

          <div className="tool-group segmented view-buttons" aria-label="Проекции камеры">
            {VIEWS.map((entry) => (
              <ToolButton
                key={entry.view}
                label={entry.label}
                title={entry.title}
                active={props.cameraCommand.view === entry.view}
                onClick={() => props.onCameraCommand(entry.view)}
              />
            ))}
          </div>

          <div className="tool-group segmented" aria-label="Тип камеры">
            {(['perspective', 'orthographic'] as CameraType[]).map((cameraType) => (
              <ToolButton
                key={cameraType}
                label={cameraType === 'perspective' ? 'Персп.' : 'Орто'}
                title={cameraType === 'perspective' ? 'Перспективная камера' : 'Ортографическая камера'}
                active={props.settings.cameraType === cameraType}
                onClick={() => props.onSettings({ cameraType })}
              />
            ))}
          </div>

          <div className="tool-group segmented" aria-label="Предпросмотр материалов">
            <ToolButton
              label="Текстуры"
              title="Показывать текстуры ресурс-паков"
              active={props.resourceMode === 'textures'}
              onClick={() => props.onResourceMode('textures')}
            />
            <ToolButton
              label="Цвета"
              title="Показывать цвета материалов"
              active={props.resourceMode === 'colors'}
              onClick={() => props.onResourceMode('colors')}
            />
            <ToolButton
              label="Ресурсы…"
              title="Настройки ресурс-паков и ручных текстур"
              onClick={props.onOpenResources}
            />
          </div>

          <details className="toolbar-menu">
            <summary className="tool-button" aria-label="Отображение сцены">Сцена</summary>
            <div className="toolbar-menu-popover toggles-popover">
              {([
                ['showGrid', 'Сетка'],
                ['showAxes', 'Оси и начало'],
                ['showHitbox', 'Область взаимодействия'],
                ['showBounds', 'Границы деталей']
              ] as Array<[keyof ViewportSettings, string]>).map(([key, label]) => (
                <label className="switch-row" key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(props.settings[key])}
                    onChange={(event) => props.onSettings({ [key]: event.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <div className="menu-actions">
                <button type="button" onClick={() => props.onCameraCommand('focus-selected')}>Выбранная деталь</button>
                <button type="button" onClick={() => props.onCameraCommand('focus-model')}>Вся модель</button>
                <button type="button" onClick={() => props.onCameraCommand('reset')}>Сбросить камеру</button>
              </div>
            </div>
          </details>
        </>
      )}
    </header>
  )
}
