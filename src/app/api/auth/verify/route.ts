import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/verify?token=... — ยืนยันอีเมลจากลิงก์ในอีเมล (Task 28)
 * ยืนยันสำเร็จ: ล้าง verificationToken + ตั้ง emailVerifiedAt → ผู้ใช้เข้าสู่ระบบได้
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') ?? ''
    if (!token) {
      return NextResponse.json({ ok: false, error: 'ลิงก์ยืนยันไม่สมบูรณ์' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { verificationToken: token } })
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'ลิงก์ยืนยันไม่ถูกต้องหรือถูกใช้ไปแล้ว — ลองเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน?" เพื่อขอลิงก์ใหม่' },
        { status: 404 },
      )
    }

    await db.user.update({
      where: { id: user.id },
      data: { verificationToken: null, emailVerifiedAt: new Date() },
    })
    await audit('verify', 'admin', `ยืนยันอีเมลสำเร็จ: ${user.name} (${user.email})`, user.name)

    return NextResponse.json({
      ok: true,
      message: `ยืนยันอีเมลสำเร็จ — บัญชีของคุณ${user.name}พร้อมใช้งานแล้ว กรุณาเข้าสู่ระบบ`,
    })
  } catch (e) {
    console.error('[auth/verify]', e)
    return NextResponse.json({ ok: false, error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' }, { status: 500 })
  }
}
