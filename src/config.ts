export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
// → Get your token at https://mapbox.com → Account → Access Tokens
// → Set VITE_MAPBOX_TOKEN in .env.local (never commit the real token)

export const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'
// Centroid of all 8 anchor zones — keeps every cluster visible on a 375px-wide phone
export const HCMC_CENTER: [number, number] = [106.7161, 10.7852]
// Zoom 12.5 shows ~10km wide on iPhone — all zones fit with margin at this width
export const HCMC_ZOOM = 12.5

export const PULSE_DURATION_MS  = 60 * 60 * 1000      // 60 minutes
export const PULSE_EXTEND_MS    = 60 * 60 * 1000      // +60 minutes on extend
export const EXTEND_NUDGE_MS    = 15 * 60 * 1000      // show nudge at 15 min remaining
export const CRITICAL_NUDGE_MS  =  5 * 60 * 1000      // critical urgency at 5 min remaining
export const SIM_INTERVAL_MS    = 8_000               // cluster update cadence
// After this long past expiry, treat as a fresh visit instead of showing
// a stale "your pulse expired" screen.  2 × PULSE_DURATION_MS = 2 hours.
export const STALE_EXPIRED_MS   = 2 * 60 * 60 * 1000  // 2 hours

// ── City context ──────────────────────────────────────────────────────────────
// The short, evocative name shown in the city badge.
// Swap this when scaling to Bangkok, Jakarta, etc.
export const CITY_DISPLAY_NAME = 'Saigon'
