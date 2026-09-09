'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

interface SystemMetrics {
    cpu: {
        usage: number
        cores: number
    }
    memory: {
        used: number
        total: number
        percentage: number
    }
    disk: {
        used: number
        total: number
        percentage: number
    }
    network: {
        bytesIn: number
        bytesOut: number
    }
    uptime: number
    hostname: string
}

interface MetricCardProps {
    title: string
    value: number
    subtitle: string
    icon: React.ReactNode
    color: string
    gradientFrom: string
    gradientTo: string
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
}

function DonutChart({ value, color, gradientFrom, gradientTo }: { value: number; color: string; gradientFrom: string; gradientTo: string }) {
    const data = [
        { name: 'used', value: value },
        { name: 'free', value: 100 - value }
    ]

    const gradientId = `gradient-${color.replace('#', '')}`

    return (
        <div className="relative w-24 h-24">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={gradientFrom} />
                            <stop offset="100%" stopColor={gradientTo} />
                        </linearGradient>
                    </defs>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={28}
                        outerRadius={40}
                        startAngle={90}
                        endAngle={-270}
                        paddingAngle={2}
                        dataKey="value"
                        strokeWidth={0}
                    >
                        <Cell fill={`url(#${gradientId})`} />
                        <Cell fill="rgba(255,255,255,0.1)" />
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-white">{value}%</span>
            </div>
        </div>
    )
}

function MetricCard({ title, value, subtitle, icon, color, gradientFrom, gradientTo }: MetricCardProps) {
    return (
        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700/50 hover:border-slate-600/50 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 group">
            {/* Glow effect */}
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-500"
                style={{
                    background: `radial-gradient(circle at 30% 30%, ${gradientFrom}, transparent 70%)`
                }}
            />

            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                    <span className="p-1.5 rounded-lg" style={{ background: `linear-gradient(135deg, ${gradientFrom}20, ${gradientTo}20)` }}>
                        {icon}
                    </span>
                    {title}
                </CardTitle>
            </CardHeader>

            <CardContent className="flex items-center justify-between pt-0">
                <div className="space-y-1">
                    <div className="text-2xl font-bold text-white tracking-tight">
                        {value}%
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                        {subtitle}
                    </p>
                </div>

                <DonutChart
                    value={value}
                    color={color}
                    gradientFrom={gradientFrom}
                    gradientTo={gradientTo}
                />
            </CardContent>
        </Card>
    )
}

export default function ServerMetricsCards() {
    const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchMetrics = useCallback(async () => {
        try {
            const response = await fetch('/api/system/metrics')

            if (response.ok) {
                const data = await response.json()
                setMetrics(data.metrics)
                setError(null)
            } else if (response.status === 401) {
                setError('Session expired')
            } else {
                setError('Failed to fetch metrics')
            }
        } catch {
            setError('Connection error')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchMetrics()

        // Update every 5 seconds for real-time feel
        const interval = setInterval(fetchMetrics, 5000)

        return () => clearInterval(interval)
    }, [fetchMetrics])

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[...Array(4)].map((_, i) => (
                    <Card key={i} className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700/50">
                        <CardHeader className="pb-2">
                            <div className="h-4 w-20 bg-slate-700 rounded animate-pulse" />
                        </CardHeader>
                        <CardContent className="flex items-center justify-between pt-0">
                            <div className="space-y-2">
                                <div className="h-8 w-16 bg-slate-700 rounded animate-pulse" />
                                <div className="h-3 w-24 bg-slate-700/50 rounded animate-pulse" />
                            </div>
                            <div className="w-24 h-24 bg-slate-700/50 rounded-full animate-pulse" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    if (error) {
        return (
            <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                <span className="font-medium">Metrics Error:</span> {error}
            </div>
        )
    }

    if (!metrics) return null

    return (
        <div className="mb-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-sm text-slate-400 font-medium">
                            {metrics.hostname}
                        </span>
                    </div>
                    <span className="text-xs text-slate-600">|</span>
                    <span className="text-xs text-slate-500">
                        Uptime: {formatUptime(metrics.uptime)}
                    </span>
                </div>
                <span className="text-xs text-slate-600">
                    Updates every 5s
                </span>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU */}
                <MetricCard
                    title="CPU Usage"
                    value={metrics.cpu.usage}
                    subtitle={`${metrics.cpu.cores} cores available`}
                    color="#22c55e"
                    gradientFrom="#22c55e"
                    gradientTo="#10b981"
                    icon={
                        <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                    }
                />

                {/* Memory */}
                <MetricCard
                    title="RAM Usage"
                    value={metrics.memory.percentage}
                    subtitle={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`}
                    color="#3b82f6"
                    gradientFrom="#3b82f6"
                    gradientTo="#6366f1"
                    icon={
                        <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    }
                />

                {/* Disk */}
                <MetricCard
                    title="Disk Usage"
                    value={metrics.disk.percentage}
                    subtitle={`${formatBytes(metrics.disk.used)} / ${formatBytes(metrics.disk.total)}`}
                    color="#f59e0b"
                    gradientFrom="#f59e0b"
                    gradientTo="#f97316"
                    icon={
                        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                        </svg>
                    }
                />

                {/* Network */}
                <MetricCard
                    title="Network"
                    value={Math.min(100, Math.round((metrics.network.bytesIn / (metrics.network.bytesIn + metrics.network.bytesOut + 1)) * 100))}
                    subtitle={`↓ ${formatBytes(metrics.network.bytesIn)} ↑ ${formatBytes(metrics.network.bytesOut)}`}
                    color="#a855f7"
                    gradientFrom="#a855f7"
                    gradientTo="#ec4899"
                    icon={
                        <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                        </svg>
                    }
                />
            </div>
        </div>
    )
}
