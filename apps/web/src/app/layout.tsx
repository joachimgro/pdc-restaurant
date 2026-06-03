import type { Metadata } from "next";
import "./globals.css";

// TODO: update title and description to match the client's brand
export const metadata: Metadata = {
  title: "Lead Intake",
  description: "AI-powered lead intake",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
