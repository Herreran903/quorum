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

import { hayAuth } from "@/lib/identidad";

function Boton({ ancho }: { ancho?: boolean }) {
  return (
    <SignInButton mode="modal">
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
    return <main className="sala-raiz" aria-busy="true" />;
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
