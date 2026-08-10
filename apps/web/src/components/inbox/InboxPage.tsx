"use client";

import "@/plugins/index"; // Load plugin registry — must be first
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { getPlugin } from "@/plugins/registry";
import { fetchAuthMe } from "@/lib/api/client";
import { useInboxStore } from "@/store/inbox-store";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";
import { NavRail } from "./NavRail";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { LeadsPanel } from "./LeadsPanel/LeadsPanel";
import { ConversationPanel } from "./ConversationPanel/ConversationPanel";
import { ProfilePanel } from "./ProfilePanel/ProfilePanel";
import { GuestsPanel } from "./GuestsPanel/GuestsPanel";
import { GuestConversationPanel } from "./GuestsPanel/GuestConversationPanel";
import { SettingsWorkspace } from "./SettingsWorkspace";
import {
  type AppSection,
  parseAppSection,
  parseSettingsArea,
  consoleViewFromParam,
} from "./app-section";

type InboxMode = "leads" | "guests";

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
  const [inboxMode, setInboxMode] = useState<InboxMode>("leads");
  const [activeGuestThreadId, setActiveGuestThreadId] = useState<string | null>(
    null
  );
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
    if (searchParams.get("inbox") === "guests") {
      setInboxMode("guests");
    }
    const consoleView = consoleViewFromParam(
      searchParams.get("view"),
      searchParams.get("tab")
    );
    if (consoleView) {
      void import("@/plugins/service/store/service-console-store").then(
        ({ useServiceConsole }) => {
          useServiceConsole.getState().setView(consoleView);
        }
      );
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
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
      } catch {
        if (!cancelled) router.replace("/login?error=session");
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

  if (loading && section === "inbox" && inboxMode === "leads") {
    return <div className="loading-screen">Loading leads…</div>;
  }

  if (error && section === "inbox" && inboxMode === "leads") {
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

  const showProfile = section === "inbox" && profileOpen && inboxMode === "leads";

  return (
    <>
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
              <div className="inbox-mode-col">
                <div className="inbox-mode-tabs" role="tablist" aria-label="Inbox">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inboxMode === "leads"}
                    className={`inbox-mode-tab${inboxMode === "leads" ? " is-active" : ""}`}
                    onClick={() => {
                      setInboxMode("leads");
                      router.replace("/inbox", { scroll: false });
                    }}
                  >
                    Leads
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inboxMode === "guests"}
                    className={`inbox-mode-tab${inboxMode === "guests" ? " is-active" : ""}`}
                    onClick={() => {
                      setInboxMode("guests");
                      setProfileOpen(false);
                      router.replace("/inbox?inbox=guests", { scroll: false });
                    }}
                  >
                    Guests
                  </button>
                </div>
                {inboxMode === "leads" ? (
                  <LeadsPanel />
                ) : (
                  <GuestsPanel
                    activeThreadId={activeGuestThreadId}
                    onSelect={setActiveGuestThreadId}
                  />
                )}
              </div>
              {inboxMode === "leads" ? (
                <>
                  <ConversationPanel
                    profileOpen={profileOpen}
                    onToggleProfile={() => setProfileOpen((v) => !v)}
                  />
                  {showProfile && (
                    <ProfilePanel onClose={() => setProfileOpen(false)} />
                  )}
                </>
              ) : (
                <GuestConversationPanel threadId={activeGuestThreadId} />
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
          {/* Plugin workspaces */}
          {(() => {
            const plugin = getPlugin(section);
            if (!plugin) return null;
            const Workspace = plugin.Workspace;
            return <Workspace />;
          })()}
        </div>
      </div>
    </>
  );
}
