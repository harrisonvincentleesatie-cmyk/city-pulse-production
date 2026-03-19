import type { Cluster, Participant, Activity, RecentJoin } from '../types'
import { getPulseStrength } from '../types'
import { ANCHOR_ZONES } from './zones'
import { ACTIVITIES } from './activities'
import { getVenuesByArea } from './venues'

const DISPLAY_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Linh', 'Minh', 'Thu', 'Nam', 'Hoa',
  'Jade', 'River', 'Cass', 'Leo', 'Mia', 'Yuki', 'Sofia', 'Omar',
  'Nina', 'Luca', 'Kai', 'Raya', 'Seren', 'Tom', 'Maya', 'Jin',
]

const FLAGS = [
  '🇻🇳', '🇺🇸', '🇬🇧', '🇫🇷', '🇩🇪', '🇦🇺',
  '🇨🇦', '🇯🇵', '🇰🇷', '🇸🇬', '🇧🇷', '🇮🇩',
  '🇹🇭', '🇮🇹', '🇪🇸', '🇳🇱', '🇵🇭',
]

// ── Mulberry32 seeded PRNG ─────────────────────────────────────────────────────
// Tiny, fast, good distribution. Given the same seed it always produces
// the same sequence — this is what makes the simulation deterministic.
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 30-minute bucket: stable within each half-hour, changes gradually over the day.
// Two demos in the same half-hour window always see the same starting state.
function getTimeSeed(): number {
  const d = new Date()
  return (
    d.getFullYear() * 1_000_000 +
    (d.getMonth() + 1) * 10_000 +
    d.getDate() * 100 +
    d.getHours() * 2 +
    (d.getMinutes() >= 30 ? 1 : 0)
  )
}

// Scale cluster counts to the current time of day.
// Peaks in the evening / late night where City Pulse is most useful.
function getActivityMultiplier(): number {
  const hour = new Date().getHours()
  if (hour >= 22 || hour <= 1)  return 2.1   // peak: late night
  if (hour >= 19 && hour < 22)  return 1.65  // prime evening
  if (hour >= 17 && hour < 19)  return 1.2   // after-work rush
  if (hour >= 12 && hour < 17)  return 0.85  // afternoon
  if (hour >= 9  && hour < 12)  return 0.55  // morning
  return 0.3                                  // quiet hours
}

function rpick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]
}

// Pick an activity weighted by the cluster's actual distribution
function weightedActivityPick(
  activities: Partial<Record<Activity, number>>,
  rand: () => number,
): Activity {
  const entries = (Object.entries(activities) as [Activity, number][])
    .filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return entries[0]?.[0] ?? 'drinks'
  let r = rand() * total
  for (const [id, n] of entries) {
    r -= n
    if (r <= 0) return id
  }
  return entries[entries.length - 1][0]
}

function rint(min: number, max: number, rand: () => number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

function buildActivitiesMap(
  total: number,
  rand: () => number,
): Partial<Record<Activity, number>> {
  const map: Partial<Record<Activity, number>> = {}
  let remaining = total
  const ids = ACTIVITIES.map(a => a.id)

  ids.forEach((id, i) => {
    if (i === ids.length - 1) {
      map[id] = Math.max(0, remaining)
    } else {
      const n = Math.floor(rand() * (remaining * 0.6))
      map[id] = n
      remaining -= n
    }
  })
  return map
}

// ── Public builders ───────────────────────────────────────────────────────────

export function buildSeedClusters(): Cluster[] {
  const timeSeed   = getTimeSeed()
  const multiplier = getActivityMultiplier()
  const now        = Date.now()

  return ANCHOR_ZONES.map((zone, i) => {
    // Each zone gets its own PRNG stream derived from time + zone index.
    // Same zone always produces the same sequence within the current time window.
    const rand = mulberry32(timeSeed * 137 + i * 31 + 7)

    const baseCount = 4 + Math.floor(rand() * 22)          // 4–25 base
    const count     = Math.max(2, Math.round(baseCount * multiplier))
    const activities = buildActivitiesMap(count, rand)

    const topActivity = (Object.entries(activities) as [Activity, number][])
      .sort(([, a], [, b]) => b - a)[0][0]

    // Bias momentum toward active states in the evening/night — feels live
    const mr = rand()
    let momentum: Cluster['momentum']
    if      (multiplier >= 1.8 && mr > 0.52) momentum = 'surging'
    else if (multiplier >= 1.0 && mr > 0.35) momentum = 'rising'
    else if (mr > 0.28)                       momentum = 'steady'
    else                                      momentum = 'cooling'

    return {
      id:           zone.id,
      zoneId:       zone.id,
      zoneName:     zone.name,
      coords:       zone.coords,
      count,
      spotCount:    getVenuesByArea(zone.id).length,  // all venues active at seed time
      topActivity,
      activities,
      momentum,
      pulseStrength: getPulseStrength(count),
      lastGrowthAt: now - rint(5_000, 180_000, rand),
    }
  })
}

export function buildSeedParticipants(clusters: Cluster[]): Participant[] {
  const timeSeed = getTimeSeed()
  const now      = Date.now()
  const out: Participant[] = []

  clusters.forEach((cluster, ci) => {
    // Zone + time seed → stable name/flag/venue assignments within the same window
    const rand         = mulberry32(timeSeed * 97 + ci * 13 + 3)
    const visibleCount = Math.min(cluster.count, 8)
    const venuesInArea = getVenuesByArea(cluster.id)

    for (let i = 0; i < visibleCount; i++) {
      // Assign each seed participant to a specific venue in their area.
      // The venueId is internal — only clusterId (area) is shown on the map.
      const venue = venuesInArea.length > 0 ? rpick(venuesInArea, rand) : null
      out.push({
        id:          `seed-${cluster.id}-${i}`,  // stable ID = same slot each load
        displayName: rpick(DISPLAY_NAMES, rand),
        flag:        rpick(FLAGS, rand),
        activity:    weightedActivityPick(cluster.activities, rand),
        clusterId:   cluster.id,
        venueId:     venue?.id,
        zoneName:    cluster.zoneName,
        joinedAt:    now - rint(0, 3_600_000, rand),
        expiresAt:   now + rint(600_000, 3_600_000, rand),
      })
    }
  })

  return out
}

// Pre-populate the live ticker so it doesn't start empty on load.
// 4–7 joins spread across the last 8 minutes — always the same set in a given
// time window, so refreshing doesn't show a different crowd.
export function buildSeedRecentJoins(clusters: Cluster[]): RecentJoin[] {
  const timeSeed = getTimeSeed()
  const rand     = mulberry32(timeSeed * 53 + 11)
  const now      = Date.now()
  const count    = 4 + Math.floor(rand() * 4)   // 4–7
  const out: RecentJoin[] = []

  for (let i = 0; i < count; i++) {
    out.push({
      id:          `rj-seed-${i}`,
      displayName: rpick(DISPLAY_NAMES, rand),
      flag:        rpick(FLAGS, rand),
      activity:    rpick(ACTIVITIES, rand).id,
      zoneName:    rpick(clusters, rand).zoneName,
      timestamp:   now - Math.floor(rand() * 8 * 60 * 1000),
    })
  }

  // Most recent first
  return out.sort((a, b) => b.timestamp - a.timestamp)
}
