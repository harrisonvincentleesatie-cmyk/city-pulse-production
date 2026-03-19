import { motion } from 'motion/react'

interface Props {
  onJoin:        () => void
  totalActive:   number
  isExpired?:    boolean
  lastZoneName?: string | null
}

export default function PreviewOverlay({ onJoin, totalActive, isExpired = false, lastZoneName }: Props) {
  return (
    <div className="preview-overlay">
      <motion.div
        className="preview-bottom"
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, type: 'spring', damping: 22, stiffness: 200 }}
      >
        <div className="preview-content-glass">
          {!isExpired && (
            <div className="preview-wordmark">
              <span className="preview-wordmark-dot" />
              City Pulse
            </div>
          )}

          {isExpired ? (
            <>
              <div className="preview-expired-row">
                <span className="preview-expired-icon" aria-hidden="true" />
                <div>
                  <p className="preview-expired-title">
                    {lastZoneName ? `Your pulse in ${lastZoneName} faded` : 'Your pulse faded'}
                  </p>
                  <p className="preview-expired-sub">The city didn't stop</p>
                </div>
              </div>
              <div className="preview-live-row preview-live-row--expired">
                <span className="preview-live-count">{totalActive}+</span>
                <span className="preview-live-label">
                  <span className="tagline-dot" />
                  still active right now
                </span>
              </div>
            </>
          ) : (
            <div className="preview-live-row">
              <span className="preview-live-count">{totalActive}+</span>
              <span className="preview-live-label">
                <span className="tagline-dot" />
                people active nearby
              </span>
            </div>
          )}

          {!isExpired && (
            <p className="preview-tagline-sub">
              Join the Pulse to see where everyone is right now
            </p>
          )}

          <button className="cta-btn join-pulse-btn" onClick={() => { navigator.vibrate?.(50); onJoin() }}>
            <span className="join-pulse-ring" />
            {isExpired ? 'Rejoin the Pulse' : 'Join the Pulse'}
          </button>

          <p className="preview-privacy">
            Grouped by zone only · Exact location never shown
          </p>
        </div>
      </motion.div>
    </div>
  )
}
