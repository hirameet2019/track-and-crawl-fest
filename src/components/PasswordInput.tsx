"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * Password field with a show/hide toggle. Drop-in for `<input type="password">`:
 * every prop is forwarded, so it works controlled (value/onChange) or
 * uncontrolled (name only, read from FormData). The toggle is a real button
 * with an aria-label and `aria-pressed`, and it never submits the form.
 */
export function PasswordInput({ className = "input", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-zinc-500 transition hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        {show ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4 10 7a11.7 11.7 0 0 1-3.2 4.3" />
            <path d="M6.6 6.6C4.2 8 2.7 10.2 2 12c1 3 5 7 10 7 1.5 0 2.9-.3 4.1-.9" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7S3 15 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
