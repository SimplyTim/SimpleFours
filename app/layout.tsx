import type { Metadata } from "next";
import FirebaseAnalytics from "@/components/FirebaseAnalytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimpleFours",
  description: "Play All Fours with friends."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  const saved = localStorage.getItem('simplefours:theme');
  const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
} catch {}
`
          }}
        />
      </head>
      <body>
        <FirebaseAnalytics />
        {children}
        <footer className="site-footer">
          {"Made by "}
          <a href="https://github.com/SimplyTim" target="_blank" rel="noreferrer">
            SimplyTim
          </a>
        </footer>
      </body>
    </html>
  );
}
