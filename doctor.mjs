/**
 * 收藏夹体检 · 一键运行器
 * ============================================================================
 * 把「翻页扫描 → 汇总打包 → 生成报告」串成一条命令，中途被限流自己等。
 *
 * 用法：
 *   node doctor.mjs              # 续扫 + 出报告（推荐，跑几次都不会重复干活）
 *   node doctor.mjs --reset      # 丢掉进度从头扫
 *   node doctor.mjs --scan-only  # 只扫不生成报告
 *   node doctor.mjs --report-only  # 只用已有数据出报告
 *
 * 断点续扫：进度写在 data/progress.json，每翻一页落一次盘。
 * 中断了（关窗口、被限流、电脑睡眠）直接重跑这条命令就行。
 * ============================================================================
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const RESET = args.includes('--reset')
const SCAN_ONLY = args.includes('--scan-only')
const REPORT_ONLY = args.includes('--report-only')

const DIR = 'D:/project-demo/fav-doctor'
const steps = []
if (!REPORT_ONLY) steps.push({ file: 'scan.mjs', extra: RESET ? ['--reset'] : [] })
if (!SCAN_ONLY) {
  steps.push({ file: 'pack.mjs' })
  steps.push({ file: 'build.mjs' })
}

const t0 = Date.now()
for (const [i, s] of steps.entries()) {
  const path = `${DIR}/${s.file}`
  if (!existsSync(path)) {
    console.error(`❌ 找不到 ${path}`)
    process.exit(1)
  }
  console.log(`\n${'─'.repeat(60)}\n▶ [${i + 1}/${steps.length}] ${s.file}\n${'─'.repeat(60)}`)
  try {
    execFileSync(process.execPath, [path, ...s.extra], { stdio: 'inherit', cwd: DIR })
  } catch (e) {
    console.error(`\n❌ ${s.file} 失败：${e.message}`)
    console.error('   进度已保存，直接重跑 node doctor.mjs 会接着来。')
    process.exit(1)
  }
}

const sec = ((Date.now() - t0) / 1000).toFixed(0)
console.log(`\n${'─'.repeat(60)}`)
console.log(`✅ 全部完成，用时 ${sec}s`)
console.log(`   报告：${DIR}/index.html`)
console.log(`   数据：${DIR}/data/fav.json`)
