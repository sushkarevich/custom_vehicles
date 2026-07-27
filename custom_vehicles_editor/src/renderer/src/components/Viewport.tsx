import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree
} from '@react-three/fiber'
import {
  Edges,
  Grid,
  Html,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  TransformControls
} from '@react-three/drei'
import {
  MathUtils,
  Object3D,
  OrthographicCamera as ThreeOrthographicCamera,
  PerspectiveCamera as ThreePerspectiveCamera,
  Raycaster,
  Vector3,
  type Group,
  type Mesh
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { ModelDefinition, ModelPart } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { useResourcePreviewStore } from '../../store/resource-preview-store'
import {
  commitAnchoredResizeTransforms,
  computeOrientedTransformBounds,
  createAxisDragPlane,
  createAnchoredResizeSession,
  createModelResizeFrame,
  orientedBoundsFaceCenter,
  resizeAxisDirection,
  SIGNED_RESIZE_HANDLES,
  type ResizeAxis,
  type SignedResizeHandle
} from '../anchored-resize'
import {
  commitGroupTransforms,
  computePartsBounds,
  createGroupTransformSession,
  groupPivotPosition
} from '../group-transform'
import { useExplicitCameraEffect } from '../hooks/useExplicitCameraEffect'
import { materialColor } from '../materialColor'
import { usePreviewTexture } from '../preview-texture-cache'
import {
  isPartSelectionClick,
  orbitControlsEnabled,
  shouldClearSelectionOnPointerMissed
} from '../transform-drag'
import {
  createResizeInteractionController,
  createResizeTrailingClickGate,
  pointerNdcFromClient,
  screenSpaceWorldSize
} from '../resize-interaction'
import {
  recordResizeDebugTrace,
  resizeDebugTraceEnabled
} from '../resize-debug-trace'
import type { CameraCommand, ViewportSettings } from '../types'

const DEFAULT_CAMERA_POSITION: [number, number, number] = [7, 5, 8]
const ORBIT_MOUSE_BUTTONS = { LEFT: 0, MIDDLE: 2, RIGHT: 2 } as const
// Drei Html defaults above ordinary application modals. Keep viewport labels
// inside the scene layer so resource/settings dialogs always cover them.
const VIEWPORT_HTML_Z_INDEX_RANGE: [number, number] = [100, 0]

function PartMaterials({ part }: { part: ModelPart }): React.JSX.Element {
  const mode = useResourcePreviewStore((state) => state.preview.mode)
  const preview = useResourcePreviewStore(
    (state) => state.resolved[part.material]
  )
  const textured = mode === 'textures'
  const east = preview?.faces.east
  const west = preview?.faces.west
  const top = preview?.faces.top
  const bottom = preview?.faces.bottom
  const south = preview?.faces.south
  const north = preview?.faces.north
  const eastTexture = usePreviewTexture(
    textured ? (east?.assetToken ?? null) : null,
    east?.rotation ?? 0
  )
  const westTexture = usePreviewTexture(
    textured ? (west?.assetToken ?? null) : null,
    west?.rotation ?? 0
  )
  const topTexture = usePreviewTexture(
    textured ? (top?.assetToken ?? null) : null,
    top?.rotation ?? 0
  )
  const bottomTexture = usePreviewTexture(
    textured ? (bottom?.assetToken ?? null) : null,
    bottom?.rotation ?? 0
  )
  const southTexture = usePreviewTexture(
    textured ? (south?.assetToken ?? null) : null,
    south?.rotation ?? 0
  )
  const northTexture = usePreviewTexture(
    textured ? (north?.assetToken ?? null) : null,
    north?.rotation ?? 0
  )
  const maps = [
    eastTexture,
    westTexture,
    topTexture,
    bottomTexture,
    southTexture,
    northTexture
  ] as const
  const color = materialColor(part.material)
  const translucent = /GLASS|ICE|SLIME|HONEY/.test(part.material)
  const emissive = /GLOWSTONE|SEA_LANTERN|SHROOMLIGHT|MAGMA/.test(part.material)
  const metalness =
    part.material.includes('IRON') || part.material.includes('COPPER')
      ? 0.38
      : 0.04

  return (
    <>
      {maps.map((map, index) => (
        <meshStandardMaterial
          // BoxGeometry group order: +X east, -X west, +Y top, -Y bottom,
          // +Z south, -Z north.
          key={index}
          attach={`material-${index}`}
          color={color}
          map={map}
          roughness={0.72}
          metalness={metalness}
          transparent={translucent}
          opacity={translucent ? 0.55 : 1}
          alphaTest={map === null ? 0 : 0.1}
          emissive={emissive ? color : '#000000'}
          emissiveIntensity={emissive ? 0.22 : 0}
        />
      ))}
    </>
  )
}

function CameraRig({
  model,
  selectedPartIds,
  command,
  controlsRef
}: {
  model: ModelDefinition
  selectedPartIds: readonly string[]
  command: CameraCommand
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}): null {
  const { camera, size } = useThree()

  // Only an explicit command nonce or a document load can place the camera.
  // Selection is intentionally read inside the callback and is not an effect
  // dependency, so Shift selection never changes the current view.
  useExplicitCameraEffect(camera, command.nonce, () => {
    const bounds =
      command.view === 'focus-selected' && selectedPartIds.length > 0
        ? computePartsBounds(model, selectedPartIds)
        : computePartsBounds(model)
    const center = bounds.getCenter(new Vector3())
    const dimensions = bounds.getSize(new Vector3())
    const radius = Math.max(dimensions.length() * 0.5, 0.8)
    const distance = Math.max(radius * 2.8, 3.5)
    const forwardSign = model['coordinate-system'].forward === 'positive-z' ? 1 : -1
    const position = new Vector3()

    switch (command.view) {
      case 'front':
        position.set(center.x, center.y, center.z + distance * forwardSign)
        break
      case 'rear':
        position.set(center.x, center.y, center.z - distance * forwardSign)
        break
      case 'left':
        position.set(center.x - distance, center.y, center.z)
        break
      case 'right':
        position.set(center.x + distance, center.y, center.z)
        break
      case 'top':
        position.set(center.x, center.y + distance, center.z)
        break
      case 'reset':
        center.set(0, 0, 0)
        position.set(7, 5, 8 * forwardSign)
        break
      case 'focus-model':
      case 'focus-selected': {
        const currentDirection = camera.position
          .clone()
          .sub(controlsRef.current?.target ?? center)
        if (currentDirection.lengthSq() < 0.001) {
          currentDirection.set(1, 0.7, forwardSign)
        }
        position.copy(center).add(currentDirection.normalize().multiplyScalar(distance))
        break
      }
      case 'perspective':
      default:
        position.set(
          center.x + distance * 0.72,
          center.y + distance * 0.5,
          center.z + distance * 0.82 * forwardSign
        )
    }

    camera.up.set(
      0,
      command.view === 'top' ? 0 : 1,
      command.view === 'top' ? -forwardSign : 0
    )
    camera.position.copy(position)
    camera.lookAt(center)

    if (camera instanceof ThreePerspectiveCamera) {
      camera.near = Math.max(0.01, distance / 1000)
      camera.far = Math.max(2000, distance * 100)
      camera.updateProjectionMatrix()
    } else if (camera instanceof ThreeOrthographicCamera) {
      camera.zoom = Math.max(
        8,
        Math.min(size.width, size.height) / Math.max(radius * 2.7, 1)
      )
      camera.near = -2000
      camera.far = 4000
      camera.updateProjectionMatrix()
    }
    if (controlsRef.current !== null) {
      controlsRef.current.target.copy(center)
      controlsRef.current.update()
    }
  })

  return null
}

function PartObject({
  part,
  selected,
  active,
  locked,
  showBounds,
  onSelect,
  registerObject
}: {
  part: ModelPart
  selected: boolean
  active: boolean
  locked: boolean
  showBounds: boolean
  onSelect: (additive: boolean) => void
  registerObject: (partId: string, object: Mesh | null) => void
}): React.JSX.Element {
  const ref = useCallback(
    (object: Mesh | null) => {
      registerObject(part.id, object)
    },
    [part.id, registerObject]
  )
  const rotation: [number, number, number] = [
    MathUtils.degToRad(part['rotation-degrees'].x),
    MathUtils.degToRad(part['rotation-degrees'].y),
    MathUtils.degToRad(part['rotation-degrees'].z)
  ]
  const edgeColor = active
    ? '#62e8ff'
    : selected
      ? '#9b86ff'
      : locked
        ? '#ffb454'
        : '#4e6378'

  return (
    <mesh
      ref={ref}
      name={part.id}
      position={[part.position.x, part.position.y, part.position.z]}
      rotation={rotation}
      scale={[part.scale.x, part.scale.y, part.scale.z]}
      castShadow
      receiveShadow
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        if (!isPartSelectionClick(event.delta)) return
        onSelect(event.shiftKey)
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        document.body.classList.add('viewport-hovering-part')
      }}
      onPointerOut={() => document.body.classList.remove('viewport-hovering-part')}
    >
      <boxGeometry args={[1, 1, 1]} />
      <PartMaterials part={part} />
      {(selected || showBounds || locked) && (
        <Edges
          threshold={15}
          color={edgeColor}
          lineWidth={active ? 2.4 : selected ? 1.8 : 1}
        />
      )}
    </mesh>
  )
}

const RESIZE_COLORS: Readonly<Record<ResizeAxis, string>> = {
  x: '#f47d85',
  y: '#71db98',
  z: '#68aafa'
}

const RESIZE_HANDLE_VISUAL_CSS_PIXELS = 12
const RESIZE_HANDLE_HIT_CSS_PIXELS = 38

function anchoredResizeNotice(
  skippedPartCount: number,
  uniformFallbackCount: number
): string | null {
  const messages: string[] = []
  if (skippedPartCount > 0) {
    messages.push(
      `Пропущено заблокированных или скрытых деталей: ${skippedPartCount}.`
    )
  }
  if (uniformFallbackCount > 0) {
    messages.push(
      `Для ${uniformFallbackCount} повёрнутых деталей применён равномерный TRS-масштаб без сдвига (shear).`
    )
  }
  return messages.length > 0 ? messages.join(' ') : null
}

function ResizeHandleTarget({
  handle,
  position,
  active,
  hovered,
  onPointerDown,
  onHoverChange
}: {
  handle: SignedResizeHandle
  position: Vector3
  active: boolean
  hovered: boolean
  onPointerDown(event: ThreeEvent<PointerEvent>): void
  onHoverChange(hovered: boolean): void
}): React.JSX.Element {
  const { camera, size } = useThree()
  const groupRef = useRef<Group>(null)
  const hitRef = useRef<Mesh>(null)
  const visualRef = useRef<Mesh>(null)
  const worldPosition = useRef(new Vector3())
  const key = `${handle.axis}:${handle.sign}`

  useFrame(() => {
    const group = groupRef.current
    const hit = hitRef.current
    const visual = visualRef.current
    if (group === null || hit === null || visual === null) return
    group.getWorldPosition(worldPosition.current)
    const hitSize = screenSpaceWorldSize(
      camera,
      worldPosition.current,
      size.height,
      RESIZE_HANDLE_HIT_CSS_PIXELS
    )
    const visualSize = screenSpaceWorldSize(
      camera,
      worldPosition.current,
      size.height,
      RESIZE_HANDLE_VISUAL_CSS_PIXELS
    )
    hit.scale.setScalar(hitSize)
    visual.scale.setScalar(visualSize)
    hit.updateMatrix()
    visual.updateMatrix()
  })

  return (
    <group ref={groupRef} position={position}>
      <mesh
        ref={hitRef}
        userData={{ resizeHandle: key }}
        onPointerDown={onPointerDown}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHoverChange(true)
        }}
        onPointerOut={() => onHoverChange(false)}
        onClick={(event) => event.stopPropagation()}
        renderOrder={30}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={RESIZE_COLORS[handle.axis]}
          transparent
          opacity={0}
          depthTest={false}
        />
      </mesh>
      <mesh ref={visualRef} renderOrder={31} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={active || hovered ? '#ffffff' : RESIZE_COLORS[handle.axis]}
          depthTest={false}
        />
      </mesh>
      <Html
        center
        zIndexRange={VIEWPORT_HTML_Z_INDEX_RANGE}
        style={{ pointerEvents: 'none' }}
      >
        <span className="resize-handle-label">
          {handle.sign > 0 ? '+' : '−'}
          {handle.axis.toLocaleUpperCase('en-US')}
        </span>
      </Html>
    </group>
  )
}

function AnchoredResizeGizmo({
  model,
  partIds,
  skippedPartCount,
  settings,
  documentEpoch,
  getObject,
  onDraggingChange,
  onResizeSettled
}: {
  model: ModelDefinition
  partIds: readonly string[]
  skippedPartCount: number
  settings: ViewportSettings
  documentEpoch: number
  getObject: (partId: string) => Object3D | null
  onDraggingChange: (dragging: boolean) => void
  onResizeSettled: () => void
}): React.JSX.Element | null {
  const { camera, gl } = useThree()
  const setEditorNotice = useDocumentStore((state) => state.setEditorNotice)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
  const selectionKey = partIds.join('\u0000')
  const traceEnabled = useMemo(() => resizeDebugTraceEnabled(), [])

  const initialFrame = useMemo(
    () => createModelResizeFrame(model, partIds),
    [model, partIds]
  )
  const { basis, transforms: initialTransforms } = initialFrame

  const initialBounds = useMemo(
    () => computeOrientedTransformBounds(initialTransforms, basis),
    [basis, initialTransforms]
  )
  const boundsIdentity = useMemo(
    () =>
      Object.entries(initialTransforms)
        .map(([partId, transform]) =>
          [
            partId,
            ...transform.position.toArray(),
            ...transform.quaternion.toArray(),
            ...transform.scale.toArray()
          ].join(':')
        )
        .join('\u0000'),
    [initialTransforms]
  )
  const [dragBounds, setDragBounds] = useState<{
    identity: string
    bounds: ReturnType<typeof initialBounds.clone>
  } | null>(null)
  const displayBounds =
    dragBounds?.identity === boundsIdentity ? dragBounds.bounds : initialBounds

  const publishNotice = useCallback(
    (message: string | null): void => {
      if (useDocumentStore.getState().editorNotice !== message) {
        setEditorNotice(message)
      }
    },
    [setEditorNotice]
  )
  const publishResizeNotice = useCallback(
    (uniformFallbackCount: number): void => {
      publishNotice(
        anchoredResizeNotice(skippedPartCount, uniformFallbackCount)
      )
    },
    [publishNotice, skippedPartCount]
  )

  const resetVisualState = useCallback((): void => {
    document.body.style.cursor = ''
    setActiveHandle(null)
    setHoveredHandle(null)
    setDragBounds(null)
  }, [])

  const session = useMemo(
    () =>
      createAnchoredResizeSession({
        partIds,
        getObject,
        beginTransaction: () => useDocumentStore.getState().beginTransaction(),
        commit: commitAnchoredResizeTransforms,
        endTransaction: () => useDocumentStore.getState().endTransaction(),
        onDraggingChange,
        ...(traceEnabled
          ? {
              trace: (entry) =>
                recordResizeDebugTrace('session', entry.phase, entry)
            }
          : {})
      }),
    // selectionKey is the ordered identity of the transient drag ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      documentEpoch,
      getObject,
      onDraggingChange,
      selectionKey,
      traceEnabled
    ]
  )

  const controller = useMemo(
    () =>
      createResizeInteractionController({
        session,
        eventSource: window,
        onUpdate: (result) => {
          setDragBounds({
            identity: boundsIdentity,
            bounds: result.bounds.clone()
          })
          const uniformFallbackCount = result.uniformFallbackPartIds.length
          publishResizeNotice(uniformFallbackCount)
        },
        onSettled: () => {
          resetVisualState()
          onResizeSettled()
        },
        ...(traceEnabled
          ? {
              onTrace: (entry) =>
                recordResizeDebugTrace('controller', entry.event, entry)
            }
          : {})
      }),
    [
      boundsIdentity,
      onResizeSettled,
      publishResizeNotice,
      resetVisualState,
      session,
      traceEnabled
    ]
  )

  useEffect(
    () => () => {
      controller.dispose()
      resetVisualState()
    },
    [boundsIdentity, controller, resetVisualState]
  )

  if (partIds.length === 0 || initialBounds.isEmpty()) return null

  const frameCenter = displayBounds.getCenter(new Vector3())
  const frameSize = displayBounds.getSize(new Vector3())
  const beginResize = (
    event: ThreeEvent<PointerEvent>,
    handle: SignedResizeHandle
  ): void => {
    if (event.button !== 0 || controller.state !== 'idle') return
    const handlePosition = orientedBoundsFaceCenter(
      displayBounds,
      basis,
      handle
    )
    const axisDirection = resizeAxisDirection(basis, handle.axis)
    const viewTowardCamera =
      camera instanceof ThreeOrthographicCamera
        ? camera.getWorldDirection(new Vector3()).negate()
        : event.ray.origin.clone().sub(handlePosition)
    const dragPlane = createAxisDragPlane(
      event.ray,
      handlePosition,
      axisDirection,
      viewTowardCamera
    )
    if (dragPlane === null) {
      publishNotice(
        'Ручка почти направлена вдоль взгляда. Поверните камеру и повторите изменение размера.'
      )
      return
    }
    const raycaster = new Raycaster()
    const projectPointer = (clientX: number, clientY: number): number | null => {
      const ndc = pointerNdcFromClient(
        clientX,
        clientY,
        gl.domElement.getBoundingClientRect()
      )
      if (ndc === null) return null
      raycaster.setFromCamera(ndc, camera)
      const point = raycaster.ray.intersectPlane(
        dragPlane.plane,
        new Vector3()
      )
      return point === null
        ? null
        : point.sub(dragPlane.startPoint).dot(axisDirection)
    }
    if (
      !controller.start({
        handle,
        basis,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        captureOwner: gl.domElement,
        projectPointer,
        constraints: {
          snap: settings.snapping ? settings.scaleSnap : null
        }
      })
    ) {
      return
    }
    event.stopPropagation()
    publishResizeNotice(0)
    const key = `${handle.axis}:${handle.sign}`
    setActiveHandle(key)
    document.body.style.cursor = 'grabbing'
  }

  return (
    <>
      <group quaternion={basis}>
        <mesh position={frameCenter} scale={frameSize} renderOrder={20}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#91a9c1"
            wireframe
            transparent
            opacity={0.64}
            depthTest={false}
          />
        </mesh>
      </group>
      {SIGNED_RESIZE_HANDLES.map((handle) => {
        const key = `${handle.axis}:${handle.sign}`
        const active = activeHandle === key
        const hovered = hoveredHandle === key
        const position = orientedBoundsFaceCenter(
          displayBounds,
          basis,
          handle
        )
        return (
          <ResizeHandleTarget
            key={key}
            handle={handle}
            position={position}
            active={active}
            hovered={hovered}
            onPointerDown={(event) => beginResize(event, handle)}
            onHoverChange={(nextHovered) => {
              if (controller.state !== 'idle') return
              setHoveredHandle(nextHovered ? key : null)
              document.body.style.cursor = nextHovered ? 'grab' : ''
            }}
          />
        )
      })}
    </>
  )
}

function SelectionTransformController({
  model,
  selectedPartIds,
  activePartId,
  settings,
  documentEpoch,
  meshVersion,
  getObject,
  onDraggingChange,
  onResizeSettled
}: {
  model: ModelDefinition
  selectedPartIds: readonly string[]
  activePartId: string | null
  settings: ViewportSettings
  documentEpoch: number
  meshVersion: number
  getObject: (partId: string) => Object3D | null
  onDraggingChange: (dragging: boolean) => void
  onResizeSettled: () => void
}): React.JSX.Element | null {
  const setEditorNotice = useDocumentStore((state) => state.setEditorNotice)
  const [pivot] = useState(() => new Object3D())
  const locked = useMemo(
    () => new Set(model.editor?.['locked-parts'] ?? []),
    [model.editor]
  )
  const hidden = useMemo(
    () => new Set(model.editor?.['hidden-parts'] ?? []),
    [model.editor]
  )
  const transformPartIds = useMemo(
    () =>
      selectedPartIds.filter(
        (partId) => !locked.has(partId) && !hidden.has(partId)
      ),
    [hidden, locked, selectedPartIds]
  )
  const selectionKey = transformPartIds.join('\u0000')
  const session = useMemo(
    () =>
      createGroupTransformSession({
        partIds: transformPartIds,
        pivot,
        getObject,
        eventSource: window,
        beginTransaction: () => useDocumentStore.getState().beginTransaction(),
        commit: commitGroupTransforms,
        endTransaction: () => useDocumentStore.getState().endTransaction(),
        onDraggingChange
      }),
    // selectionKey is an ordered, duplicate-free identity for this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentEpoch, getObject, onDraggingChange, pivot, selectionKey]
  )

  useEffect(
    () => () => {
      session.dispose()
    },
    [session, settings.transformMode]
  )

  useEffect(() => {
    if (session.dragging || transformPartIds.length === 0) return
    pivot.position.copy(
      groupPivotPosition(model, transformPartIds, activePartId, 'selection-center')
    )
    pivot.quaternion.identity()
    pivot.scale.set(1, 1, 1)
    pivot.updateMatrix()
    pivot.updateMatrixWorld(true)
  }, [
    activePartId,
    meshVersion,
    model,
    pivot,
    selectionKey,
    session,
    transformPartIds
  ])

  if (
    transformPartIds.length === 0 ||
    !transformPartIds.some((partId) => getObject(partId) !== null)
  ) {
    return null
  }

  if (settings.transformMode === 'scale') {
    return (
      <AnchoredResizeGizmo
        model={model}
        partIds={transformPartIds}
        skippedPartCount={selectedPartIds.length - transformPartIds.length}
        settings={settings}
        documentEpoch={documentEpoch}
        getObject={getObject}
        onDraggingChange={onDraggingChange}
        onResizeSettled={onResizeSettled}
      />
    )
  }

  return (
    <>
      <primitive object={pivot} visible={false} />
      <TransformControls
        object={pivot}
        mode={settings.transformMode}
        space="world"
        size={0.82}
        translationSnap={settings.snapping ? settings.translationSnap : null}
        rotationSnap={
          settings.snapping ? MathUtils.degToRad(settings.rotationSnap) : null
        }
        onMouseDown={() => {
          const skipped = selectedPartIds.length - transformPartIds.length
          setEditorNotice(
            skipped > 0
              ? `Пропущено заблокированных или скрытых деталей: ${skipped}.`
              : null
          )
          session.start()
        }}
        onObjectChange={() => session.update()}
        onMouseUp={() => session.finish()}
      />
    </>
  )
}

function Scene({
  model,
  selectedPartIds,
  activePartId,
  settings,
  command,
  onResizeSettled
}: {
  model: ModelDefinition
  selectedPartIds: readonly string[]
  activePartId: string | null
  settings: ViewportSettings
  command: CameraCommand
  onResizeSettled: () => void
}): React.JSX.Element {
  const selectPart = useDocumentStore((state) => state.selectPart)
  const documentEpoch = useDocumentStore((state) => state.documentEpoch)
  const [dragging, setDragging] = useState(false)
  const [meshVersion, setMeshVersion] = useState(0)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const meshObjects = useRef(new Map<string, Mesh>())
  const selected = useMemo(() => new Set(selectedPartIds), [selectedPartIds])
  const hidden = useMemo(
    () => new Set(model.editor?.['hidden-parts'] ?? []),
    [model.editor]
  )
  const locked = useMemo(
    () => new Set(model.editor?.['locked-parts'] ?? []),
    [model.editor]
  )
  const forwardSign = model['coordinate-system'].forward === 'positive-z' ? 1 : -1

  const setTransformDragging = useCallback((nextDragging: boolean): void => {
    // Sole gizmo → OrbitControls ownership path. Selection/mount never toggles
    // Orbit; only an actual pointer drag does.
    if (controlsRef.current !== null) {
      controlsRef.current.enabled = orbitControlsEnabled(nextDragging)
    }
    setDragging(nextDragging)
  }, [])

  const registerObject = useCallback((partId: string, object: Mesh | null): void => {
    const current = meshObjects.current.get(partId) ?? null
    if (current === object) return
    if (object === null) meshObjects.current.delete(partId)
    else meshObjects.current.set(partId, object)
    setMeshVersion((version) => version + 1)
  }, [])

  const getObject = useCallback(
    (partId: string): Object3D | null => meshObjects.current.get(partId) ?? null,
    []
  )

  return (
    <>
      <color attach="background" args={['#11161d']} />
      <fog attach="fog" args={['#11161d', 28, 110]} />
      <PerspectiveCamera
        makeDefault={settings.cameraType === 'perspective'}
        position={DEFAULT_CAMERA_POSITION}
        fov={43}
        near={0.01}
        far={2000}
      />
      <OrthographicCamera
        makeDefault={settings.cameraType === 'orthographic'}
        position={DEFAULT_CAMERA_POSITION}
        zoom={70}
        near={-2000}
        far={4000}
      />
      <CameraRig
        model={model}
        selectedPartIds={selectedPartIds}
        command={command}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        enabled={orbitControlsEnabled(dragging)}
        enableDamping={false}
        minDistance={0.2}
        maxDistance={400}
        zoomToCursor
        screenSpacePanning
        mouseButtons={ORBIT_MOUSE_BUTTONS}
      />
      <ambientLight intensity={1.25} />
      <hemisphereLight args={['#d5eaff', '#202631', 1.35]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {settings.showGrid && (
        <Grid
          args={[200, 200]}
          cellSize={1}
          cellThickness={0.55}
          cellColor="#34404e"
          sectionSize={5}
          sectionThickness={1.15}
          sectionColor="#55697f"
          fadeDistance={90}
          fadeStrength={1.8}
          infiniteGrid
        />
      )}
      {settings.showAxes && (
        <>
          <axesHelper args={[3.5]} />
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[0.075, 20, 12]} />
            <meshBasicMaterial color="#f4f7fb" />
          </mesh>
        </>
      )}

      <arrowHelper
        args={[
          new Vector3(0, 0, forwardSign),
          new Vector3(0, 0.04, 0),
          2.4,
          0x42d991,
          0.48,
          0.25
        ]}
      />
      <Html
        position={[0, 0.12, forwardSign * 2.75]}
        center
        transform
        distanceFactor={8}
        zIndexRange={VIEWPORT_HTML_Z_INDEX_RANGE}
      >
        <span className="forward-label">
          ВПЕРЁД {forwardSign > 0 ? '+Z' : '−Z'}
        </span>
      </Html>

      {settings.showHitbox && model.interaction !== undefined && (
        <mesh
          position={[
            model.interaction.offset.x,
            model.interaction.offset.y + model.interaction.height / 2,
            model.interaction.offset.z
          ]}
          scale={[
            model.interaction.width,
            model.interaction.height,
            model.interaction.width
          ]}
          renderOrder={10}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#d9a441"
            wireframe
            transparent
            opacity={0.55}
            depthTest={false}
          />
        </mesh>
      )}

      {model.parts.map((part) =>
        hidden.has(part.id) ? null : (
          <PartObject
            key={part.id}
            part={part}
            selected={selected.has(part.id)}
            active={activePartId === part.id}
            locked={locked.has(part.id)}
            showBounds={settings.showBounds}
            onSelect={(additive) => selectPart(part.id, additive)}
            registerObject={registerObject}
          />
        )
      )}

      <SelectionTransformController
        model={model}
        selectedPartIds={selectedPartIds}
        activePartId={activePartId}
        settings={settings}
        documentEpoch={documentEpoch}
        meshVersion={meshVersion}
        getObject={getObject}
        onDraggingChange={setTransformDragging}
        onResizeSettled={onResizeSettled}
      />
    </>
  )
}

export function Viewport({
  model,
  selectedPartIds,
  activePartId,
  settings,
  command,
  onCommand
}: {
  model: ModelDefinition
  selectedPartIds: readonly string[]
  activePartId: string | null
  settings: ViewportSettings
  command: CameraCommand
  onCommand: (view: CameraCommand['view']) => void
}): React.JSX.Element {
  const clearSelection = useDocumentStore((state) => state.clearSelection)
  const resizeTrailingClickGate = useRef(createResizeTrailingClickGate())
  const markResizeSettled = useCallback((): void => {
    resizeTrailingClickGate.current.markResizeSettled()
  }, [])
  const forward = model['coordinate-system'].forward === 'positive-z' ? '+Z' : '−Z'
  const cameraLabel =
    settings.cameraType === 'perspective' ? 'Перспектива' : 'Ортографическая'

  return (
    <main className="viewport-panel" aria-label="Трёхмерная сцена">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerDownCapture={() => {
          resizeTrailingClickGate.current.clearBeforePointerDown()
        }}
        onPointerMissed={(event) => {
          if (resizeTrailingClickGate.current.consumePointerMissed()) return
          if (
            shouldClearSelectionOnPointerMissed(
              event.button,
              event.shiftKey
            )
          ) {
            clearSelection()
          }
        }}
      >
        <Scene
          model={model}
          selectedPartIds={selectedPartIds}
          activePartId={activePartId}
          settings={settings}
          command={command}
          onResizeSettled={markResizeSettled}
        />
      </Canvas>
      <div className="viewport-overlay top-left" aria-hidden="true">
        <div className="axis-legend">
          <span className="axis-x">X</span>
          <span className="axis-y">Y</span>
          <span className="axis-z">Z</span>
        </div>
        <div>
          <strong>{cameraLabel}</strong>
          <small>Вперёд {forward} · Euler XYZ</small>
        </div>
      </div>
      <div className="viewport-overlay top-right">
        <button
          type="button"
          onClick={() => onCommand('focus-selected')}
          disabled={selectedPartIds.length === 0}
        >
          Выбранное
        </button>
        <button type="button" onClick={() => onCommand('focus-model')}>
          Вся модель
        </button>
        <button type="button" onClick={() => onCommand('reset')}>
          Сброс
        </button>
      </div>
      <div className="viewport-help">
        <span><kbd>ЛКМ</kbd> выбрать</span>
        <span><kbd>Shift+ЛКМ</kbd> добавить</span>
        <span><kbd>ЛКМ</kbd> вращать</span>
        <span><kbd>ПКМ</kbd> панорама</span>
        <span><kbd>Колесо</kbd> масштаб</span>
      </div>
    </main>
  )
}
