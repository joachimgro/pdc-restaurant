"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { fetchAuthMe } from "@/lib/api/client";
import { useInboxStore } from "@/store/inbox-store";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { LocationRail } from "./LocationRail";
import { LeadsPanel } from "./LeadsPanel/LeadsPanel";
import { ConversationPanel } from "./ConversationPanel/ConversationPanel";
import { ProfilePanel } from "./ProfilePanel/ProfilePanel";

export function InboxPage() {
  const router = useRouter();
  const init = useInboxStore((s) => s.init);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await fetchAuthMe();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setStaffUser(user);
      setAuthChecked(true);
      if (!user.needsProfile) {
        await init();
      }
    })();
    return () => {
      cancelled = true;
      useInboxStore.getState().sseCleanup?.();
    };
  }, [init, router]);

  async function handleProfileComplete(user: StaffUser) {
    setStaffUser(user);
    await init();
  }

  if (!authChecked) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (staffUser?.needsProfile) {
    return (
      <ProfileOnboarding
        user={staffUser}
        onComplete={(user) => void handleProfileComplete(user)}
      />
    );
  }

  if (loading) {
    return <div className="loading-screen">Loading leads…</div>;
  }

  if (error) {
    return (
      <div className="loading-screen">
        <p>{error}</p>
        <p style={{ marginTop: 8, fontSize: 12 }}>
          Start the API: <code>pnpm dev:worker</code> then{" "}
          <code>pnpm db:migrate:local && curl -X POST http://localhost:8787/admin/seed</code>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="desktop-only-banner">
        <p>
          Lead Intake is designed for desktop (1200px+). Please use a larger
          screen for the demo.
        </p>
      </div>
      <div className="inbox-shell">
        <div className={`inbox-app${profileOpen ? "" : " inbox-app--profile-hidden"}`}>
          <LocationRail staffUser={staffUser} />
          <LeadsPanel />
          <ConversationPanel
            profileOpen={profileOpen}
            onToggleProfile={() => setProfileOpen((v) => !v)}
          />
          {profileOpen && (
            <ProfilePanel onClose={() => setProfileOpen(false)} />
          )}
        </div>
      </div>
    </>
  );
}
