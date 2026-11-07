/**
 * lib/buddha.mjs —— 与佛论禅（https://my.chenyu.me/buddha/）的加解密，Node 原生实现
 * ============================================================================
 * 站点原版（js/main.js）做的事：
 *   togod(msg, key) = '佛又曰：' + 表替换( CryptoJS.AES.encrypt(msg, key).toString().substring(10) )
 *   toman(msg, key) = CryptoJS.AES.decrypt( 表反替换( msg.substring(4) ).join(''), key )
 *
 * CryptoJS.AES.encrypt(str, passphrase) 的默认形态是 OpenSSL 兼容格式：
 *   base64( 'Salted__' + 8 字节随机盐 + AES-256-CBC 密文 )
 *   key/iv = EVP_BytesToKey(MD5, 1 轮)，32 + 16 字节
 * 前 10 个字符正好是 base64('Salted__') = 'U2FsdGVkX1' ⇒ 站点把它切掉，再逐字符换成佛字。
 * ============================================================================
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const DEFAULT_KEY = 'takuron.top'
export const PREFIX = '佛又曰：'

/** 原版字符表（main.js 第 86–150 行，一字符对一佛字） */
const TABLE = {
  e: '啰', E: '羯', t: '婆', T: '提', a: '摩', A: '埵', o: '诃', O: '迦', i: '耶', I: '吉',
  n: '娑', N: '佛', s: '夜', S: '驮', h: '那', H: '谨', r: '悉', R: '墀', d: '阿', D: '呼',
  l: '萨', L: '尼', c: '陀', C: '唵', u: '唎', U: '伊', m: '卢', M: '喝', w: '帝', W: '烁',
  f: '醯', F: '蒙', g: '罚', G: '沙', y: '嚧', Y: '他', p: '南', P: '豆', b: '无', B: '孕',
  v: '菩', V: '伽', k: '怛', K: '俱', j: '哆', J: '度', x: '皤', X: '阇', q: '室', Q: '地',
  z: '利', Z: '遮', '0': '穆', '1': '参', '2': '舍', '3': '苏', '4': '钵', '5': '曳',
  '6': '数', '7': '写', '8': '栗', '9': '楞', '+': '咩', '/': '输', '=': '漫',
}

const REVERSE = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [v, k]))
const SALT_PREFIX = 'Salted__'
const B64_HEAD = 'U2FsdGVkX1' // base64('Salted__') 的前 10 个字符

function toSutra(base64) {
  return [...base64].map(c => TABLE[c] ?? c).join('')
}

function fromSutra(sutra) {
  return [...sutra].map(c => REVERSE[c] ?? c).join('')
}

/** OpenSSL EVP_BytesToKey（MD5，1 轮），返回 { key, iv } */
export function evpBytesToKey(password, salt, keyLen = 32, ivLen = 16) {
  const pass = Buffer.from(password, 'utf8')
  const parts = []
  let previous = Buffer.alloc(0)
  let total = 0
  while (total < keyLen + ivLen) {
    previous = createHash('md5').update(Buffer.concat([previous, pass, salt])).digest()
    parts.push(previous)
    total += previous.length
  }
  const block = Buffer.concat(parts)
  return { key: block.subarray(0, keyLen), iv: block.subarray(keyLen, keyLen + ivLen) }
}

/** 明文 → '佛又曰：…' */
export function encrypt(plain, password = DEFAULT_KEY) {
  const text = String(plain ?? '')
  const salt = randomBytes(8)
  const { key, iv } = evpBytesToKey(password, salt)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const sealed = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
  const base64 = Buffer.concat([Buffer.from(SALT_PREFIX, 'ascii'), salt, sealed]).toString('base64')
  return PREFIX + toSutra(base64.substring(B64_HEAD.length))
}

/** '佛又曰：…' → 明文；失败抛错 */
export function decrypt(sutra, password = DEFAULT_KEY) {
  const body = String(sutra ?? '').trim().startsWith(PREFIX)
    ? String(sutra).trim().slice(PREFIX.length)
    : String(sutra ?? '').trim()
  if (!body) return ''
  const base64 = B64_HEAD + fromSutra(body)
  const raw = Buffer.from(base64, 'base64')
  if (raw.length < 32 || raw.subarray(0, 8).toString('ascii') !== SALT_PREFIX) {
    throw new Error('不是有效的佛曰密文（Salted__ 头不对），可能混进了别的字符')
  }
  const salt = raw.subarray(8, 16)
  const { key, iv } = evpBytesToKey(password, salt)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])
  return plain.toString('utf8')
}

/** 把一段可能含多段 '佛又曰：…' 的文本逐段解开 */
export function decryptAll(text, password = DEFAULT_KEY) {
  const source = String(text ?? '')
  const segments = source.split(PREFIX).map(part => part.trim()).filter(Boolean)
  if (!segments.length) return ''
  return segments.map(part => decrypt(part, password)).join('')
}

/** 分段加密：适合流式输出，每段自带 '佛又曰：' 前缀，可再拼回去整体解 */
export function encryptSegments(plain, password = DEFAULT_KEY, size = 160) {
  const text = String(plain ?? '')
  if (!text) return ''
  const out = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size * 0.4) cut = rest.lastIndexOf(' ', size)
    if (cut < size * 0.4) cut = size
    // 别把代理对（emoji 等）劈成两半
    const code = rest.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    out.push(encrypt(rest.slice(0, cut), password))
    rest = rest.slice(cut)
  }
  if (rest) out.push(encrypt(rest, password))
  return out.join('')
}
