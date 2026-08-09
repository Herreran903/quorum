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
import { useCallback, useMemo, useRef } from "react";

import { ANONIMO, PLANTILLA_JWT, hayAuth, type Identidad } from "./identidad";

function useIdentidadClerk(): Identidad {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  /**
   * `getToken` y `user` cambian de identidad de objeto en cada emisión
   * interna de Clerk (foco de ventana, renovación de sesión). Todo lo que
   * dependa de ellos por referencia se rehace a cada rato — y la identidad
   * es dependencia del efecto que conecta el transporte y arranca el agente:
   * cada emisión derribaba la conexión y mataba al agente a mitad de turno,
   * con el turno ya pedido descartándose en silencio. Por eso acá TODO se
   * reduce a primitivos, y lo inestable vive en un ref.
   */
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

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
      const conPlantilla = await getTokenRef.current({ template: PLANTILLA_JWT });
      if (conPlantilla) return conPlantilla;
    } catch {
      // Sin plantilla todavía. No es un error que valga la pena gritar: es
      // el estado normal de una app recién creada.
    }
    return getTokenRef.current();
  }, []);

  const nombre = user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress;
  const avatar = user?.imageUrl;

  return useMemo(() => {
    if (!isSignedIn) return ANONIMO;
    return { autenticado: true, nombre, avatar, token };
  }, [isSignedIn, nombre, avatar, token]);
}

function useIdentidadAnonima(): Identidad {
  return ANONIMO;
}

export const useIdentidad: () => Identidad = hayAuth()
  ? useIdentidadClerk
  : useIdentidadAnonima;
