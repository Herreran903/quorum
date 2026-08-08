/**
 * La política de iniciativa: cuándo el agente habla y cuándo se calla.
 *
 * Este archivo es el proyecto. Todo lo demás es plomería para poder verlo.
 *
 * La idea: un agente autónomo no debería decidir si interrumpe mirando solo
 * su propia incertidumbre. Debería mirar TAMBIÉN quién está en la sala. El
 * modo de fallo documentado de los agentes colaborativos es saturar al humano
 * a comentarios; la política de aquí lo evita por construcción, con dos
 * mecanismos:
 *
 *   1. la decisión depende de la presencia, no solo del riesgo
 *   2. las dudas seguidas se preguntan como UNA, nunca como ráfaga
 *
 * Reglas, en orden:
 *   - alguien está escribiendo            → ESPERAR
 *   - riesgo alto y hay espectadores      → PREGUNTAR
 *   - riesgo alto y la sala está vacía    → encolar volante, SEGUIR
 *   - confianza < 0.6 y hay espectadores  → PREGUNTAR
 *   - si no                               → SEGUIR
 */

import type { MotivoDuda, Paso, Pregunta, Volante } from "./protocolo";

export type Decision = "SEGUIR" | "PREGUNTAR" | "ESPERAR";

/** Lo que la política sabe de la sala en el momento de decidir. */
export interface Sala {
  /** cuánta gente está mirando, SIN contar al agente. */
  espectadores: number;
  /** alguien está tecleando ahora mismo. */
  escribiendo: boolean;
}

export const UMBRAL_CONFIANZA = 0.6;

/** Por qué este paso es dudoso, o `undefined` si no lo es. */
export function motivoDeDuda(paso: Paso): MotivoDuda | undefined {
  if (paso.riesgo === "alto") return "riesgo-alto";
  if (paso.confianza < UMBRAL_CONFIANZA) return "baja-confianza";
  return undefined;
}

/**
 * La regla pura, sin memoria. Es la que se testea línea por línea.
 *
 * No agrupa ni encola — eso necesita estado y vive en `Politica`, que llama
 * a esta función para el veredicto de fondo.
 */
export function decidir(paso: Paso, sala: Sala): Decision {
  if (sala.escribiendo) return "ESPERAR";

  const motivo = motivoDeDuda(paso);
  if (!motivo) return "SEGUIR";

  // Hay duda. Preguntar solo tiene sentido si hay alguien a quién preguntarle;
  // con la sala vacía el agente avanza y deja constancia.
  return sala.espectadores > 0 ? "PREGUNTAR" : "SEGUIR";
}

/** Una duda pendiente de resolver. */
export interface Duda {
  n: number;
  texto: string;
  motivo: MotivoDuda;
}

export interface Resultado {
  decision: Decision;
  /** pregunta a publicar, ya agrupada. Solo con `PREGUNTAR`. */
  pregunta?: Pregunta;
  /** volante a publicar. Solo cuando se encoló una duda sin testigos. */
  volante?: Volante;
}

export interface OpcionesPolitica {
  /** inyectable para que los tests sean deterministas. */
  generarId?: () => string;
}

/**
 * El estado serializable de la política.
 *
 * Existe porque dentro de una channel extension los campos de instancia se
 * pierden cuando el canal queda inactivo: hay que guardar en `ctx.storage` y
 * rehidratar en `onInit`.
 */
export interface EstadoPolitica {
  pendientes: Duda[];
  preguntaAbierta: Pregunta | undefined;
}

function idPorDefecto(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * La política con memoria: agrupa dudas y recuerda si hay una pregunta abierta.
 *
 * Invariante central — mientras haya una pregunta sin responder, el agente NO
 * emite otra. Las dudas nuevas se acumulan y salen después, dentro de una sola
 * pregunta. Eso es lo que impide la ráfaga de comentarios.
 */
export class Politica {
  readonly #generarId: () => string;
  #pendientes: Duda[] = [];
  #preguntaAbierta: Pregunta | undefined;

  constructor(opciones: OpcionesPolitica = {}) {
    this.#generarId = opciones.generarId ?? idPorDefecto;
  }

  /** Dudas acumuladas que todavía nadie ha visto. */
  get pendientes(): readonly Duda[] {
    return this.#pendientes;
  }

  /** La pregunta que tiene frenado al agente, si la hay. */
  get preguntaAbierta(): Pregunta | undefined {
    return this.#preguntaAbierta;
  }

  /** Evalúa un paso nuevo. */
  evaluar(paso: Paso, sala: Sala): Resultado {
    const motivo = motivoDeDuda(paso);

    // Alguien está escribiendo: el agente se calla. Ni siquiera encola —
    // el paso no se ha ejecutado, se reevaluará cuando la sala se quede quieta.
    if (sala.escribiendo) return { decision: "ESPERAR" };

    // Ya hay una pregunta sin responder: el agente está frenado. Una duda
    // nueva se acumula en silencio en vez de convertirse en otro mensaje.
    if (this.#preguntaAbierta) {
      if (motivo) this.#encolar(paso, motivo);
      return { decision: "ESPERAR" };
    }

    if (!motivo) return { decision: "SEGUIR" };

    // Hay duda pero no hay nadie mirando: avanzar y dejar un volante.
    if (sala.espectadores === 0) {
      const duda = this.#encolar(paso, motivo);
      return { decision: "SEGUIR", volante: this.#volanteDe(duda) };
    }

    // Hay duda y hay público: preguntar, arrastrando todo lo pendiente.
    this.#encolar(paso, motivo);
    return { decision: "PREGUNTAR", pregunta: this.#emitirPregunta() };
  }

  /**
   * Reevalúa sin un paso nuevo. Se llama cuando cambia la presencia: es el
   * momento en que las dudas acumuladas a solas se vuelven una sola pregunta
   * para quien acaba de entrar.
   */
  revisar(sala: Sala): Resultado {
    if (sala.escribiendo) return { decision: "ESPERAR" };
    if (this.#preguntaAbierta) return { decision: "ESPERAR" };
    if (sala.espectadores === 0 || this.#pendientes.length === 0) {
      return { decision: "SEGUIR" };
    }
    return { decision: "PREGUNTAR", pregunta: this.#emitirPregunta() };
  }

  /** La sala respondió. El agente queda libre. */
  responder(preguntaId: string): boolean {
    if (this.#preguntaAbierta?.id !== preguntaId) return false;
    this.#preguntaAbierta = undefined;
    return true;
  }

  /** Descarta todo lo acumulado (p. ej. tras una interrupción). */
  reiniciar(): void {
    this.#pendientes = [];
    this.#preguntaAbierta = undefined;
  }

  /** Estado serializable, para guardar en `ctx.storage`. */
  instantanea(): EstadoPolitica {
    return {
      pendientes: [...this.#pendientes],
      preguntaAbierta: this.#preguntaAbierta,
    };
  }

  /** Rehidrata desde `ctx.storage` en `onInit`. */
  restaurar(estado: EstadoPolitica | undefined): void {
    this.#pendientes = estado?.pendientes ? [...estado.pendientes] : [];
    this.#preguntaAbierta = estado?.preguntaAbierta;
  }

  // ------------------------------------------------------------------ interno

  #encolar(paso: Paso, motivo: MotivoDuda): Duda {
    const duda: Duda = { n: paso.n, texto: paso.texto, motivo };
    // Un mismo paso no se encola dos veces aunque se reevalúe.
    const ya = this.#pendientes.findIndex((d) => d.n === paso.n);
    if (ya >= 0) this.#pendientes[ya] = duda;
    else this.#pendientes.push(duda);
    return duda;
  }

  #emitirPregunta(): Pregunta {
    const dudas = this.#pendientes;
    this.#pendientes = [];
    const pregunta: Pregunta = {
      id: this.#generarId(),
      texto: redactarPregunta(dudas),
      pasos: dudas.map((d) => d.n),
      motivos: [...new Set(dudas.map((d) => d.motivo))],
    };
    this.#preguntaAbierta = pregunta;
    return pregunta;
  }

  #volanteDe(duda: Duda): Volante {
    return {
      id: this.#generarId(),
      pasos: [duda.n],
      texto: duda.texto,
      motivos: [duda.motivo],
      resuelto: false,
    };
  }
}

/** Una duda sola se pregunta directo; varias, como una lista. */
export function redactarPregunta(dudas: readonly Duda[]): string {
  if (dudas.length === 0) return "¿Sigo?";
  if (dudas.length === 1) {
    const d = dudas[0];
    return d.motivo === "riesgo-alto"
      ? `El paso ${d.n} es arriesgado: ${d.texto}. ¿Lo hago?`
      : `No estoy seguro del paso ${d.n}: ${d.texto}. ¿Sigo?`;
  }
  const lista = dudas.map((d) => `${d.n}. ${d.texto}`).join("\n");
  return `Se me acumularon ${dudas.length} dudas mientras nadie miraba:\n${lista}\n¿Sigo con todas?`;
}
