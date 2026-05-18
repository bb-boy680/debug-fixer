## 路径约定

本 skill 中所有路径相对于 `<skill base directory>` 解析。

---

# 记忆库系统

## 文档描述

本文档定义 debug-fixer 的记忆管理机制：何时生成记忆、如何读取记忆、记忆文件的格式标准。

记忆仅在**修复成功**时生成，记录根因、修复方式和关键教训，供后续相似 BUG 快速定位。修复失败不生成记忆。

本文档在【多维分析】步骤 1"获取记忆"时被调用（读取），在【用户交互】Mark Fixed 时触发写入。

---

## 核心原则

1. **修成功才记，失败不记**：仅 BUG 被修复后生成记忆。失败方向记录为当前 session 的负向约束，不持久化。
2. **轻量极简**：每个记忆 ≤ 200 行，只记录关键信息，不保存完整日志或源码。
3. **文件名即索引**：文件名描述修复内容，3~10 词，如 `sidebar-zindex-overlap.md`。冲突时追加 `-2`、`-3` 后缀。
4. **自动脱敏**：
   - 字段名含 `password`/`secret`/`token`/`apiKey`/`credential` → 值替换为 `[REDACTED]`
   - 完整页面文本不写入，只保留关键字段摘要
   - 用户个人信息替换为 `[REDACTED]`

---

## 禁止行为

- **禁止修复失败时生成记忆**：只记录未定位根因的模块和已排除方向作为负向约束，不生成 `.md` 文件。
- **禁止自创格式**：必须按 `<skill base directory>/templates/memory-fix.md` 模板生成，不得自行设计结构。
- **禁止记录完整源码或日志**：堆栈保留关键帧即可，日志只提取偏差相关的 1~2 条。
- **禁止包含敏感信息**：模板中敏感字段必须脱敏后再写入。

---

## 触发时机

| 事件 | 动作 |
|------|------|
| 【多维分析】步骤 1 | 读取记忆库，搜索相似 BUG |
| Mark Fixed（修复成功） | 按模板生成记忆文件 → 写入 `.debug/memory/` → 更新 `MEMORY.md` 索引 |
| Proceed / 方向重启 | 不生成记忆，仅记录负向约束至当前 session |

---

## 记忆文件格式

必须使用 `<skill base directory>/templates/memory-fix.md` 模板，包含：

- **YAML 元数据**：`title`（标题）、`description`（一句话描述）、`time`（修复时间）
- **正文**：
  - 调用堆栈（逻辑 BUG）或样式链（视觉 BUG）
  - BUG 症状与正确行为
  - 错误源头（偏差位置 + 产生原因）
  - 正确性假设（修复验证通过的假设）
  - 修复方式（diff 格式）
  - 关键教训（非显而易见的洞察）
  - 修复结果

---

## 记忆索引文件

`.debug/MEMORY.md` 是所有记忆文件的快速索引，一行一条，格式如下：

```markdown
# Debug Memory Index

- [流程图放大超过100%失效](mermaid-zoom-100-percent-fix.md) — CSS优先级导致max-width未正确覆盖
- [滚轮缩放不跟随鼠标](mermaid-wheel-zoom-mouse-follow-fix.md) — handleWheel缺少offset补偿
```

**写入规则**：
- Mark Fixed 生成记忆文件后，必须同步追加一条到 `MEMORY.md`（文件不存在则先创建）
- 每条格式：`- [标题](文件名.md) — 一句话描述`
- 索引按时间倒序排列（最新追加在最后）

**为什么需要索引？** 1.2 搜索记忆时，先用 Grep 搜 `MEMORY.md` 的关键词（省 token，不用逐个读 `.md` 文件），命中后再读对应记忆文件。

---

## 记忆检索

【多维分析】步骤 1 执行时：

1. **先搜索引**：Grep `MEMORY.md`，用模块名/症状关键词匹配条目 → 命中则读对应记忆文件
2. **再搜文件**：索引未命中时，Grep `.debug/memory/` 目录下 `.md` 文件名和内容
3. 优先匹配同模块/同文件的历史记忆
4. 提取匹配记忆中的"错误源头"和"关键教训"，作为当前假设生成的输入
5. 无匹配则跳过，不强制关联

---

## 与其它参考文档的协同

- 模板定义：`<skill base directory>/templates/memory-fix.md`
- 生成触发：【用户交互】Mark Fixed
- 读取触发：【多维分析】步骤 1
- 负向约束（不持久化）：由 `<skill base directory>/references/direction-doubt.md` 和 `<skill base directory>/references/restart-strategy.md` 管理
