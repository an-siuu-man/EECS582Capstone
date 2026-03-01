/**
 * Artifact: webapp/src/app/layout.tsx
 * Purpose: Defines the global Next.js App Router root layout, shared fonts, and theme provider wiring for all routes.
 * Author: Ansuman Sharma
 * Created: 2026-02-09
 * Revised:
 * - 2026-03-01: Added standardized file-level prologue metadata and interface contracts. (Ansuman Sharma)
 * Preconditions:
 * - Executed by Next.js App Router runtime with valid React children and next/font support.
 * Inputs:
 * - Acceptable: `children` React node tree for route content.
 * - Unacceptable: Non-renderable children values that violate React rendering contracts.
 * Postconditions:
 * - Application HTML shell is rendered with configured typography and ThemeProvider context.
 * Returns:
 * - `RootLayout` returns JSX for the root document structure.
 * Errors/Exceptions:
 * - Font loading, hydration, or provider initialization issues may surface as runtime/render warnings or errors.
 */

import type { Metadata } from "next";
import { Quattrocento, Questrial } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const quattrocento = Quattrocento({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-heading",
});

const questrial = Questrial({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Headstart AI",
  description: "Your AI-powered assignment assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${quattrocento.variable} ${questrial.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
