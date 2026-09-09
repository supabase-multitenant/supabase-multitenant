#!/bin/sh
set -e

# Wait for the database to be ready
# (Optional: we can rely on Docker Compose healthcheck, but a quick check here is good)

echo "Starting Supabase Multitenant..."

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set."
  exit 1
fi

# Run database migrations
echo "Running database migrations..."
# We use db push for now to ensure schema is in sync. 
# --skip-generate is needed because the client was already generated during build,
# and the nextjs user doesn't have write permissions to regenerate it.
npx prisma db push --accept-data-loss --skip-generate

# Execute the main command
echo "Starting application..."
exec "$@"
