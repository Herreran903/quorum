/**
 * El agente: pide un paso, lo pasa por la política, y publica o se calla.
 *
 * Los pasos vienen de `/api/paso`, que decide en el servidor si los produce un
 * modelo local o el guion fijo. Aquí no se sabe cuál de los dos fue — igual
 * que con el transporte, esta clase habla con una sola superficie.
 *
 * La `confianza` que alimenta la política la declara el modelo, no nosotros.
 *
 * Lo corre una sola pestaña — la que le da a "arrancar". Las demás solo miran.
 */

import { AGENTE, type Paso, type Volante } from "./protocolo";
import { Politica, type Sala } from "./iniciativa";
import type { Transporte } from "./transporte";

/**
 * Ritmo del agente. Si el modelo tarda más que esto, el tick siguiente se
 * salta en vez de encimarse: el ritmo lo marca el modelo, no el reloj.
 */
export const INTERVALO_MS = 2000;

/** Lo que devuelve `/api/paso`. Se declara aquí para no importar del servidor. */
interface RespuestaPlan {
  pasos?: { texto: string; riesgo: Paso["riesgo"]; confianza: number }[];
  fuente: string;
  ms?: number;
  degradado?: string;
}

export interface EventosAgente {
  /** se llama en cada tick con lo que decidió la política */
  onDecision?: (info: {
    paso: Paso;
    decision: "SEGUIR" | "PREGUNTAR" | "ESPERAR";
    pendientes: number;
    /** qué produjo el paso: el modelo, o "guion" si el modelo falló */
    fuente: string;
    /** mensaje del fallo cuando se cayó al guion */
    degradado?: string;
  }) => void;
  /** true mientras el modelo está armando el plan; la UI lo muestra. */
  onPlaneando?: (planeando: boolean) => void;
  onFin?: () => void;
}

export class AgenteSimulado {
  readonly politica: Politica;

  readonly #transporte: Transporte;
  readonly #leerSala: () => Sala;
  readonly #eventos: EventosAgente;
  readonly #tarea: string;

  #reloj: ReturnType<typeof setInterval> | undefined;
  /** el paso que quedó en el aire por un ESPERAR; se reintenta tal cual. */
  #enElAire: Paso | undefined;
  /**
   * Pasos que la sala ya aprobó. Sin esto el agente volvería a preguntar lo
   * mismo en el siguiente tick: la política es sin memoria de aprobaciones a
   * propósito, y quién dio el permiso es asunto de quien la usa.
   */
  readonly #aprobados = new Set<number>();
  /** lo ya hecho; es el contexto que recibe el modelo en cada llamada. */
  readonly #previos: { n: number; texto: string; estado: string }[] = [];
  /** reglas que la sala le fijó; viajan al modelo en cada paso. */
  #restricciones: string[] = [];
  /** el plan pendiente de ejecutar; se rellena con una sola llamada. */
  #plan: { texto: string; riesgo: Paso["riesgo"]; confianza: number }[] = [];
  /** qué produjo el plan actual, para mostrarlo en la UI. */
  #fuente = "—";
  /** true una vez que la sala lo desvió. */
  #desviado = false;
  #motivoDesvio: string | undefined;
  /** numeración global de pasos; nunca se reinicia. */
  #n = 0;
  /** un tick no arranca si el modelo todavía está pensando el anterior. */
  #pensando = false;
  #corriendo = false;

  constructor(
    transporte: Transporte,
    leerSala: () => Sala,
    eventos: EventosAgente = {},
    tarea = "Investigar si los agentes colaborativos saturan a los usuarios, y con qué evidencia",
  ) {
    this.#transporte = transporte;
    this.#leerSala = leerSala;
    this.#eventos = eventos;
    this.#tarea = tarea;
    this.politica = new Politica();
  }

  /** La sala fijó una regla nueva; el modelo la verá en el próximo paso. */
  fijarRestriccion(texto: string): void {
    this.#restricciones.push(texto);
  }

  get corriendo(): boolean {
    return this.#corriendo;
  }

  arrancar(): void {
    if (this.#corriendo) return;
    this.#corriendo = true;
    void this.#tick();
    this.#reloj = setInterval(() => void this.#tick(), INTERVALO_MS);
  }

  parar(): void {
    this.#corriendo = false;
    if (this.#reloj) clearInterval(this.#reloj);
    this.#reloj = undefined;
  }

  /**
   * La sala respondió una pregunta. Libera al agente y, de paso, saca lo que
   * se haya acumulado mientras estaba frenado — como UNA sola pregunta.
   */
  async responder(preguntaId: string): Promise<void> {
    const abierta = this.politica.preguntaAbierta;
    if (!this.politica.responder(preguntaId)) return;
    for (const n of abierta?.pasos ?? []) this.#aprobados.add(n);
    await this.#revisarPendientes();
  }

  /**
   * La sala lo desvía: "por ahí no".
   *
   * NO lo mata — le cambia el rumbo y sigue trabajando. Es el paso 2 del
   * guion de demo: interrumpes desde una pestaña y en la otra se ve al agente
   * descartar lo que estaba haciendo y arrancar por otra línea.
   */
  async interrumpir(motivo: string): Promise<void> {
    if (this.#enElAire) {
      await this.#publicarPaso({ ...this.#enElAire, estado: "descartado" });
      this.#enElAire = undefined;
    }
    // Lo acumulado pertenecía a la línea abandonada; no tiene sentido
    // preguntarlo después de un cambio de rumbo.
    this.politica.reiniciar();
    this.#aprobados.clear();
    // El plan viejo pertenecía a la línea abandonada: se tira entero y el
    // modelo replanifica sabiendo por qué lo desviaron.
    this.#plan = [];
    this.#desviado = true;
    this.#motivoDesvio = motivo;
    await this.#transporte.publicar({ tipo: "interrupcion", interrupcion: { motivo } });

    // Si estaba parado (por ejemplo, ya había terminado), el desvío lo revive.
    if (!this.#corriendo) this.arrancar();
  }

  /**
   * Cambió la presencia: puede ser el momento de sacar las dudas que se
   * acumularon mientras la sala estaba vacía.
   */
  async alCambiarLaSala(): Promise<void> {
    // Sin guardia de `#corriendo` a propósito: las dudas acumuladas siguen
    // pendientes de revisión aunque el agente ya haya terminado la tarea.
    // Es justo el caso "volviste y esto es lo que decidí solo".
    await this.#revisarPendientes();
  }

  // ------------------------------------------------------------------ interno

  async #revisarPendientes(): Promise<void> {
    const r = this.politica.revisar(this.#leerSala());
    if (r.decision === "PREGUNTAR" && r.pregunta) {
      await this.#transporte.publicar({ tipo: "pregunta", pregunta: r.pregunta });
    }
  }

  async #tick(): Promise<void> {
    if (!this.#corriendo || this.#pensando) return;

    let paso = this.#enElAire;
    let fuente = "reintento";
    let degradado: string | undefined;

    if (!paso) {
      this.#pensando = true;
      try {
        const propuesto = await this.#siguientePaso();
        if (!propuesto) {
          this.parar();
          this.#eventos.onFin?.();
          return;
        }
        paso = propuesto.paso;
        fuente = propuesto.fuente;
        degradado = propuesto.degradado;
      } finally {
        this.#pensando = false;
      }
      // Mientras el modelo pensaba, la sala pudo pararlo.
      if (!this.#corriendo) return;
    }

    // Un paso ya aprobado no se vuelve a consultar: la sala ya dijo que sí.
    if (this.#aprobados.has(paso.n)) {
      this.#aprobados.delete(paso.n);
      this.#enElAire = undefined;
      await this.#publicarPaso({ ...paso, estado: "hecho" });
      return;
    }

    const sala = this.#leerSala();
    const r = this.politica.evaluar(paso, sala);
    this.#eventos.onDecision?.({
      paso,
      decision: r.decision,
      pendientes: this.politica.pendientes.length,
      fuente,
      degradado,
    });

    switch (r.decision) {
      case "ESPERAR": {
        // Se calla y guarda el paso para el próximo tick. No publica nada:
        // ese silencio es el comportamiento, no una falta de él.
        this.#enElAire = paso;
        return;
      }

      case "PREGUNTAR": {
        this.#enElAire = paso;
        await this.#publicarPaso({ ...paso, estado: "bloqueado" });
        if (r.pregunta) {
          await this.#transporte.publicar({ tipo: "pregunta", pregunta: r.pregunta });
        }
        return;
      }

      case "SEGUIR": {
        this.#enElAire = undefined;
        // La marca es lo que hace visible el silencio: sin ella, "avanzó
        // porque nadie miraba" no se distingue de un paso cualquiera.
        await this.#publicarPaso({
          ...paso,
          estado: "hecho",
          sinTestigos: sala.espectadores === 0,
        });
        if (r.volante) await this.#publicarVolante(r.volante);
        return;
      }
    }
  }

  /**
   * Saca el siguiente paso del plan, pidiendo uno nuevo si hace falta.
   *
   * Devuelve `undefined` cuando la tarea terminó o cuando ni el modelo ni el
   * respaldo dieron nada: mejor detenerse que girar en vacío.
   */
  async #siguientePaso(): Promise<
    { paso: Paso; fuente: string; degradado?: string } | undefined
  > {
    let degradado: string | undefined;

    if (this.#plan.length === 0) {
      const r = await this.#planear();
      if (!r) return undefined;
      degradado = r.degradado;
    }

    const g = this.#plan.shift();
    if (!g) return undefined;

    // `n` es un contador propio y nunca se reinicia: tras un desvío los pasos
    // nuevos no pueden pisar a los viejos en la vista.
    this.#n += 1;
    return {
      paso: {
        n: this.#n,
        texto: g.texto,
        riesgo: g.riesgo,
        confianza: g.confianza,
        estado: "ejecutando",
      },
      fuente: this.#fuente,
      degradado,
    };
  }

  /** Una sola llamada al modelo. Aquí es donde se paga la latencia. */
  async #planear(): Promise<{ degradado?: string } | undefined> {
    this.#eventos.onPlaneando?.(true);
    try {
      const res = await fetch("/api/paso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tarea: this.#tarea,
          previos: this.#previos,
          restricciones: this.#restricciones,
          desviado: this.#desviado,
          motivoDesvio: this.#motivoDesvio,
        }),
      });
      if (!res.ok) throw new Error(`/api/paso respondió ${res.status}`);
      const datos = (await res.json()) as RespuestaPlan;

      this.#plan = datos.pasos?.filter((p) => p.texto) ?? [];
      this.#fuente = datos.fuente;
      if (this.#plan.length === 0) return undefined;
      return { degradado: datos.degradado };
    } catch (e) {
      console.error("[agente] no pude planear", e);
      return undefined;
    } finally {
      this.#eventos.onPlaneando?.(false);
    }
  }

  #publicarPaso(paso: Paso): Promise<void> {
    // El historial que ve el modelo se lleva aquí, no en la UI: es lo que le
    // impide repetirse y lo que le dice qué línea abandonó tras un desvío.
    const i = this.#previos.findIndex((p) => p.n === paso.n);
    const entrada = { n: paso.n, texto: paso.texto, estado: paso.estado };
    if (i >= 0) this.#previos[i] = entrada;
    else this.#previos.push(entrada);

    return this.#transporte.publicar({ tipo: "paso", paso });
  }

  #publicarVolante(volante: Volante): Promise<void> {
    return this.#transporte.publicar({ tipo: "volante", volante });
  }
}

export { AGENTE };
