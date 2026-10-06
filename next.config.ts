import type { NextConfig } from "next";
import { BRAND } from "./src/config/site";

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
  // The logo and banner paths come from src/config/site.ts.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/pdf/fonts/**", `./${BRAND.pdf.logo}`, `./${BRAND.pdf.banner}`],
  },
};

export default nextConfig;
