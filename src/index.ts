export interface ViewportBoostOptions {
  enabled?: boolean
  mode?: 'native' | 'manual'
  idleDelay?: number
  zoomOutIdleDelay?: number
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

type AnyLeafer = {
  canvas?: { view?: HTMLCanvasElement }
  config?: Record<string, unknown>
  children?: unknown[]
  zoomLayer?: AnyLeafer
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  scale?: number | { x?: number; y?: number }
  hittable?: boolean
  hitChildren?: boolean
  forceRender?: () => void
  start?: () => void
  stop?: () => void
  on?: (type: string, handler: (event?: unknown) => void) => void
  off?: (type: string, handler: (event?: unknown) => void) => void
}

type AnyApp = AnyLeafer & {
  tree?: AnyLeafer
}

interface SnapshotState {
  source: HTMLCanvasElement
  startX: number
  startY: number
  viewLeft: number
  viewTop: number
  startScaleX: number
  startScaleY: number
  currentX: number
  currentY: number
  currentScaleX: number
  currentScaleY: number
  virtual: boolean
  sourceTransform: string
  sourceTransformOrigin: string
  sourceWillChange: string
  hitChildren?: boolean
  hittable?: boolean
}

const defaultOptions: Required<ViewportBoostOptions> = {
  enabled: true,
  mode: 'native',
  idleDelay: 1600,
  zoomOutIdleDelay: 320,
  minChildren: 20000,
  minScale: 0,
  maxPixelRatio: 1.5,
  restoreDelay: 500,
  minZoom: 0.02,
  maxZoom: 16,
  freezeEngine: true,
  disableHitTest: true,
  commitOnIdle: true,
  debug: false,
  className: 'leafer-x-viewport-boost'
}

export class ViewportBoost {
  readonly app: AnyApp
  readonly leafer: AnyLeafer
  readonly options: Required<ViewportBoostOptions>

  private snapshot?: SnapshotState
  private idleTimer = 0
  private restoreTimer = 0
  private raf = 0
  private lastAction: 'pan' | 'zoom-in' | 'zoom-out' = 'pan'
  private installed = false
  private moveHandler = () => this.begin()
  private zoomHandler = () => this.begin()
  private endHandler = () => this.scheduleEnd()
  private nativeHandler = () => this.nativeBegin()
  private nativeEndHandler = () => this.nativeEnd()
  private heavyScene?: boolean

  constructor(app: AnyApp, options: ViewportBoostOptions = {}) {
    this.app = app
    this.leafer = app.tree || app
    this.options = { ...defaultOptions, ...options }
    if (this.options.enabled) this.install()
  }

  install(): void {
    if (this.installed) return
    this.installed = true

    if (this.options.mode === 'manual') {
      this.on('move.start', this.moveHandler)
      this.on('move', this.moveHandler)
      this.on('zoom.start', this.zoomHandler)
      this.on('zoom', this.zoomHandler)
      this.on('move.end', this.endHandler)
      this.on('zoom.end', this.endHandler)
      return
    }

    this.on('move.start', this.nativeHandler)
    this.on('move', this.nativeHandler)
    this.on('zoom.start', this.nativeHandler)
    this.on('zoom', this.nativeHandler)
    this.on('move.end', this.nativeEndHandler)
    this.on('zoom.end', this.nativeEndHandler)
  }

  uninstall(): void {
    if (!this.installed) return
    this.installed = false

    this.off('move.start', this.moveHandler)
    this.off('move', this.moveHandler)
    this.off('zoom.start', this.zoomHandler)
    this.off('zoom', this.zoomHandler)
    this.off('move.end', this.endHandler)
    this.off('zoom.end', this.endHandler)
    this.off('move.start', this.nativeHandler)
    this.off('move', this.nativeHandler)
    this.off('zoom.start', this.nativeHandler)
    this.off('zoom', this.nativeHandler)
    this.off('move.end', this.nativeEndHandler)
    this.off('zoom.end', this.nativeEndHandler)
    this.end(true)
  }

  private nativeBegin(): void {
    if (!this.options.enabled || !this.shouldBoost()) return
    if (!this.snapshot) this.createSnapshot(false)
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  private nativeEnd(): void {
    this.scheduleEnd()
  }

  begin(): void {
    if (!this.options.enabled || !this.shouldBoost()) return
    if (!this.snapshot) this.createSnapshot()
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  panBy(x: number, y: number): void {
    this.options.mode = 'manual'
    const snapshot = this.ensureVirtualSnapshot()
    if (!snapshot) return

    snapshot.currentX += x
    snapshot.currentY += y
    this.lastAction = 'pan'
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  zoomAt(center: { x: number; y: number }, scale: number): void {
    this.options.mode = 'manual'
    const snapshot = this.ensureVirtualSnapshot()
    if (!snapshot) return

    const nextScaleX = this.clampZoom(snapshot.currentScaleX * scale)
    const nextScaleY = this.clampZoom(snapshot.currentScaleY * scale)
    const ratioX = snapshot.currentScaleX ? nextScaleX / snapshot.currentScaleX : 1
    const ratioY = snapshot.currentScaleY ? nextScaleY / snapshot.currentScaleY : 1
    const localX = center.x - snapshot.viewLeft
    const localY = center.y - snapshot.viewTop

    snapshot.currentX = localX - (localX - snapshot.currentX) * ratioX
    snapshot.currentY = localY - (localY - snapshot.currentY) * ratioY
    snapshot.currentScaleX = nextScaleX
    snapshot.currentScaleY = nextScaleY
    this.lastAction = scale < 1 ? 'zoom-out' : 'zoom-in'

    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  getScale(): number {
    return this.snapshot?.currentScaleX || this.getScaleX(this.getViewportLayer())
  }

  getViewport(): { x: number; y: number; scaleX: number; scaleY: number } {
    const layer = this.getViewportLayer()
    return {
      x: this.snapshot?.currentX ?? Number(layer.x || 0),
      y: this.snapshot?.currentY ?? Number(layer.y || 0),
      scaleX: this.snapshot?.currentScaleX ?? this.getScaleX(layer),
      scaleY: this.snapshot?.currentScaleY ?? this.getScaleY(layer)
    }
  }

  end(force = false): void {
    window.clearTimeout(this.idleTimer)
    if (!this.snapshot) return

    const snapshot = this.snapshot
    window.cancelAnimationFrame(this.raf)
    this.raf = 0
    this.updateSnapshotTransform(true)
    if (snapshot.virtual) this.commitSnapshot(snapshot)
    if (!force && this.options.freezeEngine) {
      this.restoreOnRender(snapshot)
      return
    }
    this.releaseSnapshot(snapshot)
  }

  private releaseSnapshot(snapshot: SnapshotState): void {
    if (this.snapshot !== snapshot) return
    this.snapshot = undefined
    snapshot.source.style.transform = snapshot.sourceTransform
    snapshot.source.style.transformOrigin = snapshot.sourceTransformOrigin
    snapshot.source.style.willChange = snapshot.sourceWillChange

    if (this.options.disableHitTest && snapshot.virtual) {
      this.leafer.hitChildren = snapshot.hitChildren
      this.leafer.hittable = snapshot.hittable
    }
  }

  private restoreOnRender(snapshot: SnapshotState): void {
    let done = false
    const restore = () => {
      if (done) return
      done = true
      window.clearTimeout(this.restoreTimer)
      this.off('render.before', restore)
      this.releaseSnapshot(snapshot)
    }

    this.on('render.before', restore)
    this.startEngine()
    this.leafer.forceRender?.()
    if (this.app !== this.leafer) this.app.forceRender?.()
    this.restoreTimer = window.setTimeout(restore, this.options.restoreDelay)
  }

  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled
    if (!enabled) this.end(true)
  }

  private ensureVirtualSnapshot(): SnapshotState | undefined {
    if (!this.options.enabled || !this.shouldBoost()) return undefined
    if (!this.snapshot) this.createSnapshot(true)
    if (this.snapshot) this.snapshot.virtual = true
    return this.snapshot
  }

  private shouldBoost(): boolean {
    const layer = this.getViewportLayer()
    const scale = Math.abs(this.getScaleX(layer))
    if (scale < this.options.minScale) return false
    if (this.heavyScene === undefined) {
      this.heavyScene = this.countLikelyChildren(this.leafer, this.options.minChildren) >= this.options.minChildren
    }
    return this.heavyScene
  }

  private createSnapshot(virtual = false): void {
    const source = this.getCanvas()
    if (!source) return

    const layer = this.getViewportLayer()
    const x = Number(layer.x || 0)
    const y = Number(layer.y || 0)
    const rect = source.getBoundingClientRect()
    const scaleX = this.getScaleX(layer)
    const scaleY = this.getScaleY(layer)
    this.snapshot = {
      source,
      startX: x,
      startY: y,
      viewLeft: rect.left,
      viewTop: rect.top,
      startScaleX: scaleX,
      startScaleY: scaleY,
      currentX: x,
      currentY: y,
      currentScaleX: scaleX,
      currentScaleY: scaleY,
      virtual,
      sourceTransform: source.style.transform,
      sourceTransformOrigin: source.style.transformOrigin,
      sourceWillChange: source.style.willChange,
      hitChildren: this.leafer.hitChildren,
      hittable: this.leafer.hittable
    }

    source.style.transformOrigin = '0 0'
    source.style.willChange = 'transform'
    if (this.options.disableHitTest && virtual) {
      this.leafer.hitChildren = false
      this.leafer.hittable = false
    }
    if (this.options.freezeEngine) this.stopEngine()
    this.log('snapshot start')
  }

  private updateSnapshotTransform(immediate = false): void {
    if (!this.snapshot) return
    if (immediate && this.raf) {
      window.cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.raf) return
    const apply = () => {
      this.raf = 0
      const snapshot = this.snapshot
      if (!snapshot) return

      const layer = this.getViewportLayer()
      const scaleX = snapshot.virtual ? snapshot.currentScaleX : this.getScaleX(layer)
      const scaleY = snapshot.virtual ? snapshot.currentScaleY : this.getScaleY(layer)
      const x = snapshot.virtual ? snapshot.currentX : Number(layer.x || 0)
      const y = snapshot.virtual ? snapshot.currentY : Number(layer.y || 0)
      const sx = snapshot.startScaleX ? scaleX / snapshot.startScaleX : 1
      const sy = snapshot.startScaleY ? scaleY / snapshot.startScaleY : 1
      const tx = x - snapshot.startX * sx
      const ty = y - snapshot.startY * sy
      snapshot.source.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`
    }

    if (immediate) {
      apply()
      return
    }

    this.raf = window.requestAnimationFrame(apply)
  }

  private commitSnapshot(snapshot: SnapshotState): void {
    const layer = this.getViewportLayer()
    layer.x = snapshot.currentX
    layer.y = snapshot.currentY
    layer.scaleX = snapshot.currentScaleX
    layer.scaleY = snapshot.currentScaleY
    layer.scale = snapshot.currentScaleX
  }

  private clampZoom(scale: number): number {
    return Math.max(this.options.minZoom, Math.min(this.options.maxZoom, scale))
  }

  private scheduleEnd(): void {
    window.clearTimeout(this.idleTimer)
    const delay = this.lastAction === 'zoom-out' ? this.options.zoomOutIdleDelay : this.options.idleDelay
    this.idleTimer = window.setTimeout(() => {
      if (!this.options.commitOnIdle) return
      if (this.lastAction === 'zoom-out') {
        this.end()
        return
      }
      this.runWhenIdle(() => this.end())
    }, delay)
  }

  private runWhenIdle(callback: () => void): void {
    const requestIdle = window.requestIdleCallback
    if (requestIdle) {
      requestIdle(() => callback(), { timeout: 1000 })
      return
    }
    window.setTimeout(callback, 120)
  }

  private getViewportLayer(): AnyLeafer {
    return this.leafer.zoomLayer || this.leafer
  }

  private getCanvas(): HTMLCanvasElement | undefined {
    return this.leafer.canvas?.view || this.app.canvas?.view
  }

  private countLikelyChildren(target: AnyLeafer, limit: number): number {
    const children = target.children
    if (!Array.isArray(children)) return Number.MAX_SAFE_INTEGER

    let count = children.length
    for (let i = 0; i < children.length && count < limit; i++) {
      count += this.countLikelyChildren(children[i] as AnyLeafer, limit - count)
    }
    return count
  }

  private getScaleX(target: AnyLeafer): number {
    if (typeof target.scaleX === 'number') return target.scaleX
    if (typeof target.scale === 'number') return target.scale
    return target.scale?.x || 1
  }

  private getScaleY(target: AnyLeafer): number {
    if (typeof target.scaleY === 'number') return target.scaleY
    if (typeof target.scale === 'number') return target.scale
    return target.scale?.y || 1
  }

  private getZIndex(element: HTMLElement): number {
    const zIndex = Number(window.getComputedStyle(element).zIndex)
    return Number.isFinite(zIndex) ? zIndex : 0
  }

  private stopEngine(): void {
    this.leafer.stop?.()
    if (this.app !== this.leafer) this.app.stop?.()
  }

  private startEngine(): void {
    this.leafer.start?.()
    if (this.app !== this.leafer) this.app.start?.()
  }

  private on(type: string, handler: (event?: unknown) => void): void {
    this.leafer.on?.(type, handler)
  }

  private off(type: string, handler: (event?: unknown) => void): void {
    this.leafer.off?.(type, handler)
  }

  private log(message: string): void {
    if (this.options.debug) console.info(`[ViewportBoost] ${message}`)
  }
}

export function useViewportBoost(app: AnyApp, options?: ViewportBoostOptions): ViewportBoost {
  return new ViewportBoost(app, options)
}
