// ============================================================
// EDEN DMS — Rate Limiter แบบ in-memory sliding window
// Task 29: จากเอกสาร Modernization (บทที่ 9 Security) — จำกัดการใช้งาน AI
//   60/min chatbot · 30/min OCR · 10/min voice (ที่นี่ตั้งต่อ caller)
// ใช้ Map ใน process เดียว — เพียงพอสำหรับ single-instance Next.js + SQLite
// ============================================================

interface Bucket {
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()

// จำกัดขนาด cache กัน memory leak — ล้าง key ที่ไม่ใช้นานกว่า 1 ชม.
const MAX_BUCKETS = 5000
const BUCKET_TTL_MS = 60 * 60 * 1000

export interface RateLimitResult {
  ok: boolean
  /** จำนวนครั้งที่เหลือในหน้าต่างปัจจุบัน (ถ้า ok) */
  remaining: number
  /** วินาทีที่ต้องรอก่อนลองใหม่ (ถ้าไม่ ok) */
  retryAfterSec: number
}

/**
 * ตรวจและนับการเรียก — เรียกก่อนประมวลผลงานหนักเสมอ
 * เมื่อเกิน limit จะ "ไม่นับ" การเรียกที่ถูกปฏิเสธ (ไม่ลงโทษเพิ่ม)
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()

  // housekeeping เป็นระยะ — ล้าง bucket ที่ข้อมูลเก่าหมดแล้ว
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (!b.timestamps.length || now - b.timestamps[b.timestamps.length - 1] > BUCKET_TTL_MS) {
        buckets.delete(k)
      }
    }
  }

  const bucket = buckets.get(key) ?? { timestamps: [] }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs)

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0]
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000))
    buckets.set(key, bucket)
    return { ok: false, remaining: 0, retryAfterSec }
  }

  bucket.timestamps.push(now)
  buckets.set(key, bucket)
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfterSec: 0 }
}
