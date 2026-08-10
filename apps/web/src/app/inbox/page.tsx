export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import { InboxPage } from "@/components/inbox/InboxPage";

export default function InboxRoute() {
  return (
    <Suspense fallback={<div className="loading-screen">Loading…</div>}>
      <InboxPage />
    </Suspense>
  );
}
