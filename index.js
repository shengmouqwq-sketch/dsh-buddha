/**
 * dsh-buddha —— 把 DSH 的输出自动变成"佛的答案"（与佛论禅 https://my.chenyu.me/buddha/）
 * ============================================================================
 * 挂载点：host 端 `llm/stream` waterfall（环绕每一次流式模型调用）。
 *   text-delta 攒到段落边界 → 加密成 '佛又曰：…'；
 *   加密结果**就地写回原来的 chunk 对象**，并且到 block-end 时把
 *   `chunk.block.text`（下游拿来落盘/覆盖显示的那份）也换成密文。
 *   工具/推理/usage 等 chunk 原样透传，顺序不变。
 *   带 options.purpose 的内调用（压缩摘要、标题生成…）一律不碰，否则上下文也会被加密。
 * ============================================================================
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_KEY, PREFIX, decryptAll, encrypt } from './lib/buddha.mjs'

export const name = 'buddha'

const DEFAULTS = { enabled: true, key: DEFAULT_KEY, segment: 180 }

function home() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function configPath() {
  return join(home(), 'buddha', 'config.json')
}

export function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch }
  mkdirSync(dirname(configPath()), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/** 找一个不劈开代理对的切点，优先在换行/空格处断 */
function cutAt(text, size) {
  let cut = text.lastIndexOf('\n', size)
  if (cut < size * 0.4) cut = text.lastIndexOf(' ', size)
  if (cut < size * 0.4) cut = size
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  if (cut <= 0) cut = Math.min(size, text.length)
  return { head: text.slice(0, cut), rest: text.slice(cut) }
}

export function apply(ctx) {
  const keyOf = cfg => (typeof cfg.key === 'string' && cfg.key ? cfg.key : DEFAULT_KEY)

  /**
   * 回灌保护：持久层里存的是密文，发给模型前把历史里的佛曰段还原成明文，
   * 否则模型会把自己的上一轮当成乱码，越聊越崩。
   */
  const scrub = (options, cfg) => {
    const key = keyOf(cfg)
    const fix = s => {
      if (typeof s !== 'string' || !s.includes(PREFIX)) return s
      try { return decryptAll(s, key) } catch { return s }
    }
    const msgs = options?.messages
    if (!Array.isArray(msgs)) return
    for (const m of msgs) {
      const c = m?.content
      if (typeof c === 'string') {
        const next = fix(c)
        if (next !== c) m.content = next
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (typeof block?.text === 'string') {
            const next = fix(block.text)
            if (next !== block.text) block.text = next
          }
        }
      }
    }
  }

  ctx.on('llm/stream', async function* buddhaStream(options, next) {
    const cfg = readConfig()
    if (!cfg.enabled || options?.purpose) {
      yield* next()
      return
    }

    try { scrub(options, cfg) } catch { /* 改不动就算了，别把请求搞挂 */ }

    const segment = Number(cfg.segment) >= 20 ? Number(cfg.segment) : DEFAULTS.segment
    const cipherOf = text => {
      const s = String(text ?? '')
      if (!s) return ''
      // 幂等：已经是佛曰（比如插件被重复挂载/二次经过 hook）就别再包一层
      if (s.trimStart().startsWith(PREFIX)) return s
      return cfg.override ? String(cfg.override) : encrypt(s, keyOf(cfg))
    }

    let pending = []   // 攒着的原始 text-delta 对象
    let buffer = ''    // 还没加密的明文
    let ciphers = []   // 已经加密好的段

    /** 兑现：密文写回第一个 chunk，其余清空；返回要 yield 的对象和整体密文 */
    const settle = () => {
      if (buffer) { ciphers.push(cipherOf(buffer)); buffer = '' }
      const text = ciphers.join('')
      ciphers = []
      const items = pending
      pending = []
      for (let i = 0; i < items.length; i++) {
        try { items[i].text = i === 0 ? text : '' } catch { /* 冻结对象就算了 */ }
      }
      return { items, text }
    }

    for await (const chunk of next()) {
      if (chunk && chunk.type === 'text-delta') {
        pending.push(chunk)
        buffer += String(chunk.text ?? '')
        while (buffer.length >= segment) {
          const { head, rest } = cutAt(buffer, segment)
          if (head.trim()) ciphers.push(cipherOf(head))
          buffer = rest
        }
        continue
      }

      // 块结束：下游用 block.text 覆盖显示/落盘，这份必须一起换成密文
      if (chunk && chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') {
        let text = ''
        if (pending.length) text = settle().text
        if (!text) text = cipherOf(String(chunk.block.text ?? ''))
        try { chunk.block.text = text } catch { /* 冻结对象就算了 */ }
        const items = pending
        pending = []
        for (const item of items) yield item
        yield chunk
        continue
      }

      if (pending.length) {
        const { items } = settle()
        for (const item of items) yield item
      }
      yield chunk
    }
    if (pending.length) {
      const { items } = settle()
      for (const item of items) yield item
    }
  })
}

// 给 CLI 用：node bin/buddha.mjs encode|decode <text>
export { decryptAll, encrypt }
