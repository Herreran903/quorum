/**
 * Los turnos los produce Claude.
 *
 * Corre solo en el servidor (ver `app/api/turno/route.ts`): la llave nunca
 * debe pisar el bundle del navegador.
 *
 * Se usa un modelo rápido por defecto: hay una llamada por turno, así que la
 * latencia se paga en cada intervención y el chat tiene que sentirse vivo.
 */

import Anthropic from "@anthropic-ai/sdk";

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

const MODELO_POR_DEFECTO = "claude-3-5-haiku-20241022";
const TIMEOUT_MS = 30_000;

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
    const crudo = await this.#pedir(construirPromptTurno(ctx), 2000);
    const turno = sanearTurno(extraerJson(crudo));
    if (!turno) throw new Error(`Claude devolvió un turno inservible: ${crudo.slice(0, 200)}`);
    return turno;
  }

  /** ¿Estos dos pedidos se contradicen? Es lo que abre una votación. */
  async hayConflicto(a: string, b: string): Promise<Conflicto> {
    const crudo = await this.#pedir(construirPromptConflicto(a, b), 200);
    return sanearConflicto(extraerJson(crudo));
  }

  async #pedir(prompt: string, maxTokens: number): Promise<string> {
    const res = await this.#cliente.messages.create({
      model: this.nombre,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });
    const bloque = res.content.find((b) => b.type === "text");
    const texto = bloque?.type === "text" ? bloque.text : undefined;
    if (!texto) throw new Error("Claude devolvió una respuesta vacía");
    return texto;
  }
}
