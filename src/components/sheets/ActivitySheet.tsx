import { useState } from 'react'
import { motion } from 'motion/react'
import type { Activity } from '../../types'
import { ACTIVITIES } from '../../data/activities'

interface Props {
  onSelect:        (activity: Activity) => void
  onDismiss:       () => void
  defaultActivity?: Activity
}

export default function ActivitySheet({ onSelect, onDismiss, defaultActivity }: Props) {
  // selected: which tile is highlighted (pre-seeded from last activity for UX suggestion)
  // confirmed: user has actively tapped — guards against double-tap during 260ms transition
  const [selected,  setSelected]  = useState<Activity | null>(defaultActivity ?? null)
  const [confirmed, setConfirmed] = useState(false)

  const handlePick = (id: Activity) => {
    if (confirmed) return      // prevent double-tap during transition
    navigator.vibrate?.(30)
    setConfirmed(true)
    setSelected(id)
    setTimeout(() => onSelect(id), 260)  // brief glow, then confirm
  }

  return (
    <motion.div
      className="bottom-sheet activity-sheet"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.9 }}
    >
      <div className="sheet-handle" />
      <div className="activity-sheet-header">
        <div>
          <h3 className="sheet-title">What are you doing?</h3>
          <p className="sheet-subtitle">You'll appear in the nearest active zone.</p>
        </div>
        <button className="activity-sheet-close" onClick={onDismiss} aria-label="Go back">✕</button>
      </div>

      <div className="activity-grid">
        {ACTIVITIES.map((a, i) => {
          const isSelected = selected === a.id
          return (
            <motion.button
              key={a.id}
              className={`activity-tile${isSelected ? ' selected' : ''}`}
              style={{
                '--act-color': a.color,
                '--act-glow':  a.glowColor,
              } as React.CSSProperties}
              onClick={() => handlePick(a.id)}
              initial={{ opacity: 0, y: 18 }}
              animate={{
                opacity:    1,
                y:          0,
                scale:      isSelected ? 0.94 : 1,
                background: isSelected ? a.glowColor : undefined,
              }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 28 }}
              whileTap={{ scale: 0.93 }}
            >
              <motion.span
                className="activity-emoji"
                animate={{ scale: isSelected ? 1.2 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {a.emoji}
              </motion.span>
              <span className="activity-label" style={isSelected ? { color: a.color } : undefined}>
                {a.label}
              </span>
            </motion.button>
          )
        })}
      </div>
    </motion.div>
  )
}
