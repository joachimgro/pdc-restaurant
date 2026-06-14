import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading-screen">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
