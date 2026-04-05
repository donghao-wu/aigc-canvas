# 提示词反向拆解功能设计文档

**日期**: 2026-04-05
**状态**: 待实现

---

## 一、功能概述

用户在画布上看到一张已生成的图片（ImageNode），点击「拆解」按钮，系统调用阿里云 Qwen-VL 视觉模型分析图片内容，返回结构化 JSON 提示词，并在画布上自动生成一个可编辑的 **PromptNode**，连线到原图。用户修改字段后点击「用此生图」，自动创建 ImageGenNode 并预填重组后的提示词。

**核心价值**: 将已有图片的视觉特征结构化，让生图参数可控、可复用、可微调。

---

## 二、架构

```
ImageNode  →(点击拆解)→  POST /api/analyze-image  →  PromptNode(自动创建+连线)
                              ↓ Qwen-VL API
                         返回嵌套 JSON

PromptNode →(点击生图)→  自动创建 ImageGenNode(预填重组提示词)
```

---

## 三、后端

### 新增接口: `POST /api/analyze-image`

**请求体**:
```json
{
  "base64": "<图片base64字符串>",
  "mimeType": "image/jpeg"
}
```

**处理逻辑**:
1. 调用 DashScope OpenAI 兼容接口（`qwen-vl-max`）
2. 发送 system prompt 要求返回固定 JSON 结构
3. 解析响应，提取 JSON

**System Prompt**:
```
你是一个专业的影像提示词分析师。分析用户发送的图片，返回严格的JSON格式，不要包含任何其他文字。
JSON结构如下:
{
  "characters": [{ "description": "人物描述", "position": "画面位置" }],
  "setting": { "location": "地点", "era": "时代", "time_of_day": "时间" },
  "lighting": { "type": "光源类型", "direction": "方向", "tone": "色调" },
  "composition": { "shot_type": "景别", "angle": "拍摄角度" },
  "style": { "aesthetic": "风格描述", "color_palette": "主色调", "film_grain": false }
}
如果某个字段无法判断，填null。
```

**响应**:
```json
{
  "analysis": { ...嵌套JSON... },
  "reconstructedPrompt": "合成的自然语言提示词字符串"
}
```

**认证**: 需要 `authMiddleware`
**API Key**: 存入 `.env` 的 `DASHSCOPE_API_KEY`
**Endpoint**: `https://dashscope.aliyuncs.com/compatible-mode/v1`

---

## 四、前端

### 4.1 新节点类型: `PromptNode`（区别于现有 `textNode`）

**文件**: `frontend/src/nodes/PromptAnalysisNode.tsx`

**节点 data 结构**:
```typescript
{
  analysis: {
    characters: Array<{ description: string; position: string }>;
    setting: { location: string; era: string; time_of_day: string };
    lighting: { type: string; direction: string; tone: string };
    composition: { shot_type: string; angle: string };
    style: { aesthetic: string; color_palette: string; film_grain: boolean };
  };
  reconstructedPrompt: string;
}
```

**UI 结构**:
- 头部: "结构化提示词" 标签 + 分析中动画
- Tab 切换: 「字段」↔「JSON」
  - 字段视图: 每个字段一行，label + 可编辑 input
  - JSON 视图: textarea 显示完整 JSON，编辑后同步到字段视图
- 底部: 「用此结构生图 →」按钮 → 创建 ImageGenNode，presetPrompt = reconstructedPrompt
- 宽度: 320px
- Handle: left(target) + right(source)

### 4.2 ImageNode 新增「拆解」按钮

**文件**: `frontend/src/nodes/ImageNode.tsx`

- 头部右侧加「拆解」按钮（loading 状态下禁用 + 显示旋转动画）
- 点击流程:
  1. 调用 `POST /api/analyze-image` with `{ base64, mimeType }`
  2. 成功后: 在画布上创建 PromptAnalysisNode，位置 = `{ x: node.x + 280, y: node.y }`
  3. 同时创建一条 edge: ImageNode → PromptAnalysisNode
  4. 使用 `useReactFlow().setNodes / setEdges` 插入
  5. 触发 `canvas-refresh` 持久化

### 4.3 App.tsx

- `nodeTypes` 新增 `promptAnalysis: PromptAnalysisNode`
- 右键菜单新增「结构化提示词」选项（手动创建空节点）

---

## 五、.env 新增

```
DASHSCOPE_API_KEY=sk-a58192a595934e2491a24f142bba260e
```

---

## 六、JSON → 提示词重组规则

后端在返回时做一次重组，将嵌套 JSON 合成自然语言:

```
{characters描述}, {action}, {setting.location}, {setting.era}风格,
{lighting.direction}{lighting.tone}光线, {composition.shot_type},
{style.aesthetic}, {style.color_palette}色调
```

前端修改字段后，实时重组 `reconstructedPrompt` 字符串（纯前端 JS 逻辑，无需再调 API）。

---

## 七、错误处理

- API 调用失败: ImageNode 上显示红色提示 "分析失败，请重试"
- JSON 解析失败: 返回空结构 + 提示用户手动填写
- 网络超时: 30s 超时限制

---

## 八、文件改动清单

| 文件 | 改动 |
|------|------|
| `backend/index.js` | 新增 `POST /api/analyze-image` 接口 |
| `backend/.env` | 新增 `DASHSCOPE_API_KEY` |
| `frontend/src/nodes/PromptAnalysisNode.tsx` | 新建文件 |
| `frontend/src/nodes/ImageNode.tsx` | 新增「拆解」按钮 + 逻辑 |
| `frontend/src/App.tsx` | 注册 `promptAnalysis` 节点类型，右键菜单新增选项 |
