"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setSession } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Stage = "verifying" | "success" | "error";

export default function VerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [stage, setStage] = useState<Stage>("verifying");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setErrorMsg("No sign-in token found in the URL. The link may be malformed.");
      setStage("error");
      return;
    }

    async function verify() {
      try {
        const res = await fetch(`${API_URL}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setErrorMsg(
            data.error ??
              "Invalid or expired link. Please request a new sign-in link."
          );
          setStage("error");
          return;
        }

        const data = (await res.json()) as { token: string; email: string };
        setSession(data.token, data.email);
        setStage("success");

        // Short delay so the user sees the success state, then redirect
        setTimeout(() => {
          router.replace("/inbox");
        }, 800);
      } catch {
        setErrorMsg("Something went wrong. Please try again.");
        setStage("error");
      }
    }

    void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">PDC</div>

        {stage === "verifying" && (
          <>
            <h1 className="login-title">Signing you in…</h1>
            <p className="login-subtitle">Just a moment.</p>
            <div className="login-spinner" />
          </>
        )}

        {stage === "success" && (
          <>
            <div className="login-sent-icon" style={{ color: "var(--green)" }}>✓</div>
            <h1 className="login-title">Signed in</h1>
            <p className="login-subtitle">Redirecting you now…</p>
          </>
        )}

        {stage === "error" && (
          <>
            <h1 className="login-title">Link invalid</h1>
            <p className="login-subtitle login-error-text">{errorMsg}</p>
            <a href="/login" className="login-button" style={{ display: "inline-block", textAlign: "center" }}>
              Request a new link
            </a>
          </>
        )}
      </div>
    </div>
  );
}
