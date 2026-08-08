"use client";

/**
 * La identidad del usuario actual, leída de Clerk cuando está configurado.
 *
 * Los hooks de Clerk NO se pueden llamar condicionalmente, y sin
 * `<ClerkProvider>` arriba tiran error. Por eso hay dos implementaciones y se
 * elige UNA vez, al importar, según haya claves o no: React ve siempre la
 * misma secuencia de hooks.
 */

import { useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

import { ANONIMO, PLANTILLA_JWT, hayAuth, type Identidad } from "./identidad";

function useIdentidadClerk(): Identidad {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  /**
   * El token para Portal, con la plantilla si existe.
   *
   * La plantilla `portal` es la que agrega el claim `name`, y es lo que
   * convierte el nombre en verificado. Pero solo se puede crear en el panel
   * de Clerk, que exige haber reclamado la app — así que en una app keyless
   * todavía no existe y `getToken` con plantilla falla.
   *
   * Se cae al token de sesión por defecto: la identidad sigue siendo real y
   * verificada (el `sub` va firmado), solo que el nombre pasa a venir de la
   * metadata del cliente hasta que la plantilla exista.
   */
  const token = useCallback(async () => {
    try {
      const conPlantilla = await getToken({ template: PLANTILLA_JWT });
      if (conPlantilla) return conPlantilla;
    } catch {
      // Sin plantilla todavía. No es un error que valga la pena gritar: es
      // el estado normal de una app recién creada.
    }
    return getToken();
  }, [getToken]);

  return useMemo(() => {
    if (!isSignedIn) return ANONIMO;
    return {
      autenticado: true,
      nombre: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress,
      avatar: user?.imageUrl,
      token,
    };
  }, [isSignedIn, user, token]);
}

function useIdentidadAnonima(): Identidad {
  return ANONIMO;
}

export const useIdentidad: () => Identidad = hayAuth()
  ? useIdentidadClerk
  : useIdentidadAnonima;
