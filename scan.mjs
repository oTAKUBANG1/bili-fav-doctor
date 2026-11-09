/**
 * 扫全部收藏夹，落地 JSON。只读，不删任何东西。
 * 支持断点续传：每翻一页写一次 data/progress.json，中断了重跑会接着扫。
 *
 * 用法：
 *   node scan.mjs           # 全部（续扫）
 *   node scan.mjs --reset   # 丢掉进度重来
 *   node scan.mjs --only=73037244   # 只扫某一个收藏夹（调试用）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const H = join(homedir(), '.dsh')
const OUT = 'D:/project-demo/fav-doctor/data'
mkdirSync(OUT, { recursive: true })
const PROGRESS = join(OUT, 'progress.json')
const PAGE_SLEEP = 520  // 实测 220ms 会在第 107 页触发限流，520ms 更稳 // 收藏夹接口实测不敏感，比关注列表松

const args = process.argv.slice(2)
const RESET = args.includes('--reset')
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''

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
    if (c.sessdata) return c
  }
  throw new Error('找不到凭证')
}

const cred = loadCred()
const cookie = Object.entries({ SESSDATA: cred.sessdata, bili_jct: cred.bili_jct, buvid3: cred.buvid3, DedeUserID: cred.dedeuserid })
  .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')

// 注意：fetch 默认没有超时，B站 不响应时会一直挂着 —— 之前就是卡在这里
const get = async (path, params) => {
  const url = 'https://api.bilibili.com' + path + '?' + new URLSearchParams(params)
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Cookie: cookie, Referer: 'https://www.bilibili.com/' },
        signal: AbortSignal.timeout(15000),
      })
      if (r.status === 412 || r.status === 429) {
        // 限流了：60s → 120s → 180s，够等一个窗口过去；还不行就让调用方跳过这个夹
        const wait = 60000 * (i + 1)
        console.log(`[${ts()}]   ⏳ HTTP ${r.status} 限流，等 ${wait / 1000}s 再试（第 ${i + 1}/3 次）`)
        await sleep(wait)
        continue
      }
      const j = await r.json().catch(() => null)
      if (j?.code === -412) { await sleep(120000); continue }
      return j
    } catch (e) {
      if (i === 2) return { code: -1, message: String(e.message || e) }
      await sleep(3000)
    }
  }
  return { code: -2, message: '重试耗尽（可能被限流）' }
}

/** 进度结构：{ [folderId]: { pn, items: [...], done } } */
let prog = {}
if (!RESET && existsSync(PROGRESS)) {
  try { prog = JSON.parse(readFileSync(PROGRESS, 'utf8')) } catch { prog = {} }
}
const save = () => writeFileSync(PROGRESS, JSON.stringify(prog))

// ── 1. 收藏夹列表
const fj = await get('/x/v3/fav/folder/created/list-all', { up_mid: cred.dedeuserid })
if (fj?.code !== 0) throw new Error(`拿不到收藏夹列表：code ${fj?.code} ${fj?.message || ''}`)
let folders = (Array.isArray(fj.data) ? fj.data : fj.data?.list || []).map((f) => ({
  id: String(f.id), title: f.title, count: f.media_count,
}))
if (ONLY) folders = folders.filter((f) => f.id === ONLY)

const totalDeclared = folders.reduce((s, f) => s + f.count, 0)
console.log(`[${ts()}] ${folders.length} 个收藏夹，声明共 ${totalDeclared} 条`)

// ── 2. 逐个翻页
for (const f of folders) {
  const cur = prog[f.id] || { pn: 1, items: [], done: false }
  if (cur.done) {
    console.log(`[${ts()}] 跳过（已完成）${f.title} — ${cur.items.length} 条`)
    continue
  }
  prog[f.id] = cur
  const t0 = Date.now()
  while (cur.pn <= 400) {
    const j = await get('/x/v3/fav/resource/list', { media_id: f.id, pn: String(cur.pn), ps: '20', platform: 'web' })
    if (!j || j.code !== 0) {
      console.log(`[${ts()}] ⚠️ ${f.title} 第 ${cur.pn} 页失败：code ${j?.code} ${j?.message || ''}，先跳过这个夹`)
      break
    }
    const medias = j.data?.medias || []
    for (const m of medias) {
      cur.items.push({
        folderId: f.id, folder: f.title,
        aid: m.id, type: m.type, title: m.title,
        bvid: m.bvid || m.bv_id || '',
        upper: m.upper?.name || '', upperMid: m.upper?.mid || 0,
        favTime: m.fav_time || 0, pubtime: m.pubtime || 0,
        duration: m.duration || 0,
        dead: m.title === '已失效视频' || (m.attr & 1) === 1,
        attr: m.attr,
      })
    }
    if (!j.data?.has_more) cur.done = true
    cur.pn += 1
    save()
    if (cur.pn % 20 === 0) {
      const sec = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`[${ts()}]   ${f.title}: ${cur.items.length}/${f.count} 条，第 ${cur.pn} 页，已用 ${sec}s`)
    }
    if (cur.done) break
    // 每 60 页主动歇一下，别等被限流才降速
    if (cur.pn % 60 === 0) {
      console.log(`[${ts()}]   😴 连翻 60 页，休息 25s 避开限流窗口`)
      await sleep(25000)
    } else {
      await sleep(PAGE_SLEEP)
    }
  }
  if (cur.done) {
    const deadN = cur.items.filter((x) => x.dead).length
    console.log(`[${ts()}] ✅ ${f.title}: ${cur.items.length} 条（失效 ${deadN}）`)
    save()
  }
}

// ── 3. 汇总
const all = Object.values(prog).flatMap((f) => f.items)
const doneFolders = folders.filter((f) => prog[f.id]?.done)
const dead = all.filter((x) => x.dead)

const byBvid = new Map()
for (const it of all) {
  if (!it.bvid || it.dead) continue
  if (!byBvid.has(it.bvid)) byBvid.set(it.bvid, [])
  byBvid.get(it.bvid).push(it)
}
const dupGroups = [...byBvid.values()].filter((v) => v.length > 1)
const dupExtra = dupGroups.reduce((s, v) => s + v.length - 1, 0)

const payload = {
  fetchedAt: Math.floor(Date.now() / 1000),
  uid: cred.dedeuserid,
  complete: doneFolders.length === folders.length,
  folders: folders.map((f) => {
    const p = prog[f.id] || { items: [] }
    return { id: f.id, title: f.title, declared: f.count, scanned: p.items.length, dead: p.items.filter((x) => x.dead).length, done: Boolean(p.done) }
  }),
  items: all,
  stats: { total: all.length, dead: dead.length, dupGroups: dupGroups.length, dupExtra },
}
writeFileSync(join(OUT, 'fav.json'), JSON.stringify(payload))

console.log(`\n[${ts()}] ===== 汇总 =====`)
console.log(`已完成收藏夹 ${doneFolders.length}/${folders.length}｜条目 ${all.length}｜失效 ${dead.length}｜重复 ${dupGroups.length} 组（多占 ${dupExtra}）`)
if (doneFolders.length < folders.length) {
  console.log('⚠️ 还没扫完，再跑一次会接着扫')
} else {
  console.log('🎉 全部扫完')
}
