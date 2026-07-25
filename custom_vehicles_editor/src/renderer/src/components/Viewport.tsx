import { useRef, useState } from 'react'
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber'
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
  Box3,
  Euler,
  MathUtils,
  OrthographicCamera as ThreeOrthographicCamera,
  PerspectiveCamera as ThreePerspectiveCamera,
  Quaternion,
  Vector3
} from 'three'
import type { Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { ModelDefinition, ModelPart } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { updatePart } from '../../store/operations'
import { useExplicitCameraEffect } from '../hooks/useExplicitCameraEffect'
import type { CameraCommand, ViewportSettings } from '../types'
import { materialColor } from '../materialColor'

const DEFAULT_CAMERA_POSITION: [number, number, number] = [7, 5, 8]
const ORBIT_MOUSE_BUTTONS = { LEFT: 0, MIDDLE: 2, RIGHT: 2 } as const

function partQuaternion(part: ModelPart): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(part['rotation-degrees'].x),
      MathUtils.degToRad(part['rotation-degrees'].y),
      MathUtils.degToRad(part['rotation-degrees'].z),
      'XYZ'
    )
  )
}

function modelBounds(model: ModelDefinition, onlyPartId?: string): Box3 {
  const bounds = new Box3()
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  model.parts.forEach((part) => {
    if (hidden.has(part.id) || (onlyPartId !== undefined && part.id !== onlyPartId)) return
    const rotation = partQuaternion(part)
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          bounds.expandByPoint(
            new Vector3(x * part.scale.x, y * part.scale.y, z * part.scale.z)
              .applyQuaternion(rotation)
              .add(new Vector3(part.position.x, part.position.y, part.position.z))
          )
        }
      }
    }
  })
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new Vector3(), new Vector3(2, 2, 2))
  return bounds
}

function CameraRig({
  model,
  selectedPartId,
  command,
  controlsRef
}: {
  model: ModelDefinition
  selectedPartId: string | null
  command: CameraCommand
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}): null {
  const { camera, size } = useThree()

  useExplicitCameraEffect(camera, command.nonce, () => {
    const selected =
      command.view === 'focus-selected' && selectedPartId !== null
        ? modelBounds(model, selectedPartId)
        : modelBounds(model)
    const center = selected.getCenter(new Vector3())
    const dimensions = selected.getSize(new Vector3())
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
        const currentDirection = camera.position.clone().sub(controlsRef.current?.target ?? center)
        if (currentDirection.lengthSq() < 0.001) currentDirection.set(1, 0.7, forwardSign)
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
      camera.zoom = Math.max(8, Math.min(size.width, size.height) / Math.max(radius * 2.7, 1))
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
  model,
  selected,
  locked,
  settings,
  onSelect,
  onDragging
}: {
  part: ModelPart
  model: ModelDefinition
  selected: boolean
  locked: boolean
  settings: ViewportSettings
  onSelect: () => void
  onDragging: (dragging: boolean) => void
}): React.JSX.Element {
  const meshRef = useRef<Mesh>(null)
  const update = useDocumentStore((state) => state.update)
  const beginTransaction = useDocumentStore((state) => state.beginTransaction)
  const endTransaction = useDocumentStore((state) => state.endTransaction)
  const color = materialColor(part.material)
  const transparent = /GLASS|ICE|SLIME|HONEY/.test(part.material)
  const emissive = /GLOWSTONE|SEA_LANTERN|SHROOMLIGHT|MAGMA/.test(part.material)
  const rotation: [number, number, number] = [
    MathUtils.degToRad(part['rotation-degrees'].x),
    MathUtils.degToRad(part['rotation-degrees'].y),
    MathUtils.degToRad(part['rotation-degrees'].z)
  ]

  const commitTransform = (): void => {
    const object = meshRef.current
    if (object === null) return
    update(() =>
      updatePart(model, part.id, (next) => {
        next.position = {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z
        }
        next.scale = {
          x: Math.max(0.0001, object.scale.x),
          y: Math.max(0.0001, object.scale.y),
          z: Math.max(0.0001, object.scale.z)
        }
        next['rotation-degrees'] = {
          x: MathUtils.radToDeg(object.rotation.x),
          y: MathUtils.radToDeg(object.rotation.y),
          z: MathUtils.radToDeg(object.rotation.z)
        }
      })
    )
  }

  const mesh = (
    <mesh
      ref={meshRef}
      name={part.id}
      position={[part.position.x, part.position.y, part.position.z]}
      rotation={rotation}
      scale={[part.scale.x, part.scale.y, part.scale.z]}
      castShadow
      receiveShadow
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        onSelect()
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        document.body.classList.add('viewport-hovering-part')
      }}
      onPointerOut={() => document.body.classList.remove('viewport-hovering-part')}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        roughness={0.72}
        metalness={part.material.includes('IRON') || part.material.includes('COPPER') ? 0.38 : 0.04}
        transparent={transparent}
        opacity={transparent ? 0.55 : 1}
        emissive={emissive ? color : '#000000'}
        emissiveIntensity={emissive ? 0.22 : 0}
      />
      {(selected || settings.showBounds || locked) && (
        <Edges
          threshold={15}
          color={locked ? '#ffb454' : selected ? '#66d9ff' : '#4e6378'}
          lineWidth={selected ? 1.8 : 1}
        />
      )}
    </mesh>
  )

  if (!selected || locked) return mesh

  return (
    <>
      <TransformControls
        object={meshRef as React.RefObject<Mesh>}
        mode={settings.transformMode}
        space={settings.transformMode === 'translate' ? 'world' : 'local'}
        size={0.82}
        translationSnap={settings.snapping ? settings.translationSnap : null}
        rotationSnap={settings.snapping ? MathUtils.degToRad(settings.rotationSnap) : null}
        scaleSnap={settings.snapping ? settings.scaleSnap : null}
        onMouseDown={() => {
          beginTransaction()
          onDragging(true)
        }}
        onObjectChange={commitTransform}
        onMouseUp={() => {
          commitTransform()
          endTransaction()
          onDragging(false)
        }}
      />
      {mesh}
    </>
  )
}

function Scene({
  model,
  selectedPartId,
  settings,
  command
}: {
  model: ModelDefinition
  selectedPartId: string | null
  settings: ViewportSettings
  command: CameraCommand
}): React.JSX.Element {
  const selectPart = useDocumentStore((state) => state.selectPart)
  const [dragging, setDragging] = useState(false)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  const locked = new Set(model.editor?.['locked-parts'] ?? [])
  const forwardSign = model['coordinate-system'].forward === 'positive-z' ? 1 : -1

  return (
    <>
      <color attach="background" args={['#11161d']} />
      <fog attach="fog" args={['#11161d', 28, 110]} />
      <PerspectiveCamera makeDefault={settings.cameraType === 'perspective'} position={DEFAULT_CAMERA_POSITION} fov={43} near={0.01} far={2000} />
      <OrthographicCamera makeDefault={settings.cameraType === 'orthographic'} position={DEFAULT_CAMERA_POSITION} zoom={70} near={-2000} far={4000} />
      <CameraRig
        model={model}
        selectedPartId={selectedPartId}
        command={command}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        enabled={!dragging}
        makeDefault
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
      <Html position={[0, 0.12, forwardSign * 2.75]} center transform distanceFactor={8}>
        <span className="forward-label">ВПЕРЁД {forwardSign > 0 ? '+Z' : '−Z'}</span>
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
            model={model}
            selected={part.id === selectedPartId}
            locked={locked.has(part.id)}
            settings={settings}
            onSelect={() => selectPart(part.id)}
            onDragging={setDragging}
          />
        )
      )}
    </>
  )
}

export function Viewport({
  model,
  selectedPartId,
  settings,
  command,
  onCommand
}: {
  model: ModelDefinition
  selectedPartId: string | null
  settings: ViewportSettings
  command: CameraCommand
  onCommand: (view: CameraCommand['view']) => void
}): React.JSX.Element {
  const selectPart = useDocumentStore((state) => state.selectPart)
  const forward = model['coordinate-system'].forward === 'positive-z' ? '+Z' : '−Z'
  const cameraLabel = settings.cameraType === 'perspective' ? 'Перспектива' : 'Ортографическая'

  return (
    <main className="viewport-panel" aria-label="Трёхмерная сцена">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => selectPart(null)}
      >
        <Scene model={model} selectedPartId={selectedPartId} settings={settings} command={command} />
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
        <button type="button" onClick={() => onCommand('focus-selected')} disabled={selectedPartId === null}>
          Выбранное
        </button>
        <button type="button" onClick={() => onCommand('focus-model')}>Вся модель</button>
        <button type="button" onClick={() => onCommand('reset')}>Сброс</button>
      </div>
      <div className="viewport-help">
        <span><kbd>ЛКМ</kbd> выбрать</span>
        <span><kbd>ЛКМ</kbd> вращать</span>
        <span><kbd>ПКМ</kbd> панорама</span>
        <span><kbd>Колесо</kbd> масштаб</span>
      </div>
    </main>
  )
}
