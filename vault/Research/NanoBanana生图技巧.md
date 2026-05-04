# NanoBanana 生图技巧

> NanoBanana = Google Gemini 驱动的生图平台，支持参考图输入。
> 这是我们目前生图的主要平台。

## 核心优势

- ✅ 支持参考图（Reference Image）输入 → 一致性利器
- ✅ 中文 prompt 接受度高（Gemini 本身理解中文）
- ✅ 漫画/动漫风格效果好

## 参考图使用技巧（一致性核心）

### Master Shot 工作流

```
步骤 1：生成 Master Shot（建立镜头/全景图）
        → 这张图定义了场景的 lighting, color palette, art style

步骤 2：以 Master Shot 为参考图 + 加入以下固定句
        "Maintain the same environment, lighting, color palette, 
         and art style as the reference image. 
         Change only: [你想改变的部分]"

步骤 3：每个角度变体都以 Master Shot 为参考
```

### 角色一致性工作流

```
步骤 1：生成角色正面图（或三视图中的正面部分）

步骤 2：以正面图为参考，生成其他角度/表情/服装变体
        固定句："Same character as reference image. 
                 [你想改变的内容，如：Side profile view only.]
                 Same art style, same character design."

步骤 3：如需生成角色在特定场景中，同时上传角色图+场景图
        固定句："Place the character from [image 1] 
                 into the scene from [image 2]."
```

## Prompt 格式最佳实践

### 结构顺序

```
[镜头/构图描述]
[主体描述（人物或场景）]
[参考图约束句（如有参考图）]
[画风标签]
[质量标签]
```

### 质量标签

```
high quality, masterpiece, best quality, detailed
```
（不需要写 8K、photorealistic 等，NanoBanana 自动处理分辨率）

## 角色三视图技巧

```
White background. Clean. Minimalist.
Left section: full body front view | Center: side profile | Right: back view.
Same character. Same clothes. Same height across all three.
[角色描述]
[画风标签]
```

关键：`Same character. Same clothes. Same height across all three.` 这句话显著提升三视图一致性。

## 常用固定句速查

| 场景 | 固定句 |
|------|--------|
| 场景角度变换 | `Maintain the same environment, lighting, color palette, and art style as the reference image. Change only: [角度].` |
| 角色角度变换 | `Same character as reference image. [改变项]. Same art style.` |
| 人物置入场景 | `Place the character from the reference into this scene. Keep character design unchanged.` |
| 三视图锁定 | `Same character, same clothes, same height across all three views.` |
| 情绪变化 | `Same character. Same clothes. Change only: facial expression to [emotion].` |

## 已知限制

- 手部经常出错（多手指/畸形），加 `perfect hands, correct anatomy` 可减少但不能根除
- 超过 2 个角色同框时一致性下降
- 动态姿势（打斗/跑动）一致性比静态差很多

## 与 GPT Image 2 对比

| 项目 | NanoBanana | GPT Image 2 |
|------|-----------|------------|
| 参考图支持 | ✅ | ✅ |
| 漫画风格 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 写实风格 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 中文 prompt | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 生成速度 | 快 | 慢 |
| 价格 | - | - |
