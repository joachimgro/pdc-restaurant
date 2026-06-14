"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { requestMagicLink } from "@/lib/api/client";

export function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const errorMessages: Record<string, string> = {
    missing_token: "Sign-in link was incomplete. Request a new one.",
    invalid_token: "That sign-in link has expired or was already used.",
    not_invited:
      "This email is not on the team list yet. Ask your admin for an invite.",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("sending");
    setMessage(null);
    setDevLink(null);
    try {
      const result = await requestMagicLink(trimmed);
      setStatus("sent");
      setMessage("Check your email for a sign-in link.");
      if (result.devVerifyUrl) {
        setDevLink(result.devVerifyUrl);
        setMessage("Dev mode: use the link below to sign in.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not send link");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">L</div>
        <h1 className="login-title">Lead Intake</h1>
        <p className="login-subtitle">
          Sign in with your work email to manage leads and leave team notes.
        </p>

        {errorParam && (
          <p className="login-error">
            {errorMessages[errorParam] ?? "Sign-in failed. Try again."}
          </p>
        )}

        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="login-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="login-input"
            placeholder="you@academy.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "sending"}
            autoComplete="email"
            required
          />
          <button
            type="submit"
            className="btn-primary login-submit"
            disabled={status === "sending" || !email.trim()}
          >
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
        </form>

        {message && (
          <p className={status === "error" ? "login-error" : "login-success"}>
            {message}
          </p>
        )}

        {devLink && (
          <a className="login-dev-link" href={devLink}>
            Open dev sign-in link
          </a>
        )}
      </div>
    </div>
  );
}
