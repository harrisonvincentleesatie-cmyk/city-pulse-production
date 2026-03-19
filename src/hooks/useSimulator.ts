import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Cluster, Participant, Activity, LocalUser, RecentJoin, Momentum, VenueBreakdown } from '../types'
import { getPulseStrength } from '../types'
import { buildSeedClusters, buildSeedParticipants, buildSeedRecentJoins } from '../data/seed'
import { ACTIVITIES } from '../data/activities'
import { VENUES, getVenuesByArea } from '../data/venues'
import { SIM_INTERVAL_MS, PULSE_DURATION_MS } from '../config'

// ── Internal venue-level state ─────────────────────────────────────────────
// Tracks participant counts per physical venue. Three things are true:
//   1. Each venue has its own fluctuating count (the atomic unit of activity).
//   2. Area cluster counts are always derived as Σ(venue.count).
//   3. Users are GPS-matched to a specific venue on join.
// Venue names + counts are surfaced in the cluster sheet (see getVenueBreakdown)
// so users can see which hotspot in an area is busiest right now.
// What stays private: which named person is at which venue. Participant lists
// are always area-level; venueId on Participant is used only for count bookkeeping.

interface SimVenueState {
  id:     string
  areaId: string
  count:  number
}

// ── Session cache ──────────────────────────────────────────────────────────

const SIM_CACHE_KEY = 'cp_sim_cache'
const CACHE_TTL_MS  = 5 * 60 * 1000

interface SimCache {
  ts:          number
  clusters:    Cluster[]
  participants: Participant[]
  venueStates: SimVenueState[]
}

function loadSimCache(): SimCache | null {
  try {
    const raw = sessionStorage.getItem(SIM_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as SimCache
    if (Date.now() - cache.ts > CACHE_TTL_MS) return null
    // Require venueStates — older cache format without it is discarded
    if (!cache.venueStates?.length) return null
    return cache
  } catch {
    return null
  }
}

function saveSimCache(
  clusters:    Cluster[],
  participants: Participant[],
  venueStates: SimVenueState[],
): void {
  try {
    const cache: SimCache = { ts: Date.now(), clusters, participants, venueStates }
    sessionStorage.setItem(SIM_CACHE_KEY, JSON.stringify(cache))
  } catch { /* sessionStorage unavailable — silent fail */ }
}

// ── Venue state initialisation ─────────────────────────────────────────────
// Distribute each area's seed cluster count across its registered venues.
// The distribution is intentionally uneven (Pareto-ish) so some venues read
// as busier than others — more realistic than equal shares.
// The area cluster count displayed to users always equals Σ(venue.count).

function initVenueStates(clusters: Cluster[]): SimVenueState[] {
  const states: SimVenueState[] = []

  clusters.forEach(cluster => {
    const venues = getVenuesByArea(cluster.id)
    if (venues.length === 0) return

    let remaining = cluster.count
    venues.forEach((venue, i) => {
      if (i === venues.length - 1) {
        // Last venue absorbs the remainder so totals always match exactly
        states.push({ id: venue.id, areaId: venue.areaId, count: Math.max(0, remaining) })
      } else {
        // Random share: 15–55% of what's left — creates organic venue variation
        const share = Math.max(0, Math.round(remaining * (0.15 + Math.random() * 0.40)))
        states.push({ id: venue.id, areaId: venue.areaId, count: share })
        remaining = Math.max(0, remaining - share)
      }
    })
  })

  // Safety: ensure every venue has a state entry even if its area has no cluster
  VENUES.forEach(venue => {
    if (!states.find(s => s.id === venue.id)) {
      states.push({ id: venue.id, areaId: venue.areaId, count: 0 })
    }
  })

  return states
}

// ── Area aggregation ───────────────────────────────────────────────────────
// Compute area headcounts as the sum of all venue counts in each area.
// This is the only number ever shown on the map.

function aggregateAreaCounts(venueStates: SimVenueState[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const v of venueStates) {
    map.set(v.areaId, (map.get(v.areaId) ?? 0) + v.count)
  }
  return map
}

// ── Misc helpers ───────────────────────────────────────────────────────────

const SIM_NAMES = ['Alex','Sam','Linh','Minh','Thu','Hoa','Jade','Leo','Mia','Yuki','Sofia','Omar','Nina','Luca','Kai','Raya','Tom','Maya','Jin','River']
const SIM_FLAGS = ['🇻🇳','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇦🇺','🇨🇦','🇯🇵','🇸🇬','🇮🇩','🇹🇭','🇮🇹','🇰🇷','🇳🇱']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Local user tracking ────────────────────────────────────────────────────
// Tracks userId, which area cluster they joined, AND which venue they are in.
// venueId is used to correctly decrement the venue count on removeUser.

interface LocalUserInfo {
  userId:    string
  clusterId: string
  venueId:   string
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useSimulator() {
  // Prefer sessionStorage cache → fresh seed on first load
  const { initialClusters, initialVenueStates } = useMemo(() => {
    const cache = loadSimCache()
    if (cache) {
      return { initialClusters: cache.clusters, initialVenueStates: cache.venueStates }
    }
    const clusters = buildSeedClusters()
    return { initialClusters: clusters, initialVenueStates: initVenueStates(clusters) }
  }, [])

  const [clusters, setClusters] = useState<Cluster[]>(initialClusters)

  const [participants, setParticipants] = useState<Participant[]>(() => {
    const cache = loadSimCache()
    return cache ? cache.participants : buildSeedParticipants(initialClusters)
  })

  const [recentlyJoined, setRecentlyJoined] = useState<RecentJoin[]>(() =>
    buildSeedRecentJoins(initialClusters)
  )

  // ── Refs ────────────────────────────────────────────────────────────────

  // Internal venue states — source of truth for all participant counts.
  // These are NEVER returned to callers; callers only see aggregated clusters.
  const venueStatesRef = useRef<SimVenueState[]>(initialVenueStates)

  // Latest clusters for use inside stable callbacks
  const clustersRef = useRef<Cluster[]>(initialClusters)
  useEffect(() => { clustersRef.current = clusters }, [clusters])

  // Current local user (needed to decrement the right venue on remove)
  const localUserRef = useRef<LocalUserInfo | null>(null)

  // Momentum snapshot — updated every 8 ticks (~64 s).
  // Comparing current area count to this baseline gives a ~60 s observation
  // window: stable enough to filter single-join noise, responsive enough to
  // show genuine zone shifts. Tick-by-tick deltas were too twitchy.
  const prevCountsRef   = useRef<Map<string, number>>(new Map())
  const snapshotTickRef = useRef(0)

  // ── Persist to session cache ─────────────────────────────────────────────
  useEffect(() => {
    saveSimCache(clusters, participants, venueStatesRef.current)
  }, [clusters, participants])

  // ── Simulation tick ───────────────────────────────────────────────────────
  // Pipeline per tick:
  //   1. Each venue's count fluctuates independently (–1 … +3)
  //   2. Area headcounts are re-derived as Σ(venue.count) per area
  //   3. Each cluster's count, momentum, pulseStrength, and activities update
  // This matches the spec pipeline: venue detection → area aggregation →
  // cluster recalculation → momentum signals evaluated.

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()

      // Step 1 — fluctuate individual venue counts
      const nextVenueStates = venueStatesRef.current.map(v => ({
        ...v,
        count: Math.max(0, v.count + Math.round(Math.random() * 4) - 1),
      }))
      venueStatesRef.current = nextVenueStates

      // Step 2 — aggregate venues → area headcounts
      const areaCounts = aggregateAreaCounts(nextVenueStates)

      // Every 8 ticks (~64 s) take a fresh count snapshot.
      // Momentum is the net delta between now and that snapshot — a ~60 s window
      // that smooths noise without hiding real growth or decline.
      snapshotTickRef.current += 1
      if (snapshotTickRef.current >= 8) {
        const snap = new Map<string, number>()
        areaCounts.forEach((v, k) => snap.set(k, v))
        prevCountsRef.current = snap
        snapshotTickRef.current = 0
      }

      // Step 3 — update clusters from aggregated area data
      setClusters(prev => {
        return prev.map(cluster => {
          const newCount  = Math.max(1, areaCounts.get(cluster.id) ?? cluster.count)
          const prevCount = prevCountsRef.current.get(cluster.id) ?? newCount
          const delta     = newCount - prevCount

          let momentum: Momentum
          if      (delta >= 8)  momentum = 'surging'
          else if (delta >= 3)  momentum = 'rising'
          else if (delta <= -3) momentum = 'cooling'
          else                  momentum = 'steady'

          const updatedActivities = { ...cluster.activities }
          if (delta > 0) {
            const actKey = pick(ACTIVITIES).id
            updatedActivities[actKey] = (updatedActivities[actKey] ?? 0) + delta
          }
          const topActivity = (Object.entries(updatedActivities) as [Activity, number][])
            .sort(([, a], [, b]) => b - a)[0][0]

          const spotCount = nextVenueStates.filter(v => v.areaId === cluster.id && v.count > 0).length

          return {
            ...cluster,
            count:         newCount,
            spotCount,
            momentum,
            pulseStrength: getPulseStrength(newCount),
            activities:    updatedActivities,
            topActivity,
            lastGrowthAt:  delta > 0 ? now : cluster.lastGrowthAt,
          }
        })
      })

      // Simulated recently-joined notification (65% chance per tick)
      if (Math.random() > 0.35) {
        const zone = pick(clustersRef.current) ?? { zoneName: 'Ho Chi Minh City' }
        const newJoin: RecentJoin = {
          id:          `rj-${now}-${Math.random()}`,
          displayName: pick(SIM_NAMES),
          flag:        pick(SIM_FLAGS),
          activity:    pick(ACTIVITIES).id,
          zoneName:    zone.zoneName,
          timestamp:   now,
        }
        setRecentlyJoined(prev => [newJoin, ...prev].slice(0, 12))
      }
    }, SIM_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  // ── Public: add the local user via venue assignment ───────────────────────
  // This is the output of the full join pipeline:
  //   GPS → nearest venue (resolved in MapScreen) → venueId passed here
  //   → venue count bumped → area re-aggregated → cluster updated
  //   → participant recorded with venueId (internal) and clusterId (public)

  const addUserToVenue = useCallback(
    (venueId: string, user: LocalUser, activity: Activity) => {
      const now     = Date.now()
      const venue   = VENUES.find(v => v.id === venueId)
      if (!venue) return
      const cluster = clustersRef.current.find(c => c.id === venue.areaId)
      if (!cluster) return

      const clusterId = venue.areaId
      localUserRef.current = { userId: user.id, clusterId, venueId }

      // Bump the specific venue's count
      venueStatesRef.current = venueStatesRef.current.map(v =>
        v.id === venueId ? { ...v, count: v.count + 1 } : v
      )

      // Re-aggregate area count from updated venue states
      const newAreaCount = venueStatesRef.current
        .filter(v => v.areaId === clusterId)
        .reduce((s, v) => s + v.count, 0)

      const participant: Participant = {
        id:          user.id,
        displayName: user.displayName,
        flag:        user.flag,
        activity,
        clusterId,
        venueId,     // internal — never rendered on the map
        zoneName:    cluster.zoneName,
        joinedAt:    now,
        expiresAt:   now + PULSE_DURATION_MS,
      }

      setParticipants(prev => [...prev.filter(p => p.id !== user.id), participant])

      const newSpotCount = venueStatesRef.current.filter(v => v.areaId === clusterId && v.count > 0).length

      setClusters(prev =>
        prev.map(c =>
          c.id === clusterId
            ? {
                ...c,
                count:         newAreaCount,
                spotCount:     newSpotCount,
                momentum:      'rising',
                pulseStrength: getPulseStrength(newAreaCount),
                lastGrowthAt:  now,
                activities:    { ...c.activities, [activity]: (c.activities[activity] ?? 0) + 1 },
              }
            : c
        )
      )

      const join: RecentJoin = {
        id:          `rj-user-${now}`,
        displayName: user.displayName,
        flag:        user.flag,
        activity,
        zoneName:    cluster.zoneName,
        timestamp:   now,
        isYou:       true,
      }
      setRecentlyJoined(prev => [join, ...prev].slice(0, 12))
    },
    []
  )

  // ── Public: re-add participant on session restore (no count bump) ─────────
  const restoreParticipant = useCallback(
    (clusterId: string, user: LocalUser, activity: Activity, expiresAt: number, venueId?: string) => {
      const cluster = clustersRef.current.find(c => c.id === clusterId)
      if (!cluster) return

      // Resolve venue: use stored venueId if present, otherwise first venue in area
      const resolvedVenueId = venueId ?? getVenuesByArea(clusterId)[0]?.id ?? ''
      localUserRef.current = { userId: user.id, clusterId, venueId: resolvedVenueId }

      setParticipants(prev => [
        ...prev.filter(p => p.id !== user.id),
        {
          id:          user.id,
          displayName: user.displayName,
          flag:        user.flag,
          activity,
          clusterId,
          venueId:     resolvedVenueId,
          zoneName:    cluster.zoneName,
          joinedAt:    Date.now() - 60_000,
          expiresAt,
        },
      ])
      setClusters(prev => prev.map(c =>
        c.id === clusterId ? { ...c, momentum: 'rising', pulseStrength: getPulseStrength(c.count) } : c
      ))
    },
    []
  )

  // ── Public: venue breakdown for the cluster sheet ────────────────────────
  // Returns venue name + anonymous count so the UI can show which hotspot in
  // an area is busiest. Person↔venue mapping is never included — only totals.
  const getVenueBreakdown = useCallback((areaId: string): VenueBreakdown[] => {
    return venueStatesRef.current
      .filter(v => v.areaId === areaId && v.count > 0)
      .map(v => ({
        id:    v.id,
        name:  VENUES.find(venue => venue.id === v.id)?.name ?? v.id,
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [])

  // ── Public: move user to a different venue (periodic location update) ───────
  // Decrements old venue, increments new venue, re-aggregates both areas.
  const moveUser = useCallback((userId: string, newVenueId: string) => {
    const info = localUserRef.current
    if (!info || info.userId !== userId) return
    if (info.venueId === newVenueId) return  // no change

    const newVenue = VENUES.find(v => v.id === newVenueId)
    if (!newVenue) return

    const oldVenueId   = info.venueId
    const oldClusterId = info.clusterId
    const newClusterId = newVenue.areaId

    // Update venue states: decrement old, increment new
    venueStatesRef.current = venueStatesRef.current.map(v => {
      if (v.id === oldVenueId) return { ...v, count: Math.max(0, v.count - 1) }
      if (v.id === newVenueId) return { ...v, count: v.count + 1 }
      return v
    })

    localUserRef.current = { userId, clusterId: newClusterId, venueId: newVenueId }

    // Re-aggregate both affected areas
    const oldAreaCount = venueStatesRef.current
      .filter(v => v.areaId === oldClusterId).reduce((s, v) => s + v.count, 0)
    const newAreaCount = venueStatesRef.current
      .filter(v => v.areaId === newClusterId).reduce((s, v) => s + v.count, 0)

    setClusters(prev => prev.map(c => {
      if (c.id === oldClusterId) return { ...c, count: Math.max(1, oldAreaCount), momentum: 'cooling', pulseStrength: getPulseStrength(Math.max(1, oldAreaCount)) }
      if (c.id === newClusterId) return { ...c, count: Math.max(1, newAreaCount), momentum: 'rising',  pulseStrength: getPulseStrength(Math.max(1, newAreaCount)) }
      return c
    }))

    // Update the participant record to reflect new area
    setParticipants(prev => prev.map(p =>
      p.id === userId
        ? { ...p, clusterId: newClusterId, venueId: newVenueId, zoneName: clustersRef.current.find(c => c.id === newClusterId)?.zoneName ?? p.zoneName }
        : p
    ))
  }, [])

  // ── Public: remove user when pulse expires or on voluntary leave ──────────
  const removeUser = useCallback((userId: string) => {
    const info = localUserRef.current
    if (info) {
      // Decrement the specific venue
      venueStatesRef.current = venueStatesRef.current.map(v =>
        v.id === info.venueId ? { ...v, count: Math.max(0, v.count - 1) } : v
      )
      // Re-aggregate area count
      const newAreaCount = venueStatesRef.current
        .filter(v => v.areaId === info.clusterId)
        .reduce((s, v) => s + v.count, 0)

      const newSpotCountOnRemove = venueStatesRef.current.filter(v => v.areaId === info.clusterId && v.count > 0).length

      setClusters(prev =>
        prev.map(c =>
          c.id === info.clusterId
            ? { ...c, count: newAreaCount, spotCount: newSpotCountOnRemove, momentum: 'cooling', pulseStrength: getPulseStrength(newAreaCount) }
            : c
        )
      )
    }
    setParticipants(prev => prev.filter(p => p.id !== userId))
    localUserRef.current = null
  }, [])

  return {
    clusters,
    participants,
    recentlyJoined,
    addUserToVenue,
    removeUser,
    restoreParticipant,
    getVenueBreakdown,
    moveUser,
  }
}
