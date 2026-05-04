# 壹镜 Agent 设计室

> 这个 vault 是壹镜 AIGC Canvas 的 **agent 设计台与提示词库**。
> 代码在 `../backend/`，这里负责设计、迭代、记录。

## 快速导航

| 区域 | 说明 |
|------|------|
| [[Agents/00-架构总览]] | Agent 整体架构与数据流 |
| [[Agents/01-故事圣经]] | STORY_BIBLE_PROMPT · 当前生产版本 |
| [[Agents/02-角色小传]] | CHARACTER_BIOS_PROMPT |
| [[Agents/03-资产登记]] | ASSET_REGISTRY_PROMPT · 多提示词版 |
| [[Agents/04-集数大纲]] | EPISODE_MAP_PROMPT |
| [[Agents/05-逐集剧本]] | WRITE_EPISODE_PROMPT |
| [[Agents/06-集数摘要]] | SUMMARIZE_PROMPT |
| [[Styles/00-画风总览]] | 所有画风 style token 一览 |
| [[Research/NanoBanana生图技巧]] | 漫剧生图最佳实践 |
| [[Design/Agent扩展规划]] | 下一步要做的 agent |

## 同步规则

- **Obsidian → 代码**：在这里迭代 prompt → 测试满意后手动更新 `backend/index.js`
- **代码 → Obsidian**：改了代码里的 prompt → 同步更新这里并注明版本
- prompt 版本号格式：`v主.次`，每次上生产 +1

## 当前模型配置

| 用途 | 模型 | max_tokens |
|------|------|-----------|
| 剧本创作（主力）| qwen-max | 4096–8192 |
| 集数摘要 | qwen-turbo | 512 |
