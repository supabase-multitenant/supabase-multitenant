import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, unauthorized } from '@/lib/api-auth'
import { recordAudit, requirePanelOwner } from '@/lib/access'
import { generatePanelTraefikConfig, verifyDomainDNS } from '@/lib/traefik'

/**
 * The panel's own domain.
 *
 * Changing it rewrites how this host routes traffic, so writes are restricted to
 * the panel owner. Reading it is harmless — the caller is already using it.
 */

export async function GET(request: NextRequest) {
    try {
        const session = await getSession(request)
        if (!session) return unauthorized()

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

export async function PUT(request: NextRequest) {
    try {
        const auth = await requirePanelOwner(request)
        if (auth.response) return auth.response

        const { domain } = await request.json()

        if (!domain) {
            return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
        }

        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/
        if (!domainRegex.test(domain)) {
            return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
        }

        const dnsValid = await verifyDomainDNS(domain)

        await prisma.panelSettings.upsert({
            where: { key: 'panel_domain' },
            update: { value: domain },
            create: { key: 'panel_domain', value: domain },
        })

        await prisma.panelSettings.upsert({
            where: { key: 'panel_domain_verified' },
            update: { value: dnsValid.toString() },
            create: { key: 'panel_domain_verified', value: dnsValid.toString() },
        })

        await generatePanelTraefikConfig(domain)

        await recordAudit({
            action: 'settings.panel_domain',
            actorId: auth.session.user.id,
            actorEmail: auth.session.user.email,
            targetType: 'panel',
            metadata: { domain, dnsVerified: dnsValid },
        })

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

export async function DELETE(request: NextRequest) {
    try {
        const auth = await requirePanelOwner(request)
        if (auth.response) return auth.response

        await prisma.panelSettings.deleteMany({
            where: {
                key: {
                    in: ['panel_domain', 'panel_domain_verified'],
                },
            },
        })

        const { removePanelTraefikConfig } = await import('@/lib/traefik')
        await removePanelTraefikConfig()

        await recordAudit({
            action: 'settings.panel_domain_removed',
            actorId: auth.session.user.id,
            actorEmail: auth.session.user.email,
            targetType: 'panel',
        })

        return NextResponse.json({
            success: true,
            message: 'Panel domain removed successfully',
        })
    } catch (error) {
        console.error('Delete panel domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
