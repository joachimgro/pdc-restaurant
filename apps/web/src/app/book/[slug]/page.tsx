import { Suspense } from "react";
import BookClient from "./BookClient";
import "../book.css";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="book-page">
          <main className="book-shell">
            <div className="book-loading">
              <div className="book-spinner" aria-hidden />
              <p>Loading…</p>
            </div>
          </main>
        </div>
      }
    >
      <BookClient />
    </Suspense>
  );
}
