// dsh-raw-html-v2 · scan 跳过容器内前导空白 回归测试
// 背景（先生 2026-09-04 新闻晚报卡实测）：`<div id="vcp-root">\n<style>` 开标签后带换行时，
// scan 的 inContainer 模式把「首个子块前的纯空白」当内容起点提前返回 → <style> 被误归 tail、
// 流式中反复重建 → CSS 源码泄漏成可见文本、整卡掉格式。
// 修复：容器首个子块前的【纯空白】跳过（不归 tail），非空白文本仍归 tail（行为不变）。
// 纯字符串测试，不依赖 jsdom/DOMParser，可直接运行：node tests/scan-blank-skip.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/vendor/vcp-engine-v1.js')
const engineSrc = readFileSync(ENGINE, 'utf8')

function extractFn(src, name) {
  const anchor = new RegExp('^[ \\t]*function ' + name + '\\s*\\(', 'm')
  const am = anchor.exec(src)
  if (!am) throw new Error('未找到 ' + name)
  let i = src.indexOf('{', am.index)
  let depth = 0, str = null
  const RE_START_PREV = '(=,:,[!&|?{};+-*%^~<>'
  for (; i < src.length; i++) {
    const c = src[i]
    if (str) { if (c === '\\') { i++; continue } if (c === str) str = null; continue }
    if (c === "'" || c === '"' || c === '`') { str = c; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      let prev = i - 1
      while (prev >= 0 && /\s/.test(src[prev])) prev--
      if (prev < 0 || RE_START_PREV.indexOf(src[prev]) !== -1) {
        let j = i + 1, inCls = false
        for (; j < src.length; j++) {
          const rc = src[j]
          if (rc === '\\') { j++; continue }
          if (rc === '[') inCls = true
          else if (rc === ']') inCls = false
          else if (rc === '/' && !inCls) break
        }
        i = j
        continue
      }
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(am.index, i + 1) }
  }
  throw new Error(name + ' 括号不闭合')
}

const prelude = 'var VOID_TAGS = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, param:1, source:1, track:1, wbr:1 };\n'
  + 'var RAWTEXT = { script:1, style:1 };\n'
const body = extractFn(engineSrc, 'tagEndAt') + '\n'
  + extractFn(engineSrc, 'nextTag') + '\n'
  + extractFn(engineSrc, 'scan')
const mod = new Function(prelude + body + '\nreturn { scan: scan }')
const { scan } = mod()

let pass = 0, fail = 0
function eq(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')) }
}

// 修复目标：开标签后带换行，<style> 应正常固化而非归 tail
{
  const v = '<div id="vcp-root" style="x">\n<style>css</style>\n<div class="mast">x</div>\n</div>'
  const openEnd = v.indexOf('>') + 1
  const r = scan(v, openEnd, true)
  eq(r.inner.length === 2, '首块前纯空白被跳过，style+mast 均固化（inner=' + r.inner.length + '）')
  eq(r.inner[0] && r.inner[0].indexOf('<style>') !== -1, '第一个块是 <style>')
  eq(r.inner[1] && r.inner[1].indexOf('class="mast"') !== -1, '第二个块是 mast')
  eq(r.closed === true, '容器正确闭合（closed=' + r.closed + '）')
}

// 紧贴形态（修复前就正常）保持正常
{
  const v = '<div id="vcp-root" style="x"><style>css</style><div class="mast">x</div></div>'
  const openEnd = v.indexOf('>') + 1
  const r = scan(v, openEnd, true)
  eq(r.inner.length === 2 && r.closed === true, '紧贴形态仍正常（inner=' + r.inner.length + '）')
}

// 非空白前导文本仍归 tail（不误伤真实文字内容）
{
  const v = '<div id="vcp-root" style="x">文字<style>css</style></div>'
  const openEnd = v.indexOf('>') + 1
  const r = scan(v, openEnd, true)
  eq(r.inner.length === 0 && r.closed === false, '非空白前导文本仍归 tail（inner=' + r.inner.length + '）')
  eq(r.innerTail === openEnd, 'innerTail 指向文本起点')
}

// 顶层扫描（inContainer=false）不受影响
{
  const closed = '<div id="vcp-root" style="x">\n<style>css</style>\n</div>'
  const r1 = scan(closed, 0, false)
  eq(r1.outer.length === 1 && r1.outer[0].indexOf('vcp-root') !== -1, '顶层闭合卡进 outer 正常')
  const half = '<div id="vcp-root" style="x">\n<style>css</style>\n<div class="mast">'
  const r2 = scan(half, 0, false)
  eq(r2.open && r2.open.raw.indexOf('vcp-root') !== -1, '顶层未闭合卡 open 正常')
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
