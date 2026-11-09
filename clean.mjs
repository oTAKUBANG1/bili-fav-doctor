/**
 * 收藏夹清理 · 删掉失效视频
 * ============================================================================
 * 用 B站 官方接口 POST /x/v3/fav/resource/clean（一次性清空某个收藏夹里的失效内容）。
 *
 * 默认 dry-run：只把要清的名单打出来，不动任何东西。
 *
 * 用法：
 *   node clean.mjs                    # 看名单（默认，安全）
 *   node clean.mjs --yes              # 真清
 *   node clean.mjs --only=73037244    # 只清某一个收藏夹
 *   node clean.mjs --test             # 只清一个收藏夹（挑最小的那个，先验证）
 *   node clean.mjs --min=5            # 只清「失效数 ≥ 5」的收藏夹
 *
 * 限流：遇到 412 会每 10 分钟探一次，最多等 3 小时，通了自动继续。
 * 日志：data/clean.jsonl
 * ============================================================================
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const H = join(homedir(), '.dsh')
const DIR = 'D:/project-demo/fav-doctor'
const LOG = join(DIR, 'data/clean.jsonl')

const args = process.argv.slice(2)
const YES = args.includes('--yes')
const TEST = args.includes('--test')
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''
const MIN = Number((args.find((a) => a.startsWith('--min=')) || '').split('=')[1]) || 0

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

function loadCred() {
  for (const p of [join(H, 'bili-follow', 'cred.json'), join(H, 'bili-duty', 'bili_credential.json')]) {
    if (!existsSync(p)) continue
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const c = {
      sessdata: raw.sessdata || raw.SESSDATA || '',
      bili_jct: raw.bili_jct || '',
      buvid3: raw.buvid3 || '',
      dedeuserid: String(raw.dedeuserid || raw.DedeUserID || ''),
    }
    if (c.sessdata && c.bili_jct) return c
  }
  throw new Error('找不到完整凭证（需要 sessdata + bili_jct）')
}

const cred = loadCred()
const cookie = Object.entries({ SESSDATA: cred.sessdata, bili_jct: cred.bili_jct, buvid3: cred.buvid3, DedeUserID: cred.dedeuserid })
  .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')

/** 轻量探测：限流解没解 */
async function probeUnblocked() {
  try {
    const r = await fetch('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + cred.dedeuserid, {
      headers: { 'User-Agent': UA, Cookie: cookie, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(12000),
    })
    if (r.status === 412 || r.status === 429) return false
    const j = await r.json().catch(() => null)
    return j?.code === 0
  } catch { return false }
}

/** 等限流窗口：每 10 分钟探一次，最多 3 小时 */
async function waitForUnblock(maxMinutes = 180, intervalMin = 10) {
  const start = Date.now()
  for (;;) {
    if (Math.round((Date.now() - start) / 60000) >= maxMinutes) {
      console.log(`[${ts()}] ❌ 等了 ${maxMinutes} 分钟还是限流，先放弃。稍后重跑即可。`)
      return false
    }
    await sleep(intervalMin * 60000)
    if (await probeUnblocked()) {
      console.log(`[${ts()}] ✅ 限流解除（等了约 ${Math.round((Date.now() - start) / 60000)} 分钟）`)
      return true
    }
    console.log(`[${ts()}] ⏳ 还在限流，已等 ${Math.round((Date.now() - start) / 60000)} 分钟…`)
  }
}

/** 清一个收藏夹里的所有失效内容 */
async function cleanFolder(folderId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch('https://api.bilibili.com/x/v3/fav/resource/clean', {
        method: 'POST',
        headers: {
          'User-Agent': UA, Cookie: cookie,
          Referer: `https://www.bilibili.com/medialist/detail/ml${folderId}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ media_id: String(folderId), platform: 'web', csrf: cred.bili_jct }).toString(),
        signal: AbortSignal.timeout(20000),
      })
      const text = await r.text()
      if (r.status === 412 || r.status === 429) {
        console.log(`[${ts()}] ⏳ HTTP ${r.status} 限流，进入等待模式`)
        if (!(await waitForUnblock())) process.exit(2)
        continue
      }
      try {
        return JSON.parse(text)
      } catch {
        return { code: -4, message: `HTTP ${r.status} 非 JSON：${text.slice(0, 60)}` }
      }
    } catch (e) {
      if (attempt === 3) return { code: -3, message: String(e.message || e) }
      await sleep(3000)
    }
  }
  return { code: -1, message: '重试耗尽' }
}

// ── 汇总要清的收藏夹
const fav = JSON.parse(readFileSync(join(DIR, 'data/fav.json'), 'utf8'))
const dead = fav.items.filter((x) => x.dead)
const groups = new Map()
for (const x of dead) {
  const k = String(x.folderId)
  if (!groups.has(k)) groups.set(k, { id: k, title: x.folder, items: [] })
  groups.get(k).items.push(x)
}
let targets = [...groups.values()].sort((a, b) => b.items.length - a.items.length)
if (ONLY) targets = targets.filter((g) => g.id === ONLY)
if (MIN > 0) targets = targets.filter((g) => g.items.length >= MIN)
if (TEST) targets = [targets.reduce((a, b) => (a.items.length <= b.items.length ? a : b))]

const totalDead = targets.reduce((s, g) => s + g.items.length, 0)
console.log(`待清理：${targets.length} 个收藏夹，共 ${totalDead} 个失效视频\n`)
for (const g of targets) console.log(`  ${String(g.title).padEnd(18)} ${String(g.items.length).padStart(4)} 个   (media_id=${g.id})`)

if (!YES) {
  console.log('\n===== 名单（前 20 个）=====')
  targets.flatMap((g) => g.items.map((x) => ({ ...x, folder: g.title }))).slice(0, 20).forEach((x, i) => {
    const t = x.favTime ? new Date(x.favTime * 1000).toISOString().slice(0, 7) : '??'
    console.log(`  ${String(i + 1).padStart(3)}. [${x.folder}] ${x.upper || '未知'} · 收藏于 ${t}`)
  })
  console.log(`\n⚠️ dry-run，什么都没删。确认要清就加 --yes`)
  process.exit(0)
}

if (!targets.length) { console.log('没有要清的。'); process.exit(0) }

if (!(await probeUnblocked())) {
  console.log('\n⚠️ 现在是限流状态，先等窗口过去（不会白跑）。')
  if (!(await waitForUnblock())) process.exit(2)
}

console.log(`\n即将清空 ${targets.length} 个收藏夹里的失效视频，共 ${totalDead} 个。`)
console.log('B站 没有「批量恢复收藏」，删了要一个个手动加回来。5 秒后开始，Ctrl+C 可取消…')
await sleep(5000)

let okFolders = 0
let failFolders = 0
let okItems = 0
for (const [i, g] of targets.entries()) {
  const r = await cleanFolder(g.id)
  const good = r.code === 0
  if (good) { okFolders += 1; okItems += g.items.length } else failFolders += 1
  appendFileSync(LOG, JSON.stringify({
    at: Math.floor(Date.now() / 1000),
    folderId: g.id, folder: g.title, count: g.items.length,
    ok: good, code: r.code, message: r.message || '',
  }) + '\n')
  console.log(`[${ts()}] ${i + 1}/${targets.length} ${good ? '✅' : '❌'} ${g.title}（${g.items.length} 个）`
    + (good ? '' : ` code=${r.code} ${r.message || ''}`))
  if (i < targets.length - 1) await sleep(2000)
}

console.log(`\n===== 完成 =====`)
console.log(`收藏夹：成功 ${okFolders} / 失败 ${failFolders}｜按扫描时的数量估算，清掉 ${okItems} 个失效视频`)
console.log(`日志：${LOG}`)
if (failFolders) console.log('失败的可以重跑同一条命令。')
