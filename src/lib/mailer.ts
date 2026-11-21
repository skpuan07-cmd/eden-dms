// ============================================================
// EDEN DMS — ระบบส่งอีเมล (port จาก Sahana Eden: msg + Mail.send)
// Task 28: วิเคราะห์จากแพ็กเกจ sahana-eden-improved.zip
//
// แนวคิดจาก Eden:
// - settings.mail.* (Gmail SMTP + App Password) → ที่นี่คือ env SMTP_*
// - msg_log / msg_outbox → ทุกฉบับบันทึกลง EmailLog เสมอ
//   (ถ้ายังไม่ตั้ง SMTP: สถานะ "queued" — ลิงก์สำคัญจะถูกคืนให้หน้าเว็บโชว์แทน)
// ============================================================
import { db } from '@/lib/db'

export interface MailInput {
  to: string
  subject: string
  text: string
  html?: string
  purpose: 'verify' | 'reset' | 'alert'
}

export interface MailResult {
  ok: boolean
  channel: 'smtp' | 'fallback'
  status: 'sent' | 'queued' | 'failed'
  error?: string
}

// ตั้งค่า SMTP จาก env (คู่กับ Gmail App Password ของ Eden: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587)
const SMTP_HOST = process.env.SMTP_HOST || ''
const SMTP_PORT = Number(process.env.SMTP_PORT || 587)
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || ''
const SMTP_FROM = process.env.SMTP_FROM || 'EDEN DMS <no-reply@eden.go.th>'

export function mailerConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS)
}

/** ส่งอีเมล + บันทึก EmailLog ทุกฉบับ (แม้ fallback) — ไม่ throw เพื่อไม่พัง flow หลัก */
export async function sendMail(input: MailInput): Promise<MailResult & { logId?: string }> {
  let status: MailResult['status'] = 'queued'
  let channel: MailResult['channel'] = 'fallback'
  let error: string | undefined

  if (mailerConfigured()) {
    channel = 'smtp'
    try {
      const nodemailer = await import('nodemailer')
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
      await transport.sendMail({
        from: SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      })
      status = 'sent'
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : String(e)
      console.error('[mailer] SMTP send failed:', error)
    }
  } else {
    console.log(`[mailer] fallback (ยังไม่ตั้ง SMTP) → ${input.to} | ${input.subject}`)
  }

  try {
    const log = await db.emailLog.create({
      data: {
        to: input.to,
        subject: input.subject,
        body: input.text,
        purpose: input.purpose,
        channel,
        status,
        error: error ?? null,
      },
    })
    return { ok: status !== 'failed', channel, status, error, logId: log.id }
  } catch (e) {
    console.error('[mailer] EmailLog write failed:', e)
    return { ok: status !== 'failed', channel, status, error }
  }
}

// ---------- เทมเพลตภาษาไทย ----------

export function verifyEmailContent(name: string, verifyUrl: string): { subject: string; text: string; html: string } {
  const subject = 'ยืนยันอีเมลสมัครใช้งาน EDEN DMS'
  const text = [
    `สวัสดีคุณ ${name},`,
    '',
    'ขอบคุณที่สมัครใช้งานระบบจัดการภัยพิบัติ EDEN DMS',
    'กรุณายืนยันอีเมลของท่านโดยเปิดลิงก์ด้านล่าง (ลิงก์ใช้ได้ 24 ชั่วโมง):',
    verifyUrl,
    '',
    'หากท่านไม่ได้สมัครใช้งาน กรุณาเพิกเฉยอีเมลนี้',
    '— EDEN DMS (ระบบจัดการภัยพิบัติ)',
  ].join('\n')
  const html = `<div style="font-family:sans-serif;max-width:520px">
    <h2 style="color:#059669">ยืนยันอีเมลสมัครใช้งาน EDEN DMS</h2>
    <p>สวัสดีคุณ ${name},</p>
    <p>ขอบคุณที่สมัครใช้งานระบบจัดการภัยพิบัติ EDEN DMS กรุณากดลิงก์ด้านล่างเพื่อยืนยัน (ใช้ได้ 24 ชั่วโมง):</p>
    <p><a href="${verifyUrl}" style="display:inline-block;background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">ยืนยันอีเมลของฉัน</a></p>
    <p style="font-size:12px;color:#64748b">หรือเปิดลิงก์นี้: ${verifyUrl}</p>
    <p style="font-size:12px;color:#64748b">หากท่านไม่ได้สมัครใช้งาน กรุณาเพิกเฉยอีเมลนี้</p>
  </div>`
  return { subject, text, html }
}

export function resetPasswordEmailContent(name: string, resetUrl: string): { subject: string; text: string; html: string } {
  const subject = 'ตั้งรหัสผ่านใหม่ EDEN DMS'
  const text = [
    `สวัสดีคุณ ${name},`,
    '',
    'ได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี EDEN DMS ของท่าน',
    'เปิดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ 30 นาที):',
    resetUrl,
    '',
    'หากท่านไม่ได้ขอตั้งรหัสผ่านใหม่ กรุณาเพิกเฉยอีเมลนี้ (รหัสผ่านเดิมยังใช้ได้)',
    '— EDEN DMS (ระบบจัดการภัยพิบัติ)',
  ].join('\n')
  const html = `<div style="font-family:sans-serif;max-width:520px">
    <h2 style="color:#059669">ตั้งรหัสผ่านใหม่ EDEN DMS</h2>
    <p>สวัสดีคุณ ${name},</p>
    <p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ 30 นาที):</p>
    <p><a href="${resetUrl}" style="display:inline-block;background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">ตั้งรหัสผ่านใหม่</a></p>
    <p style="font-size:12px;color:#64748b">หรือเปิดลิงก์นี้: ${resetUrl}</p>
    <p style="font-size:12px;color:#64748b">หากท่านไม่ได้ขอ กรุณาเพิกเฉยอีเมลนี้ (รหัสผ่านเดิมยังใช้ได้)</p>
  </div>`
  return { subject, text, html }
}

/** กำหนด URL ฐานของลิงก์ในอีเมล — ใช้ request origin เพื่อให้ลิงก์เปิดได้จริงจากที่ผู้ใช้เข้า */
export function appOrigin(req: { headers: { get(name: string): string | null } }, fallback = ''): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('host') || ''
  if (host) return `${proto}://${host}`
  return fallback
}
