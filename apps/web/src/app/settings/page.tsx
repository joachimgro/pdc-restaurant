import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/inbox?view=settings");
}
