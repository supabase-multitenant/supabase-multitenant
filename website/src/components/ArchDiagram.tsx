import type { ReactNode } from 'react'

function Box({
  title,
  accent = false,
  children,
  className = '',
}: {
  title: string
  accent?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-center ${
        accent
          ? 'border-brand-400/40 bg-brand-400/5'
          : 'border-line bg-surface-750'
      } ${className}`}
    >
      <div className={`text-sm font-semibold ${accent ? 'text-brand-300' : 'text-white'}`}>{title}</div>
      {children && <div className="mt-1 text-xs text-muted">{children}</div>}
    </div>
  )
}

function Flow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      {label && <span className="mb-1 text-[10px] uppercase tracking-widest text-dim">{label}</span>}
      <svg width="16" height="22" viewBox="0 0 16 22" fill="none" aria-hidden="true">
        <path d="M8 0v18M3 13l5 5 5-5" stroke="#3ECF8E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function ArchDiagram({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-[#0b0b0b] p-5 sm:p-8">
      {/* Internet */}
      <div className="flex justify-center">
        <Box title="Host(domain)" className="w-56">
          {"api.example.com · studio.example.com"}
        </Box>
      </div>

      <Flow />

      {/* Traefik edge */}
      <Box title="Traefik · edge + TLS" accent>
        {"Let's Encrypt · 80/443 · routes every hostname"}
      </Box>

      <Flow />

      {/* Split: control / data */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <div>
          <Box title="Control plane" className="w-full" accent>
            One control surface for every project
          </Box>
          <div className="mt-2 grid gap-2">
            <Box title="Panel (Next.js)" className="w-full">
              {"admin · settings :3000"}
            </Box>
            <Box title="Control Postgres" className="w-full">
              {"users · projects · env"}
            </Box>
          </div>
        </div>

        <div>
          <Box title="Data plane · per project (×N)" className="w-full" accent>
            Each project is fully isolated
          </Box>
          <div className="mt-2 rounded-xl border border-dashed border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Box title="Kong" className="w-full" />
              <Box title="PostgREST" className="w-full" />
              <Box title="Auth" className="w-full" />
              <Box title="Realtime" className="w-full" />
              <Box title="Storage" className="w-full" />
              <Box title="Studio" className="w-full" />
              <Box title="Supavisor" className="w-full" />
              <Box title="Postgres" className="w-full" />
            </div>
            {detailed && (
              <p className="mt-3 text-center text-xs text-dim">
                The same isolated stack is repeated once per project under{" "}
                <code className="rounded bg-white/5 px-1">projects/&lt;slug&gt;</code>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Control DB connection */}
      {detailed && (
        <div className="mt-4 flex flex-col items-center">
          <Flow label="reads / writes metadata" />
          <p className="rounded-lg border border-line bg-surface-750 px-4 py-2 text-center text-xs text-muted">
            The panel rows the control database · Traefik routes each hostname to the right project
          </p>
        </div>
      )}
    </div>
  )
}
