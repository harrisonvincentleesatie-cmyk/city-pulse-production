import { motion } from 'motion/react'
import type { Cluster, Participant, PulseStrength, VenueBreakdown } from '../../types'
import { getActivity } from '../../data/activities'

interface Props {
  cluster:        Cluster
  participants:   Participant[]
  venueBreakdown: VenueBreakdown[]   // anonymous venue counts — name visible, person↔venue mapping hidden
  isOwnCluster?:  boolean
  joinCount?:     number             // cluster count when user joined — used to show growth delta
  gapToFirst?:    number             // how many behind #1 (only set for rank 2/3)
  threatRival?:   { name: string; gap: number }  // rival zone closing in (only set when holding #1)
  onEndPulse?:    () => void
  onClose:        () => void
}

const MOMENTUM_LABEL: Record<string, string> = {
  surging: '🔥 Surging',
  rising:  '↑ Rising',
  steady:  '● Steady',
  cooling: '↓ Cooling',
}

const PULSE_STRENGTH_LABEL: Record<PulseStrength, string> = {
  forming: 'Pulse forming',
  rising:  'Pulse rising',
  strong:  'Strong pulse',
  peak:    'Peak pulse',
}

const PULSE_STRENGTH_COLOR: Record<PulseStrength, string> = {
  forming: 'rgba(255,255,255,0.55)',
  rising:  '#10b981',
  strong:  '#f59e0b',
  peak:    '#ff2d78',
}

export default function ClusterSheet({ cluster, participants, venueBreakdown, isOwnCluster, joinCount, gapToFirst, threatRival, onEndPulse, onClose }: Props) {
  const clusterParticipants = participants.filter(p => p.clusterId === cluster.id)
  const activity = getActivity(cluster.topActivity)

  return (
    // Full-screen container — tapping the dark overlay outside the sheet closes it
    <motion.div
      className="cluster-sheet-container"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="bottom-sheet cluster-sheet"
        onClick={e => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      >
        <div className="sheet-handle" onClick={onClose} />

        <div className="cluster-sheet-header">
          <div className="cluster-sheet-left">
            <h3 className="cluster-sheet-name">{cluster.zoneName}</h3>
            <div className="cluster-sheet-badges">
              <div
                className="cluster-momentum-badge"
                style={{ '--act-color': activity.color } as React.CSSProperties}
              >
                {MOMENTUM_LABEL[cluster.momentum]}
              </div>
              <div
                className="cluster-pulse-badge"
                style={{ color: PULSE_STRENGTH_COLOR[cluster.pulseStrength] } as React.CSSProperties}
              >
                {PULSE_STRENGTH_LABEL[cluster.pulseStrength]}
              </div>
            </div>
            {cluster.spotCount >= 2 && (
              <p className="cluster-spot-hint">
                {cluster.spotCount} active spots
              </p>
            )}
          </div>
          <div className="cluster-sheet-count-wrap">
            <div
              className="cluster-sheet-count"
              style={{ '--act-color': activity.color, '--act-glow': activity.glowColor } as React.CSSProperties}
            >
              <span className="cluster-big-count">{cluster.count}</span>
              <span className="cluster-emoji">{activity.emoji}</span>
            </div>
            {isOwnCluster && gapToFirst !== undefined && gapToFirst > 0 && (
              <span className="cluster-gap-to-first">{gapToFirst} behind #1</span>
            )}
            {isOwnCluster && joinCount !== undefined && cluster.count > joinCount && (
              <span className="cluster-join-delta">+{cluster.count - joinCount} since you joined</span>
            )}
            {isOwnCluster && threatRival && (
              <span className="cluster-threat-rival">
                {threatRival.name} {threatRival.gap <= 2 ? 'right behind' : `${threatRival.gap} behind`}
              </span>
            )}
          </div>
        </div>

        {/* Activity breakdown */}
        <p className="sheet-section-label">Activity mix</p>
        <div className="cluster-activities">
          {(Object.entries(cluster.activities) as [string, number][])
            .filter(([, n]) => n > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([id, n]) => {
              const meta = getActivity(id as never)
              return (
                <div key={id} className="cluster-act-row">
                  <span>{meta.emoji} {meta.label}</span>
                  <span className="cluster-act-count" style={{ color: meta.color }}>{n}</span>
                </div>
              )
            })
          }
        </div>


        {/* Hotspots — venue names + anonymous counts; person↔venue mapping is never exposed */}
        {venueBreakdown.length > 0 && (
          <>
            <div className="cluster-sheet-divider" />
            <p className="sheet-section-label">Hotspots in this area</p>
            <div className="venue-breakdown-list">
              {venueBreakdown.map((v, i) => (
                <motion.div
                  key={v.id}
                  className="venue-breakdown-row"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <span className="venue-breakdown-name">{v.name}</span>
                  <span
                    className="venue-breakdown-count"
                    style={{ color: activity.color, background: activity.glowColor } as React.CSSProperties}
                  >
                    {v.count}
                  </span>
                </motion.div>
              ))}
            </div>
          </>
        )}

        {/* Participant list — area-level only, no venue attribution */}
        {clusterParticipants.length > 0 && (
          <>
            <div className="cluster-sheet-divider" />
            <p className="sheet-section-label">
              People here now
              {clusterParticipants.length < cluster.count && (
                <span className="sheet-section-note">
                  {' '}· showing {clusterParticipants.length} of {cluster.count}
                </span>
              )}
            </p>
            <div className="participants-list">
              {clusterParticipants.map((p, i) => {
                const act = getActivity(p.activity)
                return (
                  <motion.div
                    key={p.id}
                    className="participant-row"
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 28 }}
                  >
                    <span className="participant-flag">{p.flag}</span>
                    <span className="participant-name">{p.displayName}</span>
                    <span className="participant-act" style={{ color: act.color }}>
                      {act.emoji} {act.label}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}

        {isOwnCluster && onEndPulse && (
          <button className="end-pulse-btn" onClick={onEndPulse}>
            Leave Pulse
          </button>
        )}
        <button className="sheet-close-btn" onClick={onClose}>Done</button>
      </motion.div>
    </motion.div>
  )
}
