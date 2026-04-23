export function getCurrentDbName(): string {
  try {
    const { hostname, pathname } = new URL(process.env.MONGODB_URI!)
    return hostname + pathname
  } catch {
    return 'none'
  }
}

export function getCurrentHostname(): string {
  try {
    return process.env.NEXT_PUBLIC_SERVER_URL
      ? new URL(process.env.NEXT_PUBLIC_SERVER_URL).hostname
      : (process.env.VERCEL_URL ?? 'none')
  } catch {
    return process.env.VERCEL_URL! || 'none'
  }
}
