# Synthesis

## 原始问题

用户要求研究 `https://github.com/mengxi-ream/read-frog` 这个库，重点了解“翻译如何实现”。本次研究以 2026-05-30 可获取的默认分支源码为准，本地克隆与远端 HEAD 均核验为 `c9b157ad56a42d2ba691cbbbbc9859d378802f5d`。

## 主线判断

1. read-frog 的翻译实现不是一个单点函数，而是浏览器扩展架构下的端到端流水线。页面翻译由 popup、浮动按钮、右键菜单、快捷键、自动翻译等入口触发，先经过 background 维护 tab 级状态，再由 host content script 的 `PageTranslationManager` 执行 DOM walk、懒翻译、结果插入和清理。选区翻译则是单独的 selection content UI，走 React 弹层和流式状态。

2. 待翻译输入采用“局部文本 + 可选网页上下文”的设计。页面翻译按 DOM paragraph/inline group 分段，并用 IntersectionObserver 对可见内容懒加载；节点翻译从鼠标命中的 block node 进入同一 DOM 翻译链；选区翻译读取 Selection 快照和段落上下文。LLM provider 可额外加入网页标题、正文片段和摘要，以弥补局部分段带来的语境不足。

3. 请求执行层把 provider、prompt、队列、缓存和流式输出拆开处理。Google/Microsoft、DeepL/DeepLX 和 LLM provider 分别有不同执行路径；页面/节点翻译主要走 `translateTextCore -> background queue -> executeTranslate` 的非流式链路，支持 Dexie 缓存、限速、重试和 LLM 批处理；选区 LLM 翻译走 background runtime port 流式输出。

4. 结果展示层分成两种体验模型：页面/节点翻译直接改宿主 DOM，选区翻译在 React 弹层中展示。页面翻译有 bilingual 和 translationOnly 两种 DOM 回填模式，并通过 wrapper、`notranslate`、spinner、错误 shadow host 和 restore 逻辑控制生命周期；选区翻译用 React state 管理 loading、thinking、错误、取消和重新生成。

5. 可复用价值最高的是 provider/prompt/queue/cache/stream 的工程分层；最需要谨慎迁移的是 content script DOM 回填和 WXT 扩展通信。若在其它项目复用，不能只复制某个 API 调用函数，需要同时处理输入分段、请求节流、缓存 key、错误恢复和目标 UI 的状态模型。

## 证据强弱

| 主线判断 | 把握度 | 原因 |
|---|---|---|
| 多入口扩展架构收敛到 background 状态和 content manager | 高 | d1 覆盖 popup、floating button、context menu、host runtime、message protocol；d4 覆盖 background 状态同步与 manager 生命周期 |
| “局部文本 + 可选上下文”的输入构造 | 高 | d2 覆盖 DOM traversal/filter、selection snapshot、webpage context、summary；d3 说明这些上下文进入 prompt/cache key |
| provider/prompt/queue/cache/stream 分层 | 高 | d3 直接定位 `executeTranslate`、provider schema、prompt、`translation-queues`、`RequestQueue`、`BatchQueue`、`background-stream` |
| 页面 DOM 回填与选区弹层展示双轨 | 高 | d4 直接定位 `translation-modes`、`translation-insertion`、`spinner`、selection provider 与 content component |
| 复用建议 | 中高 | 模块边界由源码支撑，但迁移成本判断没有跨项目实测，只能作为源码级工程判断 |

## 跨维度共识

- background 是协调层，不直接操作网页 DOM；它负责状态、跨上下文消息、队列、缓存、provider 调用和流式端口。
- host content script 是页面/节点翻译的执行现场，因为只有它能访问宿主 DOM、ShadowRoot、iframe 和用户交互点。
- selection content script 是独立交互层，重视即时反馈和流式展示，和整页翻译的批量吞吐目标不同。
- 翻译质量、成本与性能的平衡贯穿整个实现：DOM 懒加载降低请求量，LLM 上下文改善语境，队列/缓存/批处理控制吞吐和成本，错误局部展示避免整页失败。

## 关键冲突与解释

- 页面翻译和选区翻译并没有完全复用同一条请求链。页面/节点翻译默认走 background queue 和 cache；选区 LLM 走 stream port，不明显使用 `translationCache`。这不是事实冲突，而是交互目标不同：整页翻译需要吞吐与缓存，选区 LLM 更重视流式响应和可取消。

- DOM 回填有两种模式，bilingual 相对保守，translationOnly 更侵入。二者不是互相矛盾，而是服务不同用户偏好：前者保留原文，后者替换原文。风险集中在 translationOnly 对 `innerHTML` 的保存和恢复。

- provider 抽象统一了“翻译 provider”的配置入口，但执行上并不完全统一。Google/Microsoft/DeepL/LLM 分支的协议、语言码、鉴权和响应处理不同，因此终稿不能把它描述成单一 provider adapter 模式。

## 不确定性与信息缺口

- GitHub REST API 匿名请求触发 rate limit，`sn-search-code` 的 GitHub 脚本因缺少 `httpx` 未成功执行；issue/讨论覆盖不足。结论主要基于源码，而非外部使用反馈。
- 未在真实浏览器中跑复杂页面样本，无法验证 ShadowRoot、iframe、SPA、hydration、translationOnly restore 在边界页面上的实际稳定性。
- 未实测各外部 provider API 的真实可用性、速率限制或错误格式；源码只能说明项目如何调用和处理这些 provider。
- provider/model 支持列表可能随版本快速变化，最终报告必须标注版本范围。

## 对原始问题的回答

read-frog 的翻译实现可以理解为五段链路：入口触发与状态同步、DOM/selection 文本抽取、prompt/provider 请求执行、队列缓存与流式处理、结果回填和错误恢复。整页翻译的核心在 `PageTranslationManager + DOM walker + background translation queue + DOM wrapper insertion`；选区翻译的核心在 `SelectionTranslationProvider + prompt construction + background streamText + React popover state`。如果用户想复用，优先研究和抽取 provider、prompt、队列、缓存、stream 这些低耦合层；页面 DOM 回填只能在明确目标运行环境也是浏览器扩展/content script 时谨慎迁移。

## 对终稿的结构建议

- 摘要：先用 4-5 条结论说明翻译不是单函数，而是扩展多上下文流水线。
- 研究对象与版本范围：写明 `main@c9b157ad`、WXT MV3、源码为主要证据，以及 issue 覆盖限制。
- 翻译链路总览：用 Mermaid 展示“触发 -> 状态 -> 文本抽取 -> 请求层 -> 展示”的端到端流程。
- 核心实现拆解：按入口、输入构造、provider/prompt/request、结果回填与状态四段展开。
- 关键源码矩阵：列出主要文件和职责，帮助开发者回到源码阅读。
- 风险与复用建议：区分可直接学习、需适配、不要直接搬运的模块，并说明 DOM 侵入和 provider 外部稳定性风险。
