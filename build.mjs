/**
 * 生成收藏夹体检报告 index.html（数据内联，离线可看）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const src = JSON.parse(readFileSync('D:/project-demo/fav-doctor/data/fav.json', 'utf8'))
const items = src.items
const folders = src.folders
const now = src.fetchedAt
const DAY = 86400

const dead = items.filter((x) => x.dead)
const alive = items.filter((x) => !x.dead)

// 重复：同一个 bvid 出现在多个收藏夹
const byBvid = new Map()
for (const it of items) {
  if (!it.bvid || it.dead) continue
  if (!byBvid.has(it.bvid)) byBvid.set(it.bvid, [])
  byBvid.get(it.bvid).push(it)
}
const dupGroups = [...byBvid.values()].filter((v) => v.length > 1)
const dupExtra = dupGroups.reduce((s, v) => s + v.length - 1, 0)

// 每夹失效情况
const folderRows = folders
  .map((f) => ({ ...f, rate: f.scanned ? f.dead / f.scanned : 0 }))
  .sort((a, b) => b.dead - a.dead || b.scanned - a.scanned)

// 收藏大户
const byUpper = {}
for (const it of items) {
  if (it.dead) continue
  const k = it.upper || '未知'
  if (!byUpper[k]) byUpper[k] = { name: k, n: 0, mid: it.upperMid }
  byUpper[k].n += 1
}
const topUppers = Object.values(byUpper).sort((a, b) => b.n - a.n).slice(0, 12)

// 收藏年份
const byYear = {}
for (const it of items) {
  if (!it.favTime) continue
  const y = new Date(it.favTime * 1000).getFullYear()
  byYear[y] = (byYear[y] || 0) + 1
}
const years = Object.keys(byYear).map(Number).sort()

const payload = {
  fetchedAt: now,
  uid: src.uid,
  folderCount: folders.length,
  total: items.length,
  deadCount: dead.length,
  aliveCount: alive.length,
  dupGroups: dupGroups.length,
  dupExtra,
  folderRows,
  topUppers,
  byYear,
  dead: dead.slice().sort((a, b) => b.favTime - a.favTime).map((x) => ({
    title: x.title, folder: x.folder, folderId: x.folderId, aid: x.aid,
    upper: x.upper, upperMid: x.upperMid, favTime: x.favTime, duration: x.duration,
  })),
  dups: dupGroups.slice(0, 60).map((v) => ({
    title: v[0].title, bvid: v[0].bvid, upper: v[0].upper,
    folders: [...new Set(v.map((x) => x.folder))],
  })),
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>B站收藏夹体检 · ${items.length} 个视频</title>
<style>
  :root{
    --bg:#0f1216; --card:#171c23; --line:#252d38; --tx:#e8eef7; --tx2:#98a5b6; --tx3:#6b788a;
    --pink:#fb7299; --cyan:#4dc9c0; --blue:#7aa2f7; --amber:#f0a35e; --violet:#b98cff; --red:#e5646e;
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f7f8fa; --card:#fff; --line:#e3e7ee; --tx:#1b2029; --tx2:#5b6678; --tx3:#8b95a5; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);
    font:14px/1.65 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:52px 24px 72px}
  h1{font-size:34px;line-height:1.2;margin:0 0 6px;letter-spacing:-.5px}
  h1 span{color:var(--pink)}
  .sub{color:var(--tx2);font-size:14px;margin:0}
  .eyebrow{font-size:11px;letter-spacing:.16em;color:var(--tx3);margin:0 0 14px;text-transform:uppercase}
  section{margin-top:46px}
  h2{font-size:15px;margin:0 0 4px;font-weight:600}
  .hint{font-size:12.5px;color:var(--tx3);margin:0 0 16px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:34px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .card b{display:block;font-size:27px;line-height:1.2;font-weight:600;letter-spacing:-.5px}
  .card i{font-style:normal;font-size:12px;color:var(--tx2);display:block;margin-top:3px}
  .card.red b{color:var(--red)}
  .card.cyan b{color:var(--cyan)}
  .card.amber b{color:var(--amber)}
  .bars{display:flex;flex-direction:column;gap:8px}
  .brow{display:flex;align-items:center;gap:12px;font-size:12.5px}
  .blabel{width:130px;color:var(--tx2);flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .btrack{flex:1;height:11px;background:var(--card);border:1px solid var(--line);border-radius:99px;overflow:hidden}
  .bfill{height:100%;border-radius:99px;background:linear-gradient(90deg,#e5646e,#fb7299)}
  .bnum{width:76px;text-align:right;color:var(--tx);font-variant-numeric:tabular-nums;flex:none;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-weight:500;color:var(--tx3);padding:8px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
  tr:last-child td{border-bottom:0}
  td a{color:var(--tx);text-decoration:none}
  td a:hover{color:var(--pink)}
  .scroll{max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:2px 14px}
  .muted{color:var(--tx3);font-size:12px}
  .note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--amber);
    border-radius:14px;padding:18px 20px;font-size:13px}
  .note b{color:var(--amber)}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--tx3);font-size:11.5px}
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">favorite doctor · bilibili</p>
  <h1>收藏夹里 <span id="deadN">0</span> 个视频已经没了</h1>
  <p class="sub" id="sub"></p>

  <div class="cards" id="cards"></div>

  <section>
    <h2>哪些收藏夹坏了最多</h2>
    <p class="hint">按失效数量排。条子越长＝这个夹子里废掉的越多。</p>
    <div class="bars" id="folderBars"></div>
  </section>

  <section>
    <h2>失效清单</h2>
    <p class="hint">这些是 UP 删了、设成私密了、或者被下架的。收藏夹里点开只会显示「已失效视频」。</p>
    <div class="scroll"><table id="deadTable"></table></div>
  </section>

  <section>
    <h2>重复收藏</h2>
    <p class="hint" id="dupHint"></p>
    <div class="scroll"><table id="dupTable"></table></div>
  </section>

  <section>
    <h2>你收藏最多的是谁</h2>
    <p class="hint">按有效视频数排，前 12 个。</p>
    <div class="scroll"><table id="upperTable"></table></div>
  </section>

  <section>
    <h2>收藏的时间分布</h2>
    <div class="bars" id="yearBars"></div>
  </section>

  <section>
    <div class="note">
      <b>清理之前请注意：</b>失效视频删掉之后，如果那个 UP 以后把视频恢复成公开，你也不会再收藏回来。
      报告里只列清单，不自动删 —— 要删的时候单独跑 <code>clean.mjs</code>，它会先把名单打出来等你确认。
    </div>
  </section>

  <footer>
    数据：B站 收藏夹接口实时拉取（${new Date(now * 1000).toLocaleString('zh-CN')}）·
    本页纯本地生成，不上传任何东西。
  </footer>
</div>

<script>
const D = ${JSON.stringify(payload)};
const $ = (id) => document.getElementById(id);
const fmtDate = (ts) => { if (!ts) return '—'; const d = new Date(ts * 1000); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

$('deadN').textContent = D.deadCount;
$('sub').textContent = D.folderCount + ' 个收藏夹 · ' + D.total + ' 个视频 · 其中 ' + D.aliveCount + ' 个还正常';

$('cards').innerHTML = [
  ['', D.folderCount, '收藏夹'],
  ['', D.total, '视频总数'],
  ['red', D.deadCount, '已失效'],
  ['amber', D.dupExtra, '重复占位'],
].map(([cls, n, label]) => '<div class="card ' + cls + '"><b>' + n + '</b><i>' + label + '</i></div>').join('');

// 每夹失效
const maxDead = Math.max(1, ...D.folderRows.map((f) => f.dead));
$('folderBars').innerHTML = D.folderRows.filter((f) => f.scanned > 0).map((f) => {
  const w = (f.dead / maxDead) * 100;
  return '<div class="brow"><span class="blabel" title="' + esc(f.title) + '">' + esc(f.title) + '</span>'
    + '<div class="btrack"><div class="bfill" style="width:' + w + '%"></div></div>'
    + '<span class="bnum">' + f.dead + ' / ' + f.scanned + '</span></div>';
}).join('');

// 失效清单
$('deadTable').innerHTML = '<thead><tr><th>#</th><th>原视频标题</th><th>UP</th><th>所在收藏夹</th><th>收藏时间</th></tr></thead><tbody>'
  + (D.dead.length ? D.dead.map((x, i) => '<tr>'
    + '<td class="muted">' + (i + 1) + '</td>'
    + '<td>' + esc(x.title) + '</td>'
    + '<td class="muted">' + (x.upperMid ? '<a href="https://space.bilibili.com/' + x.upperMid + '" target="_blank" rel="noreferrer">' + esc(x.upper) + '</a>' : esc(x.upper)) + '</td>'
    + '<td class="muted">' + esc(x.folder) + '</td>'
    + '<td class="muted">' + fmtDate(x.favTime) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="muted" style="padding:16px 6px">一个失效的都没有 —— 你的收藏夹很干净。</td></tr>')
  + '</tbody>';

// 重复
$('dupHint').textContent = '同一个视频被塞进了多个收藏夹。' + D.dupGroups + ' 组，多占了 ' + D.dupExtra + ' 个位置（下面只列前 60 组）。';
$('dupTable').innerHTML = '<thead><tr><th>#</th><th>标题</th><th>UP</th><th>出现在</th></tr></thead><tbody>'
  + (D.dups.length ? D.dups.map((x, i) => '<tr>'
    + '<td class="muted">' + (i + 1) + '</td>'
    + '<td>' + esc(x.title) + '</td>'
    + '<td class="muted">' + esc(x.upper) + '</td>'
    + '<td class="muted">' + x.folders.map(esc).join(' / ') + '</td></tr>').join('')
    : '<tr><td colspan="4" class="muted" style="padding:16px 6px">没有重复收藏。</td></tr>')
  + '</tbody>';

// 收藏大户
$('upperTable').innerHTML = '<thead><tr><th>#</th><th>UP</th><th>你收藏了他多少个</th></tr></thead><tbody>'
  + D.topUppers.map((u, i) => '<tr><td class="muted">' + (i + 1) + '</td>'
    + '<td>' + (u.mid ? '<a href="https://space.bilibili.com/' + u.mid + '" target="_blank" rel="noreferrer">' + esc(u.name) + '</a>' : esc(u.name)) + '</td>'
    + '<td>' + u.n + '</td></tr>').join('')
  + '</tbody>';

// 年份
const maxY = Math.max(1, ...Object.values(D.byYear));
$('yearBars').innerHTML = Object.keys(D.byYear).sort().map((y) => {
  const n = D.byYear[y];
  return '<div class="brow"><span class="blabel">' + y + ' 年</span>'
    + '<div class="btrack"><div class="bfill" style="width:' + (n / maxY * 100) + '%;background:linear-gradient(90deg,#4dc9c0,#7aa2f7)"></div></div>'
    + '<span class="bnum">' + n + '</span></div>';
}).join('');
</script>
</body>
</html>`

writeFileSync('D:/project-demo/fav-doctor/index.html', html)
console.log('报告生成：D:/project-demo/fav-doctor/index.html')
console.log(`${folders.length} 个收藏夹 / ${items.length} 条 / 失效 ${dead.length} / 重复 ${dupGroups.length} 组（多占 ${dupExtra}）`)
