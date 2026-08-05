import { Suspense } from "react";
import BookClient from "./BookClient";
import "./book.css";

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
