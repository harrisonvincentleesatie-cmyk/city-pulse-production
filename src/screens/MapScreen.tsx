import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Cluster, Activity, LocalUser, Venue } from '../types'
import { getActivity } from '../data/activities'
import { VENUES } from '../data/venues'
import { PULSE_DURATION_MS, PULSE_EXTEND_MS, CITY_DISPLAY_NAME, STALE_EXPIRED_MS } from '../config'
import { supabase } from '../lib/supabase'
import { useSimulator } from '../hooks/useSimulator'
import { usePulseTimer } from '../hooks/usePulseTimer'
import { useLocalStorage } from '../hooks/useLocalStorage'
import MapContainer from '../components/map/MapContainer'
import PreviewOverlay from '../components/overlays/PreviewOverlay'
import LockedClusterTeaser from '../components/overlays/LockedClusterTeaser'
import JoinAnimation from '../components/overlays/JoinAnimation'
import LeaveAnimation from '../components/overlays/LeaveAnimation'
import ExpiryAnimation from '../components/overlays/ExpiryAnimation'
import ActivitySheet from '../components/sheets/ActivitySheet'
import ClusterSheet from '../components/sheets/ClusterSheet'
import ExtendSheet from '../components/sheets/ExtendSheet'
import PulseTimer from '../components/ui/PulseTimer'
import RecentlyJoinedBar from '../components/ui/RecentlyJoinedBar'

type MapStep = 'preview' | 'join_anim' | 'picking' | 'active' | 'expiry_anim' | 'expired'

interface Props {
  localUser:   LocalUser
  onJoinPress: () => void  // tap "Join" with no user → parent handles auth
  joinToken:   number      // increments when parent wants to trigger join animation
}

// ── Geolocation helper ────────────────────────────────────────────────────────
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 5000, maximumAge: 30_000, enableHighAccuracy: false,
    })
  )
}

// ── Venue detection ───────────────────────────────────────────────────────────
// GPS pipeline step: find the nearest registered venue within the spec radius.
// Returns null if no venue is within VENUE_RADIUS_M meters (e.g. user is 2km away).
// Venue coordinates are used only for proximity matching — never shown publicly.
const VENUE_RADIUS_M = 50  // spec: 30–50m; 50m gives coverage at typical GPS accuracy

function nearestVenue(lat: number, lng: number): Venue | null {
  // Convert radius to approximate squared degree distance at HCMC latitude
  const cosLat   = Math.cos(lat * Math.PI / 180)
  const radiusDeg = VENUE_RADIUS_M / 111_319
  const radiusSq  = (radiusDeg / cosLat) * radiusDeg  // accounts for lng compression

  let best: Venue | null = null
  let bestDist = Infinity
  for (const v of VENUES) {
    const dlng = v.coords[0] - lng
    const dlat = v.coords[1] - lat
    const dist = dlng * dlng + dlat * dlat
    if (dist < bestDist) { bestDist = dist; best = v }
  }
  // Only return the venue if it's within the radius threshold
  return bestDist <= radiusSq ? best : null
}

// ── What Changed Since You Last Checked ──────────────────────────────────────
// Snapshot: minimal cluster counts saved to localStorage when the app backgrounds.
// On return, compare current state to the snapshot and surface the single most
// notable change as a brief auto-dismissing toast. Fully client-side, no backend.

const CHANGE_SNAP_KEY = 'cp_change_snap'
const MIN_AWAY_MS     = 10 * 60 * 1000  // minimum absence before showing anything

interface SnapCluster { id: string; zoneName: string; count: number }
interface ChangeSnap  { ts: number; clusters: SnapCluster[] }

function saveChangeSnapshot(clusters: Cluster[]): void {
  try {
    localStorage.setItem(CHANGE_SNAP_KEY, JSON.stringify({
      ts:       Date.now(),
      clusters: clusters.map(c => ({ id: c.id, zoneName: c.zoneName, count: c.count })),
    } satisfies ChangeSnap))
  } catch { /* localStorage unavailable */ }
}

function loadChangeSnapshot(): ChangeSnap | null {
  try {
    const raw = localStorage.getItem(CHANGE_SNAP_KEY)
    return raw ? JSON.parse(raw) as ChangeSnap : null
  } catch { return null }
}

// Returns the single most interesting change, or null if nothing notable happened.
// Priority: top-zone leadership change → big surge (≥8) → moderate gain (≥5).
function computeChangeToast(prev: SnapCluster[], current: Cluster[]): string | null {
  const prevTop = [...prev].sort((a, b) => b.count - a.count)[0]
  const currTop = [...current].sort((a, b) => b.count - a.count)[0]
  if (prevTop && currTop && prevTop.id !== currTop.id) {
    // Only meaningful if the new leader has a clear margin over #2.
    // Prevents firing when two zones are hovering at the same count.
    const currSorted = [...current].sort((a, b) => b.count - a.count)
    const currSecond = currSorted[1]
    if (currSecond && currTop.count - currSecond.count >= 4) {
      return `${currTop.zoneName} is now the most active`
    }
    // Margin too small — fall through to delta check
  }

  let bestDelta = 0
  let bestZone  = ''
  for (const curr of current) {
    const p     = prev.find(x => x.id === curr.id)
    const delta = curr.count - (p?.count ?? curr.count)
    if (delta > bestDelta) { bestDelta = delta; bestZone = curr.zoneName }
  }
  if (bestDelta >= 8) return `${bestZone} jumped +${bestDelta} since you left`
  if (bestDelta >= 5) return `${bestZone} picked up since you left`
  return null
}

// Energetic hype phrases — assigned deterministically per zone ID so each
// zone has a consistent personality across the session.
const ZONE_HYPE_PHRASES = [
  'is on fire',
  'is going crazy',
  'is blowing up',
] as const

export default function MapScreen({ localUser, onJoinPress, joinToken }: Props) {
  const { clusters, participants, recentlyJoined, addUserToVenue, removeUser, restoreParticipant, getVenueBreakdown, moveUser } =
    useSimulator()
  const timer = usePulseTimer()
  const { isExpired: pulseExpired, reset: resetTimer } = timer

  // ── Supabase presence bridge (Phase 2) ────────────────────────────────────
  // These fire-and-forget helpers mirror the user's own pulse to the DB.
  // All errors are swallowed — simulator/timer behavior continues regardless.

  const persistPresenceJoin = async (venueId: string, clusterId: string, activity: Activity) => {
    try {
      await supabase.from('presences').upsert({
        user_id:    localUser.id,
        venue_id:   venueId,
        cluster_id: clusterId,
        activity,
        expires_at: new Date(Date.now() + PULSE_DURATION_MS).toISOString(),
      }, { onConflict: 'user_id' })
    } catch (err) {
      console.error('persistPresenceJoin failed:', err)
    }
  }

  const persistPresenceLeave = async () => {
    try {
      await supabase.from('presences').delete().eq('user_id', localUser.id)
    } catch (err) {
      console.error('persistPresenceLeave failed:', err)
    }
  }

  const persistPresenceExtend = async () => {
    try {
      const base = timer.expiresAt !== null ? Math.max(timer.expiresAt, Date.now()) : Date.now()
      await supabase
        .from('presences')
        .update({ expires_at: new Date(base + PULSE_EXTEND_MS).toISOString() })
        .eq('user_id', localUser.id)
    } catch (err) {
      console.error('persistPresenceExtend failed:', err)
    }
  }

  const [step, setStep]                     = useState<MapStep>(() => {
    if (timer.isActive) return 'active'
    if (timer.isExpired) {
      // Expired long ago → fresh preview feels more appropriate than a stale notice
      const stalePast = timer.expiresAt && (Date.now() - timer.expiresAt) > STALE_EXPIRED_MS
      if (stalePast) return 'preview'
      return 'expired'
    }
    return 'preview'
  })
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [userActivity, setUserActivity]       = useLocalStorage<Activity | null>('cp_activity', null)
  const [userClusterId, setUserClusterId]     = useLocalStorage<string | null>('cp_cluster', null)
  const [userVenueId, setUserVenueId]         = useLocalStorage<string | null>('cp_venue', null)
  const [extendDismissed, setExtendDismissed] = useState(false)
  const [lockedTeaserCluster, setLockedTeaserCluster] = useState<Cluster | null>(null)
  const [placementBanner, setPlacementBanner] = useState<{ zoneName: string; emoji: string } | null>(null)
  const [showLeaveAnim, setShowLeaveAnim] = useState(false)
  const [leaveConfirm, setLeaveConfirm]   = useState(false)
  const [youArrived, setYouArrived]       = useState(false)
  const [lastZoneName, setLastZoneName]   = useState<string | null>(null)
  const [joinCount, setJoinCount]         = useState<number | null>(null)
  // Signals MapContainer to fly to this cluster (set once on join, then cleared)
  const [flyToClusterId, setFlyToClusterId] = useState<string | undefined>(undefined)
  // Map-level join ripple: increments on each new external join to trigger animation
  const [joinRipple, setJoinRipple] = useState(0)

  // What Changed: mirror clusters into a ref for stable access in event listeners
  const clustersSnapRef    = useRef(clusters)
  useEffect(() => { clustersSnapRef.current = clusters }, [clusters])
  // Prevents the mount check from firing more than once per map reveal
  const hasCheckedChangeRef = useRef(false)
  const [changeToast, setChangeToast] = useState<string | null>(null)

  // Tonight's Hottest Area (fires only when it's NOT the user's own zone)
  const [hottestToast, setHottestToast]  = useState<{ id: string; zoneName: string; phrase: string } | null>(null)
  // Tracks the zone + count at which the hype toast last fired.
  // Storing the count (not just the id) allows re-firing when the same zone
  // grows significantly — prevents the toast from going permanently silent.
  const prevHottestRef                    = useRef<{ id: string; atCount: number } | null>(null)
  const hasShownHottestRef                = useRef(false)
  // Epoch ms when the change toast will appear on screen (0 = no change toast this session)
  const changeToastShownAtRef             = useRef<number>(0)
  // Epoch ms until the top-center notification slot is occupied (shared by all notices)
  const topNoticeBusyUntilRef             = useRef<number>(0)

  // ── Threat signal — "defending #1" tension mechanic ───────────────────────
  const [threatToast, setThreatToast]     = useState<{ rivalName: string; gap: number } | null>(null)
  const lastThreatFiredAtRef              = useRef<number>(0)
  const prevThreatGapRef                  = useRef<null | 'approaching' | 'critical'>(null)
  // Tracks when mapRevealed first became true — threat effect waits 8s before first fire
  const mapRevealedAtRef                  = useRef<number>(0)

  // ── Stabilized PulseTimer rank ─────────────────────────────────────────────
  // Raw rank flickers at zone-count boundaries (a 1-person swing can repeatedly
  // cross the top-3 threshold). stableRank enters immediately on improvement but
  // debounces worsening — preventing the slot from swapping semantic meaning
  // (rank label ↔ momentum arrow) due to transient simulator noise.
  const RANK_STABLE_MS                    = 3500
  const rankDebounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStableRankRef                 = useRef<number | null>(null)
  const [stableRank, setStableRank]       = useState<number | null>(null)

  // ── Session achievement — best rank reached this pulse ─────────────────────
  // Tracks the highest rank (lowest number) achieved at any point during the
  // active session. Read by both LeaveAnimation and ExpiryAnimation to show
  // the closing achievement line. Cleared when a new session starts (picking).
  const [bestRankThisSession, setBestRankThisSession] = useState<number | null>(null)

  const isLocked = step === 'preview' || step === 'expired'

  // ── Live rank derivation — must be above any effects that reference it ─────
  // Computed here so the rank stabilization useEffect (below) can use `rank`
  // in its dependency array without hitting the temporal dead zone.
  const userClusterEarly = userClusterId ? clusters.find(c => c.id === userClusterId) : null
  const { rank, gapToFirst } = (() => {
    if (!userClusterId) return { rank: null as number | null, gapToFirst: null as number | null }
    const sorted = [...clusters].sort((a, b) => b.count - a.count)
    const idx = sorted.findIndex(c => c.id === userClusterId)
    if (idx < 0 || idx > 2) return { rank: null as number | null, gapToFirst: null as number | null }
    const r = idx + 1
    const gap = r >= 2 ? sorted[0].count - sorted[idx].count : null
    return { rank: r as number | null, gapToFirst: gap }
  })()

  // mapRevealed: true only after JoinAnimation's exit animation fully completes.
  // Gates active UI mount — nothing renders until the overlay is fully gone.
  const [mapRevealed, setMapRevealed] = useState(() => step === 'active')

  // mapVisualsPreWarmed: flips true 300ms after join_anim starts (overlay is fully
  // opaque by ~250ms). This unlocks the map's VISUAL state — filter/heatmap/markers —
  // while the overlay is still covering everything. By the time the overlay starts to
  // fade at 2000ms, the map underneath is already fully in its active visual state.
  // The overlay then fades to reveal a stable map, with nothing still changing.
  const [mapVisualsPreWarmed, setMapVisualsPreWarmed] = useState(false)

  // Visual lock: controls CSS filter, heatmap opacity, and marker style only.
  // Separated from the interaction lock so visuals can pre-warm silently under
  // the opaque overlay without unlocking gestures or camera.
  const mapVisuallyLocked  = isLocked || step === 'picking' || (step === 'join_anim' && !mapVisualsPreWarmed)
  // Interaction lock: gestures + camera authority. Stays locked through join_anim
  // and the overlay exit window (active && !mapRevealed).
  const interactionsLocked = isLocked || step === 'picking' || step === 'join_anim' || (step === 'active' && !mapRevealed)

  // Reset both flags whenever we leave active/join_anim
  useEffect(() => {
    if (step !== 'active') setMapRevealed(false)
  }, [step])

  // Track when the map was first revealed — threat signal must wait 8s before first fire
  // so it never competes with the arrival animation and placement banner.
  // Also clears threat state and re-arms refs when the session ends.
  useEffect(() => {
    if (mapRevealed) {
      if (mapRevealedAtRef.current === 0) mapRevealedAtRef.current = Date.now()
    } else {
      mapRevealedAtRef.current     = 0
      lastThreatFiredAtRef.current = 0
      prevThreatGapRef.current     = null
      setThreatToast(null)
    }
  }, [mapRevealed])

  useEffect(() => {
    if (step !== 'join_anim') { setMapVisualsPreWarmed(false); return }
    // 300ms: overlay has been fully opaque for ~50ms — safe to warm the map underneath
    const t = setTimeout(() => setMapVisualsPreWarmed(true), 300)
    return () => clearTimeout(t)
  }, [step])

  // Track which joinToken we've already acted on — prevents re-firing on re-renders
  const lastJoinToken = useRef(0)
  // Carries placement banner data across the join animation boundary
  const pendingBannerRef = useRef<{ zoneName: string; emoji: string } | null>(null)

  // ── DB presence restore helper (Phase 2.5) ───────────────────────────────
  // Queries the presences table for an active row. If found, syncs all local
  // state from the DB row so the user resumes their pulse after a reload.
  // Returns true if a valid active presence was restored, false otherwise.
  const restorePresenceFromDb = async (): Promise<boolean> => {
    if (localUser.id === 'guest') return false
    try {
      const { data: row } = await supabase
        .from('presences')
        .select('venue_id, cluster_id, activity, expires_at')
        .eq('user_id', localUser.id)
        .maybeSingle()

      if (!row) return false

      const expiryMs = new Date(row.expires_at).getTime()
      if (expiryMs <= Date.now()) return false

      setUserActivity(row.activity as Activity)
      setUserClusterId(row.cluster_id)
      setUserVenueId(row.venue_id)
      localStorage.setItem('cp_expires_at', JSON.stringify(expiryMs))
      restoreParticipant(row.cluster_id, localUser, row.activity as Activity, expiryMs, row.venue_id)
      setFlyToClusterId(row.cluster_id)
      setStep('active')
      return true
    } catch (err) {
      console.error('restorePresenceFromDb failed:', err)
      return false
    }
  }

  // ── Mount: restore participant if returning to active session ─────────────
  useEffect(() => {
    const run = async () => {
      // Stale-expired cleanup: pulse expired while app was closed and enough time
      // has passed that we already initialised step as 'preview'. Clear the leftover
      // localStorage entries (timer + user state) so nothing leaks into the next session.
      if (timer.isExpired && timer.expiresAt && (Date.now() - timer.expiresAt) > STALE_EXPIRED_MS) {
        resetTimer()
        setUserActivity(null)
        setUserClusterId(null)
        setUserVenueId(null)
        return
      }

      // Try DB first — if an active presence row exists, restore from it and stop.
      const restoredFromDb = await restorePresenceFromDb()
      if (restoredFromDb) return

      // Fallback: restore from localStorage (returning user with no DB row, or guest)
      // Migrate stale cluster reference: vincom-d1 was removed, nguyen-hue covers that area
      const resolvedClusterId = userClusterId === 'vincom-d1' ? 'nguyen-hue' : userClusterId
      if (userClusterId === 'vincom-d1') setUserClusterId('nguyen-hue')

      if (step === 'active' && userActivity && resolvedClusterId && timer.expiresAt) {
        // Pass venueId so the simulator can track the user at the correct venue level.
        // Falls back to the first venue in the area if venueId is missing (old sessions).
        restoreParticipant(resolvedClusterId, localUser, userActivity, timer.expiresAt, userVenueId ?? undefined)
        setFlyToClusterId(resolvedClusterId)
      } else if (step === 'active' && !userActivity) {
        setStep('picking')
      }
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── React to parent's joinToken (fires after auth/setup completes) ────────
  useEffect(() => {
    if (joinToken > 0 && joinToken !== lastJoinToken.current) {
      lastJoinToken.current = joinToken
      setStep('picking')
    }
  }, [joinToken])

  // ── Pulse expiry watch ────────────────────────────────────────────────────
  // Triggers expiry ceremony instead of hard-cutting to expired state.
  // State cleanup (timer reset, user state clear) happens in handleExpiryAnimComplete
  // so it runs after the ceremony has finished.
  useEffect(() => {
    if (step === 'active' && pulseExpired) {
      removeUser(localUser.id)
      setStep('expiry_anim')
    }
  }, [step, pulseExpired, localUser.id, removeUser])

  // ── Periodic location update while pulse is active ───────────────────────
  // Spec: "location can update periodically (every 10–20 seconds)."
  // If the user moves to a different venue, moveUser updates the counts silently.
  const userVenueIdRef = useRef(userVenueId)
  useEffect(() => { userVenueIdRef.current = userVenueId }, [userVenueId])

  useEffect(() => {
    if (step !== 'active') return
    const interval = setInterval(async () => {
      try {
        const pos   = await getCurrentPosition()
        const venue = nearestVenue(pos.coords.latitude, pos.coords.longitude)
        if (venue && venue.id !== userVenueIdRef.current) {
          moveUser(localUser.id, venue.id)
          setUserVenueId(venue.id)
          setUserClusterId(venue.areaId)
          userVenueIdRef.current = venue.id
        }
      } catch { /* GPS unavailable — keep current placement */ }
    }, 15_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, localUser.id])

  // ── External join ripple: trigger map-level pulse on new joins ────────────
  const prevJoinIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (step !== 'active') return
    const latest = recentlyJoined[0]
    if (latest && !latest.isYou && latest.id !== prevJoinIdRef.current) {
      prevJoinIdRef.current = latest.id
      setJoinRipple(n => n + 1)
    }
  }, [recentlyJoined, step])

  // ── What Changed: check snapshot once the map is fully revealed ──────────
  // Fires when mapRevealed becomes true — map is visible and stable, safe to
  // show a toast. 800ms delay lets the arrival animation settle first.
  // hasCheckedChangeRef prevents re-firing if mapRevealed toggles again.
  useEffect(() => {
    if (!mapRevealed) return
    if (hasCheckedChangeRef.current) return
    hasCheckedChangeRef.current = true

    const snap = loadChangeSnapshot()
    if (!snap || Date.now() - snap.ts < MIN_AWAY_MS) {
      saveChangeSnapshot(clustersSnapRef.current)
      return
    }
    const msg = computeChangeToast(snap.clusters, clustersSnapRef.current)
    saveChangeSnapshot(clustersSnapRef.current)
    if (!msg) return
    // Record when the toast will be visible so the hottest-area effect can sequence after it.
    // Also mark the top slot busy for the full duration so surge notice queues behind it.
    const showsAt = Date.now() + 800
    changeToastShownAtRef.current = showsAt
    topNoticeBusyUntilRef.current = showsAt + 4500 + 280
    const t = setTimeout(() => {
      setChangeToast(msg)
      setTimeout(() => setChangeToast(null), 4500)
    }, 800)
    return () => clearTimeout(t)
  }, [mapRevealed])

  // ── What Changed: save on background, compare on foreground ──────────────
  // Handles the PWA case: user switches apps and returns without a page reload.
  // Uses refs so this effect never needs to re-register.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveChangeSnapshot(clustersSnapRef.current)
        return
      }
      if (stepRef.current !== 'active') return
      const snap = loadChangeSnapshot()
      if (!snap || Date.now() - snap.ts < MIN_AWAY_MS) return
      const msg = computeChangeToast(snap.clusters, clustersSnapRef.current)
      saveChangeSnapshot(clustersSnapRef.current)
      if (!msg) return
      // Record when the toast appears so the hottest-area effect can sequence after it.
      // Also mark the top slot busy so surge notice queues behind it.
      const now = Date.now()
      changeToastShownAtRef.current = now
      topNoticeBusyUntilRef.current = now + 4500 + 280
      setChangeToast(msg)
      setTimeout(() => setChangeToast(null), 4500)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // ── City hype moment — fires for genuinely dominant zones ────────────────
  // High thresholds so this only surfaces for real peaks, not background noise.
  // Re-fires if the same zone keeps growing — prevents permanent silence when
  // one zone dominates the session (the old single-fire-per-id bug).
  // Skips the user's own zone — personal rank label handles that.
  useEffect(() => {
    if (step !== 'active' || !mapRevealed) return
    const sorted = [...clusters].sort((a, b) => b.count - a.count)
    const leader = sorted[0]
    const second = sorted[1]
    if (!leader || !second)                       return
    if (leader.count < 5)                         return  // minimum meaningful crowd
    if (leader.count < second.count * 1.4)        return  // needs 40% lead (works at any scale)
    if (leader.id === userClusterId)              return  // rank label handles this

    const prev = prevHottestRef.current
    // Allow re-fire for the same zone only after it has grown 35% since last shown —
    // proportional threshold works at both quiet-hour and peak-hour scales.
    if (prev && prev.id === leader.id && leader.count < prev.atCount * 1.35) return

    prevHottestRef.current = { id: leader.id, atCount: leader.count }

    // Sequence after any pending change toast
    let delay: number
    if (hasShownHottestRef.current) {
      delay = 0
    } else if (changeToastShownAtRef.current > 0) {
      const changeToastClearsAt = changeToastShownAtRef.current + 4500 + 280
      delay = Math.max(0, changeToastClearsAt + 600 - Date.now())
    } else {
      delay = 800
    }
    hasShownHottestRef.current = true

    const phrase = ZONE_HYPE_PHRASES[
      Math.abs(leader.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0))
      % ZONE_HYPE_PHRASES.length
    ]

    const t = setTimeout(() => {
      topNoticeBusyUntilRef.current = Date.now() + 5500 + 280
      setHottestToast({ id: leader.id, zoneName: leader.zoneName, phrase })
      setTimeout(() => setHottestToast(null), 5500)
    }, delay)
    return () => clearTimeout(t)
  }, [clusters, mapRevealed, step, userClusterId])

  // ── Stabilize rank for PulseTimer ─────────────────────────────────────────
  // rank is live and can flip on every 8-second simulator tick.
  // Improvement (entering top-3 or moving up) applies immediately.
  // Worsening (dropping a rank or leaving top-3) is debounced so a brief
  // 1-tick dip does not flip the pill label or swap it for a momentum arrow.
  useEffect(() => {
    if (rankDebounceRef.current !== null) {
      clearTimeout(rankDebounceRef.current)
      rankDebounceRef.current = null
    }
    const prev = prevStableRankRef.current
    const improving = rank !== null && (prev === null || rank < prev)
    if (improving || rank === prev) {
      prevStableRankRef.current = rank
      setStableRank(rank)
    } else {
      rankDebounceRef.current = setTimeout(() => {
        prevStableRankRef.current = rank
        rankDebounceRef.current = null
        setStableRank(rank)
      }, RANK_STABLE_MS)
    }
    return () => {
      if (rankDebounceRef.current !== null) clearTimeout(rankDebounceRef.current)
    }
  }, [rank])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session achievement tracking ──────────────────────────────────────────
  // Records the best rank reached during the active session. Only improves —
  // never downgrades — so it reflects the highest point of the night.
  // Uses stableRank (not raw rank) so transient 1-tick fluctuations don't count.
  useEffect(() => {
    if (step !== 'active' || stableRank === null) return
    setBestRankThisSession(prev => (prev === null || stableRank < prev) ? stableRank : prev)
  }, [stableRank, step])

  // Clear when a new session starts so each pulse gets a fresh achievement slate.
  useEffect(() => {
    if (step === 'picking') setBestRankThisSession(null)
  }, [step])

  // ── Threat signal — fires when user's #1 zone is being closed on ─────────
  // Tier-based re-arm: each threat episode fires at most twice — once when the
  // rival enters threat range (gap ≤ 5), once when it goes critical (gap ≤ 2).
  // After two fires the toast goes silent until the rival clears back above 6,
  // at which point a fresh challenge can trigger the cycle again. This guarantees
  // "right behind you" stays rare and earned, not a repeated drumbeat.
  // prevThreatGapRef tracks tier: null = no active threat, 'approaching' = first
  // fire at gap ≤ 5 has happened, 'critical' = both fires done, silent until reset.
  useEffect(() => {
    if (step !== 'active' || !mapRevealed) return
    if (rank !== 1)                        return
    if (Date.now() - mapRevealedAtRef.current < 8_000) return  // grace period on arrival

    const userZone = clusters.find(c => c.id === userClusterId)
    if (!userZone || userZone.count < 7)   return  // minimum for #1 to be meaningful

    // Closest rival is always the #2 zone by count
    const rival = clusters
      .filter(c => c.id !== userClusterId)
      .sort((a, b) => b.count - a.count)[0]
    if (!rival || rival.count < 5)         return  // rival must have real presence

    const gap = userZone.count - rival.count

    // Reset tier when threat has cleared — rival fell back beyond 6
    if (gap > 6) {
      prevThreatGapRef.current = null
      return
    }

    if (gap < 0) return  // user is no longer #1 — rank check above should catch this
    if (rival.momentum !== 'rising' && rival.momentum !== 'surging') return  // must be advancing

    const tier = prevThreatGapRef.current as null | 'approaching' | 'critical'

    // Determine whether this state warrants a new fire
    const shouldFire =
      (tier === null && gap <= 5)            ||  // first fire: rival enters threat range
      (tier === 'approaching' && gap <= 2)       // second fire: rival goes critical

    if (!shouldFire) return

    const now = Date.now()
    if (now - lastThreatFiredAtRef.current < 150_000) return  // 150s safety net between tiers

    // Advance tier
    prevThreatGapRef.current     = gap <= 2 ? 'critical' : 'approaching'
    lastThreatFiredAtRef.current = now

    // Queue behind any in-progress notice (change toast or hottest toast)
    const waitMs = Math.max(0, topNoticeBusyUntilRef.current - now)
    const delay  = waitMs > 0 ? waitMs + 300 : 0

    const t = setTimeout(() => {
      topNoticeBusyUntilRef.current = Date.now() + 5000 + 280
      setThreatToast({ rivalName: rival.zoneName, gap })
      setTimeout(() => setThreatToast(null), 5000)
    }, delay)
    return () => clearTimeout(t)
  }, [clusters, step, mapRevealed, userClusterId, rank])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleJoinPress = () => {
    if (localUser.displayName) {
      setStep('picking')
    } else {
      onJoinPress()
    }
  }

  // Stable reference — prevents JoinAnimation's useEffect from re-running.
  // Only advances the step; map reveal and active UI mount are deferred until
  // the overlay's exit animation fully completes (via onExitComplete below).
  const handleAnimComplete = useCallback(() => {
    setStep('active')
  }, [])

  // Fires once the JoinAnimation exit animation is done (onExitComplete).
  // At this point the overlay is fully gone — safe to unlock the map and
  // mount active UI without competing animations.
  // stepRef lets us read the current step inside the callback without
  // making it a dependency (which would recreate the ref and break the guard).
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step }, [step])

  const handleMapRevealed = useCallback(() => {
    if (stepRef.current !== 'active') return
    setMapRevealed(true)
    setYouArrived(true)
    if (pendingBannerRef.current) {
      setPlacementBanner(pendingBannerRef.current)
      pendingBannerRef.current = null
      setTimeout(() => setPlacementBanner(null), 2800)
    }
  }, [])

  // Reset the burst flag after it fires — it only needs to be true for one frame cycle
  useEffect(() => {
    if (!youArrived) return
    const t = setTimeout(() => setYouArrived(false), 1200)
    return () => clearTimeout(t)
  }, [youArrived])

  // Stable reference — prevents ActivitySheet re-renders from causing side effects
  const handleActivityPick = useCallback(async (activity: Activity) => {
    // ── User join pipeline (matches MVP spec exactly) ──────────────────────
    // 1. Browser GPS location detected
    // 2. System identifies nearest registered venue (from VENUES list)
    // 3. Venue mapped to its nightlife area (venue.areaId)
    // 4. Area activity count updated via venue-level aggregation
    // 5. Cluster recalculated, heatmap + markers updated, momentum evaluated
    // Privacy: only the area (zoneName) is shown — venue identity stays internal.

    let venueId:   string
    let clusterId: string
    let zoneName:  string

    try {
      const pos   = await getCurrentPosition()
      const venue = nearestVenue(pos.coords.latitude, pos.coords.longitude)
      if (venue) {
        // Within 50m of a registered venue — assign precisely
        venueId   = venue.id
        clusterId = venue.areaId
        zoneName  = clusters.find(c => c.id === clusterId)?.zoneName ?? venue.areaId
      } else {
        // GPS obtained but no venue within 50m — place in busiest nearby area
        const hotCluster = [...clusters].sort((a, b) => b.count - a.count)[0]
        clusterId = hotCluster.id
        zoneName  = hotCluster.zoneName
        venueId   = VENUES.find(v => v.areaId === clusterId)?.id ?? VENUES[0].id
      }
    } catch {
      // Geolocation denied or timed out — fall back to the busiest area
      const hotCluster = [...clusters].sort((a, b) => b.count - a.count)[0]
      clusterId = hotCluster.id
      zoneName  = hotCluster.zoneName
      venueId   = VENUES.find(v => v.areaId === clusterId)?.id ?? VENUES[0].id
    }

    setUserActivity(activity)
    setUserClusterId(clusterId)
    setUserVenueId(venueId)
    setLastZoneName(zoneName)
    setJoinCount(clusters.find(c => c.id === clusterId)?.count ?? null)
    addUserToVenue(venueId, localUser, activity)
    timer.start()
    setExtendDismissed(false)
    // Fly happens during the animation — map is already in position when anim completes
    setFlyToClusterId(clusterId)
    // Stash banner data; handleAnimComplete fires it when the animation lands
    const actMeta = getActivity(activity)
    pendingBannerRef.current = { zoneName, emoji: actMeta.emoji }
    await persistPresenceJoin(venueId, clusterId, activity)
    setStep('join_anim')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, localUser, addUserToVenue, timer.start, setUserActivity, setUserClusterId, setUserVenueId])

  const handleClusterClick = (cluster: Cluster) => {
    if (isLocked) {
      setLockedTeaserCluster(cluster)
      return
    }
    setSelectedClusterId(cluster.id)
  }

  // Open the user's own cluster sheet when tapping the PulseTimer pill
  const handleTimerClick = () => {
    if (!userClusterId) return
    setSelectedClusterId(userClusterId)
  }

  // Expiry: all state cleanup deferred until after the ceremony completes.
  const handleExpiryAnimComplete = useCallback(() => {
    resetTimer()
    setUserActivity(null)
    setUserClusterId(null)
    setUserVenueId(null)
    setJoinCount(null)
    setStep('expired')
  }, [resetTimer, setUserActivity, setUserClusterId, setUserVenueId])

  // Leave — show confirmation first; actual animation only fires on confirm.
  const handleEndPulse = useCallback(() => {
    setLeaveConfirm(true)
  }, [])

  // Called when user confirms leave in the confirmation card.
  const handleConfirmedLeave = useCallback(() => {
    setLeaveConfirm(false)
    setSelectedClusterId(null)
    setShowLeaveAnim(true)
  }, [])

  const handleLeaveAnimComplete = useCallback(async () => {
    await persistPresenceLeave()
    removeUser(localUser.id)
    resetTimer()
    setStep('preview')
    setUserActivity(null)
    setUserClusterId(null)
    setUserVenueId(null)
    setJoinCount(null)
    setShowLeaveAnim(false)
  }, [removeUser, localUser.id, resetTimer, setUserActivity, setUserClusterId, setUserVenueId])

  const activityMeta    = userActivity ? getActivity(userActivity) : null
  const userCluster     = userClusterEarly   // already computed above effects
  // Always derived from live clusters — never a stale snapshot. Guarantees the
  // cluster sheet always shows the same count as the map bubble that was tapped.
  const selectedCluster = selectedClusterId ? (clusters.find(c => c.id === selectedClusterId) ?? null) : null

  // Rival data for ClusterSheet — only when user views their own #1 zone and a threat exists.
  // Gives the in-sheet view the same context as the threat toast, without duplicating the effect.
  const threatRivalForSheet = (() => {
    if (!selectedCluster || selectedCluster.id !== userClusterId || rank !== 1) return undefined
    const rival = clusters.filter(c => c.id !== userClusterId).sort((a, b) => b.count - a.count)[0]
    if (!rival || rival.count < 5) return undefined
    const g = selectedCluster.count - rival.count
    if (g < 0 || g > 5) return undefined
    if (rival.momentum !== 'rising' && rival.momentum !== 'surging') return undefined
    return { name: rival.zoneName, gap: g }
  })()

  return (
    <div className="map-screen">

      {/* ── Full-viewport map ───────────────────────────────── */}
      <MapContainer
        clusters={clusters}
        isLocked={mapVisuallyLocked}
        interactionsLocked={interactionsLocked}
        userClusterId={userClusterId ?? undefined}
        flyToClusterId={flyToClusterId}
        expiresAt={timer.expiresAt ?? undefined}
        youArrived={youArrived}
        onClusterClick={handleClusterClick}
      />

      {/* ── City identity badge ─────────────────────────────── */}
      <div className="city-badge" aria-hidden="true">
        <span className="city-badge-dot" />
        {CITY_DISPLAY_NAME}
      </div>

      {/* ── Preview / expired overlay ───────────────────────── */}
      <AnimatePresence>
        {isLocked && (
          <PreviewOverlay
            onJoin={handleJoinPress}
            totalActive={clusters.reduce((s, c) => s + c.count, 0)}
            isExpired={step === 'expired'}
            lastZoneName={lastZoneName}
          />
        )}
      </AnimatePresence>

      {/* ── Locked cluster teaser ───────────────────────────── */}
      <AnimatePresence>
        {isLocked && lockedTeaserCluster && (
          <LockedClusterTeaser
            cluster={lockedTeaserCluster}
            onJoin={() => { setLockedTeaserCluster(null); handleJoinPress() }}
            onClose={() => setLockedTeaserCluster(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Activation animation ────────────────────────────── */}
      <AnimatePresence onExitComplete={handleMapRevealed}>
        {step === 'join_anim' && (
          <JoinAnimation onComplete={handleAnimComplete} />
        )}
      </AnimatePresence>

      {/* ── Activity selection (bottom sheet) ───────────────── */}
      <AnimatePresence>
        {step === 'picking' && (
          <ActivitySheet
            onSelect={handleActivityPick}
            onDismiss={() => setStep('preview')}
            defaultActivity={userActivity ?? undefined}
          />
        )}
      </AnimatePresence>

      {/* ── Active state UI — only after JoinAnimation exit completes ── */}
      <AnimatePresence>
        {step === 'active' && mapRevealed && activityMeta && (
          <PulseTimer
            formatted={timer.formatted}
            emoji={activityMeta.emoji}
            count={userCluster?.count}
            flag={localUser.flag}
            momentum={userCluster?.momentum}
            rank={stableRank}
            onClick={handleTimerClick}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {step === 'active' && mapRevealed && <RecentlyJoinedBar items={recentlyJoined} />}
      </AnimatePresence>

      {/* ── Cluster detail sheet (tap a cluster or PulseTimer) ── */}
      <AnimatePresence>
        {selectedCluster && step === 'active' && mapRevealed && (
          <ClusterSheet
            cluster={selectedCluster}
            participants={participants}
            venueBreakdown={getVenueBreakdown(selectedCluster.id)}
            isOwnCluster={selectedCluster.id === userClusterId}
            joinCount={selectedCluster.id === userClusterId ? (joinCount ?? undefined) : undefined}
            gapToFirst={selectedCluster.id === userClusterId ? (gapToFirst ?? undefined) : undefined}
            threatRival={threatRivalForSheet}
            onEndPulse={handleEndPulse}
            onClose={() => setSelectedClusterId(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Leave Pulse — always visible in active state ────── */}
      <AnimatePresence>
        {step === 'active' && mapRevealed && !selectedCluster && (
          <motion.button
            className="leave-pulse-fab"
            onClick={handleEndPulse}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280, delay: 0.5 }}
          >
            Leave Pulse
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Extend nudge ────────────────────────────────────── */}
      <AnimatePresence>
        {step === 'active' && mapRevealed && timer.showExtendNudge && !extendDismissed && (
          <ExtendSheet
            formatted={timer.formatted}
            timeRemaining={timer.timeRemaining}
            onExtend={async () => { await persistPresenceExtend(); timer.extend(); setExtendDismissed(false) }}
            onDismiss={() => setExtendDismissed(true)}
          />
        )}
      </AnimatePresence>

      {/* ── Expiry ceremony — fires when timer runs out, before expired state ── */}
      <AnimatePresence>
        {step === 'expiry_anim' && (
          <ExpiryAnimation onComplete={handleExpiryAnimComplete} bestRank={bestRankThisSession} />
        )}
      </AnimatePresence>

      {/* ── Leave animation ─────────────────────────────────── */}
      <AnimatePresence>
        {showLeaveAnim && (
          <LeaveAnimation onComplete={handleLeaveAnimComplete} bestRank={bestRankThisSession} />
        )}
      </AnimatePresence>

      {/* ── Leave confirmation card ──────────────────────────── */}
      <AnimatePresence>
        {leaveConfirm && step === 'active' && mapRevealed && (
          <motion.div
            className="leave-confirm-sheet"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.9 }}
          >
            <div className="sheet-handle" />
            {/* Fading pulse ring — visual anchor; references the metaphor about to be lost */}
            <div className="leave-confirm-pulse" aria-hidden="true" />
            <p className="leave-confirm-title">Leave the pulse?</p>
            <p className="leave-confirm-sub">Your pulse fades from the city. You'll lose access to where people are now.</p>
            <div className="leave-confirm-actions">
              <button className="leave-confirm-stay" onClick={() => setLeaveConfirm(false)}>Stay in</button>
              <button className="leave-confirm-leave" onClick={handleConfirmedLeave}>Leave</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Placement confirmation ───────────────────────────── */}
      <AnimatePresence>
        {placementBanner && (
          <motion.div
            className="placement-banner"
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          >
            <span className="placement-icon">
              <svg className="placement-check-svg" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polyline className="placement-check-mark" points="4,10 8.5,15 16,6" />
              </svg>
            </span>
            <div className="placement-text">
              <span className="placement-zone">{placementBanner.zoneName}</span>
              <span className="placement-sub">{placementBanner.emoji} You boosted the pulse here</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── What Changed toast — single-line reopen reward, auto-dismisses ── */}
      <AnimatePresence>
        {changeToast && mapRevealed && (
          <motion.div
            className="change-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {changeToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tonight's Hottest Area chip — tappable, opens cluster sheet ─── */}
      <AnimatePresence>
        {hottestToast && mapRevealed && (
          <motion.div
            className="change-toast hottest-toast"
            role="button"
            tabIndex={0}
            onClick={() => {
              const c = clusters.find(cl => cl.id === hottestToast.id)
              if (c) setSelectedClusterId(c.id)
              setHottestToast(null)
            }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <span className="hottest-dot" aria-hidden="true" />
            {hottestToast.zoneName} {hottestToast.phrase}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Threat notice — rival zone closing in on #1 ────────────────── */}
      <AnimatePresence>
        {threatToast && mapRevealed && (
          <motion.div
            className="change-toast threat-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <span className="threat-dot" aria-hidden="true" />
            {threatToast.gap <= 2
              ? `${threatToast.rivalName} is right behind you`
              : `${threatToast.rivalName} is ${threatToast.gap} behind`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Join ripple — brief map-level ring when an external user joins ── */}
      {joinRipple > 0 && mapRevealed && (
        <div key={joinRipple} className="join-map-ripple" aria-hidden="true" />
      )}
    </div>
  )
}
