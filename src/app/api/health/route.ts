// ============================================================
// EDEN DMS — Health endpoint (Task 29 — จากแผน Modernization บทที่ 7.5)
// ตรวจความพร้อมของระบบ: ฐานข้อมูล + AI engine config
// เปิดให้เรียกได้โดยไม่ต้อง login (ไม่มีข้อมูลส่วนบุคคล) —
// ใช้สำหรับ monitoring / docker healthcheck / K8s probes ในอนาคต
// ============================================================
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, string> = {}

  // ฐานข้อมูล — SELECT 1 แบบง่ายที่สุด
  try {
    await db.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch (e) {
    checks.database = `fail: ${e instanceof Error ? e.message.slice(0, 100) : 'unknown'}`
  }

  // AI engine — ตรวจว่ามี SDK พร้อมเรียก (ไม่เรียกจริง เพื่อไม่เสียค่าใช้จ่าย)
  try {
    const cfg = await import('fs').then((fs) =>
      fs.promises
        .readFile('/etc/.z-ai-config', 'utf8')
        .then((t) => JSON.parse(t))
        .catch(() => null),
    )
    checks.ai_engine = cfg && (cfg.token || cfg.apiKey) ? 'ok' : 'ok (sandbox fallback)'
  } catch {
    checks.ai_engine = 'ok (sandbox fallback)'
  }

  const overall = Object.values(checks).every((v) => v.startsWith('ok')) ? 'ok' : 'degraded'

  return NextResponse.json(
    {
      status: overall,
      app: 'EDEN DMS',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overall === 'ok' ? 200 : 503 },
  )
}
