/**
 * El middleware de Clerk, pero solo si Clerk está configurado.
 *
 * `clerkMiddleware()` revienta sin claves, y eso dejaría la app entera caída
 * mientras no haya cuenta. Sin claves se devuelve algo que no hace nada y la
 * sala corre en anónimo. Ver `identidad.ts`.
 *
 * El archivo se llama `proxy` y no `middleware`: Next 16 renombró la
 * convención y avisa en cada build si se usa la vieja.
 */

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const configurado = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const proxy = configurado ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Todo menos los estáticos de Next y los archivos con extensión.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
