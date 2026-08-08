/**
 * La política de iniciativa corriendo DENTRO de Portal, no en el cliente.
 *
 * Por qué importa: casi todo el mundo conecta su agente como cliente externo.
 * Si la decisión de hablar o callarse la toma un proceso que vive en los
 * servidores de Portal, por canal, con estado durable, entonces:
 *
 *  - hay UNA sola autoridad. Con la política en el cliente, dos pestañas que
 *    corren el agente son dos agentes decidiendo distinto.
 *  - quien entra tarde ve el estado completo en el frame de conexión, vía
 *    `onSnapshot` → `channel.ext["iniciativa"]`, sin reproducir historia.
 *    Ese es el paso 5 del guion de demo.
 *  - la política sobrevive a que todos cierren la pestaña.
 *
 * LIMITACIÓN VERIFICADA CONTRA LOS DOCS: una extensión NO tiene acceso a la
 * presencia del canal. Ni participantes, ni `activity`, ni typing. El
 * protocolo solo entrega mensajes del propio namespace. Por eso los clientes
 * empujan su atención como efímeros `quorum.atencion` y la sala se deriva de
 * esos mensajes, con vencimiento. Los efímeros SÍ llegan a las extensiones.
 */

import { defineExtension } from "@portalsdk/extension-protocol";
import type {
  BatchRequest,
  BatchResponse,
  ExtensionBroadcast,
  ExtensionContext,
  InitRequest,
  SnapshotRequest,
  SnapshotResponse,
} from "@portalsdk/extension-protocol";

import { Politica, type EstadoPolitica, type Sala } from "@/lib/iniciativa";
import type { Atencion, Paso, Pregunta, Volante } from "@/lib/protocolo";

/** Namespace propio. Debe terminar en punto. */
const NS = "quorum." as const;

/** Sin latido en este tiempo, un espectador se da por ido. */
const ATENCION_EXPIRA_MS = 8000;

type TipoEntrante =
  | `${typeof NS}paso`
  | `${typeof NS}atencion`
  | `${typeof NS}respuesta`
  | `${typeof NS}interrupcion`;

/** Lo que la extensión recuerda de cada espectador. */
interface Atento extends Atencion {
  at: number;
}

interface EstadoGuardado {
  batchSeq: number;
  epoch: number;
  politica: EstadoPolitica;
  pasos: Paso[];
  volantes: Volante[];
  atentos: Record<string, Atento>;
}

const CLAVE = "quorum:estado";

function vacio(epoch: number): EstadoGuardado {
  return {
    batchSeq: 0,
    epoch,
    politica: { pendientes: [], preguntaAbierta: undefined },
    pasos: [],
    volantes: [],
    atentos: {},
  };
}

class Iniciativa {
  static readonly manifest = {
    namespace: NS,
    // Los clientes no eligen el transporte: lo fija el manifiesto.
    transport: "ws",
  } as const;

  readonly #ctx: ExtensionContext;
  /**
   * Caché en memoria. NO es la fuente de verdad: los campos de instancia se
   * pierden cuando el canal queda inactivo. La verdad está en `ctx.storage`.
   */
  #estado: EstadoGuardado | undefined;

  constructor(ctx: ExtensionContext) {
    this.#ctx = ctx;
  }

  async onInit(req: InitRequest): Promise<void> {
    const guardado = await this.#ctx.storage.get<EstadoGuardado>(CLAVE);
    // `epoch` sube cuando el canal reinicia. Lo de un epoch anterior sigue
    // siendo válido como historia, pero la atención de entonces ya caducó:
    // nadie de aquel epoch sigue conectado.
    if (guardado && guardado.epoch !== req.epoch) {
      this.#estado = { ...guardado, epoch: req.epoch, atentos: {} };
      await this.#guardar();
      return;
    }
    this.#estado = guardado ?? vacio(req.epoch);
  }

  async onBatch(req: BatchRequest): Promise<BatchResponse | void> {
    const estado = await this.#cargar(req.epoch);

    // Los lotes llegan AL MENOS UNA VEZ. Un batchSeq ya visto se descarta
    // entero: sin esto, un reintento duplicaría pasos y preguntas.
    if (req.batchSeq <= estado.batchSeq) return;

    const politica = new Politica();
    politica.restaurar(estado.politica);

    const broadcasts: ExtensionBroadcast[] = [];
    let sucio = false;

    // El reloj sale de los propios mensajes: es la única marca de tiempo que
    // la extensión sabe consistente con lo que le llega.
    const ahora = req.messages.reduce((max, m) => Math.max(max, m.at), 0);

    for (const msg of req.messages) {
      switch (msg.type as TipoEntrante) {
        case `${NS}atencion`: {
          const a = msg.content as Atencion | undefined;
          if (!a) break;
          estado.atentos[msg.senderId] = {
            escribiendo: Boolean(a.escribiendo),
            mirandoPaso: a.mirandoPaso,
            at: msg.at,
          };
          break;
        }

        case `${NS}interrupcion`: {
          politica.reiniciar();
          sucio = true;
          break;
        }

        case `${NS}respuesta`: {
          const r = msg.content as { preguntaId?: string } | undefined;
          if (r?.preguntaId) {
            politica.responder(r.preguntaId);
            sucio = true;
          }
          break;
        }

        case `${NS}paso`: {
          const paso = msg.content as Paso | undefined;
          if (!paso || typeof paso.n !== "number") break;

          // Un paso lo propone quien conduce; la DECISIÓN se toma aquí, una
          // sola vez, para todo el canal.
          const sala = derivarSala(estado.atentos, msg.senderId, ahora);
          const r = politica.evaluar(paso, sala);

          broadcasts.push({
            type: `${NS}decision`,
            content: { paso, decision: r.decision, sala },
            kind: r.decision,
          });

          if (r.decision === "SEGUIR") {
            registrarPaso(estado, { ...paso, estado: "hecho" });
            sucio = true;
          }
          if (r.decision === "PREGUNTAR") {
            registrarPaso(estado, { ...paso, estado: "bloqueado" });
            sucio = true;
          }
          if (r.volante) {
            estado.volantes.push(r.volante);
            broadcasts.push({ type: `${NS}volante`, content: r.volante });
            sucio = true;
          }
          if (r.pregunta) {
            broadcasts.push({ type: `${NS}pregunta`, content: r.pregunta });
          }
          break;
        }
      }
    }

    // Cambió la sala: puede ser el momento de sacar como UNA sola pregunta
    // las dudas que se acumularon mientras nadie miraba.
    const sala = derivarSala(estado.atentos, undefined, ahora);
    const revision = politica.revisar(sala);
    if (revision.pregunta) {
      broadcasts.push({ type: `${NS}pregunta`, content: revision.pregunta });
      sucio = true;
    }

    estado.batchSeq = req.batchSeq;
    estado.politica = politica.instantanea();
    this.#estado = estado;
    await this.#guardar();

    return { broadcasts, snapshotDirty: sucio };
  }

  /**
   * Lo que ve quien acaba de entrar. Responde "qué debería ver alguien que
   * acaba de llegar", nunca "qué me perdí".
   */
  async onSnapshot(req: SnapshotRequest): Promise<SnapshotResponse> {
    const estado = await this.#cargar(req.epoch);
    const politica = estado.politica;
    return {
      snapshot: {
        pasos: estado.pasos,
        volantes: estado.volantes,
        preguntaAbierta: politica.preguntaAbierta,
        /** las dudas que el agente tomó solo, esperando revisión */
        pendientes: politica.pendientes,
        espectadores: Object.keys(estado.atentos).length,
      },
    };
  }

  // ------------------------------------------------------------------ interno

  async #cargar(epoch: number): Promise<EstadoGuardado> {
    if (this.#estado) return this.#estado;
    // `onInit` puede no haber corrido: Portal llama a `onSnapshot` cuando
    // quiere, incluso con lotes en vuelo.
    const guardado = await this.#ctx.storage.get<EstadoGuardado>(CLAVE);
    this.#estado = guardado ?? vacio(epoch);
    return this.#estado;
  }

  async #guardar(): Promise<void> {
    if (this.#estado) await this.#ctx.storage.put(CLAVE, this.#estado);
  }
}

/** El último estado de un paso gana; se identifican por `n`. */
function registrarPaso(estado: EstadoGuardado, paso: Paso): void {
  const i = estado.pasos.findIndex((p) => p.n === paso.n);
  if (i >= 0) estado.pasos[i] = paso;
  else estado.pasos.push(paso);
}

/**
 * La sala, derivada de los mensajes de atención.
 *
 * `quienPropone` se excluye: el que conduce al agente no se cuenta como
 * espectador de sí mismo, igual que en el cliente.
 */
function derivarSala(
  atentos: Record<string, Atento>,
  quienPropone: string | undefined,
  ahora: number,
): Sala {
  let espectadores = 0;
  let escribiendo = false;
  for (const [id, a] of Object.entries(atentos)) {
    if (id === quienPropone) continue;
    if (ahora - a.at > ATENCION_EXPIRA_MS) continue;
    espectadores += 1;
    if (a.escribiendo) escribiendo = true;
  }
  return { espectadores, escribiendo };
}

export default defineExtension(Iniciativa);

/** Tipos del snapshot, para castear en el cliente al leer `ext["iniciativa"]`. */
export interface SnapshotIniciativa {
  pasos: Paso[];
  volantes: Volante[];
  preguntaAbierta: Pregunta | undefined;
  pendientes: { n: number; texto: string; motivo: string }[];
  espectadores: number;
}
