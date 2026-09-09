import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { generateProjectTraefikConfig, verifyDomainDNS, getProjectPorts } from '@/lib/traefik'

/**
 * GET /api/projects/[id]/domain
 * Get the domain configuration for a project (API + Studio domains)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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

        const { id } = await params

        const project = await prisma.project.findUnique({
            where: { id },
            select: {
                id: true,
                domain: true,
                domainVerified: true,
                studioDomain: true,
                studioDomainVerified: true,
            },
        })

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        return NextResponse.json({
            domain: project.domain,
            verified: project.domainVerified,
            studioDomain: project.studioDomain,
            studioVerified: project.studioDomainVerified,
        })
    } catch (error) {
        console.error('Get domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * PUT /api/projects/[id]/domain
 * Set or update the custom domains for a project (API and/or Studio)
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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

        const { id } = await params
        const { domain, studioDomain } = await request.json()

        // Validate domain format
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/

        if (domain && !domainRegex.test(domain)) {
            return NextResponse.json({ error: 'Invalid API domain format' }, { status: 400 })
        }

        if (studioDomain && !domainRegex.test(studioDomain)) {
            return NextResponse.json({ error: 'Invalid Studio domain format' }, { status: 400 })
        }

        if (!domain && !studioDomain) {
            return NextResponse.json({ error: 'At least one domain is required' }, { status: 400 })
        }

        // Check if project exists
        const project = await prisma.project.findUnique({
            where: { id },
            include: {
                envVars: true,
            },
        })

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        // Check if API domain is already in use by another project
        if (domain) {
            const existingApiProject = await prisma.project.findFirst({
                where: {
                    domain,
                    id: { not: id },
                },
            })
            if (existingApiProject) {
                return NextResponse.json({ error: 'API domain is already in use' }, { status: 409 })
            }
        }

        // Check if Studio domain is already in use by another project
        if (studioDomain) {
            const existingStudioProject = await prisma.project.findFirst({
                where: {
                    studioDomain,
                    id: { not: id },
                },
            })
            if (existingStudioProject) {
                return NextResponse.json({ error: 'Studio domain is already in use' }, { status: 409 })
            }
        }

        // Verify domain DNS
        const apiDnsValid = domain ? await verifyDomainDNS(domain) : false
        const studioDnsValid = studioDomain ? await verifyDomainDNS(studioDomain) : false

        // Build update data
        const updateData: Record<string, unknown> = {}
        if (domain !== undefined) {
            updateData.domain = domain || null
            updateData.domainVerified = domain ? apiDnsValid : false
        }
        if (studioDomain !== undefined) {
            updateData.studioDomain = studioDomain || null
            updateData.studioDomainVerified = studioDomain ? studioDnsValid : false
        }

        // Update the project's domains
        const updatedProject = await prisma.project.update({
            where: { id },
            data: updateData,
        })

        // Generate Traefik configuration for this project
        const envVarsMap: Record<string, string> = {}
        project.envVars.forEach(env => {
            envVarsMap[env.key] = env.value
        })
        const ports = getProjectPorts(envVarsMap)

        // Only generate Traefik config if we have at least one domain
        const finalDomain = domain || updatedProject.domain
        const finalStudioDomain = studioDomain || updatedProject.studioDomain

        if (finalDomain || finalStudioDomain) {
            await generateProjectTraefikConfig({
                projectSlug: project.slug,
                domain: finalDomain || '',
                studioDomain: finalStudioDomain || '',
                kongPort: ports.kongPort,
                studioPort: ports.studioPort,
            })
        }

        // Build response message
        const messages: string[] = []
        if (domain) {
            messages.push(apiDnsValid
                ? 'API domain verified'
                : 'API domain configured (DNS pending)')
        }
        if (studioDomain) {
            messages.push(studioDnsValid
                ? 'Studio domain verified'
                : 'Studio domain configured (DNS pending)')
        }

        return NextResponse.json({
            success: true,
            domain: updatedProject.domain,
            verified: updatedProject.domainVerified,
            studioDomain: updatedProject.studioDomain,
            studioVerified: updatedProject.studioDomainVerified,
            message: messages.join('. ') || 'Domains updated successfully',
        })
    } catch (error) {
        console.error('Set domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/projects/[id]/domain
 * Remove the custom domains from a project
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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

        const { id } = await params

        const project = await prisma.project.findUnique({
            where: { id },
        })

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        // Update the project (remove domains)
        await prisma.project.update({
            where: { id },
            data: {
                domain: null,
                domainVerified: false,
                studioDomain: null,
                studioDomainVerified: false,
            },
        })

        // Remove Traefik configuration
        const { removeProjectTraefikConfig } = await import('@/lib/traefik')
        await removeProjectTraefikConfig(project.slug)

        return NextResponse.json({
            success: true,
            message: 'Domains removed successfully',
        })
    } catch (error) {
        console.error('Delete domain error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
