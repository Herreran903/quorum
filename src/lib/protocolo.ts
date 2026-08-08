/**
 * Protocolo del canal `sesion:{id}`.
 *
 * Todo lo que viaja por el canal está descrito aquí y en ningún otro lado.
 * Ni la UI ni la política conocen el formato del SDK — solo estos tipos.
 *
 * Dos clases de mensaje, siguiendo la separación de Portal:
 *  - persistentes: se reproducen al reconectar; son la historia de la sesión.
 *  - efímeros: no tienen orden ni historia; son señal viva que caduca.
 */

export type Riesgo = "bajo" | "alto";

export type EstadoPaso =
  /** el agente lo está ejecutando ahora mismo */
  | "ejecutando"
  /** terminó bien */
  | "hecho"
  /** el agente se detuvo aquí esperando a la sala */
  | "bloqueado"
  /** la sala lo interrumpió antes de terminar */
  | "descartado";

/** Un paso del agente. Es la unidad que la política evalúa. */
export interface Paso {
  n: number;
  texto: string;
  riesgo: Riesgo;
  /** 0..1 — qué tan seguro está el agente de este paso. */
  confianza: number;
  estado: EstadoPaso;
  /**
   * El agente ejecutó este paso sin nadie mirando.
   *
   * Es lo que hace visible el silencio: sin esta marca, "avanzó solo porque
   * la sala estaba vacía" y "el agente hizo algo" se ven idénticos en pantalla.
   */
  sinTestigos?: boolean;
}

/** Por qué el agente encoló una duda en vez de preguntarla. */
export type MotivoDuda = "riesgo-alto" | "baja-confianza";

/**
 * Una pregunta del agente a la sala. Cubre uno o varios pasos: cuando hay
 * dudas seguidas se agrupan en UNA sola pregunta. Ver `iniciativa.ts`.
 */
export interface Pregunta {
  id: string;
  texto: string;
  /** los `n` de los pasos que motivaron la pregunta, en orden */
  pasos: number[];
  motivos: MotivoDuda[];
}

export interface Respuesta {
  preguntaId: string;
  texto: string;
}

/** Alguien frenó al agente en seco. */
export interface Interrupcion {
  motivo: string;
}

/** Una regla que la sala le fija al agente y que persiste el resto de la sesión. */
export interface Restriccion {
  id: string;
  texto: string;
}

/**
 * Un volante: una duda que el agente tuvo mientras nadie miraba.
 * No interrumpe a nadie — queda encolada para revisión posterior.
 * Es el lado silencioso de la política, y la razón de que el agente
 * pueda avanzar solo sin perder trazabilidad.
 */
export interface Volante {
  id: string;
  pasos: number[];
  texto: string;
  motivos: MotivoDuda[];
  resuelto: boolean;
}

/** Efímero: dónde tiene puesta la atención un espectador, ahora mismo. */
export interface Atencion {
  escribiendo: boolean;
  /** el `n` del paso que está mirando, si lo hay */
  mirandoPaso?: number;
  /**
   * Estoy mirando la sala. `false` = cerré los ojos: sigo conectado pero
   * dejo de contar como testigo, y el agente se comporta como si estuviera solo.
   *
   * Ausente se lee como `true`, para que un cliente viejo siga contando.
   */
  presente?: boolean;
}

/** Cuerpo de un mensaje persistente. */
export type CuerpoPersistente =
  | { tipo: "paso"; paso: Paso }
  | { tipo: "pregunta"; pregunta: Pregunta }
  | { tipo: "respuesta"; respuesta: Respuesta }
  | { tipo: "interrupcion"; interrupcion: Interrupcion }
  | { tipo: "restriccion"; restriccion: Restriccion }
  | { tipo: "volante"; volante: Volante };

/** Cuerpo de un mensaje efímero. */
export type CuerpoEfimero = { tipo: "atencion"; atencion: Atencion };

export type Cuerpo = CuerpoPersistente | CuerpoEfimero;

export type TipoMensaje = Cuerpo["tipo"];

export const TIPOS_PERSISTENTES = [
  "paso",
  "pregunta",
  "respuesta",
  "interrupcion",
  "restriccion",
  "volante",
] as const satisfies readonly CuerpoPersistente["tipo"][];

export const TIPOS_EFIMEROS = ["atencion"] as const satisfies readonly CuerpoEfimero["tipo"][];

export function esEfimero(cuerpo: Cuerpo): cuerpo is CuerpoEfimero {
  return cuerpo.tipo === "atencion";
}

/** Lo que entrega el transporte al suscriptor: cuerpo + quién y cuándo. */
export interface Sobre<C extends Cuerpo = Cuerpo> {
  /** id asignado por el transporte; sirve para deduplicar. */
  id: string;
  /** id del emisor. El agente emite como `AGENTE`. */
  emisor: string;
  /** epoch ms */
  at: number;
  efimero: boolean;
  cuerpo: C;
}

/** El agente publica con este id de emisor. */
export const AGENTE = "agente";

/** Id de canal para una sesión. La UI nunca lo arma a mano. */
export function canalDeSesion(idSesion: string): string {
  return `sesion:${idSesion}`;
}
