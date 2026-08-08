/**
 * Transporte real sobre Portal (`@portalsdk/core` 0.1.5).
 *
 * Se usa el core imperativo, no los hooks de `@portalsdk/react`, para que la
 * app entera siga hablando con una sola interfaz (`Transporte`) y no dependa
 * del ciclo de vida de React para la red.
 *
 * Notas verificadas contra los .d.ts del SDK, no contra la documentación:
 *
 *  - `presence` es una unión: `DetailedPresence` (con lista de participantes)
 *    o `AggregatePresence` (SOLO un conteo). No se elige desde el cliente. Por
 *    eso `Presencia.detallada` existe y la UI tiene que tolerar `total > 0`
 *    con `espectadores` vacío.
 *  - `activity` / `sendActivity("typing")` es de primera clase en Portal y ya
 *    viene con throttle. NO se manda "escribiendo" como mensaje efímero.
 *    `activity` nunca incluye al propio usuario, así que el "yo escribiendo"
 *    se lleva local.
 *  - `seq` no existe en los tipos públicos del core: se declara explícitamente
 *    stripped en este borde. El orden lo garantiza el array `messages`.
 *  - `content` tiene tope de 2KB.
 */

import { Portal } from "@portalsdk/core";
import type {
  AggregatePresence,
  ChannelHandle,
  ChannelStatus,
  DetailedPresence,
  Message,
  Unsubscribe,
} from "@portalsdk/core";

import type { Cuerpo, Sobre } from "./protocolo";
import { esEfimero } from "./protocolo";
import type {
  Desuscribir,
  EstadoConexion,
  Espectador,
  OpcionesTransporte,
  Presencia,
  Transporte,
} from "./transporte";

/** Tope duro de Portal para `content`. */
const TOPE_CONTENIDO_BYTES = 2048;

function mapearEstado(s: ChannelStatus): EstadoConexion {
  switch (s) {
    case "idle":
    case "connecting":
      return "conectando";
    case "ready":
      return "listo";
    case "reconnecting":
      return "reconectando";
    case "degraded":
    case "degraded-http":
      return "degradado";
    case "blocked":
      return "bloqueado";
  }
}

export class TransportePortal implements Transporte {
  estado: EstadoConexion = "conectando";

  readonly #canal: ChannelHandle<Cuerpo>;
  readonly #sueltas: Unsubscribe[] = [];

  readonly #escuchasMsg = new Set<(s: Sobre) => void>();
  readonly #escuchasPresencia = new Set<(p: Presencia) => void>();
  readonly #escuchasConexion = new Set<(e: EstadoConexion) => void>();

  /** dedup: `on("message")` y el diff del store pueden traer lo mismo. */
  readonly #vistos = new Set<string>();
  /** cola de mensajes que llegaron antes de que alguien se suscribiera. */
  #buffer: Sobre[] = [];

  #escribiendoHasta = 0;
  #mirandoPaso: number | undefined;
  #cerrado = false;

  constructor(opciones: OpcionesTransporte, apiKey: string) {
    // Modo anónimo: sin `token`, el SDK acuña su propia credencial y la
    // mantiene estable entre recargas. `me.anon === true`.
    const portal = new Portal({ apiKey });

    this.#canal = portal.channel<Cuerpo>(opciones.canalId, {
      history: 200,
      metadata: opciones.metadata,
    });

    this.#sueltas.push(
      this.#canal.on("message", (msg) => this.#entrante(msg)),
      this.#canal.subscribe(() => this.#drenarStore()),
      this.#canal.on("presence", () => this.#emitirPresencia()),
      // `activity` es la señal de tecleo de Portal; recalcula la presencia.
      this.#canal.on("activity", () => this.#emitirPresencia()),
      this.#canal.on("status", (s) => {
        this.#cambiarEstado(mapearEstado(s));
        this.#emitirPresencia();
      }),
    );

    // Primer momento de red del SDK. Antes de esto no hay conexión ni token.
    this.#canal.acquire();
  }

  get yo(): string | undefined {
    return this.#canal.me?.id;
  }

  // ---------------------------------------------------------------- publicar

  async publicar(cuerpo: Cuerpo): Promise<void> {
    if (this.#cerrado) return;
    avisarSiPesaDemasiado(cuerpo);

    if (esEfimero(cuerpo)) {
      await this.#canal.send({ ephemeral: true, content: cuerpo, type: cuerpo.tipo });
      return;
    }
    await this.#canal.send({ content: cuerpo, type: cuerpo.tipo });
  }

  // --------------------------------------------------------------- suscribir

  suscribir(escucha: (sobre: Sobre) => void): Desuscribir {
    this.#escuchasMsg.add(escucha);

    // Lo ya conocido (backfill del connect frame + lo que llegó antes de
    // suscribirse) va primero, en orden.
    this.#drenarStore();
    for (const sobre of this.#buffer) {
      try {
        escucha(sobre);
      } catch (e) {
        console.error("[transporte-portal] escucha falló en backfill", e);
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
    if (this.#cerrado) return;
    this.#escribiendoHasta = Date.now() + 2500;
    // El SDK ya hace throttle; llamar por tecla es lo esperado.
    this.#canal.sendTyping();
    this.#emitirPresencia();
  }

  mirando(n: number | undefined): void {
    if (this.#cerrado || this.#mirandoPaso === n) return;
    this.#mirandoPaso = n;
    // La metadata de presencia es presentación, nunca autorización.
    this.#canal.setMetadata({ mirandoPaso: n ?? null });
    this.#emitirPresencia();
  }

  desconectar(): void {
    if (this.#cerrado) return;
    this.#cerrado = true;
    for (const soltar of this.#sueltas) soltar();
    this.#canal.release();
    this.#escuchasMsg.clear();
    this.#escuchasPresencia.clear();
    this.#escuchasConexion.clear();
  }

  // ------------------------------------------------------------------ interno

  #entrante(msg: Message<Cuerpo>): void {
    const sobre = aSobre(msg);
    if (!sobre) return;
    if (this.#vistos.has(sobre.id)) return;
    this.#vistos.add(sobre.id);
    this.#buffer.push(sobre);
    this.#repartir(sobre);
  }

  /** Diff del store reactivo: cubre el backfill del connect frame. */
  #drenarStore(): void {
    if (this.#cerrado) return;
    for (const msg of this.#canal.messages) {
      if (this.#vistos.has(msg.id)) continue;
      const sobre = aSobre(msg);
      if (!sobre) continue;
      this.#vistos.add(sobre.id);
      this.#buffer.push(sobre);
      this.#repartir(sobre);
    }
  }

  #repartir(sobre: Sobre): void {
    for (const escucha of this.#escuchasMsg) {
      try {
        escucha(sobre);
      } catch (e) {
        console.error("[transporte-portal] escucha falló", e);
      }
    }
  }

  #presenciaActual(): Presencia {
    const p = this.#canal.presence;
    const yoId = this.#canal.me?.id;
    const escribiendoAhora = new Set(this.#canal.typing);
    const yoEscribe = this.#escribiendoHasta > Date.now();

    if (!p) return { total: 0, espectadores: [], detallada: true };

    if (p.kind === "aggregate") {
      // Portal solo da conteo en este canal. La UI lo tiene que aguantar.
      return aggregateAPresencia(p);
    }

    const espectadores: Espectador[] = (p as DetailedPresence).participants.map(
      (par) => {
        const soyYo = par.id === yoId;
        const meta = par.metadata as { mirandoPaso?: number | null } | undefined;
        return {
          id: par.id,
          escribiendo: soyYo ? yoEscribe : escribiendoAhora.has(par.id),
          mirandoPaso: soyYo
            ? this.#mirandoPaso
            : (meta?.mirandoPaso ?? undefined),
          soyYo,
        };
      },
    );

    return { total: p.count, espectadores, detallada: true };
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
}

function aggregateAPresencia(p: AggregatePresence): Presencia {
  return { total: p.count, espectadores: [], detallada: false };
}

/** Un mensaje del canal que no siga nuestro protocolo se ignora, no rompe. */
function aSobre(msg: Message<Cuerpo>): Sobre | undefined {
  const cuerpo = msg.content;
  if (!cuerpo || typeof cuerpo !== "object" || !("tipo" in cuerpo)) {
    return undefined;
  }
  return {
    id: msg.id,
    emisor: msg.sender.id,
    at: msg.timestamp,
    efimero: msg.ephemeral,
    cuerpo,
  };
}

function avisarSiPesaDemasiado(cuerpo: Cuerpo): void {
  const bytes = new TextEncoder().encode(JSON.stringify(cuerpo)).length;
  if (bytes > TOPE_CONTENIDO_BYTES) {
    console.warn(
      `[transporte-portal] ${cuerpo.tipo} pesa ${bytes}B; Portal rechaza sobre ${TOPE_CONTENIDO_BYTES}B`,
    );
  }
}
