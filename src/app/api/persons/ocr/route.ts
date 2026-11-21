// ============================================================
// EDEN DMS — AI Registration: OCR อ่านบัตรประชาชนไทย (Feature 1)
// Task 29: port จากแผนปรับปรุง Sahana Eden บทที่ 10
//   - PDPA consent บังคับก่อนประมวลผล (403 ถ้าไม่ยินยอม)
//   - rate limit 10 ครั้ง/นาที/ผู้ใช้ (แผนบทที่ 9.5: จำกัด AI endpoints)
//   - รูปไม่เก็บในระบบเด็ดขาด — ประมวลผลแล้วทิ้ง (PDPA: image deleted after extraction)
//   - VLM (vision LLM) ดึงฟิลด์ → validate + normalize → duplicate warn
//   - human-in-the-loop: คืนฟิลด์ให้ผู้ใช้ตรวจ/แก้ ก่อนบันทึกผ่าน POST /api/persons เอง
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResponse, audit } from '@/lib/auth'
import { withZaiRetry } from '@/lib/zai'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeExtracted, findDuplicate, extractJsonFromLlm } from '@/lib/person-registration'

export const dynamic = 'force-dynamic'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB — ตามแผนบทที่ 10.3
const RATE_LIMIT = 10 // uploads/นาที/ผู้ใช้

const EXTRACT_PROMPT = `คุณเป็นผู้ช่วยลงทะเบียนสำหรับระบบจัดการภัยพิบัติ EDEN DMS
อ่านรูปภาพนี้ (บัตรประจำตัวประชาชนไทย หรือเอกสารที่มีข้อมูลบุคคล) แล้วดึงข้อมูลฟิลด์ต่อไปนี้

ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
{
  "first_name": "ชื่อจริง (ไทย, ไม่ต้องมีคำนำหน้า)",
  "last_name": "นามสกุล",
  "national_id": "เลขบัตรประชาชน 13 หลัก (ตัวเลขล้วน, ถ้าไม่มีให้ null)",
  "gender": "male | female | unknown",
  "birth_date": "วันเกิด เช่น \"15 มี.ค. 2535\" หรือ \"1992-03-15\" (พ.ศ. ได้ ระบบแปลงให้)",
  "phone": "เบอร์โทรถ้ามีในเอกสาร (บัตรประชาชนปกติไม่มี ให้ null)",
  "address": "ที่อยู่เต็ม ๆ ตามที่พิมพ์ในเอกสาร"
}

กฎสำคัญ:
- อ่านเฉพาะข้อความที่เห็นจริงในภาพ ห้ามเดา — ฟิลด์ที่ไม่ชัด/ไม่มีให้คืนค่า null
- national_id ให้รวมทุกหลักติดกันโดยไม่มีขีดหรือช่องว่าง
- ตอบเป็น JSON object เดียว`

export async function POST(req: NextRequest) {
  // ---------- auth ----------
  const auth = requireUser(req)
  if (isResponse(auth)) return auth

  // ---------- body ----------
  const body = (await req.json().catch(() => null)) as {
    imageDataUrl?: string
    consent?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }, { status: 400 })

  // PDPA: ไม่ยินยอม = ไม่ประมวลผล (แผนบทที่ 10.3: consent required)
  if (!body.consent) {
    return NextResponse.json(
      { error: 'ต้องได้รับความยินยอมจากเจ้าของข้อมูล (PDPA) ก่อนประมวลผลรูปบัตรประชาชน' },
      { status: 403 },
    )
  }

  const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : ''
  if (!imageDataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'กรุณาแนบรูปภาพ (jpg/png/webp)' }, { status: 400 })
  }
  const b64 = imageDataUrl.split(',')[1] ?? ''
  if (!b64) return NextResponse.json({ error: 'รูปภาพไม่ถูกต้อง' }, { status: 400 })
  if (Buffer.byteLength(b64, 'base64') > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'รูปภาพใหญ่เกิน 5MB — กรุณาถ่ายใหม่ใกล้กว่านี้' }, { status: 413 })
  }

  // ---------- rate limit ----------
  const rl = rateLimit(`ocr:${auth.id}`, RATE_LIMIT, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `ใช้งาน OCR ถี่เกินกำหนด (สูงสุด ${RATE_LIMIT} ครั้ง/นาที) — ลองอีกใน ${rl.retryAfterSec} วินาที` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  // ---------- VLM extract ----------
  let raw = ''
  try {
    const completion = await withZaiRetry((z) =>
      z.chat.completions.createVision({
        model: 'glm-5.3-flash', // โมเดล vision ที่ใช้งานได้จริง (แผนระบุ glm-4v-plus แต่ยกระดับเป็นรุ่นปัจจุบัน)
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      }),
    )
    raw = completion.choices[0]?.message?.content ?? ''
  } catch (e) {
    // timeout / service error — รูปยังไม่ถูกเก็บไว้ที่ไหน (PDPA ok)
    await audit('ai_ocr', 'persons', `OCR บัตรประชาชนล้มเหลว: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`, auth.name)
    return NextResponse.json(
      { error: 'ระบบอ่านบัตรไม่สำเร็จ กรุณาลองอีกครั้ง หรือกรอกข้อมูลด้วยมือ' },
      { status: 502 },
    )
  }

  // ---------- normalize + duplicate ----------
  const parsed = extractJsonFromLlm(raw)
  if (!parsed) {
    console.error('[persons/ocr] VLM parse failed, raw head:', raw.slice(0, 300))
    return NextResponse.json(
      { error: 'ระบบแปลงข้อมูลจากบัตรไม่สำเร็จ กรุณาถ่ายใหม่ให้ชัด หรือกรอกด้วยมือ' },
      { status: 502 },
    )
  }
  const fields = normalizeExtracted(parsed)
  const duplicate = await findDuplicate(fields)

  // ---------- audit (ไม่เก็บรูป — เก็บเฉพาะผลสรุป) ----------
  const found = [fields.firstName, fields.lastName].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'
  await audit(
    'ai_ocr',
    'persons',
    `OCR อ่านบัตรประชาชน: ${found}${fields.nationalId ? ` (บัตร${fields.nationalIdValid ? 'ถูกต้อง' : 'checksum ไม่ผ่าน'})` : ''} — ยินยอม PDPA ✓, รูปไม่ถูกเก็บ`,
    auth.name,
  )

  return NextResponse.json({
    fields,
    duplicate,
    engine: 'vision-llm',
    pdpa: { consentGiven: true, imageStored: false },
  })
}
