export type TransformMode = 'translate' | 'rotate' | 'scale'
export type CameraType = 'perspective' | 'orthographic'
export type CameraView =
  | 'perspective'
  | 'front'
  | 'rear'
  | 'left'
  | 'right'
  | 'top'
  | 'focus-model'
  | 'focus-selected'
  | 'reset'

export interface CameraCommand {
  view: CameraView
  nonce: number
}

export interface ViewportSettings {
  transformMode: TransformMode
  cameraType: CameraType
  showGrid: boolean
  showAxes: boolean
  showHitbox: boolean
  showBounds: boolean
  snapping: boolean
  translationSnap: number
  rotationSnap: number
  scaleSnap: number
}
