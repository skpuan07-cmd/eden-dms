// ============================================================
// z-ai SDK client กลาง — ใช้ร่วมกันทุก route ฝั่ง backend เท่านั้น
// (z-ai-web-dev-sdk ห้าม import ฝั่ง client)
// ============================================================
import ZAI from 'z-ai-web-dev-sdk'

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>

// ใช้ instance เดียวซ้ำทั้งโปรเซส (แนวปฏิบัติจาก skill: reuse SDK instance)
let zaiInstance: ZaiClient | null = null

export async function getZAI(): Promise<ZaiClient> {
  if (!zaiInstance) zaiInstance = await ZAI.create()
  return zaiInstance
}

// ล้าง instance ค้างไว้ — ครั้งถัดไป getZAI จะอ่าน config ใหม่จากไฟล์
// (ใช้เมื่อ token/config ใน .z-ai-config ถูกจัดใหม่ เช่น หลัง sandbox เริ่มระบบ)
export function resetZAI() {
  zaiInstance = null
}

// error จาก SDK ที่เกี่ยวกับ auth/config — แก้ได้ด้วยการอ่าน config ใหม่
function isAuthConfigError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /status 401|missing X-Token|Configuration file not found/i.test(msg)
}

/**
 * ครอบการเรียก SDK ทุกครั้ง:
 * ถ้าโดน auth/config error (เช่น 401 missing X-Token เพราะ server เริ่มก่อน
 * ไฟล์ /etc/.z-ai-config พร้อม หรือ token ถูก refresh) → โหลด config ใหม่
 * แล้วลองเรียกอีกครั้งเดียว — ไม่ต้อง restart ทั้ง server
 * (401 = request ไม่ถูกรันฝั่งปลายทาง จึง retry ได้ปลอดภัยไม่ซ้ำงาน)
 */
export async function withZaiRetry<T>(fn: (zai: ZaiClient) => Promise<T>): Promise<T> {
  const zai = await getZAI()
  try {
    return await fn(zai)
  } catch (e) {
    if (!isAuthConfigError(e)) throw e
    console.warn('[zai] auth/config error — reload config and retry once:', e instanceof Error ? e.message : e)
    resetZAI()
    const fresh = await getZAI()
    return await fn(fresh)
  }
}
