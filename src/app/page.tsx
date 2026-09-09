'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkSetupStatus() {
      try {
        // First check if setup is needed (no users exist)
        const statusResponse = await fetch('/api/auth/registration-status')
        const statusData = await statusResponse.json()

        if (statusData.registrationOpen) {
          // No users exist - redirect to setup/register
          router.push('/auth/register')
          return
        }

        // Users exist - check if logged in
        const projectsResponse = await fetch('/api/projects')
        if (projectsResponse.ok) {
          router.push('/dashboard')
        } else {
          router.push('/auth/login')
        }
      } catch {
        router.push('/auth/login')
      } finally {
        setChecking(false)
      }
    }

    checkSetupStatus()
  }, [router])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return null
}
