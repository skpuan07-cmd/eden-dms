// ============================================================
// EDEN DMS — AI Registration: ลงทะเบียนด้วยเสียงภาษาไทย (Feature 2)
// Task 29: port จากแผนปรับปรุง Sahana Eden บทที่ 11
//   - PDPA consent บังคับ → 403 ถ้าไม่ยินยอม
//   - rate limit 10 ครั้ง/นาที/ผู้ใช้ (เสียงหนักกว่า — แผนบทที่ 11.3)
//   - ASR (z-ai audio.asr) → transcript → LLM แยกฟิลด์ (JSON, conservative)
//   - เสียงไม่เก็บในระบบเด็ดขาด — แปลงแล้วทิ้ง (PDPA)
//   - ผู้ใช้ตรวจ/แก้ฟิลด์ก่อนบันทึกจริง (human-in-the-loop — ADR 0004)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResponse, audit } from '@/lib/auth'
import { withZaiRetry } from '@/lib/zai'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeExtracted, findDuplicate, extractJsonFromLlm } from '@/lib/person-registration'

export const dynamic = 'force-dynamic'

const MAX_AUDIO_BYTES = 5 * 1024 * 1024 // 5MB — ตามแผนบทที่ 11.3
const RATE_LIMIT = 10
const LLM_TIMEOUT_MS = 90_000

const EXTRACT_PROMPT = (transcript: string) => `คุณเป็นผู้ช่วยลงทะเบียนสำหรับระบบจัดการภัยพิบัติ EDEN DMS
แปลงข้อความจากการบันทึกเสียง (ภาษาไทย) ต่อไปนี้เป็นข้อมูลลงทะเบียนบุคคล

ข้อความ: "${transcript}"

ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
{
  "first_name": "ชื่อจริง (ตัดคำนำหน้า เช่น นาย/นาง/นางสาว ออก)",
  "last_name": "นามสกุล",
  "national_id": "เลขบัตรประชาชน 13 หลักถ้าพูดถึง (ตัวเลขล้วน, ถ้าไม่มีให้ null)",
  "gender": "male | female | unknown",
  "birth_date": "วันเกิดถ้าพูดถึง เช่น \"15 มี.ค. 2535\" หรือ \"1992-03-15\" (พ.ศ. ได้)",
  "age": "อายุเป็นตัวเลขถ้าพูดถึง (ถ้าไม่มีให้ null)",
  "phone": "เบอร์โทรถ้าพูดถึง",
  "address": "ที่อยู่ถ้าพูดถึง"
}

กฎสำคัญ:
- ดึงเฉพาะข้อมูลที่พูดชัดเจนจริง ห้ามเดา — ฟิลด์ที่ไม่ถูกพูดถึงให้ null
- ชื่อคนไทยมักออกเสียง "สมชาย" เป็นคำเดียว อย่าแยกเป็นชื่อ+นามสกุลถ้าฟังไม่ครบ
- ตอบเป็น JSON object เดียว`

/** ปิด timeout ของ LLM (คล้ายแนวทาง search-import) */
function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ])
}

export async function POST(req: NextRequest) {
  // ---------- auth ----------
  const auth = requireUser(req)
  if (isResponse(auth)) return auth

  // ---------- body ----------
  const body = (await req.json().catch(() => null)) as {
    audioBase64?: string
    consent?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }, { status: 400 })

  // PDPA: ไม่ยินยอม = ไม่ประมวลผล
  if (!body.consent) {
    return NextResponse.json(
      { error: 'ต้องได้รับความยินยอมจากเจ้าของข้อมูล (PDPA) ก่อนบันทึกและประมวลผลเสียง' },
      { status: 403 },
    )
  }

  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : ''
  if (!audioBase64) return NextResponse.json({ error: 'ไม่พบไฟล์เสียง' }, { status: 400 })
  if (Buffer.byteLength(audioBase64, 'base64') > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'ไฟล์เสียงใหญ่เกิน 5MB — กรุณาบันทึกใหม่' }, { status: 413 })
  }

  // ---------- rate limit ----------
  const rl = rateLimit(`voice:${auth.id}`, RATE_LIMIT, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `ใช้งานเสียงถี่เกินกำหนด (สูงสุด ${RATE_LIMIT} ครั้ง/นาที) — ลองอีกใน ${rl.retryAfterSec} วินาที` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  // ---------- 1) ASR ----------
  let transcript = ''
  try {
    const asr = await withZaiRetry((z) => z.audio.asr.create({ file_base64: audioBase64 }))
    transcript = (asr?.text ?? '').trim()
  } catch (e) {
    await audit('ai_voice', 'persons', `แปลงเสียงเป็นข้อความล้มเหลว: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`, auth.name)
    return NextResponse.json(
      { error: 'ระบบฟังเสียงไม่สำเร็จ กรุณาบันทึกใหม่ในที่เงียบกว่า หรือกรอกข้อมูลด้วยมือ' },
      { status: 502 },
    )
  }
  if (!transcript) {
    return NextResponse.json(
      { error: 'ไม่ได้ยินข้อความจากเสียงที่บันทึก — ลองพูดใกล้ไมโครโฟนขึ้น' },
      { status: 422 },
    )
  }

  // ตรวจว่า ASR แปลงเสียงไทยได้จริง — บางสภาพแวดล้อมโมเดล ASR ยังไม่รองรับภาษาไทย
  // (ผลจะออกเป็นข้อความอังกฤษ/จีน ไร้ความหมาย) — แจ้งผู้ใช้ตรงไปตรงมา พร้อมทางเลือก
  const hasThai = /[\u0E00-\u0E7F]/.test(transcript)
  if (!hasThai) {
    await audit('ai_voice', 'persons', `ASR แปลงเสียงไทยไม่ได้ (ผลลัพธ์ไม่มีอักษรไทย) — แจ้งผู้ใช้ใช้ช่องทางอื่น`, auth.name)
    return NextResponse.json(
      {
        error: 'ระบบแปลงเสียงภาษาไทยยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้ — โปรดใช้ช่องทาง "บัตรประชาชน" หรือกรอกด้วยมือแทน',
        code: 'thai_unsupported',
        transcript,
      },
      { status: 422 },
    )
  }

  // ---------- 2) LLM extract ----------
  let raw = ''
  try {
    const completion = await withTimeout(
      withZaiRetry((z) =>
        z.chat.completions.create({
          messages: [
            { role: 'system', content: 'คุณเป็นผู้ช่วยแยกข้อมูลบุคคลจากภาษาไทยอย่างแม่นยำ — ตอบ JSON เท่านั้น ห้ามเดาข้อมูลที่ไม่ปรากฏ' },
            { role: 'user', content: EXTRACT_PROMPT(transcript) },
          ],
          thinking: { type: 'disabled' },
        }),
      ),
      LLM_TIMEOUT_MS,
      'ผู้ช่วย AI ใช้เวลานานเกินกำหนด — กรุณาลองอีกครั้ง',
    )
    raw = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch (e) {
    await audit('ai_voice', 'persons', `แยกข้อมูลจากเสียงล้มเหลว: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`, auth.name)
    return NextResponse.json(
      { error: e instanceof Error && e.message.includes('นานเกินกำหนด') ? e.message : 'ระบบแยกข้อมูลจากเสียงไม่สำเร็จ กรุณาลองอีกครั้ง' },
      { status: 502 },
    )
  }

  const parsed = extractJsonFromLlm(raw)
  if (!parsed) {
    console.error('[persons/voice] LLM parse failed, raw head:', raw.slice(0, 300))
    return NextResponse.json(
      { error: 'ระบบแยกข้อมูลจากเสียงไม่สำเร็จ — กรุณาพูดใหม่ช้า ๆ หรือกรอกด้วยมือ' },
      { status: 502 },
    )
  }

  // ---------- 3) normalize + duplicate ----------
  const fields = normalizeExtracted(parsed)
  const duplicate = await findDuplicate(fields)

  // ---------- audit (เก็บ transcript สั้น ๆ เท่านั้น — เสียงไม่เก็บ) ----------
  const found = [fields.firstName, fields.lastName].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'
  await audit(
    'ai_voice',
    'persons',
    `ลงทะเบียนด้วยเสียง: ${found} — ยินยอม PDPA ✓, เสียงไม่ถูกเก็บ (ข้อความ: ${transcript.slice(0, 80)})`,
    auth.name,
  )

  return NextResponse.json({
    transcript,
    fields,
    duplicate,
    engine: 'asr-llm',
    pdpa: { consentGiven: true, audioStored: false },
  })
}
