export interface ViewportBoostOptions {
  enabled?: boolean
  idleDelay?: number
  minChildren?: number
  minScale?: number
  maxPixelRatio?: number
  restoreDelay?: number
  minZoom?: number
  maxZoom?: number
  freezeEngine?: boolean
  disableHitTest?: boolean
  commitOnIdle?: boolean
  debug?: boolean
  className?: string
}

export class ViewportBoost {
  constructor(app: unknown, options?: ViewportBoostOptions)
  install(): void
  uninstall(): void
  begin(): void
  panBy(x: number, y: number): void
  zoomAt(center: { x: number; y: number }, scale: number): void
  getScale(): number
  end(force?: boolean): void
  setEnabled(enabled: boolean): void
}

export function useViewportBoost(app: unknown, options?: ViewportBoostOptions): ViewportBoost
