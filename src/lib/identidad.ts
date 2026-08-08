/**
 * Quién sos, y cómo se lo demostramos a Portal.
 *
 * Toda la app habla con `Identidad` y nunca con Clerk directamente — mismo
 * patrón que `transporte.ts`. Eso permite lo importante: **Clerk es
 * opcional**. Sin claves configuradas la sala sigue corriendo en anónimo con
 * apodos generados, y el día que las claves aparecen los perfiles pasan a ser
 * reales sin tocar la UI.
 *
 * Cuando hay sesión, el nombre que ve el resto NO sale de acá: sale del
 * `username` que Portal extrae del token firmado y publica en la presencia
 * (ver `claimMap` en `portal.config.ts`). Nadie puede decir que se llama otra
 * cosa.
 */

/** El nombre de la plantilla JWT que hay que crear en el panel de Clerk. */
export const PLANTILLA_JWT = "portal";

export interface Identidad {
  /** hay sesión iniciada y verificada */
  autenticado: boolean;
  /** nombre para mostrar; `undefined` en anónimo */
  nombre?: string;
  /** URL de la foto de perfil, si el proveedor la da */
  avatar?: string;
  /**
   * Devuelve el token para Portal, o `null` en anónimo.
   *
   * Es una función y no un string porque el token caduca: Portal la vuelve a
   * llamar cuando lo necesita. Ver `Portal.setToken` en el SDK.
   */
  token?: () => Promise<string | null>;
}

/** Anónimo: sin sesión, sin token. Es el modo en que corre sin claves. */
export const ANONIMO: Identidad = { autenticado: false };

/**
 * ¿Está Clerk configurado en este despliegue?
 *
 * Se lee la clave publicable, que es la única que existe en el navegador. La
 * secreta jamás sale del servidor.
 */
export function hayAuth(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
