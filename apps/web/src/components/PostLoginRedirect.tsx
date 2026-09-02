"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "post_login_next";

function isSafeNextPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** After magic-link verify lands on /inbox, honour a stored post-login path. */
export function PostLoginRedirect() {
  const router = useRouter();

  useEffect(() => {
    try {
      const next = sessionStorage.getItem(STORAGE_KEY);
      if (!next || !isSafeNextPath(next)) return;
      sessionStorage.removeItem(STORAGE_KEY);
      router.replace(next);
    } catch {
      // ignore storage errors
    }
  }, [router]);

  return null;
}

export function storePostLoginNext(next: string | null) {
  if (!next || !isSafeNextPath(next)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
}
