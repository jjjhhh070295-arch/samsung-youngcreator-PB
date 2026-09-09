/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets local agents run an isolated preview without corrupting another
  // already-running Next dev server's .next directory. Vercel keeps `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
