# dsh-buddha · 把 DSH 的输出自动变成「佛的答案」

![banner](docs/banner.jpg)

接 [与佛论禅](https://my.chenyu.me/buddha/) 的算法（AES-256-CBC + `takuron.top` 密钥 + 佛字替换表），
把 DSH 里助手的**每一条回复**就地加密成 `佛又曰：…`，在对话界面里直接显示。

> 一个完全没用、但极其庄重的插件。装上之后，你和模型的每一次对话都会变成经文。

```
你：只回复两个字：收到
DSH：佛又曰：栗摩阇陀萨驮尼佛舍曳皤呼娑皤伊曳伊穆皤谨喝烁羯唵穆栗埵孕嚧提唎栗栗漫
```

把上面那段粘回 <https://my.chenyu.me/buddha/>（选「佛曰 → 人话」）就能解回「收到」。

## 效果与代价

- 短句实测膨胀 **×19**（2 字 → 38 字），每段还固定收 38 字手续费
- 时间节省 **−200%**：读一行要开一次网页

## 原理

- 挂载点：host 端 `llm/stream` waterfall（环绕每一次流式模型调用）。
- `text-delta` 攒到 `segment` 字符边界 → 加密成一段佛曰 → 写回 chunk；
  到 `block-end` 时把 `chunk.block.text`（界面最终渲染 + 落盘用的那份）一并换成密文。
  只改 `text-delta` 是不够的——下游会用 `block-end` 里的文本覆盖，这是本插件踩过的坑。
- 回灌保护：发给模型前，历史里的 `佛又曰：…` 段会被还原成明文，模型自己不会被乱码带偏。
- 幂等保护：已经是佛曰的文本不会被再加密一次。
- 带 `options.purpose` 的内调用（压缩摘要、标题生成等）原样透传，不会被加密。

## 安装

```bash
# 从 GitHub
dsh plugin --profile desktop add github:shengmouqwq-sketch/dsh-buddha

# 本地开发
dsh plugin --profile desktop add link:D:/Documents/dsh-plugins/dsh-buddha
```

装完重启 DSH（或 `disable` + `enable` 一次插件）。

## 配置

`~/.dsh/buddha/config.json`（Windows: `C:\Users\<你>\.dsh\buddha\config.json`），改完即时生效：

```json
{
  "enabled": true,
  "key": "takuron.top",
  "segment": 180
}
```

| 字段 | 说明 |
| --- | --- |
| `enabled` | 关掉就完全不加密（等同禁用插件） |
| `key` | 与佛论禅的密钥，默认 `takuron.top`；改了要跟对方用同一个 key 才能解开 |
| `segment` | 每段明文字数，越小佛曰块越多，默认 180 |

## 命令行

```bash
node bin/buddha.mjs encode "你好"
node bin/buddha.mjs decode "佛又曰：…"
```

## 卸载

```bash
dsh plugin --profile desktop remove dsh-buddha
```

临时关闭：`dsh plugin --profile desktop disable buddha`（或把 config 里的 `enabled` 改成 `false`）。

## English

A DeepSeek Harness (dsh) plugin that rewrites every assistant reply into
[Buddha says](https://my.chenyu.me/buddha/)-style ciphertext (`佛又曰：…`), using the site's
AES-256-CBC + Chinese-character substitution table. History sent back to the model is
decrypted first, so the model never sees the ciphertext. Toggle with `~/.dsh/buddha/config.json`.

## 注意

- 加密后的文本会**真的**写进会话记录，所以别人看会话、导出记录，看到的都是佛曰。
- 如果你自己也想读，用上面的 CLI 或网站解，或者把 `enabled` 关掉。
- 与佛论禅的算法归属 <https://my.chenyu.me/buddha/>；本仓库只做 DSH 侧适配。
