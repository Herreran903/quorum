/**
 * Protocolo del canal `sala:{id}`.
 *
 * Todo lo que viaja por el canal está descrito aquí y en ningún otro lado.
 * La UI no conoce el formato del SDK — solo estos tipos.
 *
 * Todo es persistente: se reproduce al reconectar y es la historia de la
 * sesión. Nada de latidos ni señales que caduquen — el tecleo lo cubre
 * `activity`, la señal nativa de Portal, y una señal viva emitida como
 * mensaje terminaría desalojando la conversación del historial.
 */

/**
 * La tarea que la sala le encargó al agente, en lenguaje libre. La define
 * quien arranca la sesión y es la misma para todos los que entren después
 * — llega en el backfill como cualquier mensaje persistente.
 */
export interface Tarea {
  texto: string;
}

/**
 * Un turno del chat. Quién lo escribió sale del `emisor` del `Sobre`; lo
 * único que este cuerpo tiene que declarar es si habló la máquina.
 */
export interface Mensaje {
  id: string;
  texto: string;
  /**
   * Nombre de quien escribió, al momento de escribir.
   *
   * Está duplicado a propósito. En canales `standard` Portal entrega solo el
   * id del emisor — "display data is joined app-side by id" — y la presencia,
   * que es de dónde sale el nombre verificado, solo cubre a quien está
   * conectado AHORA. Sin esta copia, los mensajes de alguien que ya se fue
   * quedarían sin nombre.
   *
   * Es presentación, no identidad: cuando la persona está presente gana
   * siempre el nombre verificado de la presencia.
   */
  autor?: string;
  /** lo escribió el agente, no una persona */
  deAgente?: boolean;
  /** qué hizo el agente para poder decir esto (p. ej. "Revisando el esquema") */
  actividad?: string;
  /**
   * Los `id` de los mensajes humanos que ESTE turno incorporó.
   *
   * Es el mecanismo que hace visible que lo que se dice en el chat cambia lo
   * que hace el agente: la instrucción se marca aplicada en el panel y queda
   * atribuida a quien la escribió.
   */
  atendio?: string[];
}

export type TipoArtefacto = "codigo" | "documento";

/** Lo que el agente está construyendo: un archivo de código o un documento. */
export interface Artefacto {
  id: string;
  tipo: TipoArtefacto;
  titulo: string;
  /** para resaltar el código; ausente en documentos */
  lenguaje?: string;
  contenido: string;
  /** sube en cada reescritura; la última gana */
  version: number;
}

/**
 * Un pedazo de artefacto.
 *
 * Portal rechaza `content` por encima de 2KB, y un archivo de código lo pasa
 * enseguida. Así que el artefacto viaja partido y se rearma del otro lado:
 * una versión solo se muestra cuando llegaron todas sus partes.
 */
export interface TrozoArtefacto {
  id: string;
  version: number;
  tipo: TipoArtefacto;
  titulo: string;
  lenguaje?: string;
  /** 0-based */
  parte: number;
  total: number;
  texto: string;
}

/** Tope duro de Portal para `content`. Por encima de esto, rechaza el mensaje. */
export const TOPE_CONTENIDO_BYTES = 2048;

/**
 * Aire que se le deja al transporte por encima de lo que medimos.
 *
 * Medimos el cuerpo ya serializado, pero el SDK puede envolverlo con algo más
 * antes de contarlo. Quedarse corto no cuesta nada; pasarse cuesta que el
 * trozo se pierda y el artefacto no aparezca nunca.
 */
export const MARGEN_SOBRE_BYTES = 192;

export interface OpcionVoto {
  id: string;
  texto: string;
  /** quién propuso esta opción, cuando salió del mensaje de alguien */
  propuestaPor?: string;
}

/**
 * Una decisión que la sala resuelve votando.
 *
 * Se abre cuando dos pedidos se contradicen — automáticamente, o porque
 * alguien la escaló a mano. Mientras hay una abierta el agente no avanza:
 * la sala manda.
 */
export interface Votacion {
  id: string;
  motivo: string;
  opciones: OpcionVoto[];
  /** epoch ms */
  cierraEn: number;
}

/** Quién votó qué se lee del `emisor` del `Sobre`, no de este cuerpo. */
export interface Voto {
  votacionId: string;
  opcionId: string;
}

/** Todo lo que viaja por el canal. */
export type Cuerpo =
  | { tipo: "tarea"; tarea: Tarea }
  | { tipo: "mensaje"; mensaje: Mensaje }
  | { tipo: "artefacto"; trozo: TrozoArtefacto }
  | { tipo: "votacion"; votacion: Votacion }
  | { tipo: "voto"; voto: Voto };

export type TipoMensaje = Cuerpo["tipo"];

export const TIPOS = [
  "tarea",
  "mensaje",
  "artefacto",
  "votacion",
  "voto",
] as const satisfies readonly Cuerpo["tipo"][];

/** Lo que entrega el transporte al suscriptor: cuerpo + quién y cuándo. */
export interface Sobre<C extends Cuerpo = Cuerpo> {
  /** id asignado por el transporte; sirve para deduplicar. */
  id: string;
  /** id del emisor. */
  emisor: string;
  /** epoch ms */
  at: number;
  cuerpo: C;
}

/** Id de canal para una sala. La UI nunca lo arma a mano. */
export function canalDeSala(idSala: string): string {
  return `sala:${idSala}`;
}
