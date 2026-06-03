"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useInboxStore } from "@/store/inbox-store";
import { getSession } from "@/lib/auth";
import { logout } from "@/lib/api/admin";
import { LocationRail } from "./LocationRail";
import { LeadsPanel } from "./LeadsPanel/LeadsPanel";
import { ConversationPanel } from "./ConversationPanel/ConversationPanel";
import { ProfilePanel } from "./ProfilePanel/ProfilePanel";

export function InboxPage() {
  const router = useRouter();
  const init = useInboxStore((s) => s.init);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);

  const [email, setEmail] = useState<string | null>(null);

  // Auth guard — redirect to /login if no session
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setEmail(session.email);
    void init();
    return () => {
      useInboxStore.getState().sseCleanup?.();
    };
  }, [init, router]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  if (loading || email === null) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (error) {
    return (
      <div className="loading-screen">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="desktop-only-banner">
        <p>
          Lead Intake is designed for desktop (1200px+). Please use a larger
          screen.
        </p>
      </div>
      <div className="inbox-shell">
        <div className="auth-bar">
          <span className="auth-bar-email">{email}</span>
          <button
            className="auth-bar-logout"
            onClick={() => void handleLogout()}
          >
            Sign out
          </button>
        </div>
        <div className="inbox-app">
          <LocationRail />
          <LeadsPanel />
          <ConversationPanel />
          <ProfilePanel />
        </div>
      </div>
    </>
  );
}
