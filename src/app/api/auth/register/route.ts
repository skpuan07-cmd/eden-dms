import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, audit } from '@/lib/auth'
import { sendMail, verifyEmailContent, appOrigin } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register — สมัครใช้งานด้วยตนเอง (Task 28 — port จาก Sahana Eden register flow)
 * - สร้างผู้ใช้ role="volunteer" + verificationToken → ส่งอีเมลยืนยัน (ลิงก์ /login?verify=<token>)
 * - ถ้ายังไม่ตั้งค่า SMTP (sandbox) → บันทึก EmailLog สถานะ queued และคืน fallbackLink ให้หน้าเว็บโชว์แทน
 *   (เทียบเท่ากรณี Eden "Unable to send verification email" แต่ผู้ใช้ยังไปต่อได้)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; email?: string; password?: string; confirm?: string }
    const name = body.name?.trim() ?? ''
    const email = body.email?.trim().toLowerCase() ?? ''
    const password = body.password ?? ''
    const confirm = body.confirm ?? ''

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อ-นามสกุล (อย่างน้อย 2 ตัวอักษร)' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400 })
    }
    if (confirm && password !== confirm) {
      return NextResponse.json({ error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }, { status: 400 })
    }

    const exists = await db.user.findUnique({ where: { email } })
    if (exists) {
      // ไม่เปิดเผยว่าบัญชีมีอยู่จริงทั้งหมด — แต่กรณีรอยืนยันค้าง ชี้ทางไป forgot แทน
      if (exists.verificationToken) {
        return NextResponse.json(
          { error: 'อีเมลนี้มีคำขอสมัครค้างอยู่และยังไม่ได้รับการยืนยัน — หากยังไม่ได้รับลิงก์ ให้กด "ลืมรหัสผ่าน?" เพื่อขอลิงก์ใหม่' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'สมัครไม่สำเร็จ — อีเมลนี้ไม่สามารถใช้ได้' }, { status: 409 })
    }

    const token = randomBytes(32).toString('hex')
    const user = await db.user.create({
      data: {
        email,
        name,
        role: 'volunteer',
        passwordHash: hashPassword(password),
        status: 'active',
        verificationToken: token,
      },
    })

    const origin = appOrigin(req)
    const verifyUrl = `${origin}/login?verify=${token}`
    const tpl = verifyEmailContent(name, verifyUrl)
    const mail = await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html, purpose: 'verify' })

    await audit(
      'register',
      'admin',
      `สมัครใช้งานใหม่: ${name} (${email}) — อีเมลยืนยัน ${mail.status === 'sent' ? 'ส่งแล้ว' : mail.status === 'queued' ? 'รอจ่ายจริง (ยังไม่ตั้ง SMTP)' : 'ส่งไม่สำเร็จ'}`,
      name,
    )

    return NextResponse.json({
      ok: true,
      message:
        mail.status === 'sent'
          ? 'สมัครสำเร็จ — กรุณาเปิดอีเมลของท่านและกดลิงก์ยืนยัน (ลิงก์ใช้ได้ 24 ชั่วโมง)'
          : 'สมัครสำเร็จ — ระบบยังไม่ได้ตั้งค่าเซิร์ฟเวอร์อีเมล (SMTP) จึงโชว์ลิงก์ยืนยันให้ที่นี่แทนการส่งอีเมล',
      fallbackLink: mail.status === 'queued' ? verifyUrl : undefined,
    })
  } catch (e) {
    console.error('[auth/register]', e)
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' }, { status: 500 })
  }
}
