import { motion } from 'motion/react'

interface Props {
  formatted:     string
  timeRemaining: number
  onExtend:      () => void
  onDismiss:     () => void
}

const CRITICAL_MS = 5 * 60 * 1000

export default function ExtendSheet({ formatted, timeRemaining, onExtend, onDismiss }: Props) {
  const isCritical = timeRemaining > 0 && timeRemaining < CRITICAL_MS

  return (
    <motion.div
      className={`extend-banner${isCritical ? ' critical' : ''}`}
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 60, opacity: 0 }}
      transition={{ type: 'spring', damping: 22, stiffness: 240 }}
    >
      <div className="extend-left">
        <span className="extend-icon" aria-hidden="true" />
        <div>
          <p className="extend-title">
            {isCritical ? 'Your pulse is almost gone' : 'Your pulse is fading'}
          </p>
          <p className="extend-sub">{isCritical ? `${formatted} left — extend now` : `${formatted} left — extend your pulse?`}</p>
        </div>
      </div>
      <div className="extend-actions">
        <button className="extend-btn" onClick={onExtend}>Extend 60m</button>
        <button className="extend-dismiss" onClick={onDismiss}>✕</button>
      </div>
    </motion.div>
  )
}
