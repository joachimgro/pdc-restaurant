"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Stage = "form" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`${API_URL}/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.status === 429) {
        const data = (await res.json()) as { error?: string };
        setErrorMsg(data.error ?? "Too many requests. Please wait a moment.");
        setStage("error");
        return;
      }

      // Always show "sent" even if email not found (prevents enumeration)
      setStage("sent");
    } catch {
      setErrorMsg("Something went wrong. Please check your connection and try again.");
      setStage("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">PDC</div>

        {stage === "form" && (
          <>
            <h1 className="login-title">Sign in</h1>
            <p className="login-subtitle">
              Enter your email and we'll send you a sign-in link.
            </p>
            <form onSubmit={(e) => void handleSubmit(e)} className="login-form">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                className="login-input"
                autoFocus
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="login-button"
              >
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          </>
        )}

        {stage === "sent" && (
          <div className="login-sent">
            <div className="login-sent-icon">✉</div>
            <h1 className="login-title">Check your email</h1>
            <p className="login-subtitle">
              If <strong>{email}</strong> is registered, you'll receive a sign-in link shortly.
              The link expires in 15 minutes.
            </p>
            <button
              className="login-back"
              onClick={() => {
                setStage("form");
                setErrorMsg("");
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        {stage === "error" && (
          <div className="login-error-state">
            <h1 className="login-title">Couldn't send link</h1>
            <p className="login-subtitle login-error-text">{errorMsg}</p>
            <button
              className="login-back"
              onClick={() => {
                setStage("form");
                setErrorMsg("");
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
