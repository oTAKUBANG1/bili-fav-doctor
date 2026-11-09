/** 从 progress.json 汇总成 fav.json（扫描没跑完也能出报告） */
import { readFileSync, writeFileSync } from 'node:fs'

const prog = JSON.parse(readFileSync('D:/project-demo/fav-doctor/data/progress.json', 'utf8'))
const items = Object.values(prog).flatMap((f) => f.items)
const dead = items.filter((x) => x.dead)

const byBvid = new Map()
for (const it of items) {
  if (!it.bvid || it.dead) continue
  if (!byBvid.has(it.bvid)) byBvid.set(it.bvid, [])
  byBvid.get(it.bvid).push(it)
}
const dupGroups = [...byBvid.values()].filter((v) => v.length > 1)

const folders = Object.entries(prog).map(([id, f]) => ({
  id,
  title: f.items[0]?.folder || id,
  declared: f.items.length,
  scanned: f.items.length,
  dead: f.items.filter((x) => x.dead).length,
  done: Boolean(f.done),
}))

const payload = {
  fetchedAt: Math.floor(Date.now() / 1000),
  uid: 'local',
  complete: folders.every((f) => f.done),
  folders,
  items,
  stats: {
    total: items.length,
    dead: dead.length,
    dupGroups: dupGroups.length,
    dupExtra: dupGroups.reduce((s, v) => s + v.length - 1, 0),
  },
}
writeFileSync('D:/project-demo/fav-doctor/data/fav.json', JSON.stringify(payload))
console.log(`打包 ${items.length} 条 / 失效 ${dead.length} / 重复 ${dupGroups.length} 组（${folders.length} 个收藏夹）`)
