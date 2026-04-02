# Recordly 实时绘图标注功能 — 开发说明文档

**版本**: Phase 1 (快速验证版)  
**日期**: 2026-04-01  
**作者**: AI 辅助开发  

---

## 一、功能概述

在 Recordly 原有的屏幕录制工具基础上，集成了基于 **Excalidraw** 的实时绘图标注功能。用户可以在录制前或录制过程中，点击 HUD 工具栏上的铅笔按钮，弹出一个全屏透明的绘图画布，在屏幕上实时绘制标注内容（箭头、矩形、文字、自由画笔等），绘图内容会直接被录制进视频。

---

## 二、新增/修改文件清单

### 2.1 新增文件

#### `src/components/drawing-board/DrawingBoardWindow.tsx`

**作用**: 绘图板的 React 渲染组件，是整个功能的核心 UI。

**主要逻辑**:
- 使用 `@excalidraw/excalidraw` 渲染完整的 Excalidraw 画布
- 组件挂载时，通过 `window.electronAPI.getDrawingBoardData()` 从主进程加载已保存的绘图数据
- 每次画布内容变化时，通过 `window.electronAPI.setDrawingBoardData()` 将 Excalidraw 场景 JSON 保存到主进程
- 提供关闭按钮（调用 `window.electronAPI.closeDrawingBoard()`）和 `Esc` 键关闭支持
- 包含错误边界（ErrorBoundary），当 Excalidraw 加载失败时显示友好的错误提示

**关键代码片段**:
```tsx
// 加载已保存的绘图数据
const result = await window.electronAPI.getDrawingBoardData();
if (result.success && result.data) {
  setInitialData(JSON.parse(result.data));
}

// 保存绘图数据（防抖 500ms）
const handler = setTimeout(async () => {
  await window.electronAPI.setDrawingBoardData(JSON.stringify(elements));
}, 500);
```

---

### 2.2 修改文件

#### `electron/windows.ts`

**新增函数**: `createDrawingBoardWindow()`

**作用**: 创建一个全屏、透明、置顶的 Electron BrowserWindow，用于承载绘图板。

**关键配置**:
```typescript
{
  fullscreen: true,
  transparent: true,        // 透明背景，让绘图内容叠加在屏幕上
  alwaysOnTop: true,        // 始终置顶，覆盖在其他窗口之上
  frame: false,             // 无边框
  hasShadow: false,
  webPreferences: {
    preload: ...,
    contextIsolation: true,
    nodeIntegration: false,
  }
}
```

**注意**: 窗口加载路径为 `http://localhost:5173/?windowType=drawing-board`（开发模式）或对应的生产路径。

---

#### `electron/ipc/handlers.ts`

**新增 IPC Handlers**（5个）:

| Handler 名称 | 功能 |
|---|---|
| `open-drawing-board` | 创建并显示绘图板窗口（如已存在则聚焦） |
| `close-drawing-board` | 关闭并销毁绘图板窗口 |
| `get-drawing-board-data` | 返回内存中存储的绘图 JSON 数据 |
| `set-drawing-board-data` | 将绘图 JSON 数据保存到内存（`drawingBoardData` 变量） |
| `clear-drawing-board-data` | 清空绘图数据 |

**数据存储**: 绘图数据目前存储在主进程内存变量 `drawingBoardData: string | null` 中。后续可扩展为持久化到 `.recordly` 项目文件。

---

#### `electron/preload.ts`

**新增暴露的 API**（5个）:

```typescript
openDrawingBoard: () => ipcRenderer.invoke('open-drawing-board'),
closeDrawingBoard: () => ipcRenderer.invoke('close-drawing-board'),
getDrawingBoardData: () => ipcRenderer.invoke('get-drawing-board-data'),
setDrawingBoardData: (data: string) => ipcRenderer.invoke('set-drawing-board-data', data),
clearDrawingBoardData: () => ipcRenderer.invoke('clear-drawing-board-data'),
```

这些 API 通过 `contextBridge` 暴露到渲染进程的 `window.electronAPI` 对象上。

---

#### `electron/electron-env.d.ts`

**新增类型声明**: 在 `Window.electronAPI` 接口中添加了上述 5 个 API 的 TypeScript 类型定义，消除 TS 编译错误。

```typescript
openDrawingBoard: () => Promise<{ success: boolean; error?: string }>;
closeDrawingBoard: () => Promise<{ success: boolean; error?: string }>;
getDrawingBoardData: () => Promise<{ success: boolean; data: string | null }>;
setDrawingBoardData: (data: string) => Promise<{ success: boolean }>;
clearDrawingBoardData: () => Promise<{ success: boolean }>;
```

---

#### `src/App.tsx`

**新增路由**: 添加了 `drawing-board` 窗口类型的路由判断。

```tsx
if (windowType === 'drawing-board') {
  return <DrawingBoardWindow />;
}
```

Recordly 使用 URL 参数 `?windowType=xxx` 来区分不同的 Electron 窗口（如 `launch`、`editor`、`drawing-board`）。

---

#### `src/components/launch/LaunchWindow.tsx`

**新增**: 在 HUD 悬浮工具栏的两个状态中各添加了一个绘图板按钮。

- **空闲状态**（录制前）: 在 `MoreVertical` 按钮之后、`Minus`（最小化）按钮之前
- **录制中状态**: 在 `Square`（停止）按钮之后、`Minus`（最小化）按钮之前

```tsx
import { PencilLine } from "lucide-react";

<IconButton
  onClick={() => void window.electronAPI?.openDrawingBoard?.()}
  title="Open Drawing Board"
>
  <PencilLine size={16} />
</IconButton>
```

---

#### `src/components/video-editor/types.ts`

**新增类型定义**:

```typescript
export interface DrawingRegion {
  id: string;
  startMs: number;      // 开始时间（毫秒）
  endMs: number;        // 结束时间（毫秒）
  excalidrawData: string;  // 序列化的 Excalidraw 场景 JSON
  svgSnapshot?: string;    // 可选的预渲染 SVG（用于快速预览/导出）
  opacity: number;         // 透明度 0-1，默认 1
  animateStrokes: boolean; // 是否逐笔动画，默认 false
}

export const DEFAULT_DRAWING_REGION_OPACITY = 1;

export function createDrawingRegion(
  startMs: number,
  endMs: number,
  excalidrawData: string,
): DrawingRegion { ... }
```

**设计意图**: `DrawingRegion` 是为后续时间轴集成（Phase 2）预留的数据结构，表示视频中某个时间段内叠加的绘图内容。

---

#### `src/components/video-editor/projectPersistence.ts`

**修改**:
1. `ProjectEditorState` 接口新增 `drawingRegions: DrawingRegion[]` 字段
2. `normalizeProjectEditor()` 函数新增对 `drawingRegions` 的序列化/反序列化逻辑（包含数据校验和边界处理）

这确保了绘图数据能够随 `.recordly` 项目文件一起保存和加载。

---

#### `vite.config.ts`

**新增 `define` 配置**: 为 `@excalidraw/excalidraw` 提供 Node.js `process` 对象的 polyfill。

```typescript
define: {
  'process.env': JSON.stringify({ NODE_ENV: process.env.NODE_ENV ?? 'development' }),
  'process.platform': JSON.stringify(process.platform),
  'process.version': JSON.stringify(process.version),
  'process.browser': JSON.stringify(true),
},
```

**同时在 `optimizeDeps.include` 中添加了 `@excalidraw/excalidraw`**，确保 Vite 预构建时正确处理该依赖。

---

#### `index.html`

**新增内联 polyfill 脚本**: 在所有模块加载之前注入 `process` 全局对象，解决 Excalidraw 在 Electron 渲染进程中报 `ReferenceError: process is not defined` 的问题。

```html
<script>
  if (typeof globalThis.process === 'undefined') {
    globalThis.process = {
      env: { NODE_ENV: 'production' },
      platform: 'browser',
      version: '',
      browser: true,
      nextTick: function(fn) { setTimeout(fn, 0); },
    };
  }
</script>
```

---

#### `package.json`

**新增依赖**:
```json
"@excalidraw/excalidraw": "^0.17.x"
```

---

## 三、数据流说明

```
用户点击 HUD 铅笔按钮
    │
    ▼
window.electronAPI.openDrawingBoard()
    │  (IPC: 'open-drawing-board')
    ▼
主进程 createDrawingBoardWindow()
    │  创建全屏透明置顶窗口
    ▼
渲染进程加载 DrawingBoardWindow.tsx
    │  URL: ?windowType=drawing-board
    ▼
组件挂载 → getDrawingBoardData() → 加载已有绘图
    │
用户绘图 → onChange → setDrawingBoardData(json) → 保存到内存
    │
用户关闭 → closeDrawingBoard() → 销毁窗口
```

---

## 四、已知限制（ARM64 Windows）

在 ARM64 架构的 Windows 机器上运行时，以下功能受限（与绘图板无关）：

| 功能 | 状态 | 原因 |
|---|---|---|
| 屏幕录制 (WGC) | ⚠️ 受限 | WGC capturer 不支持 ARM64 |
| 视频处理 (FFmpeg) | ⚠️ 受限 | `ffmpeg-static` 无 ARM64 二进制 |
| 光标遥测 | ⚠️ 不可用 | `uiohook-napi` 无 ARM64 构建 |
| **绘图板 UI** | ✅ 正常 | 纯 Web 技术，无平台限制 |

---

## 五、绘图内容录制方案（画中画 / Picture-in-Picture）

### 5.1 问题根因

WGC（Windows Graphics Capture）在**窗口捕获模式**下，只录制目标窗口本身的内容，**不会**录制叠加在其上的其他窗口（包括透明的绘图板窗口）。

| 录制模式 | 绘图板是否被录制 | 原因 |
|---|---|---|
| **屏幕录制**（整个显示器） | ✅ 是 | WGC 捕获整个显示器的合成画面，绘图板作为置顶窗口自然包含在内 |
| **窗口录制**（特定应用窗口） | ❌ 否 | WGC 只捕获目标窗口，绘图板是独立窗口，不在捕获范围内 |

### 5.2 解决方案：画中画（Picture-in-Picture）

让绘图板窗口**自身**成为一个完整的合成画面：

```
┌─────────────────────────────────────────────────────┐
│  绘图板窗口（WGC 录制此窗口）                          │
│  ┌───────────────────────────────────────────────┐  │
│  │  <video> 背景层                                │  │
│  │  （通过 getDisplayMedia 捕获录制源的实时画面）   │  │
│  ├───────────────────────────────────────────────┤  │
│  │  Excalidraw 画布层（透明背景，绘图内容叠加其上）  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**关键机制**：`electron/main.ts` 中已注册 `setDisplayMediaRequestHandler`，它会拦截渲染进程的 `navigator.mediaDevices.getDisplayMedia()` 调用，并**自动返回当前选中的录制源**，无需用户手动选择。

### 5.3 已实现的代码变更

#### `src/components/drawing-board/DrawingBoardWindow.tsx`

组件挂载时自动启动背景捕获：

```tsx
useEffect(() => {
  const startBackgroundCapture = async () => {
    // 被 setDisplayMediaRequestHandler 拦截，自动返回选中的录制源
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 } },
      audio: false,
    });
    setBackgroundStream(stream);
  };
  void startBackgroundCapture();
}, []);
```

背景视频元素（`<video>`）绝对定位在 `zIndex: 0`，Excalidraw 画布在 `zIndex: 1`。

工具栏标题旁会显示 **● LIVE** 绿色徽章，表示背景捕获已激活。

#### `electron/ipc/handlers.ts`

新增 `get-drawing-board-window-source-id` IPC 处理器：

```typescript
ipcMain.handle('get-drawing-board-window-source-id', async () => {
  const hwndBuffer = drawingBoardWin.getNativeWindowHandle();
  const hwnd = Number(hwndBuffer.readBigInt64LE(0));
  return {
    success: true,
    sourceId: `window:${hwnd}:0`,  // desktopCapturer 兼容格式
    hwnd,
    sourceName: 'Drawing Board – Recordly',
  };
});
```

#### `electron/preload.ts`

```typescript
getDrawingBoardWindowSourceId: () =>
  ipcRenderer.invoke('get-drawing-board-window-source-id'),
```

### 5.4 自动 WGC 切换（已实现）

**问题**：用户反馈录制时可以在绘图板上画画，但录制完成后编辑视频时看不到绘图轨迹。

**根因**：WGC 始终录制原始录制源（屏幕或窗口），绘图板是独立的透明叠加窗口，不在 WGC 捕获范围内。

**修复**：在 `open-drawing-board` IPC 处理器中，当 WGC 录制正在进行时，自动执行以下步骤：

```
1. 停止当前 WGC 录制 → 保存分段视频 A（drawingBoardPreRecordingVideoPath）
2. 等待 1.2 秒（让绘图板的 getDisplayMedia 背景捕获就绪）
3. 获取绘图板窗口的 HWND
4. 以绘图板窗口为目标，启动新的 WGC 录制 → 分段视频 B
5. 设置 drawingBoardRecordingActive = true
```

在 `mux-native-windows-recording` 中，当 `drawingBoardRecordingActive` 为 true 时：

```
1. 使用 FFmpeg concat demuxer 合并 [视频A, 视频B] → 合并视频
2. 对合并视频进行音频 mux
3. 返回最终视频
```

### 5.5 测试步骤（修复后）

1. 启动 Recordly，选择任意录制源（屏幕或窗口）
2. 点击 **开始录制**
3. 录制开始后，点击 HUD 工具栏的铅笔按钮，打开绘图板
4. 确认绘图板工具栏标题旁出现 **● LIVE** 绿色徽章
5. 在绘图板上绘制内容（箭头、矩形、文字等）
6. 点击 **停止录制**
7. 在编辑器中打开录制视频，确认：
   - 绘图板打开前的内容正常显示
   - 绘图板打开后的内容包含背景画面 + 绘图轨迹

### 5.6 已知限制与后续工作

| 问题 | 状态 | 说明 |
|---|---|---|
| 绘图板关闭后继续录制 | 🔧 待实现 | 绘图板关闭时需重新切换 WGC 回原始源，并在停止时合并三段视频 |
| 窗口源背景拉伸 | ⚠️ 已知 | 窗口源比绘图板小时，背景视频会被拉伸填充（`objectFit: 'fill'`），可改为 `contain` 加黑边 |
| 音频同步 | ⚠️ 已知 | 切换 WGC 时音频录制不中断，但合并后音频时长可能与视频略有差异 |

---

## 六、Phase 2 待办事项

以下功能已在数据结构层面预留，但尚未实现 UI：

1. **时间轴绘图轨道** (`TimelineEditor.tsx`, `VideoEditor.tsx`)
   - 在视频编辑器时间轴中添加 "Drawing" 轨道
   - 支持拖拽调整绘图区域的开始/结束时间
   - 支持在特定时间点添加/删除绘图内容

2. **导出管线集成** (`src/lib/exporter/`)
   - 将 `DrawingRegion.svgSnapshot` 作为视频叠加层合成到导出视频
   - 支持基于时间轴的绘图显示/隐藏

3. **逐笔动画** (`DrawingRegion.animateStrokes`)
   - 在视频中按绘制顺序逐笔展示绘图内容

4. **压感支持**
   - 针对数位板用户，支持笔压感应

---

## 六、本地开发启动方式

```bash
# 1. 进入项目目录
cd C:\0docs\myprojects\screencordraw\Recordly

# 2. 安装依赖（跳过 ffmpeg-static 等 ARM64 不兼容的 postinstall 脚本）
npm install --ignore-scripts

# 3. 手动安装 Electron 二进制
node node_modules/electron/install.js

# 4. 启动开发服务器
npm run dev
```

> **注意**: 首次运行 `npm install` 时，如遇到 SSL 证书错误，请先执行：
> ```bash
> npm config set strict-ssl false
