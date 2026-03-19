import { useEffect } from 'react'
import { motion } from 'motion/react'

interface Props {
  onComplete: () => void
}

export default function JoinAnimation({ onComplete }: Props) {
  useEffect(() => {
    // 3 000 ms: enough room for scan → lock → activate → reveal
    const t = setTimeout(onComplete, 3000)
    return () => clearTimeout(t)
  }, [onComplete])

  return (
    <motion.div
      className="join-anim-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* ── SCAN phase (0 – 1 800 ms) ──────────────────────────── */}

      {/* City grid — continuous zoom, feels like descending into the city */}
      <motion.div
        className="join-city-grid"
        initial={{ scale: 1.0, opacity: 0 }}
        animate={{ scale: 1.28, opacity: 0.70 }}
        transition={{ duration: 3.2, ease: [0.18, 0, 0.42, 1] }}
      />

      {/* First radar sweep — primary scan rotation */}
      <motion.div
        className="join-radar-sweep"
        initial={{ rotate: 0, opacity: 0 }}
        animate={{ rotate: 360, opacity: [0, 1, 1, 0] }}
        transition={{
          rotate:  { duration: 1.6, ease: 'linear' },
          opacity: { duration: 1.6, times: [0, 0.08, 0.78, 1] },
        }}
      />

      {/* Coordinate flash — anchors the sequence to a real location */}
      <motion.div
        className="join-coords"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.85, 0.85, 0] }}
        transition={{ duration: 1.1, times: [0, 0.15, 0.65, 1], delay: 0.05 }}
      >
        10.7769°N · 106.7009°E
      </motion.div>

      {/* Expanding burst rings */}
      {[0, 1, 2, 3, 4].map(i => (
        <motion.div
          key={i}
          className="join-ring"
          initial={{ scale: 0, opacity: 0.85 }}
          animate={{ scale: 5 + i * 1.8, opacity: 0 }}
          transition={{ delay: i * 0.14, duration: 1.2, ease: [0.2, 0.8, 0.4, 1] }}
        />
      ))}

      {/* ── LOCK phase (1 600 – 2 400 ms) ──────────────────────── */}

      {/* Second radar sweep — confirmation pass, dimmer */}
      <motion.div
        className="join-radar-sweep"
        initial={{ rotate: 180, opacity: 0 }}
        animate={{ rotate: 540, opacity: [0, 0.55, 0.55, 0] }}
        transition={{
          rotate:  { duration: 1.3, ease: 'linear', delay: 1.7 },
          opacity: { duration: 1.3, times: [0, 0.10, 0.80, 1], delay: 1.7 },
        }}
      />

      {/* Lock crosshair — dimmed, atmospheric only */}
      <motion.div
        className="join-crosshair"
        initial={{ opacity: 0, scale: 1.5 }}
        animate={{ opacity: [0, 0.22, 0.22, 0], scale: [1.5, 1, 1, 0.88] }}
        transition={{ duration: 1.8, times: [0, 0.22, 0.75, 1], delay: 1.55 }}
      />

      {/* ── ACTIVATE phase (2 000 – 3 000 ms) ─────────────────── */}

      {/* Heartbeat ring — loops from 1 000 ms, tension builds through the hold */}
      <motion.div
        className="join-heartbeat"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [0.6, 2.0, 0.6], opacity: [0, 0.42, 0] }}
        transition={{ delay: 1.0, duration: 0.80, repeat: Infinity, ease: 'easeOut' }}
      />

      {/* Centre pulse — scales in during scan, stays for lock + activate */}
      <motion.div
        className="join-centre"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.25, 1], opacity: [0, 1, 1] }}
        transition={{ duration: 0.55, times: [0, 0.55, 1] }}
      >
        <motion.span
          className="join-centre-icon"
          animate={{ scale: [1, 1.14, 1, 1.08, 1] }}
          transition={{ delay: 0.6, duration: 1.6, times: [0, 0.18, 0.45, 0.72, 1], ease: 'easeInOut' }}
        >⚡</motion.span>
        <motion.div
          className="join-centre-body"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <p className="join-centre-text">Activating your pulse…</p>
          <p className="join-centre-sub">Saigon</p>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
