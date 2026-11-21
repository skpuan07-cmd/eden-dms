'use client'

// EDEN DMS — หน้าเข้าสู่ระบบ (P1: G1 accountability)
// Task 28: port จากแพ็กเกจ sahana-eden-improved — เพิ่มโฟลว์ครบเหมือน Eden:
// Login | Register | Lost Password (+ ยืนยันอีเมลจากลิงก์ ?verify= / ตั้งรหัสใหม่จากลิงก์ ?reset=)
import * as React from 'react'
import { Radio, Mail, Lock, LogIn, AlertCircle, ShieldCheck, UserPlus, KeyRound, CheckCircle2, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

const DEMO_ACCOUNTS = [
  { email: "admin@eden.go.th", password: "Admin@2568", role: "ผู้ดูแลระบบ" },
  { email: "coordinator@eden.go.th", password: "Coord@2568", role: "ผู้ประสานงาน" },
  { email: "officer.cm@eden.go.th", password: "Officer@2568", role: "เจ้าหน้าที่ (เชียงใหม่)" },
  { email: "volunteer1@eden.go.th", password: "Vol@2568", role: "อาสาสมัคร" },
]

type View = 'login' | 'register' | 'forgot' | 'reset'

export default function LoginPage() {
  const [view, setView] = React.useState<View>('login')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [name, setName] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [resetToken, setResetToken] = React.useState('')
  const [verifyState, setVerifyState] = React.useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')

  // ---------- จัดการลิงก์จากอีเมล (?verify= / ?reset=) ----------
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('verify')
    const r = params.get('reset')
    const verified = params.get('verified')
    if (verified) setNotice('ยืนยันอีเมลสำเร็จแล้ว — กรุณาเข้าสู่ระบบ')
    if (r) {
      setResetToken(r)
      setView('reset')
      // ล้าง query ให้ URL สะอาด (กัน token ค้างใน address bar เวลา share หน้าจอ)
      window.history.replaceState(null, '', '/login')
    } else if (v) {
      setVerifyState('checking')
      window.history.replaceState(null, '', '/login')
      fetch(`/api/auth/verify?token=${encodeURIComponent(v)}`)
        .then(async (res) => {
          const data = (await res.json()) as { ok?: boolean; message?: string; error?: string }
          if (res.ok && data.ok) {
            setVerifyState('ok')
            setSuccessMsg(data.message ?? 'ยืนยันอีเมลสำเร็จ')
          } else {
            setVerifyState('fail')
            setError(data.error ?? 'ยืนยันอีเมลไม่สำเร็จ')
            setView('login')
          }
        })
        .catch(() => {
          setVerifyState('fail')
          setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
        })
    }
  }, [])

  function switchView(next: View) {
    setView(next)
    setError(null)
    setSuccessMsg(null)
    setFallbackLink(null)
    setNotice(null)
    setPassword('')
    setConfirm('')
    if (next === 'register') setName('')
  }

  // ---------- ล็อกอิน ----------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'เข้าสู่ระบบไม่สำเร็จ')
        return
      }
      window.location.href = '/'
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  // ---------- สมัครใช้งาน ----------
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, confirm }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string; fallbackLink?: string }
      if (!res.ok) {
        setError(data.error ?? 'สมัครใช้งานไม่สำเร็จ')
        return
      }
      setSuccessMsg(data.message ?? 'สมัครสำเร็จ')
      if (data.fallbackLink) setFallbackLink(data.fallbackLink)
      else setTimeout(() => switchView('login'), 2500)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  // ---------- ลืมรหัสผ่าน ----------
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)
    setFallbackLink(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string; fallbackLink?: string; fallbackNote?: string }
      if (!res.ok) {
        setError(data.error ?? 'ส่งคำขอไม่สำเร็จ')
        return
      }
      setSuccessMsg(data.message ?? 'ส่งลิงก์แล้ว')
      if (data.fallbackNote) setNotice(data.fallbackNote)
      if (data.fallbackLink) setFallbackLink(data.fallbackLink)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  // ---------- ตั้งรหัสผ่านใหม่ ----------
  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password, confirm }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'ตั้งรหัสผ่านไม่สำเร็จ')
        return
      }
      setSuccessMsg(data.message ?? 'ตั้งรหัสผ่านใหม่สำเร็จ')
      setTimeout(() => switchView('login'), 2200)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  function fillDemo(acc: (typeof DEMO_ACCOUNTS)[number]) {
    setEmail(acc.email)
    setPassword(acc.password)
    setError(null)
  }

  const titleByView: Record<View, { title: string; sub: string }> = {
    login: { title: 'เข้าสู่ระบบ', sub: 'ใช้อีเมลและรหัสผ่านของท่าน' },
    register: { title: 'สมัครใช้งาน', sub: 'สมัครบัญชีใหม่เพื่อใช้ระบบจัดการภัยพิบัติ (สิทธิ์เริ่มต้น: อาสาสมัคร)' },
    forgot: { title: 'ลืมรหัสผ่าน', sub: 'กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่' },
    reset: { title: 'ตั้งรหัสผ่านใหม่', sub: 'กรอกรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร' },
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
            <Radio className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">EDEN DMS</h1>
            <p className="text-sm text-slate-400">ระบบจัดการภัยพิบัติ · ศูนย์ปฏิบัติการภาคเหนือ</p>
          </div>
        </div>

        {/* กำลังตรวจลิงก์ยืนยัน */}
        {verifyState === 'checking' && (
          <Card className="border-slate-800 bg-slate-800/60">
            <CardContent className="flex items-center justify-center gap-3 p-8 text-slate-300">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" aria-hidden />
              กำลังตรวจสอบลิงก์ยืนยันอีเมล…
            </CardContent>
          </Card>
        )}

        {/* ยืนยันสำเร็จจากลิงก์ */}
        {verifyState === 'ok' && (
          <Card className="border-emerald-800 bg-emerald-950/40">
            <CardContent className="space-y-4 p-6 pt-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" aria-hidden />
              <p className="text-emerald-200">{successMsg}</p>
              <Button onClick={() => { setVerifyState('idle'); switchView('login') }} className="h-11 w-full bg-emerald-600 font-semibold hover:bg-emerald-500">
                <LogIn className="mr-2 h-4 w-4" />
                ไปหน้าเข้าสู่ระบบ
              </Button>
            </CardContent>
          </Card>
        )}

        {verifyState !== 'checking' && verifyState !== 'ok' && (
          <Card className="border-slate-800 bg-slate-800/60 backdrop-blur">
            <CardContent className="p-6 pt-6">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-white">{titleByView[view].title}</h2>
                <p className="text-xs text-slate-400">{titleByView[view].sub}</p>
              </div>

              {/* ---------- LOGIN ---------- */}
              {view === 'login' && (
                <form onSubmit={handleSubmit} className="space-y-4" aria-label="แบบฟอร์มเข้าสู่ระบบ">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-slate-200">อีเมล</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@eden.dms"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-slate-200">รหัสผ่าน</Label>
                      <button type="button" onClick={() => switchView('forgot')} className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
                        ลืมรหัสผ่าน?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="border-slate-700 bg-slate-900 pl-9 pr-9 text-slate-100 placeholder:text-slate-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <MsgArea error={error} notice={notice} successMsg={successMsg} fallbackLink={fallbackLink} />

                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500"
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => switchView('register')}
                    className="flex w-full items-center justify-center gap-1.5 pt-1 text-sm text-slate-400 transition-colors hover:text-emerald-300"
                  >
                    <UserPlus className="h-4 w-4" />
                    ยังไม่มีบัญชี? สมัครใช้งาน
                  </button>
                </form>
              )}

              {/* ---------- REGISTER ---------- */}
              {view === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4" aria-label="แบบฟอร์มสมัครใช้งาน">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name" className="text-slate-200">ชื่อ-นามสกุล</Label>
                    <div className="relative">
                      <UserPlus className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reg-name"
                        type="text"
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="เช่น สมชาย ใจดี"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email" className="text-slate-200">อีเมล</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password" className="text-slate-200">รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reg-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-confirm" className="text-slate-200">ยืนยันรหัสผ่าน</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reg-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="••••••••"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  <MsgArea error={error} notice={notice} successMsg={successMsg} fallbackLink={fallbackLink} />

                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500"
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    {loading ? 'กำลังสมัคร...' : 'สมัครใช้งาน'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="flex w-full items-center justify-center gap-1.5 pt-1 text-sm text-slate-400 transition-colors hover:text-emerald-300"
                  >
                    <LogIn className="h-4 w-4" />
                    มีบัญชีแล้ว? เข้าสู่ระบบ
                  </button>
                </form>
              )}

              {/* ---------- FORGOT ---------- */}
              {view === 'forgot' && (
                <form onSubmit={handleForgot} className="space-y-4" aria-label="แบบฟอร์มขอลิงก์ตั้งรหัสผ่านใหม่">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email" className="text-slate-200">อีเมลของท่าน</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  <MsgArea error={error} notice={notice} successMsg={successMsg} fallbackLink={fallbackLink} />

                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500"
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {loading ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="flex w-full items-center justify-center gap-1.5 pt-1 text-sm text-slate-400 transition-colors hover:text-emerald-300"
                  >
                    <LogIn className="h-4 w-4" />
                    กลับหน้าเข้าสู่ระบบ
                  </button>
                </form>
              )}

              {/* ---------- RESET ---------- */}
              {view === 'reset' && (
                <form onSubmit={handleReset} className="space-y-4" aria-label="แบบฟอร์มตั้งรหัสผ่านใหม่">
                  <div className="space-y-2">
                    <Label htmlFor="reset-password" className="text-slate-200">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reset-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-confirm" className="text-slate-200">ยืนยันรหัสผ่านใหม่</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reset-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="••••••••"
                        className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  <MsgArea error={error} notice={notice} successMsg={successMsg} fallbackLink={fallbackLink} />

                  <Button
                    type="submit"
                    disabled={loading || !resetToken}
                    className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500"
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {loading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="flex w-full items-center justify-center gap-1.5 pt-1 text-sm text-slate-400 transition-colors hover:text-emerald-300"
                  >
                    <LogIn className="h-4 w-4" />
                    กลับหน้าเข้าสู่ระบบ
                  </button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {/* Demo accounts (เฉพาะหน้า login) */}
        {view === 'login' && verifyState !== 'ok' && verifyState !== 'checking' && (
          <Card className="border-slate-800 bg-slate-800/40">
            <CardContent className="p-4 pt-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-300">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                บัญชีทดสอบ (คลิกเพื่อกรอกอัตโนมัติ)
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => fillDemo(acc)}
                    className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-left transition-colors hover:border-emerald-600 hover:bg-slate-900"
                  >
                    <p className="text-xs font-medium text-slate-200">{acc.role}</p>
                    <p className="text-[11px] text-slate-500">{acc.email} · {acc.password}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-[11px] leading-relaxed text-slate-600">
          ทุกการเข้าถึงและแก้ไขข้อมูลจะถูกบันทึก Audit Trail<br />
          © 2568 EDEN DMS — ดัดแปลงจากสถาปัตยกรรม Sahana Eden
        </p>
      </div>
    </div>
  )
}

/** พื้นที่ข้อความสถานะร่วม (error / notice / success / ลิงก์ fallback จาก outbox) */
function MsgArea({ error, notice, successMsg, fallbackLink }: {
  error: string | null
  notice: string | null
  successMsg: string | null
  fallbackLink: string | null
}) {
  return (
    <>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="rounded-md border border-sky-800 bg-sky-950/50 px-3 py-2 text-sm text-sky-300" role="status">
          {notice}
        </div>
      )}
      {successMsg && !error && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {fallbackLink && (
        <div className="rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200" role="status">
          <p className="mb-1 font-semibold">ลิงก์ของท่าน (โหมดทดลอง — ยังไม่ได้ตั้งค่า SMTP)</p>
          <a
            href={fallbackLink}
            className="inline-flex items-center gap-1 font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            เปิดลิงก์ยืนยัน/ตั้งรหัสผ่าน
          </a>
        </div>
      )}
    </>
  )
}
