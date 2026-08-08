import { SignIn } from "@clerk/nextjs";

/**
 * Página de inicio de sesión.
 *
 * La sala usa el modal (`SignInButton mode="modal"`), así que casi nunca se
 * llega acá — existe porque Clerk redirige a esta ruta en flujos que no puede
 * resolver en un modal, como volver de un proveedor OAuth.
 */
export default function PaginaEntrar() {
  return (
    <main className="sala-raiz flex min-h-dvh items-center justify-center px-4">
      <SignIn />
    </main>
  );
}
