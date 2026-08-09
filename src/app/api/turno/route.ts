/**
 * El agente pide aquí su próximo turno de chat, y aquí se consulta si dos
 * pedidos se contradicen.
 *
 * Vive en el servidor porque la llave del proveedor no puede pisar el bundle
 * del navegador.
 *
 * Si el modelo falla se responde con el guion fijo en vez de un error: una
 * demo en vivo no se puede quedar congelada esperando a la nube.
 */

import { NextResponse } from "next/server";

import type { ContextoTurno, ModeloTurno, Turno } from "@/lib/modelo-turno";
import { VENTANA_CONVERSACION } from "@/lib/modelo-turno";
import { ModeloGuionTurno } from "@/lib/modelo-guion-turno";
import { ModeloClaude } from "@/lib/modelo-claude";
import { ModeloAbierto } from "@/lib/modelo-abierto";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const respaldo = new ModeloGuionTurno();

function elegirModelo(): ModeloTurno {
  if ((process.env.SALA_MODELO ?? "claude") === "guion") return respaldo;
  try {
    return new ModeloClaude();
  } catch {
    // Sin ANTHROPIC_API_KEY: probar el proveedor abierto antes de rendirse.
  }
  try {
    return new ModeloAbierto();
  } catch {
    // Sin proveedor configurado: el guion mantiene viva la sala.
    return respaldo;
  }
}

export async function POST(req: Request) {
  let cuerpo: Partial<ContextoTurno> & { conflicto?: { a: string; b: string } };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo invalido" }, { status: 400 });
  }

  const modelo = elegirModelo();

  // Modo consulta: ¿estos dos pedidos chocan? Solo un modelo real sabe
  // responderlo; con el guion no se abre ninguna votación automática y la
  // sala la escala a mano.
  if (cuerpo.conflicto) {
    const { a, b } = cuerpo.conflicto;
    if (!(modelo instanceof ModeloClaude || modelo instanceof ModeloAbierto)) {
      return NextResponse.json({ conflicto: false, motivo: "" });
    }
    try {
      return NextResponse.json(await modelo.hayConflicto(a, b));
    } catch {
      return NextResponse.json({ conflicto: false, motivo: "" });
    }
  }

  const ctx: ContextoTurno = {
    tarea: cuerpo.tarea ?? "",
    conversacion: (Array.isArray(cuerpo.conversacion) ? cuerpo.conversacion : []).slice(
      -VENTANA_CONVERSACION,
    ),
    artefacto: cuerpo.artefacto,
    pendientes: Array.isArray(cuerpo.pendientes) ? cuerpo.pendientes : [],
    decisiones: Array.isArray(cuerpo.decisiones) ? cuerpo.decisiones : [],
    turnosDados:
      typeof cuerpo.turnosDados === "number" && cuerpo.turnosDados >= 0
        ? cuerpo.turnosDados
        : undefined,
  };

  const arranque = Date.now();
  try {
    const turno = await modelo.siguienteTurno(ctx);
    return NextResponse.json({
      turno,
      fuente: modelo.nombre,
      ms: Date.now() - arranque,
    } satisfies Respuesta);
  } catch (e) {
    return NextResponse.json({
      turno: await respaldo.siguienteTurno(ctx),
      fuente: "guion",
      ms: Date.now() - arranque,
      degradado: e instanceof Error ? e.message : String(e),
    } satisfies Respuesta);
  }
}

export interface Respuesta {
  turno: Turno;
  /** qué produjo el turno: el nombre del modelo, o "guion" */
  fuente: string;
  ms: number;
  /** presente solo si el modelo falló y respondió el guion */
  degradado?: string;
}
