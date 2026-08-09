"use client";

/**
 * El control de sesión de la cabecera y la puerta de entrada.
 *
 * Igual que `useIdentidad`, se resuelve UNA vez al importar: los componentes
 * de Clerk necesitan `<ClerkProvider>` arriba, y sin claves ese proveedor no
 * se monta. Sin Clerk esto no dibuja nada y la sala corre en anónimo.
 *
 * Se usa `useAuth()` y no `<SignedIn>` / `<SignedOut>`: esos componentes
 * existían hasta Clerk 6 y ya no se exportan en la 7.
 */

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";

import { hayAuth } from "@/lib/identidad";

function Boton({ ancho }: { ancho?: boolean }) {
  /**
   * Tras autenticarse hay que volver A ESTA sala, dicho explícito. Sin esto,
   * los flujos que navegan (OAuth, registro de un usuario nuevo — o sea, el
   * recién llegado con link compartido) caen al fallback global "/"… y la
   * portada inventa una sala nueva vacía. "Entré y no vi nada", medido.
   */
  const ruta = usePathname();
  return (
    <SignInButton mode="modal" forceRedirectUrl={ruta} signUpForceRedirectUrl={ruta}>
      <button
        className={
          ancho
            ? "mt-5 w-full rounded-xl bg-acento px-4 py-3 text-[14px] font-semibold text-noche transition-opacity hover:opacity-90"
            : "shrink-0 rounded-lg border border-acento/40 bg-acento-hondo px-3 py-1.5 text-[12px] font-medium text-acento transition-colors hover:border-acento"
        }
      >
        Iniciar sesión
      </button>
    </SignInButton>
  );
}

function ControlClerk() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? (
    <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
  ) : (
    <Boton />
  );
}

export const ControlSesion = hayAuth() ? ControlClerk : () => null;

/**
 * La puerta: sin sesión no se entra.
 *
 * Solo aplica cuando Clerk está configurado — el canal pasa a
 * `anonymous: false`, así que sin token Portal rechaza la conexión y la sala
 * quedaría en blanco sin explicar por qué.
 */
function PuertaClerk({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  // Mientras Clerk resuelve la sesión no se decide nada: mostrar la puerta
  // acá haría parpadear el login a quien ya está adentro.
  if (!isLoaded) {
    // El cascarón va con una señal de vida: una pantalla negra y muda de
    // varios segundos —lo que tarda Clerk— se lee como una app rota, y es lo
    // primero que ve quien abre el link.
    return (
      <main className="sala-raiz flex min-h-dvh items-center justify-center px-4" aria-busy="true">
        <p className="text-[13px] text-tinta-baja">Entrando a la sala…</p>
      </main>
    );
  }

  if (isSignedIn) return <>{children}</>;

  return (
    <main className="sala-raiz flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-[20px] font-semibold tracking-tight text-tinta">
          Entrá para sumarte a la sala
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-tinta-media">
          El equipo necesita saber quién pidió qué. Tu nombre y tu foto salen de tu cuenta.
        </p>
        <Boton ancho />
      </div>
    </main>
  );
}

export const Puerta = hayAuth()
  ? PuertaClerk
  : ({ children }: { children: React.ReactNode }) => <>{children}</>;
