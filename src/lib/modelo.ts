/**
 * De dónde salen los pasos del agente.
 *
 * Mismo patrón que `transporte.ts`: una interfaz propia y varias
 * implementaciones detrás. El agente no sabe si al otro lado hay un modelo
 * local, uno en la nube, o un guion fijo.
 *
 * Por qué importa aquí más que en otros sitios: `confianza` es la señal que
 * alimenta la política. Que el MODELO la declare — y no un número inventado
 * por nosotros — es lo que convierte a Quorum en algo más que una animación.
 *
 * Esto corre SOLO en el servidor (ver `app/api/paso/route.ts`). El navegador
 * nunca habla con un proveedor de modelos: ni con Ollama, por CORS, ni con
 * uno de nube, porque su llave jamás debe salir del servidor.
 */

import type { Riesgo } from "./protocolo";

/** Lo que el agente sabe cuando pide el siguiente paso. */
export interface ContextoPaso {
  /** la tarea larga que se le encargó */
  tarea: string;
  /** lo que ya hizo, en orden */
  previos: { n: number; texto: string; estado: string }[];
  /** reglas que la sala le fijó y que debe respetar */
  restricciones: string[];
  /** true si la sala lo desvió; entonces debe cambiar de rumbo */
  desviado: boolean;
  motivoDesvio?: string;
}

/** Lo que el modelo propone. */
export interface PasoPropuesto {
  texto: string;
  riesgo: Riesgo;
  /** 0..1, declarada por el propio modelo */
  confianza: number;
  /** el modelo considera que la tarea terminó */
  fin: boolean;
}

export interface Modelo {
  readonly nombre: string;
  /**
   * Devuelve el plan COMPLETO, no un paso.
   *
   * Medido en esta máquina, un 14B local tarda ~21s por llamada. Con un paso
   * por llamada el demo serían minutos de pantalla muerta, y lo que hay que
   * ver es la política reaccionando en vivo. Planear una vez y ejecutar
   * después saca la latencia del bucle: se paga al arrancar y ya.
   *
   * Además es como trabaja un agente de verdad — planifica y luego ejecuta —
   * y la `confianza` sigue siendo declarada por el modelo, que es lo que
   * alimenta la política.
   */
  planear(ctx: ContextoPaso): Promise<PasoPropuesto[]>;
}

/** Tope de pasos por plan: ni un demo eterno ni uno que se queda corto. */
export const MAX_PASOS = 14;
export const MIN_PASOS = 6;

/** Un `PasoPropuesto` que venga torcido no debe tumbar la sesión. */
export function sanear(crudo: unknown): PasoPropuesto | undefined {
  if (!crudo || typeof crudo !== "object") return undefined;
  const o = crudo as Record<string, unknown>;

  const texto = typeof o.texto === "string" ? o.texto.trim() : "";
  if (!texto) return undefined;

  const riesgo: Riesgo = o.riesgo === "alto" ? "alto" : "bajo";

  // Un modelo pequeño devuelve la confianza como "0.8", como 80, o no la
  // devuelve. Sin un número usable la política pierde su señal, así que se
  // normaliza y, en el peor caso, se asume incertidumbre alta — que es la
  // lectura prudente: ante la duda, que pregunte.
  let confianza = typeof o.confianza === "number" ? o.confianza : Number(o.confianza);
  if (!Number.isFinite(confianza)) confianza = 0.5;
  if (confianza > 1) confianza = confianza / 100;
  confianza = Math.min(1, Math.max(0, confianza));

  return {
    texto: texto.slice(0, 200),
    riesgo,
    confianza,
    fin: o.fin === true,
  };
}

/** Un plan que venga torcido no debe tumbar la sesión. */
export function sanearPlan(crudo: unknown): PasoPropuesto[] {
  const lista = Array.isArray(crudo)
    ? crudo
    : Array.isArray((crudo as { pasos?: unknown })?.pasos)
      ? (crudo as { pasos: unknown[] }).pasos
      : [];

  const pasos: PasoPropuesto[] = [];
  for (const item of lista) {
    const p = sanear(item);
    if (p) pasos.push(p);
    if (pasos.length >= MAX_PASOS) break;
  }
  return pasos;
}

/** El prompt es el mismo para cualquier proveedor. */
export function construirPrompt(ctx: ContextoPaso): string {
  const hechos =
    ctx.previos.length === 0
      ? "(ninguno todavía)"
      : ctx.previos.map((p) => `${p.n}. ${p.texto} [${p.estado}]`).join("\n");

  const reglas =
    ctx.restricciones.length === 0
      ? "(ninguna)"
      : ctx.restricciones.map((r) => `- ${r}`).join("\n");

  const desvio = ctx.desviado
    ? `\nLA SALA TE DESVIÓ Y DIJO: "${ctx.motivoDesvio ?? "por ahí no"}".
Cambia de rumbo. NO repitas los pasos ya dados. El primer paso del plan nuevo
debe reconocer el cambio de dirección.`
    : "";

  return `Eres un agente que ejecuta una tarea larga de INVESTIGACIÓN.

TAREA: ${ctx.tarea}

PASOS YA DADOS:
${hechos}

RESTRICCIONES QUE LA SALA TE FIJÓ (obligatorias):
${reglas}${desvio}

Devuelve EXACTAMENTE 10 pasos. Ni más ni menos.

Cada "texto": una acción concreta que EMPIEZA CON UN VERBO EN INFINITIVO, de
MÁXIMO 10 PALABRAS.
Bien: "Descartar cuatro resultados sin revisión por pares"
Mal: "Análisis comparativo de sistemas colaborativos"  (no empieza con verbo)
Mal: "Iniciar una revisión bibliográfica para identificar estudios previos y
relevantes"  (demasiado largo)

"riesgo": "alto" SOLO si el paso descarta evidencia, cita algo que no pudiste
verificar, o publica o envía algo hacia afuera. Si no, "bajo".
EXACTAMENTE 3 de los 10 pasos deben ser "alto", y no pueden ir seguidos.

"confianza": número entre 0 y 1, qué tan seguro estás de ese paso. Sé honesto.
Los pasos de juicio, decisión o interpretación van por DEBAJO de 0.6.
Los de buscar o leer van por encima de 0.85.

Responde SOLO con JSON:
{"pasos":[{"texto":"...","riesgo":"bajo","confianza":0.9},{"texto":"...","riesgo":"alto","confianza":0.45}]}`;
}
