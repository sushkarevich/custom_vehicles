import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExplicitCameraEffect } from './useExplicitCameraEffect'

interface CameraState {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
  zoom: number
}

const perspectiveCamera = {}
const orthographicCamera = {}

describe('явный lifecycle камеры', () => {
  it('не меняет position, quaternion, target и zoom при выборе или очистке детали', () => {
    let state: CameraState

    function Harness({
      selectedPartId,
      commandNonce,
      camera = perspectiveCamera
    }: {
      selectedPartId: string | null
      commandNonce: number
      camera?: object
    }): null {
      useExplicitCameraEffect(camera, commandNonce, () => {
        state = {
          position: selectedPartId === null ? [7, 5, 8] : [3, 2, 4],
          quaternion: [0.1, 0.2, 0.3, 0.9],
          target: selectedPartId === null ? [0, 0, 0] : [1, 1, 1],
          zoom: 42
        }
      })
      return null
    }

    const view = render(<Harness selectedPartId="body" commandNonce={0} />)
    state = {
      position: [12.5, -3.25, 6.75],
      quaternion: [0.22, -0.31, 0.11, 0.91],
      target: [4.5, 1.25, -8],
      zoom: 137
    }
    const manipulated = structuredClone(state)

    view.rerender(<Harness selectedPartId="roof" commandNonce={0} />)
    expect(state).toEqual(manipulated)

    view.rerender(<Harness selectedPartId={null} commandNonce={0} />)
    expect(state).toEqual(manipulated)
  })

  it('применяет явный reset/focus, смену камеры и инициализацию нового документа', () => {
    let applications = 0

    function Harness({
      commandNonce,
      camera
    }: {
      commandNonce: number
      camera: object
    }): null {
      useExplicitCameraEffect(camera, commandNonce, () => {
        applications += 1
      })
      return null
    }

    const view = render(<Harness commandNonce={0} camera={perspectiveCamera} />)
    expect(applications).toBe(1)

    view.rerender(<Harness commandNonce={1} camera={perspectiveCamera} />)
    expect(applications).toBe(2)

    view.rerender(<Harness commandNonce={1} camera={orthographicCamera} />)
    expect(applications).toBe(3)

    // Opening/creating a document increments the command nonce in App.
    view.rerender(<Harness commandNonce={2} camera={orthographicCamera} />)
    expect(applications).toBe(4)
  })
})
