import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, isResponse, audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/emails — บันทึกอีเมลที่ระบบส่งล่าสุด 100 ฉบับ (Task 28 — port msg_log จาก Sahana Eden)
 * เฉพาะผู้ดูแลระบบ (admin) — แสดงสถานะจริง: sent (ส่งผ่าน SMTP สำเร็จ) | queued (ยังไม่ตั้ง SMTP — เก็บใน outbox) | failed
 */
export async function GET(req: NextRequest) {
  const auth = requireUser(req)
  if (isResponse(auth)) return auth
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, { status: 403 })
  }

  try {
    const logs = await db.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    return NextResponse.json(logs)
  } catch (e) {
    console.error('[admin/emails]', e)
    await audit('error', 'admin', `อ่านบันทึกอีเมลล้มเหลว: ${e instanceof Error ? e.message : 'unknown'}`, auth.name)
    return NextResponse.json({ error: 'อ่านบันทึกอีเมลไม่สำเร็จ' }, { status: 500 })
  }
}
