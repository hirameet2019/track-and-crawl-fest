"use client";

import { useEffect, useState } from "react";
import { getSignedUrl, type PrivateBucket } from "@/app/actions/admin";

/** Thumbnail for an object in a private bucket; staff-only signed URL fetched on mount. Click opens full size. */
export function SignedImage({ bucket, path, alt, className = "h-16 w-24 rounded-lg object-cover" }: { bucket: PrivateBucket; path: string | null | undefined; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (path) getSignedUrl(bucket, path).then(setUrl);
  }, [bucket, path]);
  if (!path) return <span className="text-xs text-zinc-500">-</span>;
  if (!url) return <div className={`animate-pulse bg-white/10 ${className}`} />;
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full size" className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className={`border border-white/10 ${className}`} />
    </a>
  );
}
