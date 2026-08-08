import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import { hayAuth } from "@/lib/identidad";
import "./globals.css";

export const metadata: Metadata = {
  title: "La sala · sesión de agente compartida",
  description:
    "Un agente de IA trabaja dentro de un chat que el equipo entero ve en vivo, redirige y puede traspasarse sin perder contexto.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const html = (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );

  // Sin claves no se monta el proveedor: los hooks de Clerk fallan sin él,
  // pero `useIdentidad` ya eligió la versión anónima. Ver `identidad.ts`.
  if (!hayAuth()) return html;

  return (
    <ClerkProvider
      appearance={{
        // Que el login no aparezca en blanco sobre una app oscura.
        variables: {
          colorBackground: "#131318",
          colorPrimary: "#7dd3c0",
          colorPrimaryForeground: "#0b0b0f",
          colorForeground: "#ececf1",
          colorNeutral: "#9a9aa8",
        },
      }}
    >
      {html}
    </ClerkProvider>
  );
}
