import { useEffect, useEffectEvent } from 'react'

/**
 * Runs camera placement only for an explicit command or when the active camera
 * instance changes. The callback stays fresh without making model edits or
 * part selection camera lifecycle events.
 */
export function useExplicitCameraEffect(
  activeCamera: object,
  commandNonce: number,
  apply: () => void
): void {
  const applyExplicitCommand = useEffectEvent(apply)

  useEffect(() => {
    applyExplicitCommand()
  }, [activeCamera, commandNonce])
}
