import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode
} from 'react'
import { isModelDefinition, type ValidationIssue } from '../../shared/schema'
import { validateModel, validateVariant } from '../../shared/validation'
import { useDocumentStore } from '../store/document-store'
import { useResourcePreviewStore } from '../store/resource-preview-store'
import { ModelInspector } from './components/ModelInspector'
import { PartList } from './components/PartList'
import { ResourcePackManager } from './components/ResourcePackManager'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { VariantInspector } from './components/VariantInspector'
import { VariantSummary } from './components/VariantSummary'
import { VariantWorkspace } from './components/VariantWorkspace'
import { Viewport } from './components/Viewport'
import { useFileWorkflows } from './hooks/useFileWorkflows'
import { useHistoryIntegration } from './hooks/useHistoryIntegration'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { CameraCommand, CameraView, TransformMode, ViewportSettings } from './types'

const INITIAL_VIEWPORT_SETTINGS: ViewportSettings = {
  transformMode: 'translate',
  cameraType: 'perspective',
  showGrid: true,
  showAxes: true,
  showHitbox: true,
  showBounds: false,
  snapping: false,
  translationSnap: 0.25,
  rotationSnap: 15,
  scaleSnap: 0.1
}

function uniqueIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.severity}\0${issue.path}\0${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

class RendererErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  public override state: { error: Error | null } = { error: null }

  public static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer startup failed', error, info.componentStack)
  }

  public override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <main className="fatal-error">
          <div className="brand-cube large" />
          <h1>Редактор не смог запуститься</h1>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => location.reload()}>Перезапустить</button>
        </main>
      )
    }
    return this.props.children
  }
}

function EditorApp(): React.JSX.Element {
  const document = useDocumentStore((state) => state.history.present)
  const kind = useDocumentStore((state) => state.kind)
  const filePath = useDocumentStore((state) => state.filePath)
  const dirty = useDocumentStore((state) => state.dirty)
  const selectedPartIds = useDocumentStore((state) => state.selectedPartIds)
  const activePartId = useDocumentStore((state) => state.activePartId)
  const editorNotice = useDocumentStore((state) => state.editorNotice)
  const documentEpoch = useDocumentStore((state) => state.documentEpoch)
  const canUndo = useDocumentStore((state) => state.history.past.length > 0)
  const canRedo = useDocumentStore((state) => state.history.future.length > 0)
  const resourceRevision = useResourcePreviewStore(
    (state) => state.preview.revision
  )
  const resourceMode = useResourcePreviewStore((state) => state.preview.mode)
  const initializeResourcePreview = useResourcePreviewStore(
    (state) => state.initialize
  )
  const resolveMaterialPreviews = useResourcePreviewStore(
    (state) => state.resolveMaterials
  )
  const setResourceMode = useResourcePreviewStore((state) => state.setMode)
  const [loadIssues, setLoadIssues] = useState<ValidationIssue[]>([])
  const [resourceManagerOpen, setResourceManagerOpen] = useState(false)
  const workflow = useFileWorkflows(setLoadIssues)
  const [settings, setSettingsState] = useState<ViewportSettings>(INITIAL_VIEWPORT_SETTINGS)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>({
    view: 'perspective',
    nonce: 0
  })
  const previousDocumentEpoch = useRef(documentEpoch)
  const executeHistoryCommand = useHistoryIntegration(canUndo, canRedo)

  useEffect(() => {
    void initializeResourcePreview()
  }, [initializeResourcePreview])

  const materialKey = useMemo(
    () =>
      isModelDefinition(document)
        ? [...new Set(document.parts.map((part) => part.material))]
            .sort()
            .join('\u0000')
        : '',
    [document]
  )

  useEffect(() => {
    if (resourceMode !== 'textures' || materialKey.length === 0) return
    void resolveMaterialPreviews(materialKey.split('\u0000'))
  }, [
    materialKey,
    resolveMaterialPreviews,
    resourceMode,
    resourceRevision
  ])

  useEffect(() => {
    window.editorApi.setDirty(dirty)
  }, [dirty])

  useEffect(() => {
    if (previousDocumentEpoch.current === documentEpoch) return
    previousDocumentEpoch.current = documentEpoch
    setSettingsState((current) => ({ ...current, cameraType: 'perspective' }))
    setCameraCommand((current) => ({ view: 'perspective', nonce: current.nonce + 1 }))
  }, [documentEpoch])

  const setSettings = useCallback((patch: Partial<ViewportSettings>) => {
    setSettingsState((current) => ({ ...current, ...patch }))
  }, [])

  const setTransformMode = useCallback((transformMode: TransformMode) => {
    setSettings({ transformMode })
  }, [setSettings])

  const sendCameraCommand = useCallback((view: CameraView) => {
    if (view === 'perspective') setSettings({ cameraType: 'perspective' })
    setCameraCommand((current) => ({ view, nonce: current.nonce + 1 }))
  }, [setSettings])

  const shortcutOptions = useMemo(
    () => ({
      enabled: !resourceManagerOpen,
      setTransformMode,
      save: workflow.save,
      saveAs: workflow.saveAs
    }),
    [
      resourceManagerOpen,
      setTransformMode,
      workflow.save,
      workflow.saveAs
    ]
  )
  useKeyboardShortcuts(shortcutOptions)

  const currentIssues = useMemo(
    () =>
      uniqueIssues([
        ...loadIssues,
        ...(isModelDefinition(document) ? validateModel(document) : validateVariant(document))
      ]),
    [document, loadIssues]
  )

  const model = isModelDefinition(document) ? document : null
  const variant = isModelDefinition(document) ? null : document

  return (
    <div className="app-shell">
      <Toolbar
        kind={kind}
        dirty={dirty}
        canUndo={canUndo}
        canRedo={canRedo}
        recent={workflow.recent}
        settings={settings}
        cameraCommand={cameraCommand}
        onSettings={setSettings}
        onCameraCommand={sendCameraCommand}
        onNewModel={() => void workflow.newModel()}
        onNewVariant={() => void workflow.newVariant()}
        onOpen={() => void workflow.open()}
        onOpenRecent={(path) => void workflow.openRecent(path)}
        onSave={() => void workflow.save()}
        onSaveAs={() => void workflow.saveAs()}
        onExport={() => void workflow.exportDocument()}
        onHistoryCommand={executeHistoryCommand}
        resourceMode={resourceMode}
        onResourceMode={(mode) => void setResourceMode(mode)}
        onOpenResources={() => setResourceManagerOpen(true)}
      />
      <div className={`workspace ${kind === 'variant' ? 'variant-mode' : ''}`}>
        {model !== null ? (
          <>
            <PartList
              model={model}
              selectedPartIds={selectedPartIds}
              activePartId={activePartId}
            />
            <Viewport
              model={model}
              selectedPartIds={selectedPartIds}
              activePartId={activePartId}
              settings={settings}
              command={cameraCommand}
              onCommand={sendCameraCommand}
            />
            <ModelInspector
              model={model}
              selectedPartIds={selectedPartIds}
              activePartId={activePartId}
            />
          </>
        ) : variant !== null ? (
          <>
            <VariantSummary variant={variant} />
            <VariantWorkspace variant={variant} />
            <VariantInspector variant={variant} />
          </>
        ) : null}
      </div>
      <StatusBar
        issues={currentIssues}
        status={editorNotice === null ? workflow.status : { kind: 'info', text: editorNotice }}
        filePath={filePath}
        selectedPartIds={selectedPartIds}
        activePartId={activePartId}
        partCount={model?.parts.length ?? null}
      />
      {resourceManagerOpen && (
        <ResourcePackManager onClose={() => setResourceManagerOpen(false)} />
      )}
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <RendererErrorBoundary>
      <EditorApp />
    </RendererErrorBoundary>
  )
}
