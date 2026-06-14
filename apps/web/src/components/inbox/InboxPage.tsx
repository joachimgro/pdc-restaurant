"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { fetchAuthMe } from "@/lib/api/client";
import { useInboxStore } from "@/store/inbox-store";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";
import { NavRail } from "./NavRail";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { LeadsPanel } from "./LeadsPanel/LeadsPanel";
import { ConversationPanel } from "./ConversationPanel/ConversationPanel";
import { ProfilePanel } from "./ProfilePanel/ProfilePanel";
import { SettingsWorkspace } from "./SettingsWorkspace";
import {
  type AppSection,
  parseAppSection,
  parseSettingsArea,
} from "./app-section";

export function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const init = useInboxStore((s) => s.init);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [section, setSection] = useState<AppSection>("inbox");
  const settingsArea =
    parseSettingsArea(searchParams.get("tab")) ??
    (searchParams.get("view") === "admin" ? "demo" : undefined);

  const handleSectionChange = useCallback(
    (next: AppSection) => {
      setSection(next);
      setProfileOpen(false);
      const url =
        next === "inbox" ? "/inbox" : `/inbox?view=${next}`;
      router.replace(url, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const fromUrl = parseAppSection(searchParams.get("view"));
    if (fromUrl) setSection(fromUrl);
  }, [searchParams]);

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

  if (loading && section === "inbox") {
    return <div className="loading-screen">Loading leads…</div>;
  }

  if (error && section === "inbox") {
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

  const showProfile = section === "inbox" && profileOpen;

  return (
    <>
      <div className="desktop-only-banner">
        <p>
          Lead Intake is designed for desktop (1200px+). Please use a larger
          screen for the demo.
        </p>
      </div>
      <div className="inbox-shell">
        <div
          className={`inbox-app${showProfile ? "" : " inbox-app--profile-hidden"}`}
        >
          <NavRail
            staffUser={staffUser}
            activeSection={section}
            onSectionChange={handleSectionChange}
          />
          {section === "inbox" && (
            <>
              <LeadsPanel />
              <ConversationPanel
                profileOpen={profileOpen}
                onToggleProfile={() => setProfileOpen((v) => !v)}
              />
              {showProfile && (
                <ProfilePanel onClose={() => setProfileOpen(false)} />
              )}
            </>
          )}
          {section === "settings" && (
            <SettingsWorkspace
              staffUser={staffUser}
              initialArea={settingsArea}
            />
          )}
          {section === "knowledge" && <KnowledgeWorkspace />}
        </div>
      </div>
    </>
  );
}
