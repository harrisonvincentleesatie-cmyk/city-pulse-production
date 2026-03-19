import { useState, useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import type { LocalUser } from './types'
import { supabase } from './lib/supabase'
import EntryScreen from './screens/EntryScreen'
import SetupScreen from './screens/SetupScreen'
import MapScreen from './screens/MapScreen'

type AppStep = 'map' | 'entry' | 'setup'

export default function App() {
  const [session,   setSession]   = useState<Session | null>(null)
  const [localUser, setLocalUser] = useState<LocalUser | null>(null)
  const [appStep,   setAppStep]   = useState<AppStep>('map')
  const [authReady, setAuthReady] = useState(false)

  // Incrementing token tells MapScreen to start the join animation
  const [joinToken, setJoinToken] = useState(0)

  // ── Bootstrap: restore session + profile on mount ────────────────────────
  useEffect(() => {
    // 1. Get any existing session immediately (no network request)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        loadProfile(session.user.id)
      } else {
        setAuthReady(true)
      }
    })

    // 2. Listen for sign-in / sign-out / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        if (session) {
          loadProfile(session.user.id)
        } else {
          setLocalUser(null)
          setAppStep('map')
          setAuthReady(true)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // ── Load user profile from DB ─────────────────────────────────────────────
  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('users')
      .select('id, display_name, flag')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      setLocalUser({
        id:          data.id,
        displayName: data.display_name,
        flag:        data.flag,
      })
      setAppStep('map')
    } else {
      // Authenticated but no profile yet → go to setup
      setAppStep('setup')
    }
    setAuthReady(true)
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  const handleJoinPress = () => {
    if (localUser) {
      setJoinToken(t => t + 1)
    } else {
      setAppStep('entry')
    }
  }

  const handleLoginSuccess = () => {
    // EntryScreen called supabase.auth.signInWithOAuth — onAuthStateChange
    // will fire and call loadProfile automatically. Nothing to do here.
  }

  const handleSetupComplete = (user: LocalUser) => {
    setLocalUser(user)
    setAppStep('map')
    setJoinToken(t => t + 1)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Don't render until we know the auth state, to avoid flicker
  if (!authReady) return null

  const activeUser: LocalUser = localUser ?? { id: 'guest', displayName: '', flag: '🌏' }

  return (
    <div className="app-root">
      {/* Map always rendered; modals layer on top */}
      <MapScreen
        localUser={activeUser}
        onJoinPress={handleJoinPress}
        joinToken={joinToken}
      />

      <AnimatePresence>
        {appStep === 'entry' && (
          <EntryScreen
            onLogin={handleLoginSuccess}
            onClose={() => setAppStep('map')}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {appStep === 'setup' && (
          <SetupScreen
            session={session}
            onComplete={handleSetupComplete}
            onBack={() => setAppStep('entry')}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
