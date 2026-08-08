/**
 * Agente falso. Emite un paso cada 2 segundos con riesgo y confianza variables.
 *
 * No hay LLM aquí y no debe haberlo todavía: el objetivo es poder VER la
 * política decidiendo, con la sala llenándose y vaciándose, sin depender de
 * una API externa ni de latencia de modelo.
 *
 * Lo corre una sola pestaña — la que le da a "arrancar". Las demás solo miran.
 */

import { AGENTE, type Paso, type Volante } from "./protocolo";
import { Politica, type Sala } from "./iniciativa";
import type { Transporte } from "./transporte";

export const INTERVALO_MS = 2000;

interface Guion {
  texto: string;
  riesgo: Paso["riesgo"];
  confianza: number;
}

/**
 * Un guion fijo, no aleatorio, para que la demo pegue siempre los dos casos
 * interesantes: el paso arriesgado con la sala llena y el paso arriesgado con
 * la sala vacía.
 */
const GUION: Guion[] = [
  { texto: "Buscar estudios sobre iniciativa de agentes", riesgo: "bajo", confianza: 0.95 },
  { texto: "Leer el resumen de arXiv 2509.11826", riesgo: "bajo", confianza: 0.91 },
  { texto: "Descartar 4 resultados sin revisión por pares", riesgo: "bajo", confianza: 0.58 },
  { texto: "Decidir si el foro de Cursor cuenta como evidencia", riesgo: "bajo", confianza: 0.41 },
  { texto: "Extraer la cifra de 31,8% de trabajo concurrente", riesgo: "bajo", confianza: 0.89 },
  { texto: "Descartar el estudio de 2019 por obsoleto", riesgo: "alto", confianza: 0.52 },
  { texto: "Citar una cifra que solo aparece en un blog", riesgo: "alto", confianza: 0.44 },
  { texto: "Contrastar las tres fuentes entre sí", riesgo: "bajo", confianza: 0.83 },
  { texto: "Interpretar la contradicción entre dos de ellas", riesgo: "bajo", confianza: 0.47 },
  { texto: "Redactar el informe con las tres fuentes", riesgo: "bajo", confianza: 0.9 },
  { texto: "Publicar el informe en el canal del equipo", riesgo: "alto", confianza: 0.78 },
];

/**
 * Por dónde sigue el agente cuando la sala lo desvía.
 *
 * Es el paso 2 del guion de demo: interrumpir no lo mata, le cambia el rumbo,
 * y ese cambio se ve en la otra pestaña.
 */
const DESVIO: Guion[] = [
  { texto: "Descartar la línea anterior por indicación de la sala", riesgo: "bajo", confianza: 0.94 },
  { texto: "Buscar solo fuentes con revisión por pares", riesgo: "bajo", confianza: 0.87 },
  { texto: "Releer el estudio de 2019 que había descartado", riesgo: "bajo", confianza: 0.66 },
  { texto: "Decidir si la muestra de ese estudio es comparable", riesgo: "bajo", confianza: 0.39 },
  { texto: "Rehacer el informe sin la cifra del blog", riesgo: "bajo", confianza: 0.85 },
  { texto: "Publicar el informe corregido", riesgo: "alto", confianza: 0.81 },
];

export interface EventosAgente {
  /** se llama en cada tick con lo que decidió la política */
  onDecision?: (info: {
    paso: Paso;
    decision: "SEGUIR" | "PREGUNTAR" | "ESPERAR";
    pendientes: number;
  }) => void;
  onFin?: () => void;
}

export class AgenteSimulado {
  readonly politica: Politica;

  readonly #transporte: Transporte;
  readonly #leerSala: () => Sala;
  readonly #eventos: EventosAgente;

  #reloj: ReturnType<typeof setInterval> | undefined;
  #indice = 0;
  /** el paso que quedó en el aire por un ESPERAR; se reintenta tal cual. */
  #enElAire: Paso | undefined;
  /**
   * Pasos que la sala ya aprobó. Sin esto el agente volvería a preguntar lo
   * mismo en el siguiente tick: la política es sin memoria de aprobaciones a
   * propósito, y quién dio el permiso es asunto de quien la usa.
   */
  readonly #aprobados = new Set<number>();
  /** true una vez que la sala lo desvió: sigue por `DESVIO`, no por `GUION`. */
  #desviado = false;
  /** numeración global de pasos; nunca se reinicia. */
  #n = 0;
  #corriendo = false;

  constructor(
    transporte: Transporte,
    leerSala: () => Sala,
    eventos: EventosAgente = {},
  ) {
    this.#transporte = transporte;
    this.#leerSala = leerSala;
    this.#eventos = eventos;
    this.politica = new Politica();
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
    this.#desviado = true;
    this.#indice = 0;
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
    if (!this.#corriendo) return;

    const paso = this.#enElAire ?? this.#siguientePaso();
    if (!paso) {
      this.parar();
      this.#eventos.onFin?.();
      return;
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
        await this.#publicarPaso({ ...paso, estado: "hecho" });
        if (r.volante) await this.#publicarVolante(r.volante);
        return;
      }
    }
  }

  #siguientePaso(): Paso | undefined {
    const linea = this.#desviado ? DESVIO : GUION;
    if (this.#indice >= linea.length) return undefined;
    const g = linea[this.#indice];
    this.#indice += 1;
    // `n` es un contador propio, no el índice de la línea: tras un desvío el
    // índice vuelve a 0 pero la numeración de pasos NO puede reiniciarse, o
    // los pasos nuevos pisarían a los viejos en la vista.
    this.#n += 1;
    return {
      n: this.#n,
      texto: g.texto,
      riesgo: g.riesgo,
      confianza: g.confianza,
      estado: "ejecutando",
    };
  }

  #publicarPaso(paso: Paso): Promise<void> {
    return this.#transporte.publicar({ tipo: "paso", paso });
  }

  #publicarVolante(volante: Volante): Promise<void> {
    return this.#transporte.publicar({ tipo: "volante", volante });
  }
}

export { AGENTE };
