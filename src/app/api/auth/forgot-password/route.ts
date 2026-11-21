import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth'
import { sendMail, resetPasswordEmailContent, appOrigin } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

const RESET_TTL_MIN = 30

/**
 * POST /api/auth/forgot-password — ขอลิงก์ตั้งรหัสผ่านใหม่ (Task 28 — port จาก Eden reset_password flow)
 * - ตอบ ok เสมอ (ไม่เปิดเผยว่าอีเมลมีบัญชีหรือไม่ — กันการเดาบัญชี)
 * - ถ้ายังไม่ตั้ง SMTP: คืน fallbackLink ให้หน้าเว็บโชว์ (เหมือนแนวคิด msg_outbox ของ Eden)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string }
    const email = body.email?.trim().toLowerCase() ?? ''
    if (!email) {
      return NextResponse.json({ error: 'กรุณากรอกอีเมล' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    const genericOk = {
      ok: true,
      message:
        'หากอีเมลนี้มีบัญชีในระบบ ลิงก์ตั้งรหัสผ่านใหม่จะถูกส่งไป (ลิงก์ใช้ได้ 30 นาที) — ตรวจสอบกล่องจดหมายและโฟลเดอร์สแปมด้วย',
    }
    if (!user || user.status !== 'active') {
      await audit('password_reset_request', 'admin', `ขอลิงก์รีเซ็ตรหัสผ่าน: ไม่พบบัญชี/ไม่พร้อมใช้ (${email})`)
      return NextResponse.json(genericOk)
    }

    // token เก่าให้หมดอายุทันที (สร้างใหม่ทับ)
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000)
    await db.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiresAt: expires },
    })

    const origin = appOrigin(req)
    const resetUrl = `${origin}/login?reset=${token}`
    const tpl = resetPasswordEmailContent(user.name, resetUrl)
    const mail = await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html, purpose: 'reset' })

    await audit(
      'password_reset_request',
      'admin',
      `ขอลิงก์รีเซ็ตรหัสผ่าน: ${user.name} (${email}) — อีเมล ${mail.status === 'sent' ? 'ส่งแล้ว' : mail.status === 'queued' ? 'รอจ่ายจริง (ยังไม่ตั้ง SMTP)' : 'ส่งไม่สำเร็จ'}`,
      user.name,
    )

    return NextResponse.json({
      ...genericOk,
      fallbackLink: mail.status === 'queued' ? resetUrl : undefined,
      fallbackNote:
        mail.status === 'queued'
          ? 'ระบบยังไม่ได้ตั้งค่าเซิร์ฟเวอร์อีเมล (SMTP) จึงโชว์ลิงก์ให้ที่นี่แทนการส่งอีเมล'
          : undefined,
    })
  } catch (e) {
    console.error('[auth/forgot-password]', e)
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' }, { status: 500 })
  }
}
