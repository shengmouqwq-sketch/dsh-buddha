#!/usr/bin/env node
/** 命令行版：node bin/buddha.mjs encode "你好" / decode "佛又曰：…" */
import { decryptAll, encrypt } from '../lib/buddha.mjs'

const [mode, ...rest] = process.argv.slice(2)
const text = rest.join(' ')
const key = process.env.BUDDHA_KEY || 'takuron.top'
if (!mode) {
  console.error('用法：node bin/buddha.mjs encode|decode <文本>')
  process.exit(2)
}
if (mode === 'decode') console.log(decryptAll(text, key))
else console.log(encrypt(text, key))
