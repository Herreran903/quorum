/**
 * Turnos por cualquier proveedor que hable el dialecto OpenAI.
 *
 * Existe porque la llave de Anthropic no siempre está a mano y el guion no
 * piensa. Con dos variables de entorno esto conversa con:
 *
 *   - Ollama local     SALA_MODELO_URL=http://localhost:11434/v1   (sin llave)
 *   - Google AI Studio SALA_MODELO_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *   - Groq             SALA_MODELO_URL=https://api.groq.com/openai/v1
 *
 * más SALA_MODELO_NOMBRE (el id del modelo) y SALA_MODELO_KEY si el proveedor
 * la exige. La ruta lo elige cuando no hay ANTHROPIC_API_KEY.
 *
 * SALA_MODELO_RAZONAMIENTO (p. ej. "low") acota cuánto piensa un modelo
 * razonador antes de escribir. Los Gemini 3.x piensan por defecto y sin esto
 * el presupuesto de tokens se va entero en razonamiento — respuesta vacía con
 * `finish_reason: length`, medido. Es opcional porque no todos lo aceptan:
 * Ollama devuelve 400 con modelos que no piensan.
 *
 * Va con fetch a propósito: instalar el SDK de un proveedor por endpoint
 * mataría la gracia de que TODOS expongan el mismo endpoint.
 */

import {
  construirPromptConflicto,
  construirPromptTurno,
  extraerJson,
  sanearConflicto,
  sanearTurno,
  type Conflicto,
  type ContextoTurno,
  type ModeloTurno,
  type Turno,
} from "./modelo-turno";

/** Un 14B local en CPU puede pensar despacio; mejor tarde que degradado. */
const TIMEOUT_MS = 120_000;

export class ModeloAbierto implements ModeloTurno {
  readonly nombre: string;
  readonly #url: string;
  readonly #llave: string | undefined;
  readonly #razonamiento: string | undefined;

  constructor() {
    const base = process.env.SALA_MODELO_URL;
    const nombre = process.env.SALA_MODELO_NOMBRE;
    if (!base) throw new Error("falta SALA_MODELO_URL");
    if (!nombre) throw new Error("falta SALA_MODELO_NOMBRE");
    this.#url = base.replace(/\/+$/, "") + "/chat/completions";
    this.nombre = nombre;
    this.#llave = process.env.SALA_MODELO_KEY || undefined;
    this.#razonamiento = process.env.SALA_MODELO_RAZONAMIENTO || undefined;
  }

  async siguienteTurno(ctx: ContextoTurno): Promise<Turno> {
    const crudo = await this.#pedir(construirPromptTurno(ctx), 6000);
    const turno = sanearTurno(extraerJson(crudo));
    if (!turno) {
      throw new Error(`${this.nombre} devolvió un turno inservible: ${crudo.slice(0, 200)}`);
    }
    return turno;
  }

  /** ¿Estos dos pedidos se contradicen? Es lo que abre una votación. */
  async hayConflicto(a: string, b: string): Promise<Conflicto> {
    const crudo = await this.#pedir(construirPromptConflicto(a, b), 1500);
    return sanearConflicto(extraerJson(crudo));
  }

  async #pedir(prompt: string, maxTokens: number): Promise<string> {
    const res = await fetch(this.#url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.#llave ? { authorization: `Bearer ${this.#llave}` } : {}),
      },
      body: JSON.stringify({
        model: this.nombre,
        max_tokens: maxTokens,
        ...(this.#razonamiento ? { reasoning_effort: this.#razonamiento } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detalle = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`${this.nombre} respondió ${res.status}: ${detalle}`);
    }

    const texto = contenidoDe(await res.json());
    if (!texto) throw new Error(`${this.nombre} devolvió una respuesta vacía`);
    return limpiarRazonamiento(texto);
  }
}

/** El texto de la primera opción, si el proveedor mandó algo usable. */
export function contenidoDe(datos: unknown): string | undefined {
  const d = datos as { choices?: { message?: { content?: unknown } }[] } | null;
  const contenido = d?.choices?.[0]?.message?.content;
  return typeof contenido === "string" && contenido.trim() ? contenido : undefined;
}

/**
 * Los modelos razonadores (qwen3, deepseek-r1, varios :free de OpenRouter)
 * piensan en voz alta dentro de <think>…</think> antes del JSON. Si el
 * razonamiento menciona llaves, `extraerJson` agarraría el objeto equivocado.
 */
export function limpiarRazonamiento(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
