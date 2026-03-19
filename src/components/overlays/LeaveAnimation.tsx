import { useEffect } from 'react'
import { motion } from 'motion/react'

interface Props {
  onComplete: () => void
  bestRank?:  number | null  // highest rank reached this session (1/2/3 = achievement shown)
}

const ACHIEVEMENT_COPY: Record<number, string> = {
  1: 'You held #1 tonight',
  2: 'You reached #2 tonight',
  3: 'You reached top 3 tonight',
}

export default function LeaveAnimation({ onComplete, bestRank }: Props) {
  const hasAchievement = bestRank !== null && bestRank !== undefined && bestRank <= 3
  // Give the achievement line breathing room to land — extend hold when it's present
  const holdMs = hasAchievement ? 3200 : 2800

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
      {/* 4 contracting rings — mirror of join's expanding rings.
          Start at wide radii and collapse inward, carrying the pink signal. */}
      {[0, 1, 2, 3].map(i => (
        <motion.div
          key={i}
          className="leave-ring"
          initial={{ scale: 4.8 - i * 0.9, opacity: 0.70 - i * 0.12 }}
          animate={{ scale: 0.2, opacity: 0 }}
          transition={{ delay: i * 0.12, duration: 1.0, ease: [0.4, 0, 0.8, 1] }}
        />
      ))}

      {/* Centre orb — clearly carries the pulse pink before collapsing.
          Holds at scale 1 briefly, then contracts and fades. */}
      <motion.div
        className="leave-orb"
        initial={{ scale: 1, opacity: 1 }}
        animate={{
          scale:   [1, 1.08, 1.08, 0.12],
          opacity: [1,  1,    0.80,  0],
        }}
        transition={{
          duration: 1.40,
          times:    [0, 0.12, 0.45, 1],
          ease:     [0.4, 0, 0.8, 1],
        }}
      />

      {/* Text — arrives after the visual collapse so language fills the silence. */}
      <div className="leave-centre">
        <motion.p
          className="leave-centre-title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.40, duration: 0.40, ease: 'easeOut' }}
        >
          You left the pulse
        </motion.p>

        <motion.p
          className="leave-centre-sub"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.68, duration: 0.36, ease: 'easeOut' }}
        >
          The city keeps moving
        </motion.p>

        <motion.p
          className="leave-centre-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.05, duration: 0.40 }}
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
