/**
 * La única superficie de red que conoce el resto de la app.
 *
 * Ni la UI ni la política ni el simulador importan `@portalsdk/*`. Hablan con
 * esta interfaz. Hay dos implementaciones:
 *
 *  - `transporte-mock.ts`   BroadcastChannel + localStorage, sin red.
 *  - `transporte-portal.ts` Portal de verdad.
 *
 * Cambiar de una a otra es una línea en `crearTransporte()` (abajo).
 */

import type { Cuerpo, Sobre } from "./protocolo";

export type Desuscribir = () => void;

/** Un espectador de la sala. */
export interface Espectador {
  id: string;
  /** true si el transporte reporta que está escribiendo ahora. */
  escribiendo: boolean;
  /**
   * Epoch ms hasta el cual vale `escribiendo`, si el transporte lo sabe.
   *
   * Existe por un fallo concreto: en una pestaña de segundo plano el navegador
   * throttlea `setInterval` a ~1/min, así que el mock deja de recalcular la
   * presencia y `escribiendo` se queda pegado en `true`. Si el consumidor
   * recalcula contra el reloj al leer, el agente no se queda mudo para siempre.
   *
   * Portal no lo necesita — expira el `typing` en el servidor y empuja el
   * cambio por WebSocket, que no se throttlea — y lo deja `undefined`.
   */
  escribiendoHasta?: number;
  /**
   * Nombre real, VERIFICADO: lo saca Portal del token firmado según
   * `claimMap.username` y lo publica en la presencia. El cliente no lo
   * declara, así que nadie puede hacerse pasar por otro. Ausente en anónimo.
   */
  nombre?: string;
  /**
   * Foto de perfil. Esta sí la declara el propio cliente (viaja como
   * metadata), así que es presentación y nunca identidad.
   */
  avatar?: string;
  /** true si conectó sin sesión iniciada. */
  anonimo?: boolean;
  /** true cuando este espectador soy yo. */
  soyYo: boolean;
}

/**
 * Estado de la sala.
 *
 * OJO: Portal puede entregar presencia en modo `aggregate` (solo un conteo,
 * sin lista de participantes) en canales grandes. Por eso `total` es siempre
 * confiable y `espectadores` puede venir vacío aunque `total > 0`.
 * `detallada` dice cuál de los dos casos es.
 */
export interface Presencia {
  /** cuánta gente hay conectada, incluyéndome. */
  total: number;
  /** lista de participantes; vacía si el transporte solo da conteo. */
  espectadores: Espectador[];
  detallada: boolean;
}

export const PRESENCIA_VACIA: Presencia = {
  total: 0,
  espectadores: [],
  detallada: true,
};

/**
 * ¿Hay alguien distinto de mí escribiendo, AHORA?
 *
 * Recalcula contra el reloj en vez de confiar en el último booleano recibido.
 * Es lo que consulta la política, y por lo tanto lo que decide si el agente
 * se calla. Ver `Espectador.escribiendoHasta`.
 */
export function alguienEscribe(p: Presencia, ahora = Date.now()): boolean {
  return p.espectadores.some((e) => {
    if (e.soyYo) return false;
    return e.escribiendoHasta === undefined
      ? e.escribiendo
      : e.escribiendoHasta > ahora;
  });
}

/**
 * Cuánta gente hay aparte de mí.
 *
 * Con presencia agregada Portal no manda lista, solo un conteo: de ahí que
 * haya dos caminos.
 */
export function otrosEn(p: Presencia): number {
  return p.detallada
    ? p.espectadores.filter((e) => !e.soyYo).length
    : Math.max(0, p.total - 1);
}

/** Cómo va la conexión. Superset mínimo común entre mock y Portal. */
export type EstadoConexion =
  | "conectando"
  | "listo"
  | "reconectando"
  | "degradado"
  | "bloqueado";

export interface Transporte {
  /** mi id en este canal. `undefined` hasta que la conexión esté lista. */
  readonly yo: string | undefined;
  readonly estado: EstadoConexion;

  /** Publica un mensaje. Todo lo publicado queda en la historia del canal. */
  publicar(cuerpo: Cuerpo): Promise<void>;

  /**
   * Escucha mensajes. Al suscribirte recibes primero la historia persistente
   * que ya existía (igual que el backfill de Portal), y después lo vivo.
   */
  suscribir(escucha: (sobre: Sobre) => void): Desuscribir;

  /** Escucha la presencia. Emite el estado actual de inmediato. */
  presencia(escucha: (p: Presencia) => void): Desuscribir;

  /** Escucha cambios de estado de conexión. Emite el actual de inmediato. */
  conexion(escucha: (e: EstadoConexion) => void): Desuscribir;

  /**
   * Señal de "estoy escribiendo". Se llama en cada tecla; el transporte
   * hace throttle. Es lo que hace que el agente se calle y espere.
   */
  escribiendo(): void;

  desconectar(): void;
}

export type ClaseTransporte = "portal" | "mock";

export interface OpcionesTransporte {
  canalId: string;
  /** metadatos de presencia iniciales (avatar, …). Presentación, nunca identidad. */
  metadata?: Record<string, unknown>;
  /**
   * De dónde sale el token de sesión para Portal.
   *
   * Es una función y no un string porque el token caduca y el SDK la vuelve a
   * llamar. `undefined` — o una que devuelva `null` — es modo anónimo: el SDK
   * acuña su propia credencial estable.
   */
  token?: () => Promise<string | null>;
  /**
   * Fuerza una implementación, ignorando la llave.
   *
   * Existe para el demo: si Portal falla en vivo, `?transporte=mock` deja la
   * sesión funcionando entre pestañas sin tocar código ni reiniciar nada.
   */
  forzar?: ClaseTransporte;
}

/**
 * Punto único de cambio mock ↔ Portal.
 *
 * Mientras no haya API key, `NEXT_PUBLIC_PORTAL_API_KEY` está vacía y todo
 * corre sobre BroadcastChannel. Cuando llegue la llave, se pone en `.env.local`
 * y esta función devuelve el transporte real sin tocar nada más.
 */
export async function crearTransporte(
  opciones: OpcionesTransporte,
): Promise<Transporte> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_API_KEY;

  if (opciones.forzar !== "mock" && apiKey) {
    const { TransportePortal } = await import("./transporte-portal");
    return new TransportePortal(opciones, apiKey);
  }

  const { TransporteMock } = await import("./transporte-mock");
  return new TransporteMock(opciones);
}

/** Para pintar en la UI qué transporte está activo. Sin secretos. */
export function transporteActivo(forzar?: ClaseTransporte): ClaseTransporte {
  if (forzar === "mock") return "mock";
  return process.env.NEXT_PUBLIC_PORTAL_API_KEY ? "portal" : "mock";
}

/** Lee `?transporte=mock` de la URL. Solo en el navegador. */
export function transporteDeLaUrl(): ClaseTransporte | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("transporte");
  return v === "mock" || v === "portal" ? v : undefined;
}
