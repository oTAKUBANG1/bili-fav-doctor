# bili-fav-doctor

B站收藏夹体检：扫出**已失效的视频**（UP 删了 / 设私密 / 被下架），出一份报告，
确认后按收藏夹一键清理。纯本地运行，凭证只在本机，不经过任何第三方。

和 [bili-follow-doctor](https://github.com/oTAKUBANG1/bili-follow-doctor) 是一对：
那个查「你关注的人还在不在」，这个查「你收藏的视频还在不在」。

## 它解决什么

收藏夹里那些点开只显示「已失效视频」的条目，B站 网页端只能一个个手动删。
收藏夹几百上千条的时候，光找出哪些失效了就很费时间。

这个工具会：翻完你所有收藏夹 → 统计失效分布 → 出一份 HTML 报告 →
你确认后按收藏夹批量清空失效内容。

## 用法

```bash
node doctor.mjs              # 一键：扫描 + 汇总 + 出报告
node doctor.mjs --reset      # 丢掉进度从头扫
node doctor.mjs --report-only  # 只用已有数据重新出报告
```

跑完打开 `index.html` 就是报告。扫描过程**断点续传**：每翻一页落盘一次，
中断了重跑同一条命令就接着来。

清理（默认 dry-run，只打名单不动手）：

```bash
node clean.mjs                    # 看名单
node clean.mjs --yes              # 真清
node clean.mjs --yes --min=4      # 只清失效数 ≥ 4 的收藏夹
node clean.mjs --yes --only=73037244   # 只清某一个
node clean.mjs --test             # 只清最小的那个收藏夹（先验证）
```

## 接口

实测这几个都**不需要 wbi 签名**（2026-11 验证）：

| 用途 | 接口 |
|---|---|
| 收藏夹列表 | `GET /x/v3/fav/folder/created/list-all?up_mid=<uid>` |
| 收藏夹内容 | `GET /x/v3/fav/resource/list?media_id=&pn=&ps=20&platform=web` |
| 清空某夹的失效内容 | `POST /x/v3/fav/resource/clean`（`media_id` + `csrf`） |
| 批量删除指定条目 | `POST /x/v3/fav/resource/batch-del`（`resources` + `csrf`） |

失效判定：`title === "已失效视频"` 或 `attr & 1`。

注意 `x/v3/fav/resource/del`（单条删除）是 **404**，别走那条路。

## 限流（重要）

B站 没公开任何限流参数，以下是实测：

- 收藏夹接口约 **107 页（≈2140 请求）后开始返回 412**，恢复时间**超过 3 小时**
- 能跑完的节奏：每页 520ms + 每 60 页休息 25 秒
- 412 时要拉开重试（60s / 120s / 180s），短重试没用
- ⚠️ **`fetch` 默认没有超时**，B站 不响应时会永久挂住 —— 必须 `AbortSignal.timeout()`

`clean.mjs` 遇到 412 会自动进入等待模式：每 10 分钟探测一次，最多等 3 小时，通了继续。

## 凭证

复用「刷B站」或「关注体检」登录过的那份：

```
~/.dsh/bili-duty/bili_credential.json
~/.dsh/bili-follow/cred.json
```

需要 `sessdata` + `bili_jct`（csrf）。

## 注意

- **清理不可撤销**。B站 没有「批量恢复收藏」，删了要一个个手动加回来。
- 报告和 `data/` 里有真实的视频标题和 UP 名，`.gitignore` 已经挡住，别手动提交。
- 只处理视频收藏（type=2），不碰专栏 / 课程 / 番剧。

License: MIT
