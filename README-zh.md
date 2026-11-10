# dsh-zotero-bridge

**读取本地 Zotero 文献库，并把条目登记为证据 —— 但绝不写回。**

*Local API 优先，`zotero.sqlite` 临时副本兜底，每篇选中的文献生成一条 REP 证据。不同步、不写入、不上云、不下载 PDF。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-brightgreen.svg)]()
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

[English](README.md) · 简体中文

---

## 为什么只读

你的 Zotero 库是多年工作的唯一副本。一次错误的写入就可能损坏 `zotero.sqlite`，或让桌面端状态错乱。因此这个插件**没有任何写入路径**：只对 Local API 发 `GET`，只对数据库**副本**做 `SELECT`。

## 三种模式

| 模式 | 条件 | 行为 |
|---|---|---|
| `local-api` | Zotero 正在运行，且开启了**设置 → 高级 →「允许此计算机上的其他应用程序与 Zotero 通信」** | 读 `http://127.0.0.1:23119/api/users/0/...`（仅回环） |
| `sqlite` | Local API 不可达，但存在 `zotero.sqlite` | 把数据库复制到临时目录，以只读方式打开副本、抽取条目，然后删除副本 |
| `unavailable` | 两者都没有 | 返回具体修复步骤，而不是空结果 |

## 工具

| 工具 | 作用 |
|---|---|
| `zotero_status` | 探测 API、查找数据库，报告当前模式与只读策略 |
| `zotero_search` | 检索文献库；返回标题、作者、年份、DOI、摘要、标签、收藏夹、附件元数据 |
| `zotero_item` | 按 key 读取单条，含附件子项 |
| `zotero_to_rep` | 把条目存成不可变 JSON 快照 + REP 证据（或 `<root>/items/<key>.json`） |

`zotero_to_rep` **不下载 PDF**。需要页码级锚点时，对附件路径运行 `doc_anchor` —— 桥接插件会把路径保留在元数据里，两个插件可以对接。

## 安装

```sh
dsh plugin --profile <name> add dsh-zotero-bridge
dsh --profile <name> --dump-config | grep dsh-zotero-bridge
```

然后：

```text
Run zotero_status.
```

若报告 `unavailable`：启动 Zotero 并开启 Local API，或把 `dataDir` 指向存放 `zotero.sqlite` 的目录。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | `false` 不挂载任何工具 |
| `root` | `.zotero-bridge` | 条目记录兜底根目录 |
| `localApiUrl` | `http://127.0.0.1:23119` | 仅回环；其它 host 直接校验失败 |
| `dataDir` | 自动探测 | Zotero 数据目录（或 `zotero.sqlite` 文件） |
| `timeoutMs` | `10000` | 单请求超时 |
| `maxResults` | `25` | 检索上限（1–100） |

## 它不做什么

- **不写入。** 不建/改/删条目，不写笔记、标签、收藏夹，不动回收站。
- **不同步。** 从不访问 `api.zotero.org`。
- **不下载/解析 PDF。** 只有附件元数据；全文交给 `dsh-doc-anchor`。
- **不需要 Web API key。** Local API 不需要账号或密钥。
- **不静默降级。** 两种模式都失败时返回 `unavailable` 和修复步骤。

## 兼容性

| | |
|---|---|
| Zotero | 7+（Local API 需手动开启）；sqlite 兜底读 Zotero 6/7 schema |
| Node | `^22.19.0 \|\| >=24.9.0`（sqlite 用 `node:sqlite`） |
| DeepSeek Harness | peer 区间 `>=0.2.1-0 <0.3.0 \|\| >=0.2.2-0 <0.3.0` |
| Peers | `@perrylink/dsh-research-core ^0.1.0`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` |
| 运行时依赖 | **零** |

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test          # fixture DB + mock Local API，不需要 Zotero
pnpm build
pnpm verify:package
```

sqlite 测试会在临时目录建一个最小 Zotero schema 数据库；Local API 测试用 scripted fetch。真实库验收是手动的：在有 Zotero 的机器上跑 `zotero_status`。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
