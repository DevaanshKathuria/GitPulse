import Link from "next/link";
import type { ReactNode } from "react";
import "reactflow/dist/style.css";
import "./globals.css";

export const metadata = {
  title: "GitPulse",
  description: "Repository intelligence dashboard"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-background text-foreground">
          <header className="border-b border-slate-800 bg-slate-950/80">
            <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
              <Link href="/repos" className="text-lg font-semibold text-sky-200">
                GitPulse
              </Link>
              <div className="flex gap-4 text-sm text-slate-300">
                <Link href="/repos" className="hover:text-slate-100">
                  Repositories
                </Link>
                <a href="http://localhost:3001/metrics" className="hover:text-slate-100">
                  Metrics
                </a>
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
