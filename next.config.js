/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  // Note: This is ignored during development (npm run dev)
  output: 'standalone',

  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config) => {
    // Exclude supabase directories from build
    config.module.rules.push({
      test: /\.tsx?$/,
      exclude: [/supabase-core/, /supabase-projects/],
    })
    return config
  },
}

module.exports = nextConfig