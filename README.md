# leafer-x-viewport-boost

`leafer-x-viewport-boost` 是一个针对超大 Leafer 画布的视口加速插件。它在平移、缩放交互期间暂停 Leafer 重绘，并直接对真实 canvas 做 CSS 合成变换；交互空闲后再一次性提交最终视口，避免 10 万到 100 万元素场景在连续缩放、移动时反复触发昂贵重绘。

## 安装

```bash
npm install leafer-x-viewport-boost
```

插件按 LeaferX 命名方式组织：

- NPM 包名：`leafer-x-viewport-boost`
- 全局变量：`LeaferX.viewportBoost`

## 使用

```ts
import { Leafer } from 'leafer-ui'
import '@leafer-in/viewport'
import { ViewportBoost } from 'leafer-x-viewport-boost'

const leafer = new Leafer({
  view: window,
  type: 'viewport'
})

const boost = new ViewportBoost(leafer, {
  minChildren: 20000,
  idleDelay: 1600,
  zoomOutIdleDelay: 320,
  maxPixelRatio: 1,
  minZoom: 0.02,
  maxZoom: 16
})
```

HTML 直连：

```html
<script src="https://unpkg.com/leafer@2.1.0/dist/web.min.js"></script>
<script src="./dist/viewport-boost.umd.js"></script>
<script>
  const boost = new LeaferX.viewportBoost.ViewportBoost(leafer)
</script>
```

## 配置

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用插件 |
| `mode` | `native` | 默认兼容 Leafer 官方 viewport/editor，不接管鼠标；`manual` 用于自定义 panBy/zoomAt |
| `idleDelay` | `1600` | 交互停止多少毫秒后提交真实视口，连续移动/缩放建议 1200-2200 |
| `zoomOutIdleDelay` | `320` | 缩小时更快提交真实视口，并跳过 idle 等待，让新露出的元素更快渲染 |
| `minChildren` | `20000` | 低于该元素量不启用加速模式 |
| `minScale` | `0` | 低于该缩放比例不启用加速模式 |
| `maxPixelRatio` | `1.5` | 兼容旧版配置，当前 canvas-transform 模式不使用 |
| `restoreDelay` | `500` | 等待 `render.before` 的兜底恢复时间 |
| `minZoom` | `0.02` | 虚拟视口缩放下限 |
| `maxZoom` | `16` | 虚拟视口缩放上限 |
| `freezeEngine` | `true` | 交互期间暂停 Leafer 渲染引擎 |
| `disableHitTest` | `true` | 交互期间临时关闭命中检测 |
| `commitOnIdle` | `true` | 是否在安静期后用 `requestIdleCallback` 提交真实视口 |
| `debug` | `false` | 输出调试日志 |

## Demo

打开 `demo/index.html`。页面会创建 100 万个矩形，左上角可以切换加速开关、执行缩放并观察 FPS。

## 适用场景

## 虚拟视口 API

默认 `native` 模式会直接兼容 Leafer 官方 `type: 'viewport'` 和 `App({ editor: {} })`，不会拦截鼠标、滚轮、选择、框选等编辑器能力。

如果你要做完全自定义交互，可以切到 `manual` 模式，并调用虚拟视口 API：

```ts
boost.panBy(deltaX, deltaY)
boost.zoomAt({ x: event.clientX, y: event.clientY }, scale)
boost.getViewport()
```

这两个方法在交互期间不会频繁写入 Leafer 的真实 `x/y/scale`，只变换真实 canvas 的 CSS 合成层；空闲后才一次性提交最终视口。插件不再复制快照覆盖层，所以不会出现两层画面叠加造成的重影。

编辑器类应用建议优先使用默认 `native` 模式，保留 Leafer 官方编辑器的点击选中、框选、滚轮缩放和平移能力。

如果希望大幅拖拽时边缘也不露出空白，需要像 demo 一样给 Leafer view 留出 overscan 缓冲区：让实际 view 比可见视口大一圈，并把 `zoomLayer.x/y` 初始化到缓冲偏移量。

这个插件主要优化“缩放画布”和“移动画布”时的连续交互体感。它不会减少元素创建成本，也不会让最终真实渲染变成低成本；最终停下后仍会恢复 Leafer 正常画面，保证编辑和拾取结果一致。
