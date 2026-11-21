// ============================================================
// EDEN DMS — ประมวลผลข้อมูลลงทะเบียนที่ AI ดึงมา (OCR/Voice)
// Task 29: จากเอกสาร Strategic Improvement Plan บทที่ 10-11
//   - normalize ฟิลด์ → โครงสร้าง Person ของเรา (human-in-the-loop:
//     AI pre-fill เท่านั้น ผู้ใช้ตรวจแก้ก่อนบันทึกจริง — ADR 0004)
//   - duplicate detection: เลขบัตร หรือ ชื่อ+นามสกุล(+วันเกิด) → warn
// ============================================================
import { db } from '@/lib/db'
import {
  digitsOnly, validateThaiId, parseThaiDate, normalizeThaiName,
  normalizeGender, normalizePhone, ageFromDob,
} from '@/lib/thai'

export interface ExtractedFields {
  firstName: string
  lastName: string
  nationalId: string
  nationalIdValid: boolean | null // null = ไม่ได้ใส่บัตร / true|false = checksum
  gender: 'male' | 'female' | 'other' | 'unknown'
  dateOfBirth: string // yyyy-mm-dd หรือ ''
  age: number | null
  phone: string
  address: string
}

export interface DuplicateInfo {
  type: 'national_id' | 'name_dob' | 'name'
  existingId: string
  name: string
  status?: string
}

/** JSON ดิบจาก LLM — รับได้ทั้ง key แบบ thai และ eng ที่โมเดลอาจใช้ */
type RawExtracted = Record<string, unknown>

function pick(raw: RawExtracted, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') return v.trim()
  }
  return ''
}

/**
 * แปลง JSON จาก AI → ExtractedFields ที่ตรวจแล้ว
 * ไม่ throw — ฟิลด์ใดไม่ชัดเจนจะเป็นค่าว่าง (AI เดาไม่ได้ = ให้ผู้ใช้กรอกเอง)
 */
export function normalizeExtracted(raw: RawExtracted | null | undefined): ExtractedFields {
  const r: RawExtracted = raw && typeof raw === 'object' ? raw : {}

  const firstName = normalizeThaiName(pick(r, ['first_name', 'firstName', 'ชื่อ', 'ชื่อจริง', 'first_name_th']))
  const lastName = normalizeThaiName(pick(r, ['last_name', 'lastName', 'นามสกุล', 'last_name_th']))

  const nid = digitsOnly(pick(r, ['national_id', 'nationalId', 'id_card_number', 'เลขบัตร', 'เลขประจำตัวประชาชน']))
  const nationalIdValid = nid
    ? nid.length === 13 && validateThaiId(nid)
    : null

  const dobIso = parseThaiDate(pick(r, ['birth_date', 'date_of_birth', 'dateOfBirth', 'วันเกิด', 'วันเดือนปีเกิด']))
  const rawAge = pick(r, ['age', 'อายุ'])
  const ageNum = Number(rawAge)

  return {
    firstName,
    lastName,
    nationalId: nid,
    nationalIdValid,
    gender: normalizeGender(pick(r, ['gender', 'เพศ'])),
    dateOfBirth: dobIso ?? '',
    age: dobIso ? ageFromDob(dobIso) : (rawAge && Number.isFinite(ageNum) && ageNum > 0 && ageNum < 150 ? Math.round(ageNum) : null),
    phone: normalizePhone(pick(r, ['phone', 'phone_number', 'telephone', 'เบอร์โทร', 'โทรศัพท์'])) ?? '',
    address: pick(r, ['address', 'ที่อยู่']).replace(/\s+/g, ' '),
  }
}

/**
 * ตรวจข้อมูลซ้ำกับทะเบียนบุคคลที่มีอยู่ (ไม่รวมรายการที่ถูกลบ)
 * ลำดับความแม่น: เลขบัตร (exact) > ชื่อ+นามสกุล+วันเกิด > ชื่อ+นามสกุล
 * (SQLite ไม่รองรับ mode:'insensitive' — เทียบตรงเป็นหลัก)
 */
export async function findDuplicate(f: ExtractedFields): Promise<DuplicateInfo | null> {
  if (f.nationalId) {
    const p = await db.person.findFirst({
      where: { deleted: false, nationalId: f.nationalId },
      orderBy: { createdAt: 'desc' },
    })
    if (p) return { type: 'national_id', existingId: p.id, name: `${p.firstName} ${p.lastName}`, status: p.status }
  }
  if (f.firstName && f.lastName) {
    if (f.dateOfBirth) {
      const p = await db.person.findFirst({
        where: {
          deleted: false, firstName: f.firstName, lastName: f.lastName,
          dateOfBirth: new Date(`${f.dateOfBirth}T00:00:00+07:00`),
        },
        orderBy: { createdAt: 'desc' },
      })
      if (p) return { type: 'name_dob', existingId: p.id, name: `${p.firstName} ${p.lastName}`, status: p.status }
    }
    const p = await db.person.findFirst({
      where: { deleted: false, firstName: f.firstName, lastName: f.lastName },
      orderBy: { createdAt: 'desc' },
    })
    if (p) return { type: 'name', existingId: p.id, name: `${p.firstName} ${p.lastName}`, status: p.status }
  }
  return null
}

/** ดึง JSON จากคำตอบโมเดลที่อาจมี markdown fence หรือข้อความแทรก */
export function extractJsonFromLlm(text: string): RawExtracted | null {
  const t = (text ?? '').trim()
  if (!t) return null
  // ลอง parse ตรง ๆ ก่อน
  try {
    return JSON.parse(t) as RawExtracted
  } catch { /* ต่อด้านล่าง */ }
  // ตัด markdown fence ```json ... ```
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as RawExtracted
    } catch { /* ต่อ */ }
  }
  // จับ object แรกที่อยู่ในข้อความ
  const obj = t.match(/\{[\s\S]*\}/)
  if (obj) {
    try {
      return JSON.parse(obj[0]) as RawExtracted
    } catch { /* ล้มเหลวทั้งหมด */ }
  }
  return null
}
