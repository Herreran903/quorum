/**
 * Transporte mock: dos pestañas del mismo navegador se hablan sin red.
 *
 * Emula a propósito las dos cosas de Portal de las que depende la sala:
 *  1. mensajes con backfill al conectar (localStorage)
 *  2. presencia viva con "escribiendo" (latidos con expiración)
 *
 * Con esto se puede trabajar todo el fin de semana aunque Portal esté caído
 * o las llaves no lleguen nunca.
 */

import type { Cuerpo, Sobre } from "./protocolo";
import type {
  Desuscribir,
  EstadoConexion,
  Espectador,
  OpcionesTransporte,
  Presencia,
  Transporte,
} from "./transporte";

/** cada cuánto late cada pestaña */
const LATIDO_MS = 1000;
/** sin latido en este tiempo, la pestaña se da por ida */
const EXPIRA_MS = 3200;
/** cuánto dura la señal de "escribiendo" antes de apagarse sola */
const ESCRIBIENDO_MS = 1800;
/** throttle de `escribiendo()` para no inundar el canal */
const THROTTLE_ESCRIBIENDO_MS = 400;
/** tope de historia guardada, para no llenar localStorage */
const TOPE_HISTORIA = 500;

type Trama =
  | { clase: "msg"; sobre: Sobre }
  | {
      clase: "latido";
      id: string;
      at: number;
      escribiendoHasta: number;
      nombre?: string;
      avatar?: string;
    }
  | { clase: "adios"; id: string };

interface Vecino {
  id: string;
  visto: number;
  escribiendoHasta: number;
  nombre?: string;
  avatar?: string;
}

function nuevoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class TransporteMock implements Transporte {
  readonly yo: string;
  estado: EstadoConexion = "conectando";

  readonly #canalId: string;
  readonly #claveHistoria: string;
  readonly #bc: BroadcastChannel;

  readonly #escuchasMsg = new Set<(s: Sobre) => void>();
  readonly #escuchasPresencia = new Set<(p: Presencia) => void>();
  readonly #escuchasConexion = new Set<(e: EstadoConexion) => void>();

  readonly #vecinos = new Map<string, Vecino>();
  #escribiendoHasta = 0;
  #ultimoEscribiendoEnviado = 0;

  #latido: ReturnType<typeof setInterval> | undefined;
  #barrido: ReturnType<typeof setInterval> | undefined;
  #cerrado = false;

  /**
   * Nombre y foto propios.
   *
   * En Portal el nombre lo pone el servidor desde el token; acá no hay
   * servidor, así que se declara. Es lo correcto para un transporte de
   * desarrollo, pero significa que en mock el nombre NO está verificado.
   */
  readonly #nombre: string | undefined;
  readonly #avatar: string | undefined;

  constructor(opciones: OpcionesTransporte) {
    this.#canalId = opciones.canalId;
    this.#claveHistoria = `quorum:historia:${opciones.canalId}`;
    this.yo = nuevoId();
    const meta = opciones.metadata;
    this.#nombre = typeof meta?.nombre === "string" ? meta.nombre : undefined;
    this.#avatar = typeof meta?.avatar === "string" ? meta.avatar : undefined;
    this.#bc = new BroadcastChannel(`quorum:${opciones.canalId}`);

    this.#bc.onmessage = (ev: MessageEvent<Trama>) => this.#recibir(ev.data);

    this.#latido = setInterval(() => this.#emitirLatido(), LATIDO_MS);
    this.#barrido = setInterval(() => this.#barrer(), LATIDO_MS);

    // La conexión "abre" en el siguiente tick para que suscribir()/presencia()
    // alcancen a registrarse antes del primer evento, igual que con red real.
    setTimeout(() => {
      if (this.#cerrado) return;
      this.#cambiarEstado("listo");
      this.#emitirLatido();
      this.#emitirPresencia();
    }, 0);

    window.addEventListener("beforeunload", this.#despedirse);
  }

  // ---------------------------------------------------------------- publicar

  async publicar(cuerpo: Cuerpo): Promise<void> {
    const sobre: Sobre = {
      id: nuevoId(),
      emisor: this.yo,
      at: Date.now(),
      cuerpo,
    };

    this.#guardar(sobre);

    // BroadcastChannel no se entrega a sí mismo: reparto local a mano para
    // que el emisor vea su propio mensaje igual que lo verían los demás.
    this.#bc.postMessage({ clase: "msg", sobre } satisfies Trama);
    this.#repartir(sobre);
  }

  // --------------------------------------------------------------- suscribir

  suscribir(escucha: (sobre: Sobre) => void): Desuscribir {
    this.#escuchasMsg.add(escucha);

    // Backfill: la historia persistente antes que lo vivo.
    for (const sobre of this.#historia()) {
      try {
        escucha(sobre);
      } catch (e) {
        console.error("[transporte-mock] escucha falló en backfill", e);
      }
    }

    return () => {
      this.#escuchasMsg.delete(escucha);
    };
  }

  presencia(escucha: (p: Presencia) => void): Desuscribir {
    this.#escuchasPresencia.add(escucha);
    escucha(this.#presenciaActual());
    return () => {
      this.#escuchasPresencia.delete(escucha);
    };
  }

  conexion(escucha: (e: EstadoConexion) => void): Desuscribir {
    this.#escuchasConexion.add(escucha);
    escucha(this.estado);
    return () => {
      this.#escuchasConexion.delete(escucha);
    };
  }

  // ------------------------------------------------------------------ señales

  escribiendo(): void {
    this.#escribiendoHasta = Date.now() + ESCRIBIENDO_MS;
    const ahora = Date.now();
    if (ahora - this.#ultimoEscribiendoEnviado < THROTTLE_ESCRIBIENDO_MS) return;
    this.#ultimoEscribiendoEnviado = ahora;
    this.#emitirLatido();
    this.#emitirPresencia();
  }

  desconectar(): void {
    if (this.#cerrado) return;
    this.#cerrado = true;
    this.#despedirse();
    if (this.#latido) clearInterval(this.#latido);
    if (this.#barrido) clearInterval(this.#barrido);
    window.removeEventListener("beforeunload", this.#despedirse);
    this.#bc.close();
    this.#escuchasMsg.clear();
    this.#escuchasPresencia.clear();
    this.#escuchasConexion.clear();
  }

  // ------------------------------------------------------------------ interno

  #despedirse = () => {
    try {
      this.#bc.postMessage({ clase: "adios", id: this.yo } satisfies Trama);
    } catch {
      // el canal ya está cerrado; nada que hacer
    }
  };

  #recibir(trama: Trama): void {
    if (this.#cerrado) return;

    switch (trama.clase) {
      case "msg": {
        // Los persistentes ya los guardó el emisor en localStorage (mismo
        // origen), así que aquí solo se reparten.
        this.#repartir(trama.sobre);
        return;
      }
      case "latido": {
        this.#vecinos.set(trama.id, {
          id: trama.id,
          visto: Date.now(),
          escribiendoHasta: trama.escribiendoHasta,
          nombre: trama.nombre,
          avatar: trama.avatar,
        });
        this.#emitirPresencia();
        return;
      }
      case "adios": {
        if (this.#vecinos.delete(trama.id)) this.#emitirPresencia();
        return;
      }
    }
  }

  #repartir(sobre: Sobre): void {
    for (const escucha of this.#escuchasMsg) {
      try {
        escucha(sobre);
      } catch (e) {
        console.error("[transporte-mock] escucha falló", e);
      }
    }
  }

  #emitirLatido(): void {
    if (this.#cerrado) return;
    this.#bc.postMessage({
      clase: "latido",
      id: this.yo,
      at: Date.now(),
      escribiendoHasta: this.#escribiendoHasta,
      nombre: this.#nombre,
      avatar: this.#avatar,
    } satisfies Trama);
  }

  #barrer(): void {
    const limite = Date.now() - EXPIRA_MS;
    let cambio = false;
    for (const [id, v] of this.#vecinos) {
      if (v.visto < limite) {
        this.#vecinos.delete(id);
        cambio = true;
      }
    }
    // La señal de "escribiendo" caduca sola aunque no llegue otro latido.
    this.#emitirPresencia();
    if (cambio) this.#emitirLatido();
  }

  #presenciaActual(): Presencia {
    const ahora = Date.now();
    const yo: Espectador = {
      id: this.yo,
      escribiendo: this.#escribiendoHasta > ahora,
      escribiendoHasta: this.#escribiendoHasta,
      nombre: this.#nombre,
      avatar: this.#avatar,
      soyYo: true,
    };
    const otros: Espectador[] = [...this.#vecinos.values()]
      .filter((v) => v.visto >= ahora - EXPIRA_MS)
      .map((v) => ({
        id: v.id,
        escribiendo: v.escribiendoHasta > ahora,
        escribiendoHasta: v.escribiendoHasta,
        nombre: v.nombre,
        avatar: v.avatar,
        soyYo: false,
      }));

    const espectadores = [yo, ...otros];
    return { total: espectadores.length, espectadores, detallada: true };
  }

  #ultimaFirma = "";

  #emitirPresencia(): void {
    if (this.#cerrado) return;
    const p = this.#presenciaActual();
    const firma = JSON.stringify(p);
    if (firma === this.#ultimaFirma) return;
    this.#ultimaFirma = firma;
    for (const escucha of this.#escuchasPresencia) escucha(p);
  }

  #cambiarEstado(e: EstadoConexion): void {
    if (this.estado === e) return;
    this.estado = e;
    for (const escucha of this.#escuchasConexion) escucha(e);
  }

  // ----------------------------------------------------------- historia local

  #historia(): Sobre[] {
    try {
      const crudo = localStorage.getItem(this.#claveHistoria);
      if (!crudo) return [];
      const datos: unknown = JSON.parse(crudo);
      return Array.isArray(datos) ? (datos as Sobre[]) : [];
    } catch {
      return [];
    }
  }

  #guardar(sobre: Sobre): void {
    try {
      const historia = this.#historia();
      historia.push(sobre);
      localStorage.setItem(
        this.#claveHistoria,
        JSON.stringify(historia.slice(-TOPE_HISTORIA)),
      );
    } catch {
      // cuota llena o storage bloqueado: la sesión sigue viva, solo sin replay
    }
  }
}

/** Borra la historia de una sesión. Útil para reiniciar la demo. */
export function borrarHistoriaMock(canalId: string): void {
  try {
    localStorage.removeItem(`quorum:historia:${canalId}`);
  } catch {
    // sin storage no hay nada que borrar
  }
}
