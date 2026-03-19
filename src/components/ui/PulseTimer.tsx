import { motion } from 'motion/react'

interface Props {
  formatted:  string
  emoji:      string        // activity emoji only — label dropped to make room for count
  count?:     number        // live zone participant count
  flag:       string
  momentum?:  string
  rank?:      number | null // 1–3 = top zone ranks; null = unranked
  onClick?:   () => void
}

export default function PulseTimer({ formatted, emoji, count, flag, momentum, rank, onClick }: Props) {
  // Rank beats momentum — don't double-apply animation conflicts
  const cls = [
    'pulse-timer',
    rank === 1 ? 'rank-1'
    : rank === 2 ? 'rank-2'
    : rank === 3 ? 'rank-3'
    : momentum  ? `momentum-${momentum}`
    : '',
  ].filter(Boolean).join(' ')

  const stateLabel = rank === 1             ? '#1'
                   : rank === 2             ? '#2'
                   : rank === 3             ? '#3'
                   : momentum === 'surging' ? '↑↑'
                   : null

  return (
    <motion.button
      className={cls}
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 22 }}
    >
      <span className="timer-flag">{flag}</span>
      <span className="timer-emoji">{emoji}</span>
      {count !== undefined && <span className="timer-count">{count}</span>}
      <span className="timer-dot" />
      {stateLabel && <span className="timer-state">{stateLabel}</span>}
      <span className="timer-time">{formatted}</span>
    </motion.button>
  )
}
