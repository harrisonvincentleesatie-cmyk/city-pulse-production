import { useState, useEffect, useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { PULSE_DURATION_MS, PULSE_EXTEND_MS, EXTEND_NUDGE_MS, CRITICAL_NUDGE_MS } from '../config'

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function usePulseTimer() {
  const [expiresAt, setExpiresAt] = useLocalStorage<number | null>('cp_expires_at', null)

  // Initialize timeRemaining synchronously from localStorage so the first render
  // doesn't flash "0:00" for a returning user mid-session.
  const [timeRemaining, setTimeRemaining] = useState<number>(() => {
    try {
      const item = localStorage.getItem('cp_expires_at')
      const stored = item ? (JSON.parse(item) as number | null) : null
      return stored ? Math.max(0, stored - Date.now()) : 0
    } catch { return 0 }
  })

  useEffect(() => {
    if (!expiresAt) {
      setTimeRemaining(0)
      return
    }

    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now())
      setTimeRemaining(remaining)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const start = useCallback(() => {
    setExpiresAt(Date.now() + PULSE_DURATION_MS)
  }, [setExpiresAt])

  const extend = useCallback(() => {
    setExpiresAt(prev =>
      prev !== null
        ? Math.max(prev, Date.now()) + PULSE_EXTEND_MS
        : Date.now() + PULSE_EXTEND_MS
    )
  }, [setExpiresAt])

  const reset = useCallback(() => {
    setExpiresAt(null)
    setTimeRemaining(0)
  }, [setExpiresAt])

  // ── Derive active/expired from wall clock, not from timeRemaining ─────────
  //
  // BUG (previous): isActive/isExpired were derived from `timeRemaining`, which
  // starts at 0 from useState. After timer.start() sets a future expiresAt, the
  // 1-second interval hadn't fired yet — so timeRemaining was still 0 and
  // isExpired was momentarily true, immediately triggering the expiry watch in
  // MapScreen and transitioning to 'expired' right after 'active' was set.
  //
  // FIX: compare expiresAt directly against Date.now(). A freshly-set future
  // expiresAt always yields isExpired=false and isActive=true on the same render.
  const now = Date.now()
  const isActive  = expiresAt !== null && now < expiresAt
  const isExpired = expiresAt !== null && now >= expiresAt

  return {
    expiresAt,
    timeRemaining,
    formatted:       formatTime(timeRemaining),
    isActive,
    isExpired,
    showExtendNudge: isActive && timeRemaining > 0 && timeRemaining < EXTEND_NUDGE_MS,
    isCritical:      isActive && timeRemaining > 0 && timeRemaining < CRITICAL_NUDGE_MS,
    start,
    extend,
    reset,
  }
}
