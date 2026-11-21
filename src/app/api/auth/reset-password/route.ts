import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password — ตั้งรหัสผ่านใหม่ด้วย token จากลิงก์ (Task 28)
 * - token ต้องยังไม่หมดอายุ (30 นาที)
 * - สำเร็จ: ล้าง token + ปลดล็อกบัญชี + รีเซ็ตตัวนับพยายามผิด
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; password?: string; confirm?: string }
    const token = body.token ?? ''
    const password = body.password ?? ''
    const confirm = body.confirm ?? ''

    if (!token) {
      return NextResponse.json({ error: 'ลิงก์ตั้งรหัสผ่านไม่สมบูรณ์' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400 })
    }
    if (confirm && password !== confirm) {
      return NextResponse.json({ error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { resetToken: token } })
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว — กรุณาขอลิงก์ใหม่ที่หน้า "ลืมรหัสผ่าน?"' },
        { status: 400 },
      )
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        resetToken: null,
        resetTokenExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    })
    await audit('password_reset', 'admin', `ตั้งรหัสผ่านใหม่สำเร็จ: ${user.name} (${user.email})`, user.name)

    return NextResponse.json({ ok: true, message: 'ตั้งรหัสผ่านใหม่สำเร็จ — กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' })
  } catch (e) {
    console.error('[auth/reset-password]', e)
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' }, { status: 500 })
  }
}
