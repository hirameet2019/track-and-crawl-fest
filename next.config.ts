import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Payment screenshots from phones are commonly 2-6 MB. The proof form also
      // downscales images client-side before upload; this is the hard ceiling.
      bodySizeLimit: "10mb",
    },
  },
  // The PDF generator reads these from disk at runtime (fs.readFile), which the
  // bundler cannot see. Include them in every serverless function bundle.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/pdf/fonts/**", "./src/lib/pdf/logo-pdf.png", "./public/poster-1x.jpg"],
  },
};

export default nextConfig;
