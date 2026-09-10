import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Supabase Multitenant — Postgres for every team and every project",
  description:
    "Self-hosted platform: organizations, projects and a dedicated Supabase stack (Postgres, Auth, Storage, Realtime) per project.",
  icons: {
    icon: '/supabase-multitenant-logo-transparent.png',
    shortcut: '/supabase-multitenant-logo-transparent.png',
    apple: '/supabase-multitenant-logo-transparent.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Apply the stored theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t?t==='dark':true)}catch(e){}`,
          }}
        />
      </head>
      <body className={`${interTight.variable} ${jetbrainsMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
