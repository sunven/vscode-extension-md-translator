# Visual Plan

## Context

- report: `report.md`
- purpose: 帮助工程读者快速理解 read-frog 翻译链路的跨上下文流程、调用路径和源码责任边界。
- status: applied

## Plan

| slot | purpose | type | content_source | must_have | output |
|---|---|---|---|---|---|
| 翻译链路总览 | 展示从用户触发到结果展示的端到端流程 | Mermaid flowchart | synthesis + d1-d4 | 必须 | `report.md` 内 Mermaid |
| 翻译链路总览 | 对比页面、节点、选区三类主要翻译路径 | Markdown 表格 | d1-d4 | 必须 | `report.md` 内表格 |
| 核心源码文件与职责矩阵 | 帮助读者按模块回到源码阅读 | Markdown 表格 | d1-d4 | 必须 | `report.md` 内表格 |
| 风险与复用建议 | 区分可复用、需改造和高风险部分 | Markdown 表格 | synthesis + d4 | 必须 | `report.md` 内表格 |

## Notes

- 本报告是技术实现分析，关键内容是可核验的调用链、源码职责和风险判断；AI 概念图不能承载这些精确信息，因此不生成 AI 图片。
- Mermaid 用于表达跨上下文流程，表格用于保留文件路径、职责和复用建议的精确对照。
