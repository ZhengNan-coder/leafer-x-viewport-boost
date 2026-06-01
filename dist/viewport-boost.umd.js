(function (global) {
  var LeaferX = (global.LeaferX = global.LeaferX || {})
  var defaults = {
    enabled: true,
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

  function ViewportBoost(app, options) {
    this.app = app
    this.leafer = app.tree || app
    this.options = Object.assign({}, defaults, options || {})
    this.snapshot = null
    this.idleTimer = 0
    this.restoreTimer = 0
    this.raf = 0
    this.lastAction = 'pan'
    this.installed = false
    this.heavyScene = undefined

    var self = this
    this.moveHandler = function () {
      self.begin()
    }
    this.zoomHandler = function () {
      self.begin()
    }
    this.endHandler = function () {
      self.scheduleEnd()
    }

    if (this.options.enabled) this.install()
  }

  ViewportBoost.prototype.install = function () {
    if (this.installed) return
    this.installed = true
    this.on('move.start', this.moveHandler)
    this.on('move', this.moveHandler)
    this.on('zoom.start', this.zoomHandler)
    this.on('zoom', this.zoomHandler)
    this.on('move.end', this.endHandler)
    this.on('zoom.end', this.endHandler)
  }

  ViewportBoost.prototype.uninstall = function () {
    if (!this.installed) return
    this.installed = false
    this.off('move.start', this.moveHandler)
    this.off('move', this.moveHandler)
    this.off('zoom.start', this.zoomHandler)
    this.off('zoom', this.zoomHandler)
    this.off('move.end', this.endHandler)
    this.off('zoom.end', this.endHandler)
    this.end(true)
  }

  ViewportBoost.prototype.begin = function () {
    if (!this.options.enabled || !this.shouldBoost()) return
    if (!this.snapshot) this.createSnapshot()
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  ViewportBoost.prototype.panBy = function (x, y) {
    var snapshot = this.ensureVirtualSnapshot()
    if (!snapshot) return
    snapshot.currentX += x
    snapshot.currentY += y
    this.lastAction = 'pan'
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  ViewportBoost.prototype.zoomAt = function (center, scale) {
    var snapshot = this.ensureVirtualSnapshot()
    if (!snapshot) return
    var nextScaleX = this.clampZoom(snapshot.currentScaleX * scale)
    var nextScaleY = this.clampZoom(snapshot.currentScaleY * scale)
    var ratioX = snapshot.currentScaleX ? nextScaleX / snapshot.currentScaleX : 1
    var ratioY = snapshot.currentScaleY ? nextScaleY / snapshot.currentScaleY : 1
    var localX = center.x - snapshot.viewLeft
    var localY = center.y - snapshot.viewTop
    snapshot.currentX = localX - (localX - snapshot.currentX) * ratioX
    snapshot.currentY = localY - (localY - snapshot.currentY) * ratioY
    snapshot.currentScaleX = nextScaleX
    snapshot.currentScaleY = nextScaleY
    this.lastAction = scale < 1 ? 'zoom-out' : 'zoom-in'
    this.updateSnapshotTransform()
    this.scheduleEnd()
  }

  ViewportBoost.prototype.getScale = function () {
    return (this.snapshot && this.snapshot.currentScaleX) || this.getScaleX(this.getViewportLayer())
  }

  ViewportBoost.prototype.getViewport = function () {
    var layer = this.getViewportLayer()
    return {
      x: (this.snapshot && this.snapshot.currentX) != null ? this.snapshot.currentX : Number(layer.x || 0),
      y: (this.snapshot && this.snapshot.currentY) != null ? this.snapshot.currentY : Number(layer.y || 0),
      scaleX: (this.snapshot && this.snapshot.currentScaleX) != null ? this.snapshot.currentScaleX : this.getScaleX(layer),
      scaleY: (this.snapshot && this.snapshot.currentScaleY) != null ? this.snapshot.currentScaleY : this.getScaleY(layer)
    }
  }

  ViewportBoost.prototype.end = function (force) {
    clearTimeout(this.idleTimer)
    if (!this.snapshot) return

    var snapshot = this.snapshot
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.updateSnapshotTransform(true)
    if (snapshot.virtual) this.commitSnapshot(snapshot)
    if (!force && this.options.freezeEngine) {
      this.restoreOnRender(snapshot)
      return
    }
    this.releaseSnapshot(snapshot)
  }

  ViewportBoost.prototype.releaseSnapshot = function (snapshot) {
    if (this.snapshot !== snapshot) return
    this.snapshot = null
    snapshot.source.style.transform = snapshot.sourceTransform
    snapshot.source.style.transformOrigin = snapshot.sourceTransformOrigin
    snapshot.source.style.willChange = snapshot.sourceWillChange

    if (this.options.disableHitTest) {
      this.leafer.hitChildren = snapshot.hitChildren
      this.leafer.hittable = snapshot.hittable
    }
  }

  ViewportBoost.prototype.restoreOnRender = function (snapshot) {
    var self = this
    var done = false
    var restore = function () {
      if (done) return
      done = true
      clearTimeout(self.restoreTimer)
      self.off('render.before', restore)
      self.releaseSnapshot(snapshot)
    }
    this.on('render.before', restore)
    this.startEngine()
    if (this.leafer.forceRender) this.leafer.forceRender()
    if (this.app !== this.leafer && this.app.forceRender) this.app.forceRender()
    this.restoreTimer = setTimeout(restore, this.options.restoreDelay)
  }

  ViewportBoost.prototype.setEnabled = function (enabled) {
    this.options.enabled = enabled
    if (!enabled) this.end(true)
  }

  ViewportBoost.prototype.ensureVirtualSnapshot = function () {
    if (!this.options.enabled || !this.shouldBoost()) return undefined
    if (!this.snapshot) this.createSnapshot(true)
    if (this.snapshot) this.snapshot.virtual = true
    return this.snapshot
  }

  ViewportBoost.prototype.shouldBoost = function () {
    var layer = this.getViewportLayer()
    var scale = Math.abs(this.getScaleX(layer))
    if (scale < this.options.minScale) return false
    if (this.heavyScene === undefined) {
      this.heavyScene = this.countLikelyChildren(this.leafer, this.options.minChildren) >= this.options.minChildren
    }
    return this.heavyScene
  }

  ViewportBoost.prototype.createSnapshot = function (virtual) {
    var source = this.getCanvas()
    if (!source) return

    var layer = this.getViewportLayer()
    var x = Number(layer.x || 0)
    var y = Number(layer.y || 0)
    var rect = source.getBoundingClientRect()
    var scaleX = this.getScaleX(layer)
    var scaleY = this.getScaleY(layer)
    this.snapshot = {
      source: source,
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
      virtual: !!virtual,
      sourceTransform: source.style.transform,
      sourceTransformOrigin: source.style.transformOrigin,
      sourceWillChange: source.style.willChange,
      hitChildren: this.leafer.hitChildren,
      hittable: this.leafer.hittable
    }

    source.style.transformOrigin = '0 0'
    source.style.willChange = 'transform'
    if (this.options.disableHitTest) {
      this.leafer.hitChildren = false
      this.leafer.hittable = false
    }
    if (this.options.freezeEngine) this.stopEngine()
    this.log('snapshot start')
  }

  ViewportBoost.prototype.updateSnapshotTransform = function (immediate) {
    if (!this.snapshot) return
    if (immediate && this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.raf) return
    var self = this
    var apply = function () {
      self.raf = 0
      var snapshot = self.snapshot
      if (!snapshot) return
      var layer = self.getViewportLayer()
      var scaleX = snapshot.virtual ? snapshot.currentScaleX : self.getScaleX(layer)
      var scaleY = snapshot.virtual ? snapshot.currentScaleY : self.getScaleY(layer)
      var x = snapshot.virtual ? snapshot.currentX : Number(layer.x || 0)
      var y = snapshot.virtual ? snapshot.currentY : Number(layer.y || 0)
      var sx = snapshot.startScaleX ? scaleX / snapshot.startScaleX : 1
      var sy = snapshot.startScaleY ? scaleY / snapshot.startScaleY : 1
      var tx = x - snapshot.startX * sx
      var ty = y - snapshot.startY * sy
      snapshot.source.style.transform = 'matrix(' + sx + ', 0, 0, ' + sy + ', ' + tx + ', ' + ty + ')'
    }
    if (immediate) {
      apply()
      return
    }
    this.raf = requestAnimationFrame(apply)
  }

  ViewportBoost.prototype.commitSnapshot = function (snapshot) {
    var layer = this.getViewportLayer()
    layer.x = snapshot.currentX
    layer.y = snapshot.currentY
    layer.scaleX = snapshot.currentScaleX
    layer.scaleY = snapshot.currentScaleY
    layer.scale = snapshot.currentScaleX
  }

  ViewportBoost.prototype.clampZoom = function (scale) {
    return Math.max(this.options.minZoom, Math.min(this.options.maxZoom, scale))
  }

  ViewportBoost.prototype.scheduleEnd = function () {
    var self = this
    var delay = this.lastAction === 'zoom-out' ? this.options.zoomOutIdleDelay : this.options.idleDelay
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(function () {
      if (!self.options.commitOnIdle) return
      if (self.lastAction === 'zoom-out') {
        self.end()
        return
      }
      self.runWhenIdle(function () {
        self.end()
      })
    }, delay)
  }

  ViewportBoost.prototype.runWhenIdle = function (callback) {
    var requestIdle = window.requestIdleCallback
    if (requestIdle) {
      requestIdle(function () {
        callback()
      }, { timeout: 1000 })
      return
    }
    setTimeout(callback, 120)
  }

  ViewportBoost.prototype.getViewportLayer = function () {
    return this.leafer.zoomLayer || this.leafer
  }

  ViewportBoost.prototype.getCanvas = function () {
    return (this.leafer.canvas && this.leafer.canvas.view) || (this.app.canvas && this.app.canvas.view)
  }

  ViewportBoost.prototype.countLikelyChildren = function (target, limit) {
    var children = target && target.children
    if (!Array.isArray(children)) return Number.MAX_SAFE_INTEGER
    var count = children.length
    for (var i = 0; i < children.length && count < limit; i++) {
      count += this.countLikelyChildren(children[i], limit - count)
    }
    return count
  }

  ViewportBoost.prototype.getScaleX = function (target) {
    if (typeof target.scaleX === 'number') return target.scaleX
    if (typeof target.scale === 'number') return target.scale
    return (target.scale && target.scale.x) || 1
  }

  ViewportBoost.prototype.getScaleY = function (target) {
    if (typeof target.scaleY === 'number') return target.scaleY
    if (typeof target.scale === 'number') return target.scale
    return (target.scale && target.scale.y) || 1
  }

  ViewportBoost.prototype.getZIndex = function (element) {
    var zIndex = Number(window.getComputedStyle(element).zIndex)
    return Number.isFinite(zIndex) ? zIndex : 0
  }

  ViewportBoost.prototype.stopEngine = function () {
    if (this.leafer.stop) this.leafer.stop()
    if (this.app !== this.leafer && this.app.stop) this.app.stop()
  }

  ViewportBoost.prototype.startEngine = function () {
    if (this.leafer.start) this.leafer.start()
    if (this.app !== this.leafer && this.app.start) this.app.start()
  }

  ViewportBoost.prototype.on = function (type, handler) {
    if (this.leafer.on) this.leafer.on(type, handler)
  }

  ViewportBoost.prototype.off = function (type, handler) {
    if (this.leafer.off) this.leafer.off(type, handler)
  }

  ViewportBoost.prototype.log = function (message) {
    if (this.options.debug) console.info('[ViewportBoost] ' + message)
  }

  function useViewportBoost(app, options) {
    return new ViewportBoost(app, options)
  }

  LeaferX.viewportBoost = {
    ViewportBoost: ViewportBoost,
    useViewportBoost: useViewportBoost
  }
})(typeof window !== 'undefined' ? window : globalThis)
