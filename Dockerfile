# === Build Stage ===
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache libc6-compat openssl

# Copy package files
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client (needs dummy DATABASE_URL for generation)
# SECURITY NOTE: This is ONLY for build time to generate client artifacts.
# It is NOT used in production and does NOT persist to the final image.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# === Production Stage ===
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies
# Added: prisma for migrations
RUN apk add --no-cache libc6-compat openssl git curl docker-cli

# Install global prisma for the entrypoint script (pinned to match project version)
RUN npm install -g prisma@6.19.1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy entrypoint script
COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set ownership of app directory
RUN chown -R nextjs:nodejs /app

# Note: We run as root because:
# 1. Docker socket access requires root
# 2. Mounted volumes (/data/core, /data/projects) are created as root
# In a more secure setup, you could use rootless Docker or adjust volume permissions

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application using entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
