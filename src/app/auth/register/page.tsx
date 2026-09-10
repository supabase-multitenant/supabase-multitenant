'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  // Check registration status on page load
  useEffect(() => {
    async function checkRegistrationStatus() {
      try {
        const response = await fetch('/api/auth/registration-status')
        const data = await response.json()
        setRegistrationOpen(data.registrationOpen)
        setStatusMessage(data.message)
      } catch {
        // If check fails, allow registration attempt (API will validate)
        setRegistrationOpen(true)
      } finally {
        setChecking(false)
      }
    }
    checkRegistrationStatus()
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNameChange = (e: any) => {
    setName(e.target.value)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEmailChange = (e: any) => {
    setEmail(e.target.value)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePasswordChange = (e: any) => {
    setPassword(e.target.value)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleConfirmPasswordChange = (e: any) => {
    setConfirmPassword(e.target.value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, password }),
      })

      if (response.ok) {
        // Account created (owner). Establish the Auth.js session, then continue.
        const result = await signIn('credentials', { email, password, redirect: false })
        if (result?.error) {
          router.push('/auth/login')
        } else {
          router.push('/dashboard')
          router.refresh()
        }
      } else {
        const data = await response.json()
        setError(data.error || 'Registration failed')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Show loading state while checking registration status
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              Loading...
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show registration closed message
  if (!registrationOpen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex justify-center mb-4">
              <Image
                src="/supabase-multitenant-logo-transparent.png"
                alt="Supabase Multitenant"
                width={200}
                height={200}
                className="object-contain"
              />
            </div>
            <CardTitle className="text-2xl text-center">Registration Closed</CardTitle>
            <CardDescription className="text-center">
              {statusMessage}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center text-sm text-muted-foreground">
                <p className="mb-4">
                  New user registration is not available at this time.
                  Supabase Multitenant requires an administrator to create new accounts.
                </p>
              </div>
              <Link href="/auth/login" className="block">
                <Button className="w-full">
                  Go to Login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <Image
              src="/supabase-multitenant-logo-transparent.png"
              alt="Supabase Multitenant"
              width={200}
              height={200}
              className="object-contain"
            />
          </div>
          <CardTitle className="text-2xl text-center">Create Admin Account</CardTitle>
          <CardDescription className="text-center">
            {statusMessage || 'Set up your Supabase Multitenant administrator account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={handleNameChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={handleEmailChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={handlePasswordChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Admin Account'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}