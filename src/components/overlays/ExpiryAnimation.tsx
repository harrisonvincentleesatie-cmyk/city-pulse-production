import { useEffect } from 'react'
import { motion } from 'motion/react'

interface Props {
  onComplete: () => void
  bestRank?:  number | null  // highest rank reached this session (1/2/3 = achievement shown)
}

// Rank 1 gets different copy for expiry — acknowledges the irony of fading while at the top.
// Ranks 2 and 3 use the same copy as leave since the achievement stands regardless.
const ACHIEVEMENT_COPY: Record<number, string> = {
  1: 'You hit #1 before fading',
  2: 'You reached #2 tonight',
  3: 'You reached top 3 tonight',
}

// Distinct from LeaveAnimation: rings expand outward (signal dissipating, not contracting).
// The orb dims slowly — energy draining, not deliberately collapsing.
// Copy communicates time running out, not a choice.
export default function ExpiryAnimation({ onComplete, bestRank }: Props) {
  const hasAchievement = bestRank !== null && bestRank !== undefined && bestRank <= 3
  const holdMs = hasAchievement ? 3000 : 2600

  useEffect(() => {
    const t = setTimeout(onComplete, holdMs)
    return () => clearTimeout(t)
  }, [onComplete, holdMs])

  return (
    <motion.div
      className="leave-anim-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.55 } }}
      transition={{ duration: 0.35 }}
    >
      {/* 4 rings expanding outward — signal spreading too thin to sustain.
          Opposite of leave (contracting). Different from join (expanding with energy). */}
      {[0, 1, 2, 3].map(i => (
        <motion.div
          key={i}
          className="expiry-ring"
          initial={{ scale: 0.8, opacity: 0.65 - i * 0.12 }}
          animate={{ scale: 4.2 + i * 0.6, opacity: 0 }}
          transition={{ delay: i * 0.20, duration: 2.0, ease: [0.2, 0, 0.5, 1] }}
        />
      ))}

      {/* Centre orb dims gradually — no collapse, just losing signal */}
      <motion.div
        className="leave-orb"
        initial={{ scale: 1, opacity: 0.90 }}
        animate={{
          scale:   [1, 1.06, 1.02, 0.88, 0.60],
          opacity: [0.90, 0.82, 0.60, 0.28, 0],
        }}
        transition={{
          duration: 1.80,
          times:    [0, 0.15, 0.45, 0.75, 1],
          ease:     'easeInOut',
        }}
      />

      <div className="leave-centre">
        <motion.p
          className="leave-centre-title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.40, ease: 'easeOut' }}
        >
          Your pulse faded
        </motion.p>

        <motion.p
          className="leave-centre-sub"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.70, duration: 0.36, ease: 'easeOut' }}
        >
          Time ran out — the city moves on
        </motion.p>

        <motion.p
          className="leave-centre-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.08, duration: 0.40 }}
        >
          Join again to unlock the map
        </motion.p>

        {hasAchievement && (
          <motion.p
            className="leave-centre-achievement"
            data-rank={bestRank}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.55, duration: 0.45 }}
          >
            {ACHIEVEMENT_COPY[bestRank!]}
          </motion.p>
        )}
      </div>
    </motion.div>
  )
}
