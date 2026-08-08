import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quorum · sesión deliberante",
  description:
    "Una sesión de agente que varias personas ven en vivo. El agente decide cuándo hablar según quién esté mirando.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
