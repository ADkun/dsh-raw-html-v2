// dsh-raw-html-v2 · assistant-step 分组消费（groupPart）回归测试
// 背景（issue #4）：DSH 0.2.x 对同一条 assistant-step 节点渲染两个分组变体
// （data-chat-group-part = reasoning / response），官方靠 slot 注入的 groupPart
// 参数把内容切开——reasoning 变体只画思考块、response 变体跳过思考块。本插件以
// priority -10 shadow 官方渲染器后曾全量遍历 blocks、从不消费 groupPart，于是两个
// 变体各渲染一份完整内容 → 流式期间同一内容成对重复（settle 后过程组收敛才恢复）。
// 本测试从 lib/client.js 源码提取真实 buildAssistantChildren，注入轻量 stub 后验证：
//   1. groupPart='reasoning' → 只渲染思考块
//   2. groupPart='response'  → 只渲染非思考块
//   3. groupPart 缺失（0.1.x / 未分组）→ 全量渲染（旧行为不变）
//   4. running 标志跟随过滤后的可见块序列
// 用法：node tests/group-part.test.mjs
// （extractFn 与 slot-split.test.mjs 同款技法：从源码提取真实函数，防复制漂移）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')
const src = readFileSync(CLIENT, 'utf8')

/** 从源码提取一个函数定义全文（含签名到配平闭合括号）。跳过字符串/注释/正则字面量。 */
function extractFn(name) {
  const anchor = new RegExp('^[ \\t]*function ' + name + '\\s*\\(', 'm')
  const am = anchor.exec(src)
  if (!am) throw new Error('未找到函数 ' + name)
  let i = src.indexOf('{', am.index)
  if (i === -1) throw new Error(name + ' 无函数体')
  let depth = 0
  let str = null
  const RE_START_PREV = '(=,:,[!&|?{};+-*%^~<>'
  for (; i < src.length; i++) {
    const c = src[i]
    if (str) {
      if (c === '\\') { i++; continue }
      if (c === str) str = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      let prev = i - 1
      while (prev >= 0 && /\s/.test(src[prev])) prev--
      if (prev < 0 || RE_START_PREV.includes(src[prev])) {
        i++
        let cls = false
        for (; i < src.length; i++) {
          const rc = src[i]
          if (rc === '\\') { i++; continue }
          if (rc === '[') cls = true
          else if (rc === ']') cls = false
          else if (rc === '/' && !cls) break
        }
        continue
      }
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(am.index, i + 1) }
  }
  throw new Error(name + ' 花括号未配平')
}

const body = extractFn('buildAssistantChildren')

// ---- 轻量 stub 环境（只提供 buildAssistantChildren 触及的外部符号）----
function VcpLite() {}
function VcpReasoningRow() {}
function noop() {}
function md(text, key) { return { type: 'MD', props: { key: key }, text: text } }
function splitText(t) { return [{ type: 'md', text: t }] }

const build = new Function(
  'createElement', 'VcpLite', 'VcpReasoningRow',
  'vcpEngineRender', 'vcpPageRender', 'splitVcpText', 'splitMermaidFence', 'renderMdSegment',
  body + '\nreturn buildAssistantChildren',
)(
  function createElement(type, props, child) {
    const name = typeof type === 'string' ? type : (type === VcpReasoningRow ? 'REASONING' : type === VcpLite ? 'LITE' : 'C')
    return { type: name, props: props || {}, child: child }
  },
  VcpLite,
  VcpReasoningRow,
  noop, noop, splitText, splitText,
  function (text, streaming, key) { return md(text, key) },
)

// ---- 断言工具 ----
let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { console.log('  ✓ ' + label); pass++ } else {
    console.log('  ✗ ' + label + '（期望 ' + JSON.stringify(expected) + '，实得 ' + JSON.stringify(actual) + '）')
    fail++
  }
}

const BLOCKS = [
  { kind: 'reasoning', text: '思考内容' },
  { kind: 'text', text: '正文内容' },
]
const tags = (r) => r.children.map((c) => c.type).join(',')
const texts = (r) => r.children.filter((c) => c.type === 'MD').map((c) => c.text).join(',')

console.log('== groupPart 三态语义 ==')
eq(tags(build(BLOCKS, false, true, 'response')), 'MD', 'response 变体：只渲染正文段（不再重复渲染思考块）')
eq(texts(build(BLOCKS, false, true, 'response')), '正文内容', 'response 变体：正文段内容正确')
eq(tags(build(BLOCKS, false, true, 'reasoning')), 'REASONING', 'reasoning 变体：只渲染思考块')
eq(tags(build(BLOCKS, false, true, undefined)), 'REASONING,MD', 'groupPart 缺失：全量渲染（0.1.x 旧行为不变）')
eq(tags(build(BLOCKS, false, true, '')), 'REASONING,MD', 'groupPart 为空串：按未分组处理，全量渲染')
eq(tags(build(BLOCKS, false, true, 'other')), 'REASONING,MD', '未知 groupPart（未来新变体）：全量渲染，不误删内容')

console.log('== running 标志跟随过滤后的可见序列 ==')
const runReasoning = build([{ kind: 'text', text: 'A' }, { kind: 'reasoning', text: 'B' }], true, true, 'reasoning')
eq(runReasoning.children.length, 1, 'reasoning 变体：过滤后仅 1 个可见块')
eq(runReasoning.children[0].props.running, true, 'reasoning 变体：末块 running=true（思考中动画不丢）')
const runResponse = build([{ kind: 'reasoning', text: 'B' }, { kind: 'text', text: 'A' }], true, true, 'response')
eq(runResponse.children[0].props.running, undefined, 'response 变体：不含 reasoning 块，running 标志不外溢')

console.log('== 空值容错 ==')
eq(build([null, { kind: 'text', text: 'A' }, undefined], false, true, 'response').children.length, 1, 'blocks 含空项：跳过且不崩')
eq(build([], false, true, 'reasoning').children.length, 0, '空 blocks：产出空 children')

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
