import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Cluster } from '../../types'
import { getActivity } from '../../data/activities'
import { MAPBOX_TOKEN, MAP_STYLE, HCMC_CENTER, HCMC_ZOOM, PULSE_DURATION_MS } from '../../config'

// ── Mobile camera helpers ─────────────────────────────────────────────────────
function onMobile(): boolean {
  // screen.width = physical device CSS pixel width — immune to viewport inflation.
  return window.screen.width <= 480
}

// Locked/preview overview zoom. Lower value = wider city view = more clusters
// visible in preview. The contrast between this wide locked view and the 16.5
// flyTo arrival is the core "join the pulse" camera journey.
const MOBILE_ZOOM_OVERVIEW = 1.0   // HCMC_ZOOM + 1.0 = zoom 13.5 — wider view, more clusters visible

// Pitch: 50° active ambient = street-perspective, city feels real.
// 30° locked/preview = more top-down, less perspective foreshortening so
//   clusters sit at their true geographic positions (not stacked by vanishing point).
// 62° arrival = cinematic deep-angle plunge into the neighbourhood.
const MOBILE_PITCH_OVERVIEW = 50   // active ambient state
const MOBILE_PITCH_LOCKED   = 30   // locked / preview state — readable geography
const MOBILE_PITCH_ARRIVE   = 62   // flyTo on join

// Locked-state bottom padding. Keep minimal — more map, more atmosphere.
const LOCKED_BOTTOM_PAD_DESKTOP = 280
const LOCKED_BOTTOM_PAD_MOBILE  = 60

// Stable non-cryptographic hash → consistent label per zone
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// ── Zoom-based Level of Detail ─────────────────────────────────────────────
// At wider zooms, many clusters overlap. LOD solves this by spatially
// deduplicating: when two clusters are close, only the stronger one is shown.
// The user's own cluster always shows and always claims its area first.
//
//  wide   zoom < 13.8 → 1800m exclusion radius — one dominant signal per area
//  medium 13.8–14.9   → 1100m exclusion radius — top 1–2 per neighbourhood
//  close  zoom ≥ 15.0 → all clusters — full per-activity street-level detail
const PULSE_RANK:   Record<string, number> = { peak: 4, strong: 3, rising: 2, forming: 1 }
const MOMENTUM_RANK: Record<string, number> = { surging: 4, rising: 3, steady: 2, cooling: 1 }

function clusterImportance(c: Cluster): number {
  return (PULSE_RANK[c.pulseStrength] ?? 0) * 1000 + c.count * 10 + (MOMENTUM_RANK[c.momentum] ?? 0)
}

// Squared ground distance in meters — equirectangular approx, accurate for < 5 km
function distSqM(a: [number, number], b: [number, number]): number {
  const cosLat = Math.cos(((a[1] + b[1]) * 0.5) * Math.PI / 180)
  const dx     = (a[0] - b[0]) * cosLat * 111_319
  const dy     = (a[1] - b[1]) * 111_319
  return dx * dx + dy * dy
}

function computeLodClusters(
  clusters:      Cluster[],
  lod:           'wide' | 'medium' | 'close',
  userClusterId?: string,
): Cluster[] {
  if (lod === 'close') return clusters

  const radiusM  = lod === 'wide' ? 1800 : 1100
  const radiusSq = radiusM * radiusM

  // Sort strongest-first; user's cluster leads so it claims its area first
  const sorted = [...clusters].sort((a, b) => {
    if (a.id === userClusterId) return -1
    if (b.id === userClusterId) return  1
    return clusterImportance(b) - clusterImportance(a)
  })

  // Greedy spatial deduplication: skip a cluster if it falls inside the
  // exclusion zone of an already-kept one. User's cluster always passes.
  const kept: Cluster[] = []
  for (const c of sorted) {
    const blocked = c.id !== userClusterId &&
      kept.some(k => distSqM(c.coords, k.coords) < radiusSq)
    if (!blocked) kept.push(c)
  }
  return kept
}

// Three visual tiers for locked bubbles — conveys scale without exact count
function getLockSizeTier(count: number): 'sm' | 'md' | 'lg' {
  if (count <= 5)  return 'sm'
  if (count <= 14) return 'md'
  return 'lg'
}

interface Props {
  clusters:             Cluster[]
  isLocked:             boolean
  interactionsLocked?:  boolean  // true during 'picking' + 'join_anim' — locks gestures; camera control stays programmatic
  userClusterId?:       string
  flyToClusterId?:      string
  expiresAt?:           number
  youArrived?:          boolean  // true for ~1s after join animation completes → burst
  onClusterClick:       (cluster: Cluster) => void
}

// Ambient satellite offsets (degrees).
// At HCMC_ZOOM (12.5) these land within ~0.6–1.0× the heatmap radius,
// creating a natural zone bloom instead of an isolated dot.
// The pattern is asymmetric so it never looks like a mechanical ring.
const AMBIENT_OFFSETS: [number, number][] = [
  [ 0.015,  0.007],
  [-0.011,  0.013],
  [ 0.007, -0.015],
  [-0.015, -0.005],
  [ 0.012,  0.011],
  [-0.005, -0.016],
]

function buildHeatGeoJSON(clusters: Cluster[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []

  clusters.forEach(c => {
    const weight = Math.min(1, c.count / 30)

    // Main anchor point — full weight
    features.push({
      type:       'Feature',
      geometry:   { type: 'Point', coordinates: c.coords },
      properties: { weight },
    })

    // Ambient zone satellites — deterministic per cluster so they never jump.
    // Each cluster gets 6 lower-weight echoes whose offsets are scaled by a
    // hash of the cluster ID (0.80–1.20×) so nearby zones feel organically
    // different and don't produce a uniform grid.
    const scale         = 0.80 + (hashId(c.id) % 41) / 100  // 0.80 – 1.20
    const ambientWeight = Math.max(0.14, weight * 0.38)

    AMBIENT_OFFSETS.forEach(([dlng, dlat]) => {
      features.push({
        type:       'Feature',
        geometry:   {
          type:        'Point',
          coordinates: [c.coords[0] + dlng * scale, c.coords[1] + dlat * scale],
        },
        properties: { weight: ambientWeight },
      })
    })
  })

  return { type: 'FeatureCollection', features }
}

function getTimerSVG(expiresAt: number): string {
  const timeRemaining = Math.max(0, expiresAt - Date.now())
  const elapsed       = Math.max(0, PULSE_DURATION_MS - timeRemaining)
  // Compute exact dashoffset from elapsed time — no CSS animation needed.
  // Each marker rebuild (<1px change per 8s tick) is visually imperceptible.
  const dashOffset   = (257.6 * elapsed / PULSE_DURATION_MS).toFixed(2)
  const urgencyClass = timeRemaining < 300_000 ? 'urgent' : timeRemaining < 900_000 ? 'warning' : ''
  return `<svg class="cm-timer-ring ${urgencyClass}" viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
    <circle class="cm-timer-track" cx="45" cy="45" r="41"/>
    <circle class="cm-timer-arc" cx="45" cy="45" r="41" style="stroke-dashoffset:${dashOffset}"/>
  </svg>`
}

// ── Three LOD representations ─────────────────────────────────────────────
// wide   → zone-pulse dot   — no activity detail, clean city radar
// medium → compact emoji    — activity visible, count hidden, no ring
// close  → full bubble      — count + emoji + ring + spot dots (current design)
//
// Locked state always overrides LOD — preview markers never reveal activity.
function getMarkerHTML(
  cluster:  Cluster,
  isLocked: boolean,
  isYou:    boolean,
  lod:      'wide' | 'medium' | 'close',
  expiresAt?: number,
): string {
  // "You" indicators are only shown when the user has an active presence on the map.
  // Locked state (preview / expired / picking) means no active presence — never show.
  const youExtra = isYou && !isLocked
    ? `<div class="cm-you-ring"></div><div class="cm-you-sonar"></div><span class="cm-you-label"><span class="cm-you-dot"></span>You</span>${expiresAt ? getTimerSVG(expiresAt) : ''}`
    : ''

  if (isLocked) {
    const tier = getLockSizeTier(cluster.count)
    // Use the activity-specific locked hint so each zone has a distinct personality.
    // Only medium/large clusters get a chip — keeps the preview sparse and curious.
    const hint = getActivity(cluster.topActivity).lockedHint
    const chip = tier !== 'sm'
      ? `<div class="cm-hint-chip" aria-hidden="true"><span class="cm-hint-chip-label">${hint}</span></div>`
      : ''
    return `
      <div class="cm-bubble locked size-${tier}">
        <span class="cm-locked-pip"></span>
      </div>
      <div class="cm-ring"></div>
      ${chip}
      ${youExtra}
    `
  }

  const act = getActivity(cluster.topActivity)

  // Wide LOD: zone-pulse dot — no count, no emoji, no ring.
  // One clean radar signal per area. Size encodes relative scale.
  if (lod === 'wide') {
    const tier = getLockSizeTier(cluster.count)
    return `
      <div class="cm-bubble zone-pulse size-${tier}"
           style="--cm-color:${act.color};--cm-glow:${act.glowColor}">
        <span class="cm-zone-pip"></span>
      </div>
      ${youExtra}
    `
  }

  // Medium LOD: compact emoji — activity type is visible, count is not.
  // Rings removed — reduces visual noise at neighbourhood zoom.
  if (lod === 'medium') {
    return `
      <div class="cm-bubble compact"
           style="--cm-color:${act.color};--cm-glow:${act.glowColor}">
        <span class="cm-emoji">${act.emoji}</span>
      </div>
      ${youExtra}
    `
  }

  // Close LOD: full per-activity detail — count + emoji + ring + spot dots.
  const dotRow = cluster.spotCount >= 2
    ? `<div class="cm-spot-dots">${
        Array.from({ length: Math.min(cluster.spotCount, 4) })
          .map(() => `<span class="cm-spot-dot" style="background:${act.color}"></span>`)
          .join('')
      }</div>`
    : ''
  return `
    <div class="cm-bubble unlocked" style="--cm-color:${act.color};--cm-glow:${act.glowColor}">
      <span class="cm-count">${cluster.count}</span>
      <span class="cm-emoji">${act.emoji}</span>
    </div>
    <div class="cm-ring" style="border-color:${act.color}"></div>
    ${dotRow}
    ${youExtra}
  `
}

function createMarkerEl(
  cluster:  Cluster,
  isLocked: boolean,
  isYou:    boolean,
  lod:      'wide' | 'medium' | 'close',
  expiresAt?: number,
): HTMLDivElement {
  const el = document.createElement('div')
  // Locked markers get no momentum/pulse/lod class — no energy info leaks in preview.
  // Unlocked markers carry lod-* so CSS can target each tier if needed.
  el.className = isLocked
    ? 'cluster-marker'
    : `cluster-marker momentum-${cluster.momentum} pulse-${cluster.pulseStrength} lod-${lod}${isYou ? ' is-you' : ''}`
  el.innerHTML = getMarkerHTML(cluster, isLocked, isYou, lod, isYou ? expiresAt : undefined)
  return el
}

export default function MapContainer({ clusters, isLocked, interactionsLocked, userClusterId, flyToClusterId, expiresAt, youArrived, onClusterClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markersRef   = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const [mapLoaded, setMapLoaded] = useState(false)
  // LOD tier — derived from zoom; only 3 possible values so state updates are rare
  const [lodLevel, setLodLevel] = useState<'wide' | 'medium' | 'close'>('wide')

  const onClickRef            = useRef(onClusterClick)
  const isLockedRef           = useRef(isLocked)
  const interactionsLockedRef = useRef(interactionsLocked ?? isLocked)
  const userClusterRef        = useRef(userClusterId)
  // Always-current clusters snapshot — used by marker click handlers so they
  // never close over a stale Cluster object from the time the marker was created.
  const clustersRef           = useRef(clusters)
  // Set when a join flyTo runs; suppresses the competing unlock easeTo so the
  // camera lands exactly where flyTo placed it with no secondary correction hitch.
  const justFlewRef           = useRef(false)
  useEffect(() => { onClickRef.current            = onClusterClick              }, [onClusterClick])
  useEffect(() => { isLockedRef.current           = isLocked                   }, [isLocked])
  useEffect(() => { interactionsLockedRef.current = interactionsLocked ?? isLocked }, [interactionsLocked, isLocked])
  useEffect(() => { userClusterRef.current        = userClusterId               }, [userClusterId])
  useEffect(() => { clustersRef.current           = clusters                   }, [clusters])

  // ── Burst entrance when the join animation completes ─────────────────────
  // youArrived is true for ~1s right after the ceremony, revealing the user on the map.
  // We apply the class to the bubble (not the wrapper) to avoid conflicting with
  // Mapbox's positioning transform on the marker element.
  useEffect(() => {
    if (!youArrived || !userClusterId) return
    const raf = requestAnimationFrame(() => {
      const marker = markersRef.current.get(userClusterId)
      if (!marker) return
      const bubble = marker.getElement().querySelector('.cm-bubble') as HTMLElement | null
      if (!bubble) return
      bubble.classList.add('you-burst-in')
      setTimeout(() => bubble.classList.remove('you-burst-in'), 950)
    })
    return () => cancelAnimationFrame(raf)
  }, [youArrived, userClusterId])

  // ── Active state: remove padding + maintain pitch ────────────────────────
  // Locked states handle padding inside the interaction-locking effect below.
  // Also held during 'picking' (interactionsLocked) so camera stays put.
  // After a join flyTo the camera is already precisely positioned — skip the
  // ease so the animation → live map transition is instantaneous with no hitch.
  const effectiveLock = interactionsLocked ?? isLocked
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || effectiveLock) return
    if (justFlewRef.current) {
      // flyTo just landed — camera is already correct; consume the flag and skip
      justFlewRef.current = false
      return
    }
    mapRef.current.easeTo({
      padding:  { top: 0, bottom: 0, left: 0, right: 0 },
      pitch:    onMobile() ? MOBILE_PITCH_OVERVIEW : 0,
      duration: 500,
    })
  }, [effectiveLock, mapLoaded])

  // ── Lock / unlock map interactions ───────────────────────────────────────
  // isLocked (preview/expired): full lock + camera reset.
  // interactionsLocked (picking): lock gestures only — markers stay live.
  useEffect(() => {
    const map = mapRef.current
    if (!mapLoaded || !map) return
    if (effectiveLock) {
      map.scrollZoom.disable()
      map.dragPan.disable()
      map.doubleClickZoom.disable()
      map.touchZoomRotate.disable()
      map.keyboard.disable()
      // Only reset camera on hard lock (preview/expired), not during picking or join_anim
      if (isLocked) {
        const mobile = onMobile()
        map.easeTo({
          center:   HCMC_CENTER,
          zoom:     HCMC_ZOOM + (mobile ? MOBILE_ZOOM_OVERVIEW : 0),
          pitch:    mobile ? MOBILE_PITCH_LOCKED : 0,
          padding:  { top: 0, bottom: mobile ? LOCKED_BOTTOM_PAD_MOBILE : LOCKED_BOTTOM_PAD_DESKTOP, left: 0, right: 0 },
          duration: 700,
        })
      }
    } else {
      map.scrollZoom.enable()
      map.dragPan.enable()
      map.doubleClickZoom.enable()
      map.touchZoomRotate.enable()
      map.keyboard.enable()
    }
  }, [effectiveLock, isLocked, mapLoaded])

  // ── Fly to cluster when user joins ────────────────────────
  // Sets justFlewRef so the subsequent unlock effect does not fight the flyTo
  // endpoint with a competing easeTo — keeps the join transition hitch-free.
  useEffect(() => {
    if (!flyToClusterId || !mapLoaded || !mapRef.current) return
    const target = clusters.find(c => c.id === flyToClusterId)
    if (!target) return
    justFlewRef.current = true
    const mobile = onMobile()
    mapRef.current.flyTo({
      center: target.coords,
      zoom:   mobile ? 16.5 : 14.5,
      pitch:  mobile ? MOBILE_PITCH_ARRIVE : 10,
      speed:  mobile ? 0.9 : 1.1,   // slightly slower on mobile = more cinematic
      curve:  1.4,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToClusterId, mapLoaded])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const mobile   = onMobile()
    const initZoom = HCMC_ZOOM + (mobile ? MOBILE_ZOOM_OVERVIEW : 0)
    const lockPad  = mobile ? LOCKED_BOTTOM_PAD_MOBILE : LOCKED_BOTTOM_PAD_DESKTOP

    const map = new mapboxgl.Map({
      container:   containerRef.current,
      style:       MAP_STYLE,
      center:      HCMC_CENTER,
      zoom:        initZoom,
      accessToken: MAPBOX_TOKEN,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.on('load', () => {
      map.resize()

      // Offset camera upward on initial load so clusters sit above the bottom overlay
      if (interactionsLockedRef.current) {
        map.setPadding({ top: 0, bottom: lockPad, left: 0, right: 0 })
        // Lock interactions immediately — don't wait for the React effect cycle
        map.scrollZoom.disable()
        map.dragPan.disable()
        map.doubleClickZoom.disable()
        map.touchZoomRotate.disable()
        map.keyboard.disable()
      }

      map.addSource('pulse-heat', {
        type: 'geojson',
        data: buildHeatGeoJSON([]),
      })

      const firstSymbolId = map.getStyle()?.layers?.find(l => l.type === 'symbol')?.id

      map.addLayer(
        {
          id:     'pulse-heatmap',
          type:   'heatmap',
          source: 'pulse-heat',
          paint:  {
            'heatmap-weight':    ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
            // Intensity: softer at city zoom so the spread is wide and zonal,
            // sharper when zoomed in so individual clusters stay defined.
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.85, 13, 1.8, 15, 3.2],
            // Radius: large at city overview (zone blobs), peaks at neighbourhood
            // zoom (social corridors), tightens at street level (individual venue).
            'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 10, 80, 13, 130, 15, 80],
            'heatmap-opacity':   0.82,
            // Color ramp: first stop at 0.06 (was 0.15) so ambient areas between
            // clusters glow with residual energy — creates strip/corridor feel.
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0,0,0,0)',
              0.06, 'rgba(50,0,130,0.38)',
              0.18, 'rgba(110,0,175,0.66)',
              0.42, 'rgba(210,0,115,0.82)',
              0.72, 'rgba(255,75,0,0.90)',
              1,    'rgba(255,220,50,1)',
            ],
          },
        },
        firstSymbolId,
      )

      // Sync current zoom into a CSS custom property so markers can scale
      // responsively. At overview zoom (~13.5) markers scale to ~59%;
      // at street-level zoom (~16.5) they reach 100%. Mobile only — the
      // CSS rule that reads --map-zoom is inside the mobile media query.
      const syncZoom = () => {
        const z = map.getZoom()
        containerRef.current?.style.setProperty('--map-zoom', z.toFixed(3))
        // LOD tier — only 3 values, only update state when crossing a threshold
        const next: 'wide' | 'medium' | 'close' = z >= 15.0 ? 'close' : z >= 13.8 ? 'medium' : 'wide'
        setLodLevel(prev => prev === next ? prev : next)
      }
      map.on('zoom', syncZoom)
      syncZoom()

      setMapLoaded(true)
    })

    const ro = new ResizeObserver(() => { mapRef.current?.resize() })
    ro.observe(containerRef.current)

    mapRef.current = map
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      setMapLoaded(false)
    }
  }, [])

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    try {
      (mapRef.current.getSource('pulse-heat') as mapboxgl.GeoJSONSource)
        ?.setData(buildHeatGeoJSON(clusters))
    } catch { /* source not ready yet */ }
  }, [clusters, mapLoaded])

  // Heatmap opacity by state:
  //   locked (preview) → 0.82 — heatmap IS the map information; markers are dim/generic
  //   active           → 0.52 — markers carry the information; heatmap becomes atmosphere
  // This prevents heatmap + markers from both shouting at full intensity simultaneously.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    try {
      mapRef.current.setPaintProperty('pulse-heatmap', 'heatmap-opacity', isLocked ? 0.82 : 0.52)
    } catch { /* layer not ready */ }
  }, [isLocked, mapLoaded])

  const rebuildMarkers = useCallback((
    map:          mapboxgl.Map,
    nextClusters: Cluster[],
    locked:       boolean,
    youId:        string | undefined,
    expiresAt:    number | undefined,
    lod:          'wide' | 'medium' | 'close',
  ) => {
    const markers = markersRef.current

    markers.forEach((marker, id) => {
      if (!nextClusters.find(c => c.id === id)) {
        marker.remove()
        markers.delete(id)
      }
    })

    nextClusters.forEach(cluster => {
      const isYou = cluster.id === youId
      const existing = markers.get(cluster.id)
      if (existing) {
        const el = existing.getElement()
        // Count-pop animation only meaningful at close LOD where count is rendered
        const prevCount = lod === 'close'
          ? parseInt(el.querySelector('.cm-count')?.textContent ?? '-1', 10)
          : -1
        el.className = locked
          ? 'cluster-marker'
          : `cluster-marker momentum-${cluster.momentum} pulse-${cluster.pulseStrength} lod-${lod}${isYou ? ' is-you' : ''}`
        el.innerHTML = getMarkerHTML(cluster, locked, isYou, lod, isYou ? expiresAt : undefined)
        if (!locked && lod === 'close' && cluster.count !== prevCount && prevCount !== -1) {
          const countEl  = el.querySelector('.cm-count')  as HTMLElement | null
          const bubbleEl = el.querySelector('.cm-bubble') as HTMLElement | null
          if (countEl) {
            countEl.classList.add('count-pop')
            setTimeout(() => countEl.classList.remove('count-pop'), 420)
          }
          // Only pulse the bubble on growth, not on shrink
          if (bubbleEl && cluster.count > prevCount) {
            bubbleEl.classList.add('bubble-pop')
            setTimeout(() => bubbleEl.classList.remove('bubble-pop'), 520)
          }
        }
      } else {
        const el = createMarkerEl(cluster, locked, isYou, lod, isYou ? expiresAt : undefined)
        const clusterId = cluster.id
        el.addEventListener('click', () => {
          // Re-resolve from the latest clusters snapshot so the handler never
          // fires with a Cluster object that was captured at marker-creation time.
          const fresh = clustersRef.current.find(c => c.id === clusterId)
          if (fresh) onClickRef.current(fresh)
        })
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(cluster.coords)
          .addTo(map)
        markers.set(cluster.id, marker)
      }
    })
  }, [])

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const display = computeLodClusters(clusters, lodLevel, userClusterId)
    rebuildMarkers(mapRef.current, display, isLocked, userClusterId, expiresAt, lodLevel)
  }, [clusters, isLocked, userClusterId, expiresAt, mapLoaded, lodLevel, rebuildMarkers])

  return (
    <div
      ref={containerRef}
      className="map-viewport"
      style={{
        filter:     isLocked ? 'brightness(0.68) saturate(0.75) contrast(1.05)' : 'none',
        // Smooth the filter removal so the map brightens over the same window as the
        // JoinAnimation exit fade (250ms) — the reveal feels like emergence, not a snap.
        transition: 'filter 0.28s ease-out',
      }}
    />
  )
}
