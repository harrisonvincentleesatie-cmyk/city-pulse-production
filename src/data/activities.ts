import type { Activity } from '../types'

export interface ActivityMeta {
  id:        Activity
  label:     string
  emoji:     string
  color:     string
  glowColor: string
  lockedHint: string
}

export const ACTIVITIES: ActivityMeta[] = [
  {
    id:         'drinks',
    label:      'Drinks',
    emoji:      '🍺',
    color:      '#f59e0b',
    glowColor:  'rgba(245,158,11,0.35)',
    lockedHint: 'Filling up',
  },
  {
    id:         'party',
    label:      'Party',
    emoji:      '🎉',
    color:      '#a855f7',
    glowColor:  'rgba(168,85,247,0.35)',
    lockedHint: 'Peak energy',
  },
  {
    id:         'eating',
    label:      'Eating',
    emoji:      '🍜',
    color:      '#ef4444',
    glowColor:  'rgba(239,68,68,0.35)',
    lockedHint: 'Night crowd',
  },
  {
    id:         'exploring',
    label:      'Exploring',
    emoji:      '🗺️',
    color:      '#10b981',
    glowColor:  'rgba(16,185,129,0.35)',
    lockedHint: 'City moving',
  },
  {
    id:         'working',
    label:      'Working',
    emoji:      '💻',
    color:      '#3b82f6',
    glowColor:  'rgba(59,130,246,0.35)',
    lockedHint: 'Night owls out',
  },
  {
    id:         'cafe',
    label:      'Coffee',
    emoji:      '☕',
    color:      '#d97706',
    glowColor:  'rgba(217,119,6,0.35)',
    lockedHint: 'Low-key pulse',
  },
  {
    id:         'shopping',
    label:      'Shopping',
    emoji:      '🛍️',
    color:      '#06b6d4',
    glowColor:  'rgba(6,182,212,0.35)',
    lockedHint: 'Busy block',
  },
]

export const getActivity = (id: Activity): ActivityMeta =>
  ACTIVITIES.find(a => a.id === id) ?? ACTIVITIES[0]
