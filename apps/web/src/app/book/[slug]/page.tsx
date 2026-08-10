import { Suspense } from "react";
import type { Metadata } from "next";
import BookClient from "./BookClient";
import "../book.css";

export const metadata: Metadata = {
  title: "Book a table · The Test Kitchen",
  description: "Reserve a table online",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="book-shell">
          <p className="book-muted">Loading…</p>
        </main>
      }
    >
      <BookClient />
    </Suspense>
  );
}
