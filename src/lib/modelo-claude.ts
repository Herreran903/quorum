/**
 * Los turnos los produce Claude.
 *
 * Corre solo en el servidor (ver `app/api/turno/route.ts`): la llave nunca
 * debe pisar el bundle del navegador.
 *
 * Este camino no se puede probar sin ANTHROPIC_API_KEY, así que cada decisión
 * de aquí va verificada contra la referencia del API — no contra memoria:
 *
 * - `claude-opus-5` por defecto. El default anterior (claude-3-5-haiku-
 *   20241022) fue RETIRADO en febrero de 2026 y devuelve 404: el estreno en
 *   vivo habría fallado en el primer turno. `ANTHROPIC_MODEL` sigue siendo el
 *   override para quien prefiera otra cosa (p. ej. `claude-haiku-4-5` si la
 *   latencia manda sobre la calidad — esa decisión es del dueño, no nuestra).
 * - Sin `temperature`: los modelos actuales rechazan los parámetros de
 *   muestreo con un 400. El estilo se dirige desde el prompt.
 * - `effort: "low"`: hay una llamada por turno de chat y la sala tiene que
 *   sentirse viva; low en Opus 5 rinde por encima de su peso y recorta
 *   latencia y tokens. El thinking queda en su default (adaptativo).
 * - `max_tokens` cubre thinking MÁS respuesta en Opus 5: los topes viejos
 *   (2000/200) truncarían el turno a mitad del pensamiento.
 */

import Anthropic from "@anthropic-ai/sdk";

import {
  construirPromptTurno,
  extraerJson,
  sanearTurno,
  type ContextoTurno,
  type ModeloTurno,
  type Turno,
} from "./modelo-turno";

const MODELO_POR_DEFECTO = "claude-opus-5";
/** Con thinking adaptativo un turno puede pensar antes de hablar. */
const TIMEOUT_MS = 60_000;

export class ModeloClaude implements ModeloTurno {
  readonly nombre: string;
  readonly #cliente: Anthropic;

  constructor(nombre = process.env.ANTHROPIC_MODEL ?? MODELO_POR_DEFECTO) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("falta ANTHROPIC_API_KEY");
    this.nombre = nombre;
    this.#cliente = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  }

  async siguienteTurno(ctx: ContextoTurno): Promise<Turno> {
    const crudo = await this.#pedir(construirPromptTurno(ctx), 6000);
    const turno = sanearTurno(extraerJson(crudo));
    if (!turno) throw new Error(`Claude devolvió un turno inservible: ${crudo.slice(0, 200)}`);
    return turno;
  }

  async #pedir(prompt: string, maxTokens: number): Promise<string> {
    const res = await this.#cliente.messages.create({
      model: this.nombre,
      max_tokens: maxTokens,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    });

    // Los clasificadores pueden declinar con HTTP 200: hay que mirar
    // stop_reason antes de leer content. El throw degrada al guion local.
    if (res.stop_reason === "refusal") {
      throw new Error("Claude declinó el turno (refusal)");
    }

    const bloque = res.content.find((b) => b.type === "text");
    const texto = bloque?.type === "text" ? bloque.text : undefined;
    if (!texto) throw new Error("Claude devolvió una respuesta vacía");
    return texto;
  }
}
