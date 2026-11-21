'use client'
// ============================================================
// EDEN DMS — AI Registration Dialog (ลงทะเบียนด้วย AI)
// Task 29: port จากเอกสาร Sahana_Eden_Strategic_Improvement_Plan
//   บทที่ 10 (Feature 1: OCR บัตรประชาชน) + บทที่ 11 (Feature 2: Voice ไทย)
//
// หลักการ (ตามแผน ADR 0004 — human-in-the-loop):
//   1. AI pre-fill เท่านั้น — ผู้ใช้ตรวจ/แก้ทุกฟิลด์ก่อนบันทึกจริง
//   2. PDPA consent บังคับทั้ง 2 ช่องทาง ก่อนประมวลผลใด ๆ
//   3. รูป/เสียงไม่ถูกเก็บในระบบ — ประมวลผลแล้วทิ้ง
//   4. Duplicate detection — เตือนถ้าพบบุคคลเดียวกันในทะเบียนแล้ว
// ============================================================
import * as React from 'react'
import { Sparkles, Mic, Square, Camera, Upload, Loader2, AlertTriangle, RotateCcw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { GENDERS, PERSON_STATUS } from '@/lib/constants'
import { apiSend, Field } from './shared'

// ===== Types (ตรงกับ response ของ API) =====
interface ExtractedFields {
  firstName: string
  lastName: string
  nationalId: string
  nationalIdValid: boolean | null
  gender: string
  dateOfBirth: string
  age: number | null
  phone: string
  address: string
}

interface DuplicateInfo {
  type: string
  existingId: string
  name: string
  status?: string
}

interface LiteRef { id: string; label: string }

const NONE = 'none'
const MAX_BYTES = 5 * 1024 * 1024

function bytesOfDataUrl(dataUrl: string): number {
  const b64 = dataUrl.split(',')[1] ?? ''
  return Math.round((b64.length * 3) / 4)
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const b64 = result.includes(',') ? result.split(',')[1] : result
      resolve(b64)
    }
    reader.onerror = () => reject(new Error('อ่านไฟล์เสียงไม่สำเร็จ'))
    reader.readAsDataURL(blob)
  })
}

export function AiRegisterDialog({
  incidents,
  shelters,
  onCreated,
}: {
  /** เหตุการณ์สำหรับผูกบริบท (ผู้ประสบภัยเกิดจากเหตุการณ์ใด) */
  incidents: { id: string; code: string; title: string }[]
  /** ศูนย์พักพิง (ถ้าลงทะเบียนที่ศูนย์) */
  shelters: { id: string; name: string }[]
  /** เรียกเมื่อบันทึกสำเร็จ — ให้โมดูลรีเฟรชรายการ */
  onCreated: () => void
}) {
  const { toast } = useToast()

  // dialog + mode
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'card' | 'voice'>('card')

  // PDPA consent — ต้องยินยอมก่อนประมวลผลทั้งสองช่องทาง
  const [consent, setConsent] = React.useState(false)

  // ช่องทางบัตร
  const [imageDataUrl, setImageDataUrl] = React.useState('')
  const [ocrBusy, setOcrBusy] = React.useState(false)

  // ช่องทางเสียง
  const [recording, setRecording] = React.useState(false)
  const [recSeconds, setRecSeconds] = React.useState(0)
  const [voiceBusy, setVoiceBusy] = React.useState(false)
  const [transcript, setTranscript] = React.useState('')
  const [voiceNotice, setVoiceNotice] = React.useState('')
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // ผลลัพธ์ที่ดึงได้ (pre-fill ให้แก้ไขได้)
  const [fields, setFields] = React.useState<ExtractedFields | null>(null)
  const [duplicate, setDuplicate] = React.useState<DuplicateInfo | null>(null)

  // บริบทเพิ่มเติมตอนบันทึก
  const [status, setStatus] = React.useState('safe')
  const [lastSeenLocation, setLastSeenLocation] = React.useState('')
  const [incidentId, setIncidentId] = React.useState(NONE)
  const [shelterId, setShelterId] = React.useState(NONE)
  const [saving, setSaving] = React.useState(false)

  const setF = (patch: Partial<ExtractedFields>) =>
    setFields((f) => (f ? { ...f, ...patch } : f))

  function resetAll() {
    setConsent(false)
    setImageDataUrl('')
    setOcrBusy(false)
    setRecording(false)
    setRecSeconds(0)
    setVoiceBusy(false)
    setTranscript('')
    setVoiceNotice('')
    setFields(null)
    setDuplicate(null)
    setStatus('safe')
    setLastSeenLocation('')
    setIncidentId(NONE)
    setShelterId(NONE)
    setSaving(false)
    stopTimer()
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    recorderRef.current = null
  }

  function openDialog() {
    resetAll()
    setOpen(true)
  }

  function closeDialog(nextOpen: boolean) {
    if (!nextOpen) resetAll()
    setOpen(nextOpen)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // ---------- ช่องทางบัตร ----------
  function onPickImage(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = '' // เลือกซ้ำได้แม้เป็นไฟล์เดิม
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'ไฟล์ไม่ถูกต้อง', description: 'กรุณาเลือกรูปภาพ (jpg/png/webp)', variant: 'destructive' })
      return
    }
    if (file.size > MAX_BYTES) {
      toast({ title: 'รูปใหญ่เกิน 5MB', description: 'กรุณาถ่ายใหม่หรือย่อรูปก่อนอัปโหลด', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(String(reader.result ?? ''))
    reader.onerror = () => toast({ title: 'อ่านรูปไม่สำเร็จ', variant: 'destructive' })
    reader.readAsDataURL(file)
  }

  async function runOcr() {
    if (!consent || !imageDataUrl) return
    setOcrBusy(true)
    setDuplicate(null)
    try {
      const res = (await apiSend('/api/persons/ocr', 'POST', {
        imageDataUrl,
        consent: true,
      })) as { fields: ExtractedFields; duplicate: DuplicateInfo | null }
      setFields(res.fields)
      setDuplicate(res.duplicate)
      toast({
        title: 'ดึงข้อมูลจากบัตรสำเร็จ',
        description: 'โปรดตรวจสอบข้อมูลด้านล่างและแก้ไขก่อนบันทึก (รูปของท่านไม่ถูกเก็บในระบบ)',
      })
    } catch (e) {
      toast({
        title: 'ประมวลผล OCR ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'กรุณาลองใหม่',
        variant: 'destructive',
      })
    } finally {
      setOcrBusy(false)
    }
  }

  // ---------- ช่องทางเสียง ----------
  async function startRecording() {
    if (!consent) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data)
      }
      recorder.onstop = async () => {
        stopTimer()
        stream.getTracks().forEach((t) => t.stop())
        recorderRef.current = null
        setRecording(false)
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 2000) {
          toast({ title: 'เสียงสั้นเกินไป', description: 'กรุณาพูดนานขึ้น (แนะนำ 5-30 วินาที)', variant: 'destructive' })
          return
        }
        await runVoice(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setRecSeconds(0)
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    } catch {
      toast({
        title: 'เปิดไมโครโฟนไม่ได้',
        description: 'โปรดอนุญาตการใช้ไมโครโฟนในเบราว์เซอร์ หรืออัปโหลดไฟล์เสียงแทน',
        variant: 'destructive',
      })
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  function onPickAudio(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    if (!file.type.startsWith('audio/')) {
      toast({ title: 'ไฟล์ไม่ถูกต้อง', description: 'กรุณาเลือกไฟล์เสียง (wav/mp3/m4a)', variant: 'destructive' })
      return
    }
    if (file.size > MAX_BYTES) {
      toast({ title: 'ไฟล์เสียงใหญ่เกิน 5MB', variant: 'destructive' })
      return
    }
    void runVoice(file)
  }

  async function runVoice(blob: Blob) {
    if (!consent) return
    setVoiceBusy(true)
    setDuplicate(null)
    setVoiceNotice('')
    try {
      const audioBase64 = await base64FromBlob(blob)
      const res = (await apiSend('/api/persons/voice', 'POST', {
        audioBase64,
        consent: true,
      })) as { transcript: string; fields: ExtractedFields; duplicate: DuplicateInfo | null }
      setTranscript(res.transcript)
      setFields(res.fields)
      setDuplicate(res.duplicate)
      toast({
        title: 'แปลงเสียงเป็นข้อมูลสำเร็จ',
        description: 'โปรดตรวจสอบข้อมูลด้านล่างและแก้ไขก่อนบันทึก (เสียงของท่านไม่ถูกเก็บในระบบ)',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'กรุณาลองใหม่'
      if (msg.includes('ยังไม่พร้อมใช้งาน')) {
        // ASR ยังไม่รองรับไทยในสภาพแวดล้อมนี้ — แสดง notice inline (ไม่ใช่แค่ toast)
        setVoiceNotice(msg)
      } else {
        toast({ title: 'ประมวลผลเสียงไม่สำเร็จ', description: msg, variant: 'destructive' })
      }
    } finally {
      setVoiceBusy(false)
    }
  }

  // ---------- บันทึกจริง (ผ่าน CRUD ปกติ + audit) ----------
  async function submit() {
    const f = fields
    if (!f || !f.firstName.trim() || !f.lastName.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        gender: f.gender || 'unknown',
        status,
        notes: `ลงทะเบียนผ่าน AI (${mode === 'card' ? 'OCR บัตรประชาชน' : 'บันทึกเสียง'}) — ตรวจสอบโดยเจ้าหน้าที่`,
      }
      if (f.nationalId) payload.nationalId = f.nationalId
      if (f.dateOfBirth) payload.dateOfBirth = new Date(`${f.dateOfBirth}T00:00:00+07:00`).toISOString()
      if (f.age != null) payload.age = f.age
      if (f.phone.trim()) payload.phone = f.phone.trim()
      if (f.address.trim()) payload.address = f.address.trim()
      if (lastSeenLocation.trim()) payload.lastSeenLocation = lastSeenLocation.trim()
      if (incidentId !== NONE) payload.incidentId = incidentId
      if (shelterId !== NONE) payload.shelterId = shelterId

      await apiSend('/api/persons', 'POST', payload)
      toast({
        title: 'ลงทะเบียนบุคคลสำเร็จ',
        description: `${f.firstName} ${f.lastName} (บันทึกโดยตรวจสอบจาก AI pre-fill)`,
      })
      closeDialog(false)
      onCreated()
    } catch (e) {
      toast({
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'กรุณาลองใหม่',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const hasResult = fields !== null
  const canSubmit = hasResult && !!fields?.firstName.trim() && !!fields?.lastName.trim() && !saving

  return (
    <>
      <Button onClick={openDialog} variant="outline" className="border-teal-600 text-teal-700 hover:bg-teal-50 hover:text-teal-800">
        <Sparkles className="h-4 w-4" /> ลงทะเบียนด้วย AI
      </Button>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-teal-600" /> ลงทะเบียนด้วย AI
            </DialogTitle>
            <DialogDescription>
              เลือกช่องทางนำเข้า — ถ่ายรูปบัตรประชาชน หรือบันทึกเสียง แล้วระบบจะดึงข้อมูลมา pre-fill ให้ตรวจและแก้ไขก่อนบันทึกจริง
            </DialogDescription>
          </DialogHeader>

          {/* PDPA consent */}
          <Card className={consent ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/50'}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">ความยินยอมตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)</Label>
                  <p className="text-xs leading-relaxed text-slate-600">
                    ยินยอมให้ระบบประมวลผล{mode === 'card' ? 'รูปบัตรประชาชน' : 'ข้อมูลเสียง'}ของบุคคลนี้เพื่อดึงข้อมูลลงทะเบียนโดยอัตโนมัติ —
                    ไฟล์ต้นฉบับจะถูกลบทันทีหลังประมวลผล ไม่ถูกเก็บในระบบ และการประมวลผลมีบันทึกตรวจสอบ
                  </p>
                </div>
                <Switch checked={consent} onCheckedChange={setConsent} aria-label="ยินยอม PDPA" />
              </div>
            </CardContent>
          </Card>

          {/* ช่องทางนำเข้า */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'card' | 'voice')}>
            <TabsList className="w-full">
              <TabsTrigger value="card" className="flex-1 gap-1.5">
                <Camera className="h-4 w-4" /> บัตรประชาชน
              </TabsTrigger>
              <TabsTrigger value="voice" className="flex-1 gap-1.5">
                <Mic className="h-4 w-4" /> บันทึกเสียง
              </TabsTrigger>
            </TabsList>

            {/* บัตร */}
            <TabsContent value="card" className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickImage} aria-label="ถ่ายหรือเลือกรูปบัตรประชาชน" />
                  <span
                    className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                    role="button"
                    aria-disabled={!consent}
                    onClick={(e) => {
                      if (!consent) {
                        e.preventDefault()
                        toast({ title: 'โปรดยินยอม PDPA ก่อน', description: 'เปิดสวิตช์ความยินยอมด้านบนก่อนใช้งาน', variant: 'destructive' })
                      }
                    }}
                  >
                    <Camera className="h-4 w-4" /> ถ่าย/เลือกรูปบัตร
                  </span>
                </label>
                {imageDataUrl && (
                  <Button variant="ghost" size="sm" onClick={() => { setImageDataUrl(''); setFields(null); setDuplicate(null) }}>
                    <RotateCcw className="h-4 w-4" /> เริ่มใหม่
                  </Button>
                )}
                {imageDataUrl && (
                  <Button onClick={runOcr} disabled={!consent || ocrBusy} className="bg-teal-600 hover:bg-teal-700">
                    {ocrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {ocrBusy ? 'กำลังอ่านบัตร...' : 'ดึงข้อมูลจากบัตร'}
                  </Button>
                )}
              </div>
              {imageDataUrl && (
                <div className="flex justify-center rounded-lg border bg-slate-50 p-2">
                  <img src={imageDataUrl} alt="ตัวอย่างรูปบัตรประชาชนที่เลือกไว้" className="max-h-56 rounded-md object-contain" />
                </div>
              )}
              {ocrBusy && (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังประมวลผลด้วย AI (ประมาณ 10-30 วินาที) — รูปจะถูกลบหลังเสร็จ
                </p>
              )}
            </TabsContent>

            {/* เสียง */}
            <TabsContent value="voice" className="space-y-3 pt-2">
              <p className="text-sm text-slate-600">
                พูดเป็นประโยค เช่น: <span className="italic">ฉันชื่อสมชาย ใจดี เกิด 15 มีนาคม 2535 ที่อยู่บ้านเลขที่ 12 ตำบลหนองบัว จังหวัดลพบุรี เบอร์ 0812345678</span>
              </p>
              {voiceNotice && (
                <Card className="border-amber-300 bg-amber-50">
                  <CardContent className="flex items-start gap-2 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">ข้อจำกัดของช่องทางเสียง</p>
                      <p>{voiceNotice}</p>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {recording ? (
                  <Button onClick={stopRecording} variant="destructive" className="gap-2">
                    <Square className="h-4 w-4" /> หยุดบันทึก ({recSeconds} วินาที)
                  </Button>
                ) : (
                  <Button onClick={startRecording} disabled={!consent || voiceBusy} variant="destructive" className="gap-2">
                    <Mic className="h-4 w-4" /> เริ่มบันทึกเสียง
                  </Button>
                )}
                <label>
                  <input type="file" accept="audio/*" className="hidden" onChange={onPickAudio} aria-label="เลือกไฟล์เสียง" />
                  <span
                    className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                    role="button"
                    onClick={(e) => {
                      if (!consent) {
                        e.preventDefault()
                        toast({ title: 'โปรดยินยอม PDPA ก่อน', description: 'เปิดสวิตช์ความยินยอมด้านบนก่อนใช้งาน', variant: 'destructive' })
                      }
                    }}
                  >
                    <Upload className="h-4 w-4" /> อัปโหลดไฟล์เสียง
                  </span>
                </label>
                {voiceBusy && (
                  <span className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> กำลังฟังเสียงและแยกข้อมูล... (10-40 วินาที)
                  </span>
                )}
              </div>
              {transcript && (
                <Card>
                  <CardContent className="p-3">
                    <p className="mb-1 text-xs font-medium text-slate-500">ข้อความที่ได้จากเสียง</p>
                    <p className="text-sm">{transcript}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* เตือนข้อมูลซ้ำ */}
          {duplicate && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="flex items-start gap-2 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800">
                    พบข้อมูลที่น่าจะซ้ำกัน
                    {duplicate.type === 'national_id' && ' (เลขบัตรประชาชนตรงกัน)'}
                    {duplicate.type === 'name_dob' && ' (ชื่อ + วันเกิดตรงกัน)'}
                    {duplicate.type === 'name' && ' (ชื่อ-นามสกุลตรงกัน)'}
                  </p>
                  <p className="text-amber-700">
                    {duplicate.name}
                    {duplicate.status ? ` — สถานะในทะเบียน: ${duplicate.status}` : ''} ·
                    หากเป็นคนเดียวกัน โปรดแก้ไขข้อมูลเดิมแทนการเพิ่มซ้ำ (กดยกเลิกแล้วค้นหาในตาราง)
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ฟิลด์ pre-fill (แก้ไขได้) */}
          {hasResult && fields && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Info className="h-4 w-4 text-slate-400" /> ข้อมูลที่ดึงได้ — โปรดตรวจสอบและแก้ไขก่อนบันทึก
                </p>
                <Badge variant="outline" className="text-xs">AI pre-fill</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="ชื่อ" required>
                  <Input value={fields.firstName} onChange={(e) => setF({ firstName: e.target.value })} placeholder="ชื่อจริง" />
                </Field>
                <Field label="นามสกุล" required>
                  <Input value={fields.lastName} onChange={(e) => setF({ lastName: e.target.value })} placeholder="นามสกุล" />
                </Field>
                <Field label="เลขบัตรประชาชน">
                  <div className="space-y-1">
                    <Input
                      value={fields.nationalId}
                      onChange={(e) => setF({ nationalId: e.target.value.replace(/\D/g, '').slice(0, 13), nationalIdValid: null })}
                      placeholder="13 หลัก"
                      inputMode="numeric"
                    />
                    {fields.nationalIdValid === false && (
                      <p className="text-xs text-amber-600">เลขบัตรนี้ไม่ผ่านการตรวจ checksum — โปรดตรวจสอบอีกครั้งก่อนบันทึก</p>
                    )}
                    {fields.nationalIdValid === true && (
                      <p className="text-xs text-emerald-600">เลขบัตรผ่านการตรวจ checksum ถูกต้อง</p>
                    )}
                  </div>
                </Field>
                <Field label="เพศ">
                  <Select value={fields.gender || 'unknown'} onValueChange={(v) => setF({ gender: v })}>
                    <SelectTrigger><SelectValue placeholder="เลือกเพศ" /></SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="วันเกิด">
                  <Input
                    type="date"
                    value={fields.dateOfBirth}
                    onChange={(e) => setF({ dateOfBirth: e.target.value, age: null })}
                    aria-label="วันเกิด"
                  />
                </Field>
                <Field label="อายุ (ปี)">
                  <Input
                    type="number"
                    min={0}
                    max={150}
                    value={fields.age != null ? String(fields.age) : ''}
                    onChange={(e) => setF({ age: e.target.value === '' ? null : Math.max(0, Math.min(150, Number(e.target.value))) })}
                    placeholder="คำนวณจากวันเกิดอัตโนมัติ"
                  />
                </Field>
                <Field label="โทรศัพท์">
                  <Input value={fields.phone} onChange={(e) => setF({ phone: e.target.value })} placeholder="เช่น 0812345678" />
                </Field>
                <Field label="สถานะ">
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue placeholder="เลือกสถานะ" /></SelectTrigger>
                    <SelectContent>
                      {PERSON_STATUS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="ที่อยู่">
                    <Input value={fields.address} onChange={(e) => setF({ address: e.target.value })} placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" />
                  </Field>
                </div>
                <Field label="ตำแหน่งพบล่าสุด">
                  <Input value={lastSeenLocation} onChange={(e) => setLastSeenLocation(e.target.value)} placeholder="เช่น ศูนย์พักพิงวัดหลวงพ่วง" />
                </Field>
                <Field label="เหตุการณ์ที่เกี่ยวข้อง">
                  <Select value={incidentId} onValueChange={setIncidentId}>
                    <SelectTrigger><SelectValue placeholder="ไม่ระบุ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>ไม่ระบุ</SelectItem>
                      {incidents.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.code} — {i.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="ศูนย์พักพิง">
                  <Select value={shelterId} onValueChange={setShelterId}>
                    <SelectTrigger><SelectValue placeholder="ไม่ระบุ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>ไม่ระบุ</SelectItem>
                      {shelters.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {/* ปุ่มท้าย */}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => closeDialog(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button onClick={submit} disabled={!canSubmit} className="bg-teal-600 hover:bg-teal-700">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              บันทึกการลงทะเบียน
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AiRegisterDialog
