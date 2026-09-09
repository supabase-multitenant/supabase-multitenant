'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SettingsPage() {
    const [domain, setDomain] = useState('')
    const [domainVerified, setDomainVerified] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [initialLoading, setInitialLoading] = useState(true)
    const router = useRouter()

    // Load current panel domain on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const response = await fetch('/api/settings/panel-domain')
                if (response.ok) {
                    const data = await response.json()
                    if (data.domain) {
                        setDomain(data.domain)
                        setDomainVerified(data.verified)
                    }
                } else if (response.status === 401) {
                    router.push('/auth/login')
                }
            } catch (error) {
                console.error('Failed to load settings:', error)
            } finally {
                setInitialLoading(false)
            }
        }

        loadSettings()
    }, [router])

    const handleSaveDomain = async () => {
        if (!domain.trim()) {
            setError('Please enter a domain')
            return
        }

        setLoading(true)
        setError('')
        setSuccess('')

        try {
            const response = await fetch('/api/settings/panel-domain', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ domain: domain.trim() }),
            })

            const data = await response.json()

            if (response.ok) {
                setDomainVerified(data.verified)
                setSuccess(data.message)
            } else {
                setError(data.error || 'Failed to save domain')
            }
        } catch {
            setError('An error occurred. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleRemoveDomain = async () => {
        setLoading(true)
        setError('')
        setSuccess('')

        try {
            const response = await fetch('/api/settings/panel-domain', {
                method: 'DELETE',
            })

            if (response.ok) {
                setDomain('')
                setDomainVerified(false)
                setSuccess('Panel domain removed successfully')
            } else {
                const data = await response.json()
                setError(data.error || 'Failed to remove domain')
            }
        } catch {
            setError('An error occurred. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    if (initialLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div>Loading...</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Image
                            src="/supabase-multitenant-logo-transparent.png"
                            alt="Supabase Multitenant"
                            width={150}
                            height={150}
                            className="object-contain"
                        />
                    </div>
                    <Link href="/dashboard">
                        <Button variant="outline">Back to Dashboard</Button>
                    </Link>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="max-w-2xl mx-auto">
                    <div className="mb-8">
                        <h2 className="text-3xl font-bold mb-2">Panel Settings</h2>
                        <p className="text-muted-foreground">
                            Configure your Supabase Multitenant dashboard settings
                        </p>
                    </div>

                    {success && (
                        <div className="mb-6 bg-green-500/10 border border-green-500/20 text-green-500 px-4 py-3 rounded">
                            {success}
                        </div>
                    )}

                    {error && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        {/* Panel Domain Configuration */}
                        <Card>
                            <CardHeader>
                                <CardTitle>🌐 Panel Domain</CardTitle>
                                <CardDescription>
                                    Configure a custom domain for accessing this Supabase Multitenant dashboard.
                                    Traefik will automatically provision SSL certificates via Let&apos;s Encrypt.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-4 py-3 rounded">
                                        <h4 className="font-medium mb-2">How Panel Domain Works</h4>
                                        <ol className="text-sm space-y-1 list-decimal list-inside">
                                            <li>Point your domain&apos;s DNS A record to this server&apos;s IP address</li>
                                            <li>Enter your domain below (e.g., <code className="bg-blue-500/20 px-1 rounded">panel.example.com</code>)</li>
                                            <li>Traefik will automatically provision an SSL certificate</li>
                                            <li>Access your panel at <code className="bg-blue-500/20 px-1 rounded">https://panel.example.com</code></li>
                                        </ol>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="panel_domain">Panel Domain</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="panel_domain"
                                                type="text"
                                                placeholder="panel.example.com"
                                                value={domain}
                                                onChange={(e) => setDomain(e.target.value)}
                                            />
                                            {domain && (
                                                <div className={`flex items-center px-3 py-2 rounded text-xs font-medium ${domainVerified
                                                        ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                                                        : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                                                    }`}>
                                                    {domainVerified ? '✓ Verified' : '⏳ Pending'}
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Enter the domain you want to use for this Supabase Multitenant dashboard (without https://)
                                        </p>
                                    </div>

                                    {domain && (
                                        <div className="space-y-2">
                                            <Label>Panel URL</Label>
                                            <div className="p-2 bg-gray-800/50 rounded">
                                                <code className="text-green-400">https://{domain}</code>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <Button
                                            onClick={handleSaveDomain}
                                            disabled={loading || !domain.trim()}
                                            variant="outline"
                                        >
                                            {loading ? 'Saving...' : 'Save Domain'}
                                        </Button>
                                        {domain && (
                                            <Button
                                                onClick={handleRemoveDomain}
                                                disabled={loading}
                                                variant="destructive"
                                            >
                                                Remove Domain
                                            </Button>
                                        )}
                                    </div>

                                    {!domainVerified && domain && (
                                        <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-4 py-3 rounded text-sm">
                                            <strong>DNS Not Verified:</strong> Make sure your domain&apos;s A record points to this server&apos;s IP address.
                                            DNS propagation can take up to 48 hours. You can still access the panel via IP:3000 in the meantime.
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Current Access Info */}
                        <Card>
                            <CardHeader>
                                <CardTitle>📌 Access Information</CardTitle>
                                <CardDescription>
                                    Current ways to access your Supabase Multitenant dashboard
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded">
                                        <span className="text-muted-foreground">Direct IP Access:</span>
                                        <code className="text-blue-400">http://YOUR_SERVER_IP:3000</code>
                                    </div>
                                    {domain && domainVerified && (
                                        <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded">
                                            <span className="text-muted-foreground">Custom Domain:</span>
                                            <a
                                                href={`https://${domain}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-green-400 hover:underline"
                                            >
                                                https://{domain}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    )
}
