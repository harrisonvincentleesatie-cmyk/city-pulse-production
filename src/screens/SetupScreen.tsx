import { useState } from 'react'
import { motion } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import type { LocalUser } from '../types'
import { supabase } from '../lib/supabase'

const FLAGS = [
  '🇻🇳','🇺🇸','🇬🇧','🇦🇺','🇫🇷','🇩🇪','🇯🇵','🇰🇷',
  '🇸🇬','🇹🇭','🇮🇩','🇲🇾','🇵🇭','🇨🇳','🇮🇳','🇧🇷',
  '🇨🇦','🇲🇽','🇮🇹','🇪🇸','🇳🇱','🇸🇪','🇵🇱','🇿🇦',
]

interface Props {
  session:    Session | null
  onComplete: (user: LocalUser) => void
  onBack:     () => void
}

export default function SetupScreen({ session, onComplete, onBack }: Props) {
  const [name,    setName]    = useState('')
  const [flag,    setFlag]    = useState('🇻🇳')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const canContinue = name.trim().length >= 2 && !saving

  const handleSubmit = async () => {
    if (!canContinue) return
    if (!session?.user) {
      setError('No active session. Please go back and sign in again.')
      return
    }

    setSaving(true)
    setError(null)

    const { error } = await supabase.from('users').insert({
      id:                   session.user.id,
      display_name:         name.trim(),
      flag,
      onboarding_completed: true,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    onComplete({
      id:          session.user.id,
      displayName: name.trim(),
      flag,
    })
  }

  return (
    <motion.div
      className="modal-sheet"
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
    >
      <button className="modal-close" onClick={onBack} aria-label="Back">←</button>

      <div className="setup-inner">
        <h2 className="setup-title">Set up your pulse</h2>
        <p className="setup-subtitle">Your name and flag are the only things others will see.</p>

        <div className="setup-field">
          <label className="setup-label">Display name</label>
          <input
            className="setup-input"
            type="text"
            placeholder="e.g. Linh, Alex, Kai…"
            maxLength={20}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </div>

        <div className="setup-field">
          <label className="setup-label">Your flag</label>
          <div className="flag-grid">
            {FLAGS.map(f => (
              <button
                key={f}
                className={`flag-btn${flag === f ? ' selected' : ''}`}
                onClick={() => setFlag(f)}
                aria-label={f}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ color: '#f87171', fontSize: '0.8rem', textAlign: 'center', marginBottom: '0.5rem' }}>
            {error}
          </p>
        )}

        <button
          className={`cta-btn full${canContinue ? '' : ' disabled'}`}
          onClick={handleSubmit}
          disabled={!canContinue}
        >
          {saving ? 'Saving…' : 'Start Your Pulse →'}
        </button>
      </div>
    </motion.div>
  )
}
