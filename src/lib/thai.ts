// ============================================================
// EDEN DMS — ยูทิลิตี้ภาษาไทย (port จากแผนปรับปรุง Sahana Eden)
// Task 29: วิเคราะห์จากเอกสาร Sahana_Eden_Strategic_Improvement_Plan
//   - ThaiNameParser.normalize  → normalizeThaiName
//   - DateParser.parse_thai_date → parseThaiDate (พ.ศ. → ค.ศ.)
//   - _validate_thai_id         → validateThaiId (checksum 13 หลัก)
// ใช้ร่วมกับ AI Registration (OCR บัตรประชาชน / Voice ลงทะเบียน)
// ============================================================

// ---------- เลขบัตรประชาชน 13 หลัก ----------

/** ตัดตัวอักษรที่ไม่ใช่ตัวเลขออก — รับทั้ง "1-2345-..." และช่องว่าง */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * ตรวจ checksum เลขบัตรประชาชนไทย 13 หลัก
 * อัลกอริทึมตามแผน (บทที่ 10.3): sum(d[i] * (13-i)) i=0..11, check = (11 - sum%11) % 10
 */
export function validateThaiId(id: string): boolean {
  const d = digitsOnly(id)
  if (d.length !== 13 || !/^\d+$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i)
  const check = (11 - (sum % 11)) % 10
  return check === Number(d[12])
}

/** จัดรูปแบบแสดงผล 1-2345-67890-12-3 (ถ้าไม่ครบ 13 หลักคืนค่าเดิม) */
export function formatThaiId(id: string): string {
  const d = digitsOnly(id)
  if (d.length !== 13) return id
  return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12, 13)}`
}

// ---------- วันที่ภาษาไทย (พ.ศ. → ค.ศ.) ----------

const THAI_MONTHS: Record<string, number> = {
  // ชื่อเต็ม
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
  // ตัวย่อ (มี/ไม่มีจุด)
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}

/**
 * แปลงข้อความวันที่ภาษาไทย → ISO "YYYY-MM-DD" (ค.ศ.)
 * รองรับ: "15 มี.ค. 2535" · "15 มีนาคม 2535" · "15/3/2535" · "15-03-2535" · "1992-03-15"
 * ปี >= 2400 ถือเป็นพุทธศักราช (ลบ 543) — ตามแผนบทที่ 11.3
 * คืน null ถ้าแปลงไม่ได้
 */
export function parseThaiDate(input: string | null | undefined): string | null {
  const s = (input ?? '').trim()
  if (!s) return null

  // ISO อยู่แล้ว
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [_, y, m, d] = iso
    if (validYmd(Number(y), Number(m), Number(d))) return `${y}-${m}-${d}`
    return null
  }

  // แบบไทย: วัน ชื่อเดือน ปี
  const th = s.match(/^(\d{1,2})\s+([\u0E00-\u0E7F.]+)\s+(\d{4})$/)
  if (th) {
    const day = Number(th[1])
    const month = THAI_MONTHS[normalizeMonthKey(th[2])]
    const year = buddhistToGregorianYear(Number(th[3]))
    if (month && year && validYmd(year, month, day)) {
      return `${year}-${pad(month)}-${pad(day)}`
    }
    return null
  }

  // ตัวเลขคั่น: 15/3/2535 · 15-3-2535 · 15.3.2535 (วัน/เดือน/ปี)
  const num = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (num) {
    const day = Number(num[1])
    const month = Number(num[2])
    const year = buddhistToGregorianYear(Number(num[3]))
    if (year && validYmd(year, month, day)) {
      return `${year}-${pad(month)}-${pad(day)}`
    }
    return null
  }

  return null
}

/** เลขปี >= 2400 ถือว่าเป็นพ.ศ. → แปลงเป็นค.ศ. (ลบ 543) */
function buddhistToGregorianYear(year: number): number {
  return year >= 2400 ? year - 543 : year
}

function normalizeMonthKey(m: string): string {
  const t = m.trim()
  // ตรงกันเป๊ะ → ใช้เลย | ลองต่อท้ายด้วยจุด (ตัวย่อ "ม.ค") | ตัดจุดท้าย (ตัวย่อ "ม.ค.")
  if (t in THAI_MONTHS) return t
  if (`${t}.` in THAI_MONTHS) return `${t}.`
  const noDot = t.replace(/\.$/, '')
  if (noDot in THAI_MONTHS) return noDot
  return t
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  return true
}

/** คำนวณอายุจากวันเกิด (ISO yyyy-mm-dd หรือ Date) — คืน null ถ้าไม่ถูกต้อง */
export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null
  const d = dob instanceof Date ? dob : new Date(`${dob}T00:00:00+07:00`)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
  if (beforeBirthday) age--
  return age >= 0 && age < 150 ? age : null
}

// ---------- ชื่อ ----------

/** รายการคำนำหน้า — เรียงยาว→สั้น เพื่อให้ "นางสาว" ตรงก่อน "นาง" */
const NAME_TITLES = [
  'นางสาว', 'เด็กชาย', 'เด็กหญิง',
  'นาย', 'นาง',
  'จ.ส.อ.ท.', 'ว่าที่ ร.ต.', 'จ.ส.อ.', 'จ.ส.ท.',
  'ด.ต.', 'ส.อ.', 'พล.ต.ต.', 'พ.ต.ท.',
  'ร.ต.', 'ร.ท.', 'พ.อ.', 'พ.ท.', 'พ.ต.', 'น.อ.', 'น.ท.',
]

/** ตัดคำนำหน้าชื่อออก (นาย/นาง/นางสาว/ยศ ฯลฯ) และตัดช่องว่างซ้ำ
 * รับทั้งแบบมีช่องว่าง ("นาย สมชาย") และไม่มี ("นายสมชาย" — พบบ่อยจาก OCR) */
export function normalizeThaiName(name: string | null | undefined): string {
  let s = (name ?? '').trim().replace(/\s+/g, ' ')
  for (const title of NAME_TITLES) {
    if (!s.startsWith(title)) continue
    const rest = s.slice(title.length)
    const hasSpace = rest.startsWith(' ')
    const enoughRemainder = rest.replace(/^\s+/, '').length >= 2 // กันคำทั่วไป เช่น "นายก"
    if (hasSpace || enoughRemainder) {
      s = rest.trim()
      break
    }
  }
  return s
}

/** แยกชื่อ-นามสกุลจากข้อความเดียว "สมชาย ใจดี" → [first, last] */
export function splitFullName(full: string | null | undefined): { firstName: string; lastName: string } {
  const s = normalizeThaiName(full)
  const parts = s.split(' ').filter(Boolean)
  if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
  return { firstName: parts[0] ?? '', lastName: '' }
}

// ---------- เพศ ----------

/** รับทั้ง "ชาย"/"ช"/"male"/"M" → male · "หญิง"/"ญ"/"female"/"F" → female · อื่น ๆ → unknown */
export function normalizeGender(g: string | null | undefined): 'male' | 'female' | 'unknown' {
  const s = (g ?? '').trim().toLowerCase()
  if (['male', 'm', 'ชาย', 'ช', 'ชช'].includes(s)) return 'male'
  if (['female', 'f', 'หญิง', 'ญ', 'ญญ'].includes(s)) return 'female'
  return 'unknown'
}

// ---------- เบอร์โทร ----------

/** เก็บเฉพาะตัวเลข + เครื่องหมาย + ตัดช่องว่าง — คืน null ถ้าว่าง */
export function normalizePhone(p: string | null | undefined): string | null {
  const s = (p ?? '').replace(/[^\d+\-\s]/g, '').trim()
  return s || null
}
