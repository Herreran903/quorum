/**
 * El agente pide su PLAN aquí — no un paso suelto.
 *
 * Vive en el servidor por dos razones, no una:
 *  - Ollama no acepta peticiones desde un origen web cualquiera.
 *  - cuando se cambie a un modelo de nube, su llave no puede pisar el bundle.
 *
 * Si el modelo falla, se responde con el guion fijo en vez de un error. Un
 * demo en vivo no se puede quedar congelado esperando a un modelo local.
 */

import { NextResponse } from "next/server";

import type { ContextoPaso, Modelo, PasoPropuesto } from "@/lib/modelo";
import { ModeloGuion, TAREA_POR_DEFECTO } from "@/lib/modelo-guion";
import { ModeloOllama } from "@/lib/modelo-ollama";

/** Nunca prerenderizar: cada plan es una decisión nueva. */
export const dynamic = "force-dynamic";
/** Planear con un modelo local puede pasarse del tope por defecto de Next. */
export const maxDuration = 120;

const respaldo = new ModeloGuion();

function elegirModelo(): Modelo {
  switch (process.env.QUORUM_MODELO ?? "ollama") {
    case "guion":
      return respaldo;
    case "ollama":
    default:
      return new ModeloOllama();
  }
}

export async function POST(req: Request) {
  let ctx: ContextoPaso;
  try {
    const cuerpo = (await req.json()) as Partial<ContextoPaso>;
    ctx = {
      tarea: cuerpo.tarea ?? TAREA_POR_DEFECTO,
      previos: Array.isArray(cuerpo.previos) ? cuerpo.previos : [],
      restricciones: Array.isArray(cuerpo.restricciones) ? cuerpo.restricciones : [],
      desviado: cuerpo.desviado === true,
      motivoDesvio: cuerpo.motivoDesvio,
    };
  } catch {
    return NextResponse.json({ error: "cuerpo invalido" }, { status: 400 });
  }

  const modelo = elegirModelo();
  const arranque = Date.now();

  try {
    const pasos = await modelo.planear(ctx);
    return NextResponse.json({
      pasos,
      fuente: modelo.nombre,
      ms: Date.now() - arranque,
    } satisfies Respuesta);
  } catch (e) {
    // Degradar, no romper: el guion mantiene viva la sesión y la UI muestra
    // que el modelo se cayó.
    return NextResponse.json({
      pasos: await respaldo.planear(ctx),
      fuente: "guion",
      ms: Date.now() - arranque,
      degradado: e instanceof Error ? e.message : String(e),
    } satisfies Respuesta);
  }
}

export interface Respuesta {
  pasos: PasoPropuesto[];
  /** qué produjo el plan: el nombre del modelo, o "guion" */
  fuente: string;
  /** cuánto tardó en planear */
  ms: number;
  /** presente solo si el modelo falló y respondió el guion */
  degradado?: string;
}
