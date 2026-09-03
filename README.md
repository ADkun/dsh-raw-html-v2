# dsh-raw-html-v2（VCP 视觉通感协议插件 · 官方 Slot API 版）

> 让 AI 在 DeepSeek Harness 对话正文中直接输出裸 HTML，渲染成视觉卡片（卡片 / KaTeX 公式 / Mermaid 图表 / SVG / 内置字体），
> **零 bundle 补丁**——前端以官方 `conversation.chat.node` 槽位的 `assistant-step` 替换渲染器接入，
> **渲染逻辑复用 v1 渲染引擎**（`assets/vendor/vcp-engine-v1.js` = v1 patch/v6-inject.js 原样复制），
> 流式 / 字体锁权 / 作用域化 / KaTeX·Mermaid / 自愈层零重写，兼容 rc 与 alpha 全版本线。

## 效果预览

以下均为本插件**实际渲染的 VCP 卡片**（流式逐段长出 · 内置书法字体 · KaTeX/Mermaid/SVG/JS 动画 · 交互控件 · hover 下载单文件 HTML）：

<p>
  <img src="docs/showcase/weather-magazine-card.png" alt="数据新闻卡：杂志风天气版面" width="49%">
  <img src="docs/showcase/petrel-book-cover.png" alt="文学装帧：《海燕》封面" width="49%">
</p>
<p>
  <img src="docs/showcase/library-essay-page.png" alt="散文长文：借书记·第17页 纸感排版" width="49%">
  <img src="docs/showcase/dual-patch-verify.png" alt="技术复合卡：JS 动画 + KaTeX + Mermaid" width="49%">
</p>

四图分别代表：**数据/编辑风格**、**文学封面装帧**、**散文纸质长文**、**技术复合**（60fps JS 动画 / 公式 / 流程图 / 深色终端面板）。

## 为什么有 v2

dsh-raw-html v1 依赖「前端 bundle 补丁」注入渲染能力（改 `case"html"` 分支）。DSH 0.1.2-alpha 起
前端压缩器变量名逐版本漂移，补丁锚点失配 → 用户报错。v2 改用**官方 Slot API** 提供接入点——
只替换槽位渲染器，让 v1 引擎在 rc 与 alpha 上都能运行；渲染能力与压缩器解耦、引擎零重写。

## 与 v1 的关键差异

| 维度 | v1（dsh-raw-html） | v2（本包） |
|---|---|---|
| 渲染引擎 | patch/v6-inject.js（bundle 内联注入） | **同一引擎原样复制**为 assets/vendor/vcp-engine-v1.js，client 经 new Function 注入 vc/hp/f 加载 |
| 接入点 | bundle 补丁 `case"html"` | 官方 Slot：`conversation.chat.node` / `assistant-step` 替换渲染器（priority:-10 shadow 官方 AssistantNodeView） |
| 前端更新影响 | 每个版本都要适配补丁 | 完全免疫 |
| 模型输出方式 | 正文直接裸 HTML | 同 v1：正文直接输出 `<div id="vcp-root">`（协议未变） |
| 普通 markdown 段落 | 宿主渲染 | 官方 `MarkdownText`（@deepseek-ai/dsh-client-ui-primitives），require 失败纯文本兜底 |
| 依赖声明 | inject 含 `dsh-client-runtime` | 已移除（alpha 无此包） |
| 状态/配置隔离 | `raw-html` / `.dsh/dsh-raw-html-state.json` | `raw-html-v2` / `.dsh/dsh-raw-html-v2-state.json` |

**v1 与本包可并存**：状态文件、RPC 通道、配置命名空间、cordis 插件名全部隔离，互不干扰。
v1 用户可继续留在 v1 补丁方案，v2 用户走官方 Slot 方案。

## 安装

### 方式一：本地目录 / tarball（推荐）

```bash
# 本地目录安装（开发/本机）
dsh plugin --profile web add <本包路径>

# 或打包 tarball 后安装（分发/其他机器）
npm pack            # 生成 dsh-raw-html-v2-0.7.28.tgz
dsh plugin --profile web add dsh-raw-html-v2-0.7.28.tgz
```

安装完成后 **重启 dsh web**（client 层改动需重启生效），浏览器刷新页面。

### 方式二：marketplace / npm（发布后）

```bash
dsh plugin --profile web add <npm 包名或 owner/repo>
```

## 安装后验证（应与其他机器效果一致）

1. 重启 dsh web → 刷新页面；
2. 点 composer 旁「</>」开启渲染 HTML；点右下角盾牌开「可信模式」（徽章绿底）——卡内 `<script>` / `onclick` 交互需要可信模式；
3. 让 AI 在正文输出 `<div id="vcp-root">` 卡片 → 应**流式逐段长出**，收尾无感；
4. Console 检查：无 TypeError；出现 `[dsh-raw-html-v2] ensureGlobalFonts 注入 @font-face …条`（debug 级）即字体服务就绪；若流式停顿帧触发 `F8 自检` 警告属自愈信号，非故障；
5. 版本确认：见 `package.json`（当前 0.7.28）。

## 字体说明（效果一致性关键）

- **内置字体（随包分发 · 离线可用）**：`assets/fonts/` 含 27 款子集 woff2（Lanxi-* 全家），写卡 `font-family:'Lanxi-…'` 直接命中，无需任何字体配置；
- **外置大库（不随包分发）**：`DESIGN.md` §0.1 所列方正/造字工房等全量 ttf（体积 + 授权原因）。安装方如需使用，在 DSH 设置 `raw-html-v2` 命名空间配置字体根：
  - `fontsRoot`（默认 `I:\字体`，可改为本机字体目录）
  - `fontRoots`（额外字体根数组，可多个）
  未配置时这些字体名自动回退系统字体，**卡片渲染、交互、公式图表等其余功能不受影响**；
- **下载自包含**：卡片 hover「⤓ 下载 HTML」会把卡内用到的内置字体以 data URI 内嵌（外置全量 ttf 不内嵌）——下载文件离线打开书法还原；
- **授权**：代码与渲染引擎 MIT；内置字体为 OFL 开源 + 子集化字库（商用分发请自行核对 `assets/fonts/` 内各字体授权条款）。

## 使用

1. 打开浏览器界面，点 composer 输入框旁的「</>」按钮开启「渲染 HTML」开关；
2. 开启后，AI 按注入的 VCP 协议在**回复正文直接输出** `<div id="vcp-root">…</div>`，assistant-step 替换渲染器把 vcp 段交给 v1 引擎渲染——**流式原生**：卡片随模型输出逐段长出（子块固化、样式同步生效，与 v1 完全一致）；
3. 卡片内 `onclick="input('...')"` 交互、KaTeX 公式、Mermaid 图表均可用；卡片 hover 可「⤓ 下载 HTML」；字体声明（Lanxi-*）带 `!important` 锁权，主题/皮肤插件无法覆盖；
4. **完整 HTML 程序页**（`<!DOCTYPE html>` 起、含 `<script>` 的 canvas/JS 动画等）：点右下角「可信模式」盾牌徽章开启后即可直渲直跑（页面级 `body/html` 样式自动隔离为卡内 `.vcp-page-host`，不污染对话界面）；
5. **IO 热窗（防历史累积卡顿）**：可视区 + 两屏预取内的卡/图/程序全量渲染，远离窗口的历史卡显示轻量占位条、滚动进入自动升级（无感）——会话再长，常驻渲染与 style 量恒定 ≈ 窗口大小；
6. 「</>」关闭时渲染器不注册 → 官方默认渲染（HTML 转义为源码，与 v1 语义一致）。

## 目录结构

```
lib/index.js       Host 端：systemPrompt 协议注入 + 字体/vendor 服务 + loopback RPC
lib/client.js      浏览器端：开关按钮 + input() 桥 + 可信模式 + assistant-step 接入（切段后喂 v1 引擎）
assets/vendor/vcp-engine-v1.js   v1 渲染引擎原样复制（流式/字体锁权/KaTeX·Mermaid/自愈层）
assets/            内置精选字体 + KaTeX/Mermaid 前端资源（随插件分发，离线可用）
styles/            美学风格知识库（RAG 化，agent 检索后按风格输出）
tests/             接入层切段测试（slot-split）+ 引擎复用链路测试（engine-smoke）
DESIGN.md          完整设计规范（字体/中文排版/安全铁律/文档地图）
```

## 兼容性

- ✅ DSH 0.1.0-rc.6 / 0.1.1-rc.2（next 通道）
- ✅ DSH 0.1.2-alpha.2 / alpha.3 / alpha.4 / alpha.5（alpha 通道，alpha.5 实测全链路通过）
- 依赖：`@deepseek-ai/cordis@^4.0.1`（覆盖 4.0.1 与 4.0.2）、`react@^18`
- `@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives` 均为可选依赖（primitives 缺失时普通 markdown 降级纯文本，卡片渲染不受影响）

## 许可证

MIT（含 `assets/vendor/vcp-engine-v1.js`——本仓库姊妹项目 dsh-raw-html 的渲染引擎，原样复制复用）。
内置字体为开源授权（OFL 等）+ 先生自备字库子集（授权由作者确认），分发时请核对 `assets/fonts` 内各字体授权。
