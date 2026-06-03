"use client";

import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox-store";
import { LocationRail } from "./LocationRail";
import { LeadsPanel } from "./LeadsPanel/LeadsPanel";
import { ConversationPanel } from "./ConversationPanel/ConversationPanel";
import { ProfilePanel } from "./ProfilePanel/ProfilePanel";

export function InboxPage() {
  const init = useInboxStore((s) => s.init);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);

  useEffect(() => {
    void init();
    return () => {
      useInboxStore.getState().sseCleanup?.();
    };
  }, [init]);

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
