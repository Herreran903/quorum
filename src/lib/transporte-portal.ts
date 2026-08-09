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
import { TOPE_CONTENIDO_BYTES } from "./protocolo";
import type {
  Desuscribir,
  EstadoConexion,
  Espectador,
  OpcionesTransporte,
  Presencia,
  Transporte,
} from "./transporte";


/**
 * Cuánto vale mi propio "estoy escribiendo".
 *
 * Solo para mí: `activity` de Portal nunca incluye al propio usuario, así que
 * el resto lo sabe por la señal nativa y yo lo llevo con el reloj.
 */
const VIGENCIA_TECLEO_MS = 6000;

/**
 * Cada cuánto se vuelve a evaluar la presencia contra el reloj.
 *
 * Portal no manda un frame de "dejé de escribir" — según
 * `@portalsdk/wire-protocol`, el tecleo ajeno "expires by absence (~5s
 * client-side); there is no explicit 'stopped' frame". Sin este barrido,
 * `#emitirPresencia()` solo corre en reacción a eventos entrantes, y el
 * ícono de "escribiendo" queda pegado al último estado visto hasta que por
 * casualidad llegue otro evento cualquiera. Mismo rol que `#barrer()` en
 * `transporte-mock.ts`.
 */
const BARRIDO_MS = 1000;

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
  #cerrado = false;
  #barrido: ReturnType<typeof setInterval> | undefined;

  constructor(opciones: OpcionesTransporte, apiKey: string) {
    // Con `token`, Portal verifica el JWT contra el JWKS del proveedor y
    // publica el `username` firmado en la presencia — ese es el nombre real,
    // y no puede falsificarse desde el cliente.
    //
    // Sin `token` es modo anónimo: el SDK acuña su propia credencial y la
    // mantiene estable entre recargas. `me.anon === true`.
    //
    // Se envuelve la función porque el SDK espera `Promise<string>` y la
    // nuestra puede devolver `null` cuando todavía no hay sesión.
    const token = opciones.token;
    const portal = new Portal({
      apiKey,
      ...(token ? { token: async () => (await token()) ?? "" } : {}),
    });

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
      this.#canal.on("status", (s, error) => {
        // Sin esto, una conexión rechazada (token que el servidor no puede
        // verificar, por ejemplo) se ve como una sala vacía sin explicación.
        if (error) console.error(`[transporte-portal] estado ${s}:`, error);
        this.#cambiarEstado(mapearEstado(s));
        this.#emitirPresencia();
      }),
    );

    // Primer momento de red del SDK. Antes de esto no hay conexión ni token.
    this.#canal.acquire();

    this.#barrido = setInterval(() => this.#emitirPresencia(), BARRIDO_MS);
  }

  get yo(): string | undefined {
    return this.#canal.me?.id;
  }

  // ---------------------------------------------------------------- publicar

  async publicar(cuerpo: Cuerpo): Promise<void> {
    if (this.#cerrado) return;
    avisarSiPesaDemasiado(cuerpo);

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

  /**
   * "Estoy escribiendo", por la vía nativa de Portal.
   *
   * Antes esto además publicaba un mensaje PERSISTENTE de atención cada 2,5s
   * por cliente. Con `history: 200`, unos pocos minutos de sesión bastaban
   * para que ese goteo desalojara la conversación entera: quien entraba
   * tarde recibía un backfill de puro ruido y veía una sala vacía — es decir,
   * rompía exactamente lo que esta app promete.
   *
   * `sendTyping` ya viene con throttle, lo expira el servidor y lo empuja por
   * WebSocket. No hace falta nada más.
   */
  escribiendo(): void {
    if (this.#cerrado) return;
    this.#escribiendoHasta = Date.now() + VIGENCIA_TECLEO_MS;
    this.#canal.sendTyping();
    this.#emitirPresencia();
  }

  desconectar(): void {
    if (this.#cerrado) return;
    this.#cerrado = true;
    if (this.#barrido) clearInterval(this.#barrido);
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
      // El SDK mete el mensaje propio en el store ANTES de que el servidor lo
      // acepte (`status: "pending"`). Si se reparte ese eco y el envío falla,
      // el emisor ve un mensaje que nadie más recibió y que nada retracta:
      // el reducer no sabe deshacer. Se espera al acuse.
      if (msg.status === "pending") continue;
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
        // `username` lo pone el servidor desde el token firmado; el avatar lo
        // declara el cliente en su metadata. Uno es identidad, el otro solo
        // presentación.
        const nombre = par.username;
        const avatar =
          typeof par.metadata?.avatar === "string" ? par.metadata.avatar : undefined;

        const soyYo = par.id === yoId;
        if (soyYo) {
          return {
            id: par.id,
            escribiendo: yoEscribe,
            escribiendoHasta: this.#escribiendoHasta,
            nombre,
            avatar,
            anonimo: par.anon,
            soyYo: true,
          };
        }

        // El tecleo ajeno sale de `activity`, la señal nativa: la expira el
        // servidor y llega por WebSocket.
        return {
          id: par.id,
          escribiendo: escribiendoAhora.has(par.id),
          nombre,
          avatar,
          anonimo: par.anon,
          soyYo: false,
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
