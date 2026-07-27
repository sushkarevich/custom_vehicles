import {
  Box3,
  Euler,
  MathUtils,
  Plane,
  Quaternion,
  Vector3,
  type Object3D,
  type Ray
} from 'three'
import {
  isModelDefinition,
  type ModelDefinition,
  type ModelPart
} from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import { updateParts } from '../store/operations'
import {
  captureSceneTransform,
  type SceneTransformSnapshot
} from './transform-drag'

export const MIN_PART_SCALE = 0.0001
export const MAX_PART_SCALE = 64
export const MIN_AXIS_DRAG_PLANE_ALIGNMENT = 0.001

export type ResizeAxis = 'x' | 'y' | 'z'
export type ResizeSign = -1 | 1

export interface SignedResizeHandle {
  axis: ResizeAxis
  sign: ResizeSign
}

export const SIGNED_RESIZE_HANDLES: readonly SignedResizeHandle[] = [
  { axis: 'x', sign: -1 },
  { axis: 'x', sign: 1 },
  { axis: 'y', sign: -1 },
  { axis: 'y', sign: 1 },
  { axis: 'z', sign: -1 },
  { axis: 'z', sign: 1 }
]

export interface ResizeConstraints {
  minScale?: number
  maxScale?: number
  snap?: number | null
}

export interface ResizeTransformMap {
  [partId: string]: SceneTransformSnapshot
}

export interface ModelResizeFrame {
  transforms: ResizeTransformMap
  basis: Quaternion
}

export interface AxisDragPlane {
  plane: Plane
  startPoint: Vector3
}

export interface SelectionResizeResult {
  transforms: ResizeTransformMap
  initialBounds: Box3
  bounds: Box3
  basis: Quaternion
  axisDirection: Vector3
  anchorCoordinate: number
  movedCoordinate: number
  extent: number
  scaleFactor: number
  /**
   * A shared non-uniform scale shears a box whose local axes do not align
   * with the grabbed group axis. YAML cannot represent shear, so those parts
   * use a uniform local scale factor. This preserves their shape, keeps every
   * scale positive, and makes their projected support along the grabbed axis
   * scale by the exact same factor as the selection.
   */
  uniformFallbackPartIds: string[]
}

interface NormalizedResizeConstraints {
  minScale: number
  maxScale: number
  snap: number | null
}

export interface AnchoredResizeStart {
  handle: SignedResizeHandle
  /**
   * Orientation of the resize bounds in model space. Use the selected part's
   * quaternion for a single part and identity for model-axis group bounds.
   */
  basis: Quaternion
  pointerId?: number
  sessionId?: number
  constraints?: ResizeConstraints
}

export interface AnchoredResizeSession {
  readonly dragging: boolean
  readonly result: SelectionResizeResult | null
  start(request: AnchoredResizeStart): boolean
  /**
   * Distance from the original pointer-down point, measured along the
   * positive axis direction. It is not an incremental delta.
   */
  update(projectedDistance: number): SelectionResizeResult | null
  finish(): boolean
  cancel(): boolean
  dispose(): void
}

export interface AnchoredResizeTraceEntry {
  sessionId: number | null
  phase:
    | 'start'
    | 'update'
    | 'commit-before'
    | 'commit-applied'
    | 'commit-complete'
    | 'post-frame-1'
    | 'post-frame-2'
    | 'cancel-before'
    | 'cancel-complete'
  calculatedTransforms: Record<
    string,
    {
      position: number[]
      quaternion: number[]
      scale: number[]
    }
  > | null
  storeTransforms: Record<
    string,
    {
      position: [number, number, number]
      rotationDegrees: [number, number, number]
      scale: [number, number, number]
    }
  > | null
  liveObjects: Record<
    string,
    {
      position: number[]
      quaternion: number[]
      scale: number[]
      matrix: number[]
      matrixWorld: number[]
      matrixWorldNeedsUpdate: boolean
      matrixAutoUpdate: boolean
      parent: {
        position: number[]
        quaternion: number[]
        scale: number[]
        matrix: number[]
        matrixWorld: number[]
        matrixWorldNeedsUpdate: boolean
        matrixAutoUpdate: boolean
      } | null
    }
  >
}

const AXIS_INDEX: Record<ResizeAxis, 0 | 1 | 2> = {
  x: 0,
  y: 1,
  z: 2
}

const LOCAL_AXES = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1)
] as const

function finiteVector(vector: Vector3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  )
}

export function modelPartResizeTransform(
  part: ModelPart
): SceneTransformSnapshot {
  return {
    position: new Vector3(part.position.x, part.position.y, part.position.z),
    quaternion: new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(part['rotation-degrees'].x),
        MathUtils.degToRad(part['rotation-degrees'].y),
        MathUtils.degToRad(part['rotation-degrees'].z),
        'XYZ'
      )
    ),
    scale: new Vector3(part.scale.x, part.scale.y, part.scale.z)
  }
}

/**
 * Produces the declarative frame used to render an idle resize gizmo.
 *
 * This deliberately reads the model rather than mounted Object3D refs. During
 * a React Three Fiber render those refs still contain the previous committed
 * host props, so using them here would leave handles one model revision behind
 * after inspector edits or Undo/Redo. The drag session still snapshots the
 * live Object3D instances at pointer-down.
 */
export function createModelResizeFrame(
  model: ModelDefinition,
  partIds: readonly string[]
): ModelResizeFrame {
  const parts = new Map(model.parts.map((part) => [part.id, part]))
  const transforms: ResizeTransformMap = {}
  partIds.forEach((partId) => {
    const part = parts.get(partId)
    if (part !== undefined) {
      transforms[partId] = modelPartResizeTransform(part)
    }
  })
  const selectedPart =
    partIds.length === 1 && partIds[0] !== undefined
      ? parts.get(partIds[0])
      : undefined
  return {
    transforms,
    basis:
      selectedPart === undefined
        ? new Quaternion()
        : modelPartResizeTransform(selectedPart).quaternion
  }
}

/**
 * Constructs a plane that contains the resize axis and faces the camera.
 *
 * `viewTowardCamera` is the point-to-eye vector for perspective cameras and
 * the negated world view direction for orthographic cameras. Nearly parallel
 * ray/plane configurations are rejected instead of starting an ill-conditioned
 * drag that would jump or stop updating.
 */
export function createAxisDragPlane(
  ray: Ray,
  interactionPoint: Vector3,
  axisDirection: Vector3,
  viewTowardCamera: Vector3,
  minimumAlignment = MIN_AXIS_DRAG_PLANE_ALIGNMENT
): AxisDragPlane | null {
  if (
    !finiteVector(interactionPoint) ||
    !finiteVector(axisDirection) ||
    !finiteVector(viewTowardCamera) ||
    axisDirection.lengthSq() < 1e-12 ||
    viewTowardCamera.lengthSq() < 1e-12
  ) {
    return null
  }

  const axis = axisDirection.clone().normalize()
  const planeNormal = viewTowardCamera
    .clone()
    .addScaledVector(axis, -viewTowardCamera.dot(axis))
  if (!finiteVector(planeNormal) || planeNormal.lengthSq() < 1e-12) return null
  planeNormal.normalize()

  const alignmentThreshold =
    Number.isFinite(minimumAlignment) && minimumAlignment > 0
      ? minimumAlignment
      : MIN_AXIS_DRAG_PLANE_ALIGNMENT
  if (Math.abs(ray.direction.dot(planeNormal)) < alignmentThreshold) return null

  const plane = new Plane().setFromNormalAndCoplanarPoint(
    planeNormal,
    interactionPoint
  )
  const startPoint = ray.intersectPlane(plane, new Vector3())
  return startPoint !== null && finiteVector(startPoint)
    ? { plane, startPoint }
    : null
}

function axisIndex(axis: ResizeAxis): 0 | 1 | 2 {
  return AXIS_INDEX[axis]
}

function axisVector(axis: ResizeAxis): Vector3 {
  return LOCAL_AXES[axisIndex(axis)].clone()
}

export function resizeAxisDirection(
  basis: Quaternion,
  axis: ResizeAxis
): Vector3 {
  return axisVector(axis).applyQuaternion(basis).normalize()
}

function component(vector: Vector3, index: 0 | 1 | 2): number {
  return vector.getComponent(index)
}

function setComponent(
  vector: Vector3,
  index: 0 | 1 | 2,
  value: number
): void {
  vector.setComponent(index, value)
}

function normalizedConstraints(
  constraints: ResizeConstraints = {}
): NormalizedResizeConstraints {
  const requestedMinimum = constraints.minScale ?? MIN_PART_SCALE
  const requestedMaximum = constraints.maxScale ?? MAX_PART_SCALE
  const minScale =
    Number.isFinite(requestedMinimum) && requestedMinimum > 0
      ? requestedMinimum
      : MIN_PART_SCALE
  const maxScale =
    Number.isFinite(requestedMaximum) && requestedMaximum >= minScale
      ? requestedMaximum
      : Math.max(MAX_PART_SCALE, minScale)
  const snap =
    constraints.snap !== null &&
    constraints.snap !== undefined &&
    Number.isFinite(constraints.snap) &&
    constraints.snap > 0
      ? constraints.snap
      : null
  return { minScale, maxScale, snap }
}

function snappedClamp(
  value: number,
  minimum: number,
  maximum: number,
  snap: number | null
): number {
  const finiteValue = Number.isFinite(value) ? value : minimum
  const snapped =
    snap === null ? finiteValue : Math.round(finiteValue / snap) * snap
  return Math.min(maximum, Math.max(minimum, snapped))
}

function cloneTransform(
  transform: SceneTransformSnapshot
): SceneTransformSnapshot {
  return {
    position: transform.position.clone(),
    quaternion: transform.quaternion.clone(),
    scale: transform.scale.clone()
  }
}

function cloneTransformMap(
  transforms: Readonly<ResizeTransformMap>
): ResizeTransformMap {
  return Object.fromEntries(
    Object.entries(transforms).map(([partId, transform]) => [
      partId,
      cloneTransform(transform)
    ])
  )
}

function applyTransform(
  object: Object3D,
  transform: SceneTransformSnapshot
): void {
  object.position.copy(transform.position)
  object.quaternion.copy(transform.quaternion)
  object.scale.copy(transform.scale)
  object.updateMatrix()
  object.updateMatrixWorld(true)
}

export function faceCenter(
  transform: SceneTransformSnapshot,
  handle: SignedResizeHandle
): Vector3 {
  const index = axisIndex(handle.axis)
  const direction = resizeAxisDirection(transform.quaternion, handle.axis)
  return transform.position
    .clone()
    .addScaledVector(
      direction,
      handle.sign * component(transform.scale, index) * 0.5
    )
}

/**
 * Converts the center of a signed oriented-bound face back to model space.
 * This is the placement point for the corresponding custom gizmo handle.
 */
export function orientedBoundsFaceCenter(
  bounds: Box3,
  basis: Quaternion,
  handle: SignedResizeHandle
): Vector3 {
  if (bounds.isEmpty()) {
    throw new Error('A resize handle requires non-empty bounds')
  }
  const index = axisIndex(handle.axis)
  const center = bounds.getCenter(new Vector3())
  setComponent(
    center,
    index,
    handle.sign > 0
      ? component(bounds.max, index)
      : component(bounds.min, index)
  )
  return center.applyQuaternion(basis)
}

/**
 * Resizes one centered unit-box from a signed local face.
 *
 * The opposite face is the anchor. The quaternion and the two unaffected
 * scale components remain byte-for-byte equivalent in numeric value; only
 * center and the grabbed local dimension change.
 */
export function resizeTransformFromFace(
  initial: SceneTransformSnapshot,
  handle: SignedResizeHandle,
  projectedDistance: number,
  constraints: ResizeConstraints = {}
): SceneTransformSnapshot {
  const index = axisIndex(handle.axis)
  const limits = normalizedConstraints(constraints)
  const initialSize = component(initial.scale, index)
  const rawSize =
    initialSize +
    handle.sign * (Number.isFinite(projectedDistance) ? projectedDistance : 0)
  const newSize = snappedClamp(
    rawSize,
    limits.minScale,
    limits.maxScale,
    limits.snap
  )
  const direction = resizeAxisDirection(initial.quaternion, handle.axis)
  const result = cloneTransform(initial)
  result.position.addScaledVector(
    direction,
    handle.sign * (newSize - initialSize) * 0.5
  )
  setComponent(result.scale, index, newSize)
  return result
}

/**
 * Computes an AABB in an arbitrary orthonormal selection frame. The returned
 * Box3 coordinates are in `basis^-1` space, not model space.
 */
export function computeOrientedTransformBounds(
  transforms: Readonly<ResizeTransformMap>,
  basis = new Quaternion()
): Box3 {
  const bounds = new Box3()
  const inverseBasis = basis.clone().normalize().invert()
  Object.values(transforms).forEach((transform) => {
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          bounds.expandByPoint(
            new Vector3(
              x * transform.scale.x,
              y * transform.scale.y,
              z * transform.scale.z
            )
              .applyQuaternion(transform.quaternion)
              .add(transform.position)
              .applyQuaternion(inverseBasis)
          )
        }
      }
    }
  })
  return bounds
}

function alignedLocalAxis(
  transform: SceneTransformSnapshot,
  groupAxis: Vector3
): 0 | 1 | 2 | null {
  for (const index of [0, 1, 2] as const) {
    const localDirection = LOCAL_AXES[index]
      .clone()
      .applyQuaternion(transform.quaternion)
      .normalize()
    if (Math.abs(localDirection.dot(groupAxis)) >= 1 - 1e-10) return index
  }
  return null
}

function correctedAnchor(
  transforms: ResizeTransformMap,
  basis: Quaternion,
  handle: SignedResizeHandle,
  expectedAnchor: number
): Box3 {
  const index = axisIndex(handle.axis)
  const bounds = computeOrientedTransformBounds(transforms, basis)
  const actualAnchor =
    handle.sign > 0
      ? component(bounds.min, index)
      : component(bounds.max, index)
  const correction = expectedAnchor - actualAnchor
  if (Math.abs(correction) <= Number.EPSILON) return bounds

  const direction = resizeAxisDirection(basis, handle.axis)
  Object.values(transforms).forEach((transform) => {
    transform.position.addScaledVector(direction, correction)
  })
  return computeOrientedTransformBounds(transforms, basis)
}

/**
 * Resizes the combined oriented bounds from a signed end handle.
 *
 * Exact TRS policy:
 * - centers scale along the grabbed selection-frame axis about the fixed
 *   opposite bound;
 * - if that axis aligns with a part-local axis, only that local dimension is
 *   scaled;
 * - otherwise a non-uniform shared-frame scale would create shear, which the
 *   YAML TRS schema cannot store. The part is uniformly scaled instead. Its
 *   projected half-extent along the grabbed axis still changes by the exact
 *   group factor, so both combined end faces remain exact.
 *
 * The fallback IDs are returned so the UI can disclose this representable
 * behavior instead of silently pretending that shear was serialized.
 */
export function resizeSelectionFromFace(
  initial: Readonly<ResizeTransformMap>,
  basis: Quaternion,
  handle: SignedResizeHandle,
  projectedDistance: number,
  constraints: ResizeConstraints = {}
): SelectionResizeResult {
  const ids = Object.keys(initial)
  if (ids.length === 0) {
    throw new Error('Anchored resize requires at least one transform')
  }

  const normalizedBasis = basis.clone().normalize()
  const index = axisIndex(handle.axis)
  const initialBounds = computeOrientedTransformBounds(initial, normalizedBasis)
  const initialMinimum = component(initialBounds.min, index)
  const initialMaximum = component(initialBounds.max, index)
  const initialExtent = initialMaximum - initialMinimum
  if (!(initialExtent > 0) || !Number.isFinite(initialExtent)) {
    throw new Error('Anchored resize requires a positive selection extent')
  }

  const anchorCoordinate =
    handle.sign > 0 ? initialMinimum : initialMaximum
  const groupAxis = resizeAxisDirection(normalizedBasis, handle.axis)
  const limits = normalizedConstraints(constraints)
  const policies = new Map<
    string,
    { affectedAxes: readonly (0 | 1 | 2)[]; uniformFallback: boolean }
  >()
  const uniformFallbackPartIds: string[] = []
  let minimumFactor = 0
  let maximumFactor = Number.POSITIVE_INFINITY

  ids.forEach((partId) => {
    const transform = initial[partId]
    if (transform === undefined) return
    const aligned = alignedLocalAxis(transform, groupAxis)
    const uniformFallback = aligned === null
    const affectedAxes: readonly (0 | 1 | 2)[] =
      aligned === null ? [0, 1, 2] : [aligned]
    policies.set(partId, { affectedAxes, uniformFallback })
    if (uniformFallback) uniformFallbackPartIds.push(partId)
    affectedAxes.forEach((affectedAxis) => {
      const initialScale = component(transform.scale, affectedAxis)
      if (!(initialScale > 0) || !Number.isFinite(initialScale)) {
        throw new Error(`Part ${partId} has an invalid scale`)
      }
      minimumFactor = Math.max(
        minimumFactor,
        limits.minScale / initialScale
      )
      maximumFactor = Math.min(
        maximumFactor,
        limits.maxScale / initialScale
      )
    })
  })

  if (minimumFactor > maximumFactor) {
    throw new Error('Resize constraints cannot preserve positive part scales')
  }

  const rawExtent =
    initialExtent +
    handle.sign * (Number.isFinite(projectedDistance) ? projectedDistance : 0)
  const nextExtent = snappedClamp(
    rawExtent,
    initialExtent * minimumFactor,
    initialExtent * maximumFactor,
    limits.snap
  )
  const scaleFactor = nextExtent / initialExtent
  const inverseBasis = normalizedBasis.clone().invert()
  const transforms: ResizeTransformMap = {}

  ids.forEach((partId) => {
    const initialTransform = initial[partId]
    const policy = policies.get(partId)
    if (initialTransform === undefined || policy === undefined) return
    const transform = cloneTransform(initialTransform)
    const framePosition = transform.position
      .clone()
      .applyQuaternion(inverseBasis)
    const initialCoordinate = component(framePosition, index)
    const nextCoordinate =
      anchorCoordinate +
      scaleFactor * (initialCoordinate - anchorCoordinate)
    transform.position.addScaledVector(
      groupAxis,
      nextCoordinate - initialCoordinate
    )
    policy.affectedAxes.forEach((affectedAxis) => {
      setComponent(
        transform.scale,
        affectedAxis,
        component(transform.scale, affectedAxis) * scaleFactor
      )
    })
    transforms[partId] = transform
  })

  const bounds = correctedAnchor(
    transforms,
    normalizedBasis,
    handle,
    anchorCoordinate
  )
  const minimum = component(bounds.min, index)
  const maximum = component(bounds.max, index)

  return {
    transforms,
    initialBounds,
    bounds,
    basis: normalizedBasis,
    axisDirection: groupAxis,
    anchorCoordinate,
    movedCoordinate: handle.sign > 0 ? maximum : minimum,
    extent: maximum - minimum,
    scaleFactor,
    uniformFallbackPartIds
  }
}

/**
 * Store bridge used by AnchoredResizeSession. It performs exactly one model
 * update inside the already-open drag transaction. Resize never changes a
 * quaternion, so preserving the original rotation-degrees avoids Euler
 * round-trip drift and keeps resize history limited to position/scale.
 */
export function commitAnchoredResizeTransforms(
  transforms: Readonly<ResizeTransformMap>
): void {
  const partIds = Object.keys(transforms)
  if (partIds.length === 0) return
  useDocumentStore.getState().update((document) => {
    if (!isModelDefinition(document)) return document
    return updateParts(document, partIds, (part) => {
      const transform = transforms[part.id]
      if (transform === undefined) return
      part.position = {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z
      }
      part.scale = {
        x: Math.min(
          MAX_PART_SCALE,
          Math.max(MIN_PART_SCALE, transform.scale.x)
        ),
        y: Math.min(
          MAX_PART_SCALE,
          Math.max(MIN_PART_SCALE, transform.scale.y)
        ),
        z: Math.min(
          MAX_PART_SCALE,
          Math.max(MIN_PART_SCALE, transform.scale.z)
        )
      }
    })
  })
}

/**
 * Model-transform transaction used by the authoritative pointer controller.
 * This layer deliberately does not install DOM listeners or own pointer
 * capture: `createResizeInteractionController` is the sole owner of the
 * gesture lifecycle. Keeping this class limited to scene snapshots and one
 * history transaction prevents duplicate finish/cancel paths.
 */
export function createAnchoredResizeSession(options: {
  partIds: readonly string[]
  getObject(partId: string): Object3D | null
  beginTransaction(): void
  commit(transforms: ResizeTransformMap): void
  endTransaction(): void
  onDraggingChange(dragging: boolean): void
  onSettled?(): void
  trace?(entry: AnchoredResizeTraceEntry): void
}): AnchoredResizeSession {
  let dragging = false
  let activeObjects = new Map<string, Object3D>()
  let initialTransforms: ResizeTransformMap = {}
  let request: AnchoredResizeStart | null = null
  let latestResult: SelectionResizeResult | null = null

  const traceTransforms = (
    transforms: Readonly<ResizeTransformMap> | null
  ): AnchoredResizeTraceEntry['calculatedTransforms'] =>
    transforms === null
      ? null
      : Object.fromEntries(
          Object.entries(transforms).map(([partId, transform]) => [
            partId,
            {
              position: transform.position.toArray(),
              quaternion: transform.quaternion.toArray(),
              scale: transform.scale.toArray()
            }
          ])
        )

  const traceObject = (
    object: Object3D
  ): AnchoredResizeTraceEntry['liveObjects'][string] => {
    const parent = object.parent
    return {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      matrix: object.matrix.toArray(),
      matrixWorld: object.matrixWorld.toArray(),
      matrixWorldNeedsUpdate: object.matrixWorldNeedsUpdate,
      matrixAutoUpdate: object.matrixAutoUpdate,
      parent:
        parent === null
          ? null
          : {
              position: parent.position.toArray(),
              quaternion: parent.quaternion.toArray(),
              scale: parent.scale.toArray(),
              matrix: parent.matrix.toArray(),
              matrixWorld: parent.matrixWorld.toArray(),
              matrixWorldNeedsUpdate: parent.matrixWorldNeedsUpdate,
              matrixAutoUpdate: parent.matrixAutoUpdate
            }
    }
  }

  const trace = (
    phase: AnchoredResizeTraceEntry['phase'],
    transforms: Readonly<ResizeTransformMap> | null,
    objects: ReadonlyMap<string, Object3D> = activeObjects,
    sessionId: number | null = request?.sessionId ?? null
  ): void => {
    if (options.trace === undefined) return
    const document = useDocumentStore.getState().history.present
    const storeTransforms =
      (phase === 'commit-complete' ||
        phase === 'post-frame-1' ||
        phase === 'post-frame-2') &&
      isModelDefinition(document)
        ? Object.fromEntries(
            document.parts
              .filter((part) => objects.has(part.id))
              .map((part) => [
                part.id,
                {
                  position: [
                    part.position.x,
                    part.position.y,
                    part.position.z
                  ] as [number, number, number],
                  rotationDegrees: [
                    part['rotation-degrees'].x,
                    part['rotation-degrees'].y,
                    part['rotation-degrees'].z
                  ] as [number, number, number],
                  scale: [
                    part.scale.x,
                    part.scale.y,
                    part.scale.z
                  ] as [number, number, number]
                }
              ])
          )
        : null
    options.trace({
      sessionId,
      phase,
      calculatedTransforms: traceTransforms(transforms),
      storeTransforms,
      liveObjects: Object.fromEntries(
        [...objects].map(([partId, object]) => [
          partId,
          traceObject(object)
        ])
      )
    })
  }

  const restoreObjects = (): void => {
    activeObjects.forEach((object, partId) => {
      const transform = initialTransforms[partId]
      if (transform !== undefined) applyTransform(object, transform)
    })
  }

  const settle = (shouldCommit: boolean): boolean => {
    if (!dragging) return false
    dragging = false
    try {
      if (shouldCommit) {
        // The resize calculation is authoritative. R3F may reconcile the
        // declarative, pre-commit model props between the last physical
        // pointermove and pointerup, so never reconstruct the commit from the
        // mutable scene objects. Reapply and commit the exact same calculated
        // snapshot synchronously; no render/matrix propagation is required.
        const transforms = cloneTransformMap(
          latestResult?.transforms ?? initialTransforms
        )
        trace('commit-before', transforms)
        activeObjects.forEach((object, partId) => {
          const transform = transforms[partId]
          if (transform !== undefined) applyTransform(object, transform)
        })
        trace('commit-applied', transforms)
        options.commit(transforms)
        trace('commit-complete', transforms)
        if (options.trace !== undefined) {
          const settledObjects = new Map(activeObjects)
          const settledSessionId = request?.sessionId ?? null
          requestAnimationFrame(() => {
            trace(
              'post-frame-1',
              transforms,
              settledObjects,
              settledSessionId
            )
            requestAnimationFrame(() => {
              trace(
                'post-frame-2',
                transforms,
                settledObjects,
                settledSessionId
              )
            })
          })
        }
      } else {
        trace('cancel-before', latestResult?.transforms ?? null)
        restoreObjects()
        trace('cancel-complete', initialTransforms)
      }
    } finally {
      activeObjects = new Map()
      initialTransforms = {}
      request = null
      latestResult = null
      try {
        options.endTransaction()
      } finally {
        try {
          options.onDraggingChange(false)
        } finally {
          options.onSettled?.()
        }
      }
    }
    return true
  }

  const finish = (): boolean => settle(true)
  const cancel = (): boolean => settle(false)

  return {
    get dragging() {
      return dragging
    },
    get result() {
      return latestResult
    },
    start(nextRequest) {
      if (dragging) return false
      const objects = new Map<string, Object3D>()
      const transforms: ResizeTransformMap = {}
      options.partIds.forEach((partId) => {
        const object = options.getObject(partId)
        if (object === null) return
        objects.set(partId, object)
        transforms[partId] = captureSceneTransform(object)
      })
      if (objects.size === 0) return false

      options.beginTransaction()
      activeObjects = objects
      initialTransforms = transforms
      request = {
        ...nextRequest,
        basis: nextRequest.basis.clone().normalize()
      }
      latestResult = null
      dragging = true
      options.onDraggingChange(true)
      trace('start', initialTransforms)
      return true
    },
    update(projectedDistance) {
      if (!dragging || request === null) return null
      const result = resizeSelectionFromFace(
        initialTransforms,
        request.basis,
        request.handle,
        projectedDistance,
        request.constraints
      )
      activeObjects.forEach((object, partId) => {
        const transform = result.transforms[partId]
        if (transform !== undefined) applyTransform(object, transform)
      })
      latestResult = result
      trace('update', result.transforms)
      return result
    },
    finish,
    cancel,
    dispose() {
      cancel()
    }
  }
}
