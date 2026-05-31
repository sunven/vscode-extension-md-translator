# 设计：为 MD Translator 增加多翻译方式（Google / 微软 / AI）

由 /office-hours 生成，日期 2026-05-30
分支：master
仓库：sunven/vscode-extension-md-translator
状态：APPROVED
模式：Builder
参考研究：`reports/2026-05-30-read-frog-translation-implementation-1910/`（read-frog @ `c9b157ad`）

## 问题陈述

扩展当前只支持一种翻译方式：OpenAI 兼容的 LLM（`openaiClient.ts`）。需要在保留 AI 翻译的前提下，新增 **Google 翻译** 和 **微软翻译** 两种方式，由用户自由切换。新增方式参考 `mengxi-ream/read-frog` 的实现。

## 这个功能的价值

- **零门槛翻译**：Google/微软走免费非官方端点，无需任何 API Key，安装即用 —— 对比 AI 必须先配置 key + baseURL + model。
- **更快/更省**：纯机器翻译对单文件 Markdown 响应快、零成本，适合不需要 LLM 语境感知的场景。
- **可扩展骨架**：一次性把"翻译方式"抽象成 provider 接口，以后加 DeepL / DeepLX 只是再实现一个 provider。

## 约束

- 不重写现有 AI 链路与 `parse → batch → validate → preview → replace` 管线，只做增量。
- Google/微软使用免费非官方端点（用户决策），不引入官方付费 API。
- 翻译方式通过全局配置项 `mdTranslator.provider` 选择，并提供一个切换命令（用户决策）。
- 保持现有依赖注入测试接缝（`MarkdownTranslationDependencies`）可用。

## 前提（已与用户确认）

1. **纯增量**：新增两个非 AI provider，挂在 provider 开关后；现有 AI 路径与整条 parse→batch→validate→preview→replace 管线原样复用。
2. **复用 Markdown 引擎**：`markdownSegments.ts`（解析/切分/分批/回填/校验）与 `translateMarkdown.ts` 编排 + 预览均与 provider 无关，原样复用；只有"调用翻译"这一步按 provider 变化。
3. **Provider 契约 = segments 进、`Map<id,text>` 出**：Google/微软翻译有序文本数组，**按数组下标**映射回 segment id（不用 JSON-id 协议）。微软原生支持批量；Google 需自己的分批策略。
4. **目标语言需要语言码**：新增 `mdTranslator.targetLanguageCode`（默认 `zh-CN`）供 Google/微软使用；AI 仍用自由文本 `targetLanguage` 作为 prompt 中的语言名。
5. **免 Key ⇒ 接受脆弱性**：`provider != ai` 时跳过 API Key 提示；文档需说明 Google/微软走非官方端点，可能限流或失效，并给出清晰错误。
6. **行内强调标记是未受保护的风险**：现有分段器剥离了代码/链接/URL，但没剥离 `**bold**`/`*italic*`；纯文本调用 Google/微软可能破坏这些标记，而 `validateTranslatedMarkdown` 不会检测到。v1 接受此风险（强调标记通常能存活）并写入文档；后续迭代可 tokenize 强调标记或改发 `textType=html`。

## read-frog 参考要点（来自源码 @ `c9b157ad`）

### Google 翻译（免费 / 非官方）
- `POST https://translate-pa.googleapis.com/v1/translateHtml`
- Header：`Content-Type: application/json+protobuf`、`X-Goog-API-Key: AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520`（Google 翻译网页组件内置的公开 key，非用户 key）
- Body：`[[[sourceText], fromLang, toLang], "wt_lib"]`
- 响应：嵌套数组，译文在 `result[0][0]`
- read-frog 每次只发一条文本。本设计计划发**整批数组**（见下方 Google provider）。

### 微软翻译（免费 / edge）
- 鉴权：`GET https://edge.microsoft.com/translate/auth` → 返回 JWT token（纯文本，约 10 分钟有效）
- 翻译：`POST https://api-edge.cognitive.microsofttranslator.com/translate?from={from}&to={to}&api-version=3.0&includeSentenceLength=true&textType=html`
- Header：`Ocp-Apim-Subscription-Key: {token}`、`Authorization: Bearer {token}`
- Body：`[{ "Text": "..." }, ...]` —— **原生批量**
- 响应：`[{ "translations": [{ "text": "..." }] }, ...]`，顺序与输入一致
- `from=auto` 时传空串

### 分流设计（`execute-translate.ts`）
- `isNonAPIProvider` → google-translate / microsoft-translate（无需 key）
- `isLLMProviderConfig` → aiTranslate
- 语言码：Google/微软用 ISO 639-1（`zh-CN`）；LLM 用语言英文名。
- read-frog 的核心判断「provider 抽象是统一配置，不是统一协议」—— 本设计据此设计接口：调用统一，但各 provider 自己处理语言码/鉴权/解析。

## 备选方案

### 方案 A：最小函数选择器
加 provider 配置 + 切换命令；新增 `googleClient.ts`/`microsoftClient.ts` 各导出一个返回 `Map<id,text>` 的函数；`translateMarkdown` 按 provider 选函数。AI 保留原有回退，Google/MS 走简化调用。
- 工量：S–M｜风险：低｜复用：几乎全部
- 缺点：provider 判断散落在多处 if，扩展时易漏改

### 方案 B：Provider 接口抽象（已选 ✅）
定义 `TranslationProvider` 接口，实现 OpenAI/Google/Microsoft 三个 provider，按配置 resolve。复用现有依赖注入接缝（把 `translateSegmentsWithOpenAI` 依赖换成 resolved provider）。AI 特有的重试/单段回退逻辑收进 AI provider。
- 工量：M｜风险：低｜复用：Markdown 引擎 + 编排 + 预览全部复用
- 优点：边界清晰、可分 provider 单测、以后加 DeepL 只加一个文件

### 方案 C：HTML 段落统一管线
把每个 segment 渲染为极简 HTML，对所有 provider 发 `textType=html`，由翻译引擎原生保留行内标记。
- 工量：L｜风险：中
- 否决：对分段模型和校验改动最大，对一个文件翻译器属过度设计

## 推荐方案（B）详细设计

### 1. Provider 接口

新增 `src/translationProvider.ts`：

```ts
export type ProviderId = 'ai' | 'google' | 'microsoft'

export interface ProviderTranslationContext {
  settings: TranslationSettings & { forceTranslate?: boolean }
  apiKey?: string              // 仅 AI 需要
  targetLanguageCode: string   // zh-CN，供 Google/微软
  targetLanguageName: string   // "Simplified Chinese"，供 AI prompt
  sourceLanguageCode: string   // 默认 "auto"
  reporter?: TranslationRecoveryReporter
}

export interface TranslationProvider {
  readonly id: ProviderId
  readonly requiresApiKey: boolean
  // 输入一批 segments，返回 id -> 译文。各 provider 自行处理批内重试/错误。
  translateSegments(
    segments: TranslationSegmentInput[],
    context: ProviderTranslationContext,
  ): Promise<Map<string, string>>
}

export function resolveProvider(id: ProviderId): TranslationProvider
```

- **OpenAIProvider**：包装现有 `translateSegmentsWithOpenAI`，并把现有 `translateBatchWithRecovery` + 单段 JSON 回退逻辑收进它的 `translateSegments`。`requiresApiKey = true`。
- **GoogleProvider**、**MicrosoftProvider**：`requiresApiKey = false`，按下方实现。所有 HTTP/解析错误包装成 `TranslationClientError`，让编排层的进度/错误展示统一工作。

### 2. 编排层改动（`translateMarkdown.ts`）

- 把 `MarkdownTranslationDependencies.translateSegmentsWithOpenAI` 替换为 `resolveProvider`（或直接注入一个 `provider: TranslationProvider`），保留依赖注入可测性。
- `translateBatchesIntoMap` 内的 `translateBatchWithRecovery(...)` 改为 `provider.translateSegments(batch, ctx)`；AI 特有的恢复逻辑随之移入 OpenAIProvider。
- **Key 提示按 provider 类型门控**：

```ts
const provider = resolveProvider(settings.provider)
let apiKey: string | undefined
if (provider.requiresApiKey) {
  apiKey = await dependencies.getApiKey(context)
  if (!apiKey) { /* 现有的提示/设置 key 流程 */ return }
}
```

- **"译文与原文相同就强制重试"块（`translatedText === originalText`）门控为仅 AI**：`forceTranslate` 是 AI prompt 技巧，对 Google/微软无意义。Google/微软返回与原文相同时，多半是已是目标语言或不可译，不应强制重试。

### 3. Google provider

- 端点/Header/key 同 read-frog。
- **批量**：read-frog 每次发一条；本设计把整个 batch 作为文本数组发送：Body `[[texts, from, to], "wt_lib"]`，读取 `result[0]` 作为有序译文数组，按下标映射 `segments[i].id`。
- from = `auto`；to = `targetCodeFor(settings.targetLanguage)`。
- **批量已被佐证**：kiss-translator `genGoogle2`（`src/apis/trans.js:474`）对同一 `translate-pa` 端点发送多元素 `texts` 数组，证实数组批量可用（read-frog 仅发单条）。
- **长度守卫（评审决议）**：必须断言 `result[0].length === batch.length`，不等时抛清晰错误；**不要静默逐段 fan-out**（40 段批量逐段 = 40 次请求，非官方端点极易限流）。
- 复用共享 `zipByIndex(segments, texts)` 与 `normalizeTranslatedText`。

### 4. Microsoft provider

- 先 `refreshMicrosoftToken()`（GET edge auth），**进程内缓存 token + 过期时间**，遇 401 再刷新。
- 翻译端点同 read-frog；Body = `segments.map(s => ({ Text: s.text }))`，响应按下标映射回 id。
- 原生批量；现有 `maxSegmentsPerChunk`(40) / `maxChunkChars`(20000) 远在微软单请求上限（约 1000 条 / 50000 字符）内，分批逻辑直接复用。
- **超时（评审决议）**：用 `AbortController` + `requestTimeoutMs`（仿 `openaiClient.ts:62-63`）；翻译请求 401 时刷新 token 重试一次；长度不等时抛清晰错误，复用 `zipByIndex`。

### 5. 配置与命令

`package.json` 新增：
- `mdTranslator.provider`：enum `["ai","google","microsoft"]`，默认 `"ai"`，带 `enumDescriptions`。
- **不新增** `targetLanguageCode`（评审决议：单一来源，避免漂移）。沿用现有 `targetLanguage`（语言名）作为唯一目标语言来源；Google/微软所需的语言码由 `language.ts` 的名称→码映射表派生。
- 命令 `mdTranslator.selectProvider`（标题如「选择翻译方式」）：QuickPick 三选一，写入全局配置；注册到 `commands`、`activationEvents`、（可选）标题栏菜单。

`package.nls.json` / `package.nls.zh-cn.json` 新增对应文案。

### 6. 语言码处理（评审决议：单一来源 + 映射表）

新增 `src/language.ts`：
- 唯一来源是现有的 `targetLanguage`（语言名，如 `Simplified Chinese`）。
- `targetCodeFor(name)`：名称→ISO 639-1 码映射表（`Simplified Chinese→zh-CN`、`Traditional Chinese→zh-TW`、`English→en`、`Japanese→ja` 等常用项），供 Google/微软使用；**映射不中时抛清晰错误**（提示用户改用受支持语言名或切回 AI），不静默回退。
- AI 继续直接用 `targetLanguage` 名。
- 顺带把 `openaiClient.ts` 的 `normalizeTranslatedText` 抽到共享处，Google/微软结果走同一规范化，使 `applyTranslations` 一致回填。
- 源语言固定 `auto`（微软空串、Google `"auto"`）。v1 不暴露源语言设置。

### 7. 校验与安全

- `validateTranslatedMarkdown` 原样保留（front matter / 代码块 / 链接 / 表格列数不变）。
- 文档标注前提 6（行内强调标记风险）。
- 错误统一包成 `TranslationClientError`，复用现有错误展示与进度。

## 核心文件改动清单

| 文件 | 改动 |
|---|---|
| `src/translationProvider.ts` | 新增：接口、`resolveProvider`、OpenAI/Google/Microsoft 三 provider（或拆分文件） |
| `src/openaiProvider.ts` | 新增：包装现有 raw 调用 + 收纳逐批恢复逻辑（从 translateMarkdown.ts 迁入） |
| `src/googleClient.ts` | 新增：Google 端点 + 批量数组 + 长度守卫 + 超时 |
| `src/microsoftClient.ts` | 新增：edge auth token 缓存 + 批量 + 401 重试 + 超时 |
| `src/language.ts` | 新增：名称→语言码映射；抽出共享 `normalizeTranslatedText` 与 `zipByIndex` |
| `src/openaiClient.ts` | 微调：导出/迁出 `normalizeTranslatedText` 供共享 |
| `src/config.ts` | 新增 `provider` 读取（**不加** targetLanguageCode） |
| `src/translateMarkdown.ts` | resolve provider、Key 提示门控、unchanged-retry 仅 AI、逐批恢复迁出 |
| `src/extension.ts` | 注册 `selectProvider` 命令 |
| `package.json` / `*.nls*.json` | 新 `provider` 配置 + 新命令 + 文案 |
| `src/test/*` | 迁移恢复/unchanged 测试到 `openaiProvider.test.ts`；新增 google/microsoft/resolve/language/门控测试 |

## 未决问题

1. ~~Google 批量数组是否稳定？~~ 已佐证（kiss-translator `genGoogle2` 用多元素数组）。落地仍加长度守卫。
2. 切换命令写入全局还是工作区配置？（建议全局；如需可在 QuickPick 后再问作用域）
3. 是否需要状态栏显示当前 provider？（nice-to-have，可后置）
4. 微软 token 是否跨会话持久化？（建议仅进程内缓存，遇 401 刷新）

## 成功标准

- 三种 provider 均可对同一 `.md` 完成翻译并通过 `validateTranslatedMarkdown`。
- Google/微软无需任何 API Key 即可工作；切换命令即时生效。
- AI 路径行为与现状完全一致（回退/重试/校验不回归）。
- Google/微软对含代码块、链接、表格的 Markdown，结构校验全部通过。
- google/microsoft/provider-resolve 三类单测通过；现有 openaiClient 测试不回归。

## 分发计划

已是 Marketplace 发布扩展（publisher `sunven`，已有 `af72551` 发布 workflow）。
- 复用 `npm run package`（vsce）+ 现有 release workflow。
- 版本从 `0.0.7` 升到 `0.1.0`（minor，新功能）。
- README / CHANGELOG 增加 provider 说明与「Google/微软为非官方端点」免责声明。

## 下一步（实现顺序）

1. 配置：加 `provider` 读取 + NLS 文案（**不加** targetLanguageCode）。
2. `language.ts`：名称→码映射 + 抽出共享 `normalizeTranslatedText` / `zipByIndex`。
3. 定义 `TranslationProvider` 接口 + `ProviderTranslationContext`。
4. OpenAIProvider：包装现有 raw 调用 + **迁入**逐批恢复逻辑；迁移 5 个恢复/unchanged 测试到 `openaiProvider.test.ts`。
5. GoogleProvider（批量数组 + 长度守卫 + 超时）。
6. MicrosoftProvider（token 缓存 + 401 重试 + 超时）。
7. `resolveProvider` 接入 `translateMarkdown`（非 AI 跳过 key 提示、unchanged-retry 仅 AI 门控）。
8. `selectProvider` 命令 + 注册。
9. 新增 google/microsoft/resolve/language/门控测试 + 3 个回归测试。
10. README/CHANGELOG + 版本号 `0.1.0` + package。

## 我注意到的几点

- 你把翻译链路拆成 raw-token + prose-segment 的设计，让"换一个不懂 Markdown 的纯机器翻译引擎"几乎零成本 —— 这是这次能做成增量而非重写的关键。
- 你已经为 read-frog 跑了一整套 deep-research 报告再来设计，先研究后动手；这份设计直接站在那份报告的肩膀上。
- 现有 `MarkdownTranslationDependencies` 的依赖注入接缝，正好让 provider 抽象顺势接入而不破坏可测性 —— 当初为可测性写的代码，这次回报了扩展性。

---

# 工程评审（plan-eng-review · 2026-05-30）

## 评审决议（已逐项确认）

1. **架构**：维持方案 B（`TranslationProvider` 接口），已知并接受约 10 个编排测试的迁移成本（CC 重写很便宜）。
2. **恢复逻辑**：逐批恢复（重试 + 单段回退）**收进 OpenAIProvider**；编排层统一调 `provider.translateSegments(batch, ctx)`。全文 unchanged-retry 块留在编排层但门控 `provider.id==='ai'`。
3. **语言配置**：单一 `targetLanguage`（语言名）来源 + `language.ts` 名称→码映射；映射不中抛清晰错误。**不新增** `targetLanguageCode`。
4. **Google 批量（佐证 + 守卫）**：数组批量已被 kiss-translator 佐证；落地必须 `result[0].length === batch.length` 守卫，**不静默逐段 fan-out**。
5. **超时/取消**：Google/微软客户端用 `AbortController` + `requestTimeoutMs`，并尊重编排层 `cancellationToken`；微软 token 模块级缓存、401 刷新一次。
6. **DRY/一致性**：共享 `zipByIndex(segments, texts)` 与 `normalizeTranslatedText`；所有 provider 错误包成 `TranslationClientError`。

## What already exists（复用，不重建）

| 已有 | 复用方式 |
|---|---|
| `markdownSegments.ts`（parse/split/batch/apply/validate） | 原样复用，provider 无关 |
| `translateMarkdown.ts` 编排 + 预览 + replace/discard | 原样复用，仅换"调用翻译"那一步 |
| `TranslationClientError` + `buildBatchTranslationError`(:654) | Google/微软错误复用同一类型与展示 |
| `translateBatchWithRecovery` + 单段回退(:575,:639) | 迁入 OpenAIProvider，行为不变 |
| `MarkdownTranslationDependencies` DI 接缝 | provider 经此注入，保持可测 |
| `normalizeTranslatedText`(:328) | 抽共享，三 provider 统一规范化 |

## NOT in scope（明确推迟）

- **行内强调标记保护**（`**bold**`/`*italic*`）：v1 接受 Google/微软可能损坏，文档标注；见下方 TODO。
- **官方付费 API**（Azure / Google Cloud Translation）：office-hours 已否决免费方案之外的路径；接口就绪后可作 opt-in。
- **DeepL / DeepLX provider**：read-frog 有；接口就绪后再加一个 provider 即可。
- **状态栏显示当前 provider**：nice-to-have。
- **源语言可选**：v1 固定 `auto`。
- **选区/划词翻译、整文档流式**：read-frog 的浏览器场景，不适用文件翻译器。

## Test Plan（供 /qa 消费）

**受影响命令/入口**
- `mdTranslator.translateMarkdownToChinese`（三 provider 都走它）
- `mdTranslator.selectProvider`（新命令，QuickPick 写配置）

**关键交互**
- 切换 provider 后立即生效；Google/微软不弹 API Key 提示
- AI 路径（含恢复/unchanged-retry）行为不回归

**边界**
- Google `result[0]` 长度不等 → 清晰错误（不 fan-out）
- 微软 token 过期/401 → 刷新一次重试
- 端点 429/离线/超时 → 清晰可重试错误
- Google/微软返回与原文相同 → 走 `validateTranslatedMarkdown` 的 identical 错误，不强制重试
- 含代码块/链接/表格的 Markdown → 结构校验通过

**关键路径（必须可用）**
- 选 Google → 翻译 .md（无 key）→ 预览 → 替换
- 选微软 → 翻译 → 预览 → 替换
- 选 AI（默认）→ 与现状完全一致

## 失败模式 × 是否兜底

| 新码路 | 现实失败 | 有测试 | 有错误处理 | 用户可见 |
|---|---|---|---|---|
| googleClient | 端点限流/封禁(429) | 计划新增 | TranslationClientError(status) | 是 |
| googleClient | `result[0]` 长度不等 | 计划新增 | 抛错不 fan-out | 是 |
| microsoftClient | auth token 端点失效 | 计划新增 | 清晰错误 | 是 |
| microsoftClient | 翻译 401（token 过期） | 计划新增 | 刷新重试一次 | 否→是 |
| 两者 | 请求超时 | 计划新增 | AbortController 超时错误 | 是 |
| language.ts | 目标语言名不可映射 | 计划新增 | 抛清晰错误 | 是 |

无"无测试 AND 无错误处理 AND 静默"的关键缺口 —— 前提是上述计划测试 + 守卫都落地。

## 并行化策略

| 步骤 | 触及模块 | 依赖 |
|---|---|---|
| language.ts + normalize 抽取 | language/openaiClient | — |
| TranslationProvider 接口 | translationProvider | language |
| OpenAIProvider + 测试迁移 | openaiProvider/openaiClient | 接口 |
| GoogleProvider | googleClient | 接口、language |
| MicrosoftProvider | microsoftClient | 接口、language |
| 编排接入 + 门控 | translateMarkdown | 上述 provider |
| 命令 + 配置 + NLS | extension/package | — |

- Lane A: language → 接口 →（OpenAIProvider / GoogleProvider / MicrosoftProvider 三者并行）→ 编排接入（顺序汇合）
- Lane B: 命令 + 配置 + NLS（独立，可并行）
- 冲突点：三个 provider 都依赖接口与 language，须先合并接口再并行；编排接入是三者的汇合点，最后做。

## Implementation Tasks

- [ ] **T1 (P1, human ~30min / CC ~5min)** — language — 名称→码映射 + 抽出共享 `normalizeTranslatedText`/`zipByIndex`
  - Surfaced by: 架构/代码质量 — 单一语言来源 + DRY
  - Files: `src/language.ts`, `src/openaiClient.ts`
  - Verify: `language.test.ts`（已知名→码、未知名→错误）
- [ ] **T2 (P1, human ~30min / CC ~10min)** — provider — 定义 `TranslationProvider` 接口 + `ProviderTranslationContext` + `resolveProvider`
  - Surfaced by: 架构 — 方案 B
  - Files: `src/translationProvider.ts`
  - Verify: `resolveProvider` 单测（ai/google/microsoft/未知）
- [ ] **T3 (P1, human ~2h / CC ~15min)** — openaiProvider — 包装 raw 调用 + 迁入恢复逻辑；迁移 5 个测试
  - Surfaced by: 架构 Issue 1 — 恢复收进 OpenAIProvider
  - Files: `src/openaiProvider.ts`, `src/translateMarkdown.ts`, `src/test/openaiProvider.test.ts`
  - Verify: 迁移后 5 个恢复/unchanged 测试通过（行为不变）
- [ ] **T4 (P1, human ~1h / CC ~10min)** — googleClient — 批量数组 + 长度守卫 + 超时 + 错误包装
  - Surfaced by: 架构折叠项 + 性能 — 守卫不 fan-out
  - Files: `src/googleClient.ts`, `src/test/googleClient.test.ts`
  - Verify: happy/长度不等/429/超时（mock fetch）
- [ ] **T5 (P1, human ~1.5h / CC ~10min)** — microsoftClient — token 缓存 + 401 重试 + 批量 + 超时
  - Surfaced by: 架构折叠项
  - Files: `src/microsoftClient.ts`, `src/test/microsoftClient.test.ts`
  - Verify: happy/401-刷新/长度不等/超时（mock fetch）
- [ ] **T6 (P1, human ~1h / CC ~10min)** — translateMarkdown — provider 选择 + key 门控 + unchanged-retry 仅 AI
  - Surfaced by: 架构 — 门控
  - Files: `src/translateMarkdown.ts`, `src/test/extension.test.ts`
  - Verify: google/ms 不弹 key；ai unchanged 仍重试（回归）
- [ ] **T7 (P2, human ~45min / CC ~10min)** — extension/config — `selectProvider` 命令 + `provider` 配置 + NLS
  - Surfaced by: office-hours 决策 — 全局配置 + 切换命令
  - Files: `src/extension.ts`, `src/config.ts`, `package.json`, `package.nls*.json`
  - Verify: 命令存在 + 本地化键测试（现有 :31-45）
- [ ] **T8 (P1, human ~1h / CC ~10min)** — test — 3 个关键回归测试
  - Surfaced by: 测试 IRON RULE — 3 个 CRITICAL 回归
  - Files: `src/test/*`
  - Verify: ①恢复迁移后行为不变 ②AI unchanged-retry 保留 ③AI 整体流程不变
- [ ] **T9 (P2, human ~30min / CC ~5min)** — docs — README/CHANGELOG + 版本 `0.1.0` + 非官方端点免责声明
  - Surfaced by: 分发计划
  - Files: `README.md`, `CHANGELOG.md`, `package.json`
  - Verify: `npm run package` 成功

## Completion Summary

- Step 0 Scope Challenge — 维持方案 B（复杂度触发，但为 office-hours 既定选择；测试迁移成本已知并接受）
- Architecture Review — 2 issues（恢复位置、语言漂移），均已决议 + 2 折叠指令（Google 守卫、超时/取消）
- Code Quality Review — 3 指令（zipByIndex DRY、normalize 一致性、错误包装），无阻塞决策
- Test Review — 覆盖图已出，识别 GAP 多处，3 个 CRITICAL 回归（强制写测试）
- Performance Review — 1 note（Google 长度不等不 fan-out），无 N+1/内存问题
- NOT in scope — 已写（6 项）
- What already exists — 已写（6 项复用）
- Failure modes — 0 关键静默缺口（前提：计划测试 + 守卫落地）
- Parallelization — 2 lanes（A 顺序汇合、B 独立并行）
- Lake Score — 完整选项采纳：恢复隔离 + 单一语言源 + 长度守卫 + 超时 + 3 回归测试，均选完整版

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 2 issues resolved, 3 directives, 3 critical regression tests required, 0 silent gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI surface beyond a QuickPick) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0 — all four decision points answered (scope, recovery location, language config; folded directives accepted).
- **VERDICT:** ENG CLEARED — design is implementation-ready. Office-hours produced the design; this review locked architecture, test coverage, and edge cases. Run /ship when implemented.
