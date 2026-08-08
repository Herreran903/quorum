/**
 * Modelo local vía Ollama.
 *
 * Es el que se usa durante el hackathon: no gasta llamadas, no necesita llave
 * y funciona sin internet. Corre en el servidor de Next, no en el navegador —
 * Ollama no acepta peticiones desde un origen web cualquiera.
 */

import {
  construirPrompt,
  sanearPlan,
  type ContextoPaso,
  type Modelo,
  type PasoPropuesto,
} from "./modelo";

const HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const POR_DEFECTO = "qwen2.5:14b";
/**
 * Medido: un 14B local tarda ~21s en frío en esta máquina. El margen es
 * generoso a propósito — se paga UNA vez por plan, no una vez por paso.
 */
const TIMEOUT_MS = 90_000;

export class ModeloOllama implements Modelo {
  readonly nombre: string;

  constructor(nombre = process.env.OLLAMA_MODEL ?? POR_DEFECTO) {
    this.nombre = nombre;
  }

  async planear(ctx: ContextoPaso): Promise<PasoPropuesto[]> {
    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: this.nombre,
        stream: false,
        // Obliga a Ollama a emitir JSON; sin esto los modelos pequeños
        // envuelven la respuesta en prosa y hay que rescatarla a mano.
        format: "json",
        options: {
          // Algo de variedad para que dos corridas no sean idénticas, pero no
          // tanta como para que la confianza se vuelva ruido.
          temperature: 0.6,
          num_predict: 900,
        },
        messages: [{ role: "user", content: construirPrompt(ctx) }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama respondió ${res.status}: ${await res.text()}`);
    }

    const datos = (await res.json()) as { message?: { content?: string } };
    const crudo = datos.message?.content;
    if (!crudo) throw new Error("Ollama devolvió una respuesta vacía");

    const pasos = sanearPlan(extraerJson(crudo));
    if (pasos.length === 0) {
      throw new Error(`Ollama devolvió un plan inservible: ${crudo.slice(0, 200)}`);
    }
    return pasos;
  }
}

/**
 * Con `format: "json"` la respuesta debería ser JSON puro, pero los modelos
 * pequeños a veces le cuelgan texto antes o después. Se rescata el primer
 * objeto de la cadena en vez de fallar.
 */
function extraerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    const i = texto.indexOf("{");
    const j = texto.lastIndexOf("}");
    if (i < 0 || j <= i) return undefined;
    try {
      return JSON.parse(texto.slice(i, j + 1));
    } catch {
      return undefined;
    }
  }
}
