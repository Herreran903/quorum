import { SignUp } from "@clerk/nextjs";

/** El par de `sign-in`: mismo motivo para existir. */
export default function PaginaRegistro() {
  return (
    <main className="sala-raiz flex min-h-dvh items-center justify-center px-4">
      <SignUp />
    </main>
  );
}
