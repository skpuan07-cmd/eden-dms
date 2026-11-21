import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ล็อกบัญชีชั่วคราวเมื่อพยายามเข้าสู่ระบบผิดซ้ำ (port จาก auth_user.failed_attempts/locked_until ของ Sahana Eden — Task 28)
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

/** คุกกี้ปลอดภัยบน HTTPS — port จาก patch `if request.is_https: session.secure()` ของ Eden (Task 28) */
function cookieOptions(req: NextRequest) {
  const isHttps = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https'
  return { ...SESSION_COOKIE_OPTIONS, secure: isHttps || SESSION_COOKIE_OPTIONS.secure }
}

/** POST /api/auth/login — เข้าสู่ระบบ (P1: G1 + Task 28: lockout/pending) */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string }
    const email = body.email?.trim().toLowerCase()
    const password = body.password ?? ''
    if (!email || !password) {
      return NextResponse.json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
      // นับพยายามผิดเฉพาะกรณีบัญชีมีจริง (กันเดาบัญชีด้วยการล็อก)
      if (user && user.status === 'active') {
        const attempts = user.failedAttempts + 1
        const lock = attempts >= MAX_FAILED_ATTEMPTS
        await db.user.update({
          where: { id: user.id },
          data: {
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : user.lockedUntil,
          },
        })
        if (lock) {
          await audit('login', 'admin', `บัญชีถูกล็อกชั่วคราว ${LOCK_MINUTES} นาที (พยายามผิด ${MAX_FAILED_ATTEMPTS} ครั้ง): ${email}`)
          return NextResponse.json(
            { error: `พยายามเข้าสู่ระบบไม่ถูกต้อง ${MAX_FAILED_ATTEMPTS} ครั้ง — บัญชีถูกล็อกชั่วคราว ${LOCK_MINUTES} นาที หรือใช้ "ลืมรหัสผ่าน?" เพื่อตั้งรหัสใหม่` },
            { status: 423 },
          )
        }
        const left = MAX_FAILED_ATTEMPTS - attempts
        await audit('login', 'admin', `พยายามเข้าสู่ระบบไม่สำเร็จ (${attempts}/${MAX_FAILED_ATTEMPTS}): ${email}`)
        return NextResponse.json(
          { error: `อีเมลหรือรหัสผ่านไม่ถูกต้อง (พยายามผิดอีก ${left} ครั้งก่อนบัญชีถูกล็อกชั่วคราว)` },
          { status: 401 },
        )
      }
      await audit('login', 'admin', `พยายามเข้าสู่ระบบไม่สำเร็จ: ${email}`)
      return NextResponse.json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 })
    }

    // ล็อกชั่วคราวยังไม่หมดเวลา
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const remainMin = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000))
      await audit('login', 'admin', `พยายามเข้าสู่ระบบระหว่างถูกล็อก (เหลือ ~${remainMin} นาที): ${email}`)
      return NextResponse.json(
        { error: `บัญชีถูกล็อกชั่วคราว — ลองอีกครั้งในอีก ~${remainMin} นาที หรือใช้ "ลืมรหัสผ่าน?" เพื่อตั้งรหัสใหม่ทันที` },
        { status: 423 },
      )
    }

    // สมัครแล้วแต่ยังไม่ยืนยันอีเมล (มี verificationToken ค้าง)
    if (user.verificationToken) {
      await audit('login', 'admin', `เข้าสู่ระบบก่อนยืนยันอีเมล: ${email}`)
      return NextResponse.json(
        { error: 'บัญชียังไม่ได้รับการยืนยัน — กรุณาเปิดลิงก์ยืนยันในอีเมลที่ได้รับตอนสมัคร หรือกด "ลืมรหัสผ่าน?" เพื่อขอลิงก์ใหม่' },
        { status: 403 },
      )
    }

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null },
    })
    await audit('login', 'admin', `เข้าสู่ระบบ: ${user.name} (${user.role})`, user.name)

    const token = signSession({ id: user.id, email: user.email, name: user.name, role: user.role })
    const res = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(req))
    return res
  } catch (e) {
    console.error('[auth/login]', e)
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' }, { status: 500 })
  }
}
