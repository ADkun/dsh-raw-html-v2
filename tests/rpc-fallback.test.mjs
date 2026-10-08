// dsh-raw-html-v2 · DSH 0.2.x RPC 兜底通道（issue #5）回归测试
// 背景：0.2.x 下 connection.rpc.handle 注册失效（connection 插件 inject 退化为
// ['credentials'] → owner.webServer 解析失败 → 路由从未挂载）→ 专属 channel 一律 405。
// 插件在探测到该前缀路由未挂载时，用自身已注入的 webServer 直注册同前缀路由，并自行
// 实现 connection 的 wire 信封。本测试从 lib/index.js 源码提取真实实现，注入 mock
// webServer / connection，逐条验证 wire 契约与来源校验：
//   1. 探测三态（已挂载 / 未挂载 / 无法探测）
//   2. 正常请求 → 200 {type:'server-response', rpcId, result}，rpcId 原样回显
//   3. 非 POST / endpoint 非法 → 404；Content-Type 不符 → 415；body 非 JSON → 400
//   4. method 与 endpoint 不符 → 200 + gateway/bad-request
//   5. 来源校验：requestRejection 的 401/403 原样回传；它抛错时退回本机白名单（收窄不放开）
// 用法：node tests/rpc-fallback.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/index.js')
const src = readFileSync(INDEX, 'utf8')

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

const CHANNEL = '/dsh-raw-html-v2'
const fnPrefix = extractFn('rpcPrefixRouteRegistered')
const fnFallback = extractFn('registerFallbackRpcRoute')
const fnRejection = extractFn('rpcRequestRejection')

const makeRpc = (webServer, connection) =>
  new Function(
    'webServer', 'connection', 'rpcHandler', 'failResult', 'RPC_CHANNEL',
    fnPrefix + '\n' + fnFallback + '\n' + fnRejection + '\nreturn { rpcPrefixRouteRegistered, registerFallbackRpcRoute, rpcRequestRejection }',
  )(
    webServer,
    connection,
    async (endpoint, payload) => ({ ok: true, value: { endpoint: endpoint, payload: payload } }),
    (code, message) => ({ ok: false, error: { code: code, message: message } }),
    CHANNEL,
  )

function makeWebServer(prefixes) {
  return {
    prefixes: prefixes,
    register(route) {
      if (this.prefixes.has(route.path)) throw new Error('webserver: duplicate ' + route.kind + ' route "' + route.path + '"')
      this.prefixes.set(route.path, route)
      return () => this.prefixes.delete(route.path)
    },
  }
}

function makeReq(url, method, opts) {
  const o = opts || {}
  const payload = o.raw !== undefined ? o.raw : o.json === undefined ? '' : JSON.stringify(o.json)
  const handlers = {}
  const req = {
    url: url,
    method: method,
    headers: { 'content-type': o.ctype === undefined ? 'application/json' : o.ctype },
    socket: { remoteAddress: o.remoteAddress === undefined ? '127.0.0.1' : o.remoteAddress },
    on(ev, fn) { handlers[ev] = fn; return req },
    flush() {
      if (payload !== '') handlers.data && handlers.data(Buffer.from(payload, 'utf8'))
      handlers.end && handlers.end()
    },
  }
  return req
}

function makeRes() {
  const res = {
    status: 0,
    body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers; return res },
    end(chunk) { res.body = chunk === undefined ? '' : String(chunk) },
  }
  return res
}

async function call(handler, req) {
  const res = makeRes()
  const p = handler(req, res)
  req.flush()
  await p
  return res
}

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { console.log('  ✓ ' + label); pass++ } else {
    console.log('  ✗ ' + label + '（期望 ' + JSON.stringify(expected) + '，实得 ' + JSON.stringify(actual) + '）')
    fail++
  }
}

const envelope = (method, payload, rpcId) => ({ type: 'client-request', method: method, rpcId: rpcId === undefined ? 'r-1' : rpcId, payload: payload === undefined ? {} : payload })

console.log('== 探测三态 ==')
const ws0 = makeWebServer(new Map())
const rpc0 = makeRpc(ws0, undefined)
eq(rpc0.rpcPrefixRouteRegistered(), false, '前缀未挂载 → false（触发兜底注册）')
const wsNoMap = { register() { return () => {} } }
eq(makeRpc(wsNoMap, undefined).rpcPrefixRouteRegistered(), null, 'webServer 无 prefixes 表 → null（保守不动，避免重复注册抛错）')

console.log('== 兜底注册与 wire 契约 ==')
const ws = makeWebServer(new Map())
const rpc = makeRpc(ws, undefined)
rpc.registerFallbackRpcRoute(undefined)
eq(rpc.rpcPrefixRouteRegistered(), true, '兜底注册后前缀已挂载 → true')
const route = ws.prefixes.get(CHANNEL)
eq(route.kind, 'prefix', '注册的路由 kind=prefix')

const okRes = await call(route.handler, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state', {}, 'abc-123') }))
eq(okRes.status, 200, '正常信封 → 200')
const okBody = JSON.parse(okRes.body)
eq(okBody.type, 'server-response', '响应体 type=server-response')
eq(okBody.rpcId, 'abc-123', 'rpcId 原样回显（否则 connection 层报 rpcId mismatch）')
eq(okBody.result.ok, true, 'result.ok=true')
eq(okBody.result.value.endpoint, 'get-state', 'endpoint 正确透传给 handler')
eq(JSON.parse(String(okBody.result.value.payload && JSON.stringify(okBody.result.value.payload))).x, undefined, '空 payload 透传为原值')

const playRes = await call(route.handler, makeReq(CHANNEL + '/set-state', 'POST', { json: envelope('set-state', { render: true }) }))
eq(JSON.parse(playRes.body).result.value.payload.render, true, 'payload 完整透传')

console.log('== 边界与错误码 ==')
eq((await call(route.handler, makeReq(CHANNEL + '/get-state', 'GET', {}))).status, 404, '非 POST → 404')
eq((await call(route.handler, makeReq(CHANNEL, 'POST', { json: envelope('get-state') }))).status, 404, '缺 endpoint（裸前缀）→ 404')
eq((await call(route.handler, makeReq(CHANNEL + '/a/b', 'POST', { json: envelope('a/b') }))).status, 200, 'endpoint 多段合法 → 200（官方 endpointFromPath 逐段校验，不禁止 /）')
eq((await call(route.handler, makeReq(CHANNEL + '/a//b', 'POST', { json: envelope('a//b') }))).status, 404, 'endpoint 含空段 → 404')
eq((await call(route.handler, makeReq(CHANNEL + '/a%20b', 'POST', { json: envelope('a b') }))).status, 404, 'endpoint 含非法字符（空格）→ 404')
eq((await call(route.handler, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state'), ctype: 'text/plain' }))).status, 415, 'Content-Type 不符 → 415')
eq((await call(route.handler, makeReq(CHANNEL + '/get-state', 'POST', { raw: 'not json' }))).status, 400, 'body 非 JSON → 400')

const mismatch = await call(route.handler, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('list-styles', {}, 'r-9') }))
eq(mismatch.status, 200, 'method 与 endpoint 不符 → 200（信封内报错，与官方一致）')
eq(JSON.parse(mismatch.body).result.error.code, 'gateway/bad-request', '错误码 gateway/bad-request')
eq(JSON.parse(mismatch.body).rpcId, 'r-9', '错误响应同样回显 rpcId')

const badEnv = await call(route.handler, makeReq(CHANNEL + '/get-state', 'POST', { json: { payload: {}, rpcId: 'r-7' } }))
eq(JSON.parse(badEnv.body).result.error.code, 'gateway/bad-request', '信封缺 type/method → gateway/bad-request')
eq(JSON.parse(badEnv.body).rpcId, 'r-7', '非法信封仍尽力回显 rpcId')

console.log('== 来源校验（只收窄、不放开）==')
const wsGuard = makeWebServer(new Map())
const conn403 = { requestRejection: () => 403 }
const rpc403 = makeRpc(wsGuard, conn403)
rpc403.registerFallbackRpcRoute(conn403)
const g403 = await call(wsGuard.prefixes.get(CHANNEL).handler, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state') }))
eq(g403.status, 403, "connection.requestRejection 返回 403 → 403（不放行）")
eq(g403.body, 'forbidden', '403 响应体与官方一致')

const ws401 = makeWebServer(new Map())
const conn401 = { requestRejection: () => 401 }
makeRpc(ws401, conn401).registerFallbackRpcRoute(conn401)
const g401 = await call(ws401.prefixes.get(CHANNEL).handler, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state') }))
eq(g401.status, 401, 'requestRejection 返回 401 → 401')
eq(g401.body, 'unauthorized', '401 响应体与官方一致')

const wsThrow = makeWebServer(new Map())
const connThrow = { requestRejection: () => { throw new Error('接口变动') } }
makeRpc(wsThrow, connThrow).registerFallbackRpcRoute(connThrow)
const hThrow = wsThrow.prefixes.get(CHANNEL).handler
eq((await call(hThrow, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state'), remoteAddress: '127.0.0.1' }))).status, 200, '校验接口抛错 → 本机来源放行（退回白名单，不放开远程）')
eq((await call(hThrow, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state'), remoteAddress: '192.168.1.50' }))).status, 403, '校验接口抛错 + 远程来源 → 403（收紧）')
eq((await call(hThrow, makeReq(CHANNEL + '/get-state', 'POST', { json: envelope('get-state'), remoteAddress: '::1' }))).status, 200, 'IPv6 本机回环 ::1 放行')

console.log('== 重复注册必须抛错（说明两条路径互斥的必要性）==')
let dupThrew = false
try { ws.register({ kind: 'prefix', path: CHANNEL, handler: () => {} }) } catch (e) { dupThrew = true }
eq(dupThrew, true, 'webServer 重复 (kind,path) 注册抛错 → 官方成功时绝不能注册兜底')

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
