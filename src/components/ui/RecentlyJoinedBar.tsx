import { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { RecentJoin } from '../../types'
import { getActivity } from '../../data/activities'

const MAX_ITEMS = 8

interface Props {
  items: RecentJoin[]
}

// dir = 1  → going toward newer (lower index): item drops in from above, old exits below
// dir = -1 → going toward older (higher index): item rises from below, old exits above
// This matches: live auto-play = new item drops down from above (like a live ticker)
//               swipe up = browse into older history (content rises from below)
//               swipe down = return to newer (content drops in from above)
const variants = {
  enter:  (dir: number) => ({ y: dir >= 0 ? -28 : 28, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit:   (dir: number) => ({ y: dir >= 0 ? 28 : -28, opacity: 0 }),
}

export default function RecentlyJoinedBar({ items }: Props) {
  const visible   = items.slice(0, MAX_ITEMS)
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)
  const prevFirst = useRef<string | undefined>(undefined)

  // When a new person joins (items[0] changes), drop back to index 0.
  // dir=1 → new item slides in from above, matching the "dropping in" ticker feel.
  const firstId = visible[0]?.id
  useEffect(() => {
    if (firstId !== prevFirst.current) {
      prevFirst.current = firstId
      setDir(1)
      setIdx(0)
    }
  }, [firstId])

  if (visible.length === 0) return null

  const clamped = Math.min(idx, visible.length - 1)
  const item    = visible[clamped]
  const act     = getActivity(item.activity)

  const goNewer = () => {
    if (clamped > 0) { setDir(1); setIdx(clamped - 1) }
  }
  const goOlder = () => {
    if (clamped < visible.length - 1) { setDir(-1); setIdx(clamped + 1) }
  }

  return (
    <div className="recently-joined">
      {/* Track clips vertical motion so items don't overflow the notification zone */}
      <div className="rj-track">
        <AnimatePresence custom={dir} mode="wait" initial={false}>
          <motion.div
            key={item.id}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.55 }}
            className={`rj-item${item.isYou ? ' rj-you' : ''}`}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e, info) => {
              // Swipe UP (negative offset) → go into older history
              // Swipe DOWN (positive offset) → return toward newer
              if      (info.offset.y < -36) goOlder()
              else if (info.offset.y >  36) goNewer()
            }}
            style={{ cursor: visible.length > 1 ? 'grab' : 'default', userSelect: 'none' }}
          >
            <span className="rj-flag">{item.flag}</span>
            <span className="rj-name">{item.displayName}</span>
            <span className="rj-sep">·</span>
            <span className="rj-zone">{item.zoneName}</span>
            <span className="rj-act" style={{ color: act.color }}>{act.emoji}</span>
          </motion.div>
        </AnimatePresence>
      </div>

    </div>
  )
}
