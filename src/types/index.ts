export type Activity = 'drinks' | 'party' | 'eating' | 'exploring' | 'working' | 'cafe' | 'shopping'

// A registered physical venue (bar, café, restaurant, etc.).
// Venues are the atomic unit of activity. Users are GPS-matched to a venue on
// join. The map shows area clusters; the cluster sheet surfaces venue names with
// anonymous headcounts so users can see which hotspot is busiest right now.
// Person↔venue mapping is never exposed — participant lists are area-level only.
export interface Venue {
  id:     string
  name:   string
  areaId: string            // → AnchorZone.id / Cluster.id
  coords: [number, number]  // [lng, lat] — used for GPS proximity matching only
}
export type Momentum      = 'rising' | 'steady' | 'cooling' | 'surging'
export type PulseStrength = 'forming' | 'rising' | 'strong' | 'peak'

// Absolute headcount thresholds — independent of growth rate (momentum).
export function getPulseStrength(count: number): PulseStrength {
  if (count <= 7)  return 'forming'
  if (count <= 18) return 'rising'
  if (count <= 32) return 'strong'
  return 'peak'
}

export interface AnchorZone {
  id:     string
  name:   string
  coords: [number, number]  // [lng, lat]
  radius: number            // meters – used for heatmap weight
}

export interface Cluster {
  id:            string
  zoneId:        string
  zoneName:      string
  coords:        [number, number]
  count:         number
  spotCount:     number   // number of venues with ≥1 person — anonymous, no names
  topActivity:   Activity
  activities:    Partial<Record<Activity, number>>
  momentum:      Momentum
  pulseStrength: PulseStrength
  lastGrowthAt:  number
}

export interface Participant {
  id:          string
  displayName: string
  flag:        string
  activity:    Activity
  clusterId:   string   // area ID — the only location info shown publicly
  venueId?:    string   // internal venue assignment — never shown on the map
  zoneName:    string
  joinedAt:    number
  expiresAt:   number
}

export interface LocalUser {
  id:          string
  displayName: string
  flag:        string
}

export interface RecentJoin {
  id:          string
  displayName: string
  flag:        string
  activity:    Activity
  zoneName:    string
  timestamp:   number
  isYou?:      boolean  // true only for the local user's own join event
}

// Venue headcount surfaced to the cluster sheet: name + anonymous count only.
// Intentionally includes venue names — users want to know which spot is busiest.
// Privacy is preserved because the count is aggregate; no participant is linked
// to a specific venue (participant list stays at area level).
export interface VenueBreakdown {
  id:    string
  name:  string
  count: number
}
