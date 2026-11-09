/**
 * 摸 B站 收藏夹接口：只读，不做任何修改。
 * 目的：确认 1) 怎么列收藏夹 2) 失效条目长什么样 3) 要不要 wbi 签名
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const H = join(homedir(), '.dsh')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,
  39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,
  63,57,62,11,36,20,34,44,52]
const md5 = (s) => createHash('md5').update(s).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Math.floor(Date.now() / 1000)

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

const c = loadCred()
const cookie = Object.entries({ SESSDATA: c.sessdata, bili_jct: c.bili_jct, buvid3: c.buvid3, DedeUserID: c.dedeuserid })
  .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')
console.log('登录 UID:', c.dedeuserid)

const get = async (path, params = {}) => {
  const url = 'https://api.bilibili.com' + path + '?' + new URLSearchParams(params)
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cookie, Referer: 'https://www.bilibili.com/' },
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// ── 1. 拿 wbi key
const nav = await get('/x/web-interface/nav', {})
const wbiImg = nav.json?.data?.wbi_img || {}
const img = (wbiImg.img_url || '').split('/').pop().split('.')[0]
const sub = (wbiImg.sub_url || '').split('/').pop().split('.')[0]
const WBI = img && sub ? MIXIN.map((i) => (img + sub)[i]).join('').slice(0, 32) : ''
console.log('登录名:', nav.json?.data?.uname, '| wbi key 拿到:', Boolean(WBI))

const signed = (params) => {
  const p = { ...params, wts: String(now()) }
  const q = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&')
  return q + '&w_rid=' + md5(q + WBI)
}

// ── 2. 列出所有收藏夹（先试不带签名）
console.log('\n=== 收藏夹列表 ===')
let folders = null
for (const [label, path, signedFlag] of [
  ['list-all（不签名）', '/x/v3/fav/folder/created/list-all', false],
  ['list-all（wbi）', '/x/v3/fav/folder/created/list-all', true],
]) {
  const q = signedFlag ? signed({ up_mid: c.dedeuserid }) : new URLSearchParams({ up_mid: c.dedeuserid }).toString()
  const r = await fetch('https://api.bilibili.com' + path + '?' + q, {
    headers: { 'User-Agent': UA, Cookie: cookie, Referer: 'https://www.bilibili.com/' },
  })
  const j = await r.json().catch(() => null)
  console.log(`${label}: code=${j?.code} ${j?.message || ''}`)
  if (j?.code === 0 && j.data) {
    folders = Array.isArray(j.data) ? j.data : j.data.list || []
    console.log('  收藏夹数:', folders.length)
    folders.slice(0, 8).forEach((f) => console.log(`   - ${f.title} | media_id=${f.id} | ${f.media_count} 个`))
    break
  }
  await sleep(700)
}

if (!folders?.length) {
  console.log('没拿到收藏夹列表')
  process.exit(0)
}

// ── 3. 看第一个收藏夹的内容长什么样
const target = folders.find((f) => f.media_count > 0) || folders[0]
console.log(`\n=== 收藏夹「${target.title}」的内容（media_id=${target.id}）===`)
for (const [label, qs] of [
  ['不签名', new URLSearchParams({ media_id: String(target.id), pn: '1', ps: '20', platform: 'web' }).toString()],
  ['wbi 签名', signed({ media_id: String(target.id), pn: '1', ps: '20', platform: 'web' })],
]) {
  const r = await fetch('https://api.bilibili.com/x/v3/fav/resource/list?' + qs, {
    headers: { 'User-Agent': UA, Cookie: cookie, Referer: `https://www.bilibili.com/medialist/detail/ml${target.id}` },
  })
  const j = await r.json().catch(() => null)
  console.log(`${label}: code=${j?.code} ${j?.message || ''} has_more=${j?.data?.has_more}`)
  if (j?.code === 0 && j.data) {
    const medias = j.data.medias || []
    console.log('  本页', medias.length, '条；info:', JSON.stringify(j.data.info || {}).slice(0, 120))
    console.log('  样本字段:', Object.keys(medias[0] || {}).join(','))
    // 找失效的
    const dead = medias.filter((m) => m.title === '已失效视频' || m.attr !== 0 || !m.bvid)
    console.log('  本页疑似失效:', dead.length)
    if (dead[0]) console.log('  失效样本:', JSON.stringify(dead[0]).slice(0, 500))
    if (medias[0]) console.log('  正常样本:', JSON.stringify(medias[0]).slice(0, 400))
    break
  }
  await sleep(800)
}
