import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { generatePanelTraefikConfig, verifyDomainDNS } from '@/lib/traefik'

/**
 * GET /api/settings/panel-domain
 * Get the panel domain configuration
 */
export async function GET() {
    try {
        // Validate session
        const cookieStore = await cookies()
        const sessionToken = cookieStore.get('session')?.value
        if (!sessionToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const session = await validateSession(sessionToken)
        if (!session) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
        }

        const domainSetting = await prisma.panelSettings.findUnique({
            where: { key: 'panel_domain' },
        })

        const verifiedSetting = await prisma.panelSettings.findUnique({
            where: { key: 'panel_domain_verified' },
        })

        return NextResponse.json({
            domain: domainSetting?.value || null,
            verified: verifiedSetting?.value === 'true',
        })
    } catch (error) {
        console.error('Get panel domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * PUT /api/settings/panel-domain
 * Set or update the panel domain
 */
export async function PUT(request: NextRequest) {
    try {
        // Validate session
        const cookieStore = await cookies()
        const sessionToken = cookieStore.get('session')?.value
        if (!sessionToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const session = await validateSession(sessionToken)
        if (!session) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
        }

        const { domain } = await request.json()

        if (!domain) {
            return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
        }

        // Validate domain format
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/
        if (!domainRegex.test(domain)) {
            return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
        }

        // Verify domain DNS points to this server
        const dnsValid = await verifyDomainDNS(domain)

        // Save the domain setting
        await prisma.panelSettings.upsert({
            where: { key: 'panel_domain' },
            update: { value: domain },
            create: { key: 'panel_domain', value: domain },
        })

        // Save the verification status
        await prisma.panelSettings.upsert({
            where: { key: 'panel_domain_verified' },
            update: { value: dnsValid.toString() },
            create: { key: 'panel_domain_verified', value: dnsValid.toString() },
        })

        // Generate Traefik configuration for the panel
        await generatePanelTraefikConfig(domain)

        return NextResponse.json({
            success: true,
            domain,
            verified: dnsValid,
            message: dnsValid
                ? 'Panel domain configured and verified successfully. The panel will be accessible at https://' + domain
                : 'Panel domain configured. DNS verification pending - make sure your domain points to this server.',
        })
    } catch (error) {
        console.error('Set panel domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/settings/panel-domain
 * Remove the panel domain
 */
export async function DELETE() {
    try {
        // Validate session
        const cookieStore = await cookies()
        const sessionToken = cookieStore.get('session')?.value
        if (!sessionToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const session = await validateSession(sessionToken)
        if (!session) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
        }

        // Delete the settings
        await prisma.panelSettings.deleteMany({
            where: {
                key: {
                    in: ['panel_domain', 'panel_domain_verified'],
                },
            },
        })

        // Remove Traefik configuration
        const { removePanelTraefikConfig } = await import('@/lib/traefik')
        await removePanelTraefikConfig()

        return NextResponse.json({
            success: true,
            message: 'Panel domain removed successfully',
        })
    } catch (error) {
        console.error('Delete panel domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
