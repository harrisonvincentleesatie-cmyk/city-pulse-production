import { motion } from 'motion/react'
import type { Cluster } from '../../types'

interface Props {
  cluster: Cluster
  onJoin:  () => void
  onClose: () => void
}

export default function LockedClusterTeaser({ cluster, onJoin, onClose }: Props) {
  return (
    <motion.div
      className="locked-teaser"
      initial={{ opacity: 0, y: -14, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97 }}
      transition={{ type: 'spring', damping: 28, stiffness: 380 }}
    >
      <span className="locked-teaser-dot" aria-hidden="true" />
      <span className="locked-teaser-name">{cluster.zoneName}</span>
      <span className="locked-teaser-sep" aria-hidden="true">·</span>
      <span className="locked-teaser-count">
        <span className="locked-count-blur">••</span>
      </span>
      <button className="locked-teaser-join-pill" onClick={onJoin}>
        Join →
      </button>
      <button className="locked-teaser-close" onClick={onClose} aria-label="Close">✕</button>
    </motion.div>
  )
}
