/**
 * Un turno del agente en el chat compartido.
 *
 * Interfaz propia con varias implementaciones detrás, igual que `transporte.ts`:
 * el agente no sabe si al otro lado hay Claude o el guion de respaldo.
 *
 * Un turno no es "un paso de un plan": es lo que el agente dice ahora,
 * mirando toda la conversación — incluidas las instrucciones que la gente
 * escribió mientras trabajaba. Por eso puede cambiar de rumbo en el turno
 * siguiente y no hay que esperar a ningún replaneo.
 *
 * Corre SOLO en el servidor (ver `app/api/turno/route.ts`).
 */

import type { TipoArtefacto } from "./protocolo";

/** Una intervención ya ocurrida en el chat. */
export interface Intervencion {
  /** id del mensaje; el modelo lo usa para decir a cuál le hizo caso */
  id: string;
  /** nombre legible de quien habló ("ana"), o "agente" */
  autor: string;
  texto: string;
  deAgente: boolean;
}

/** El artefacto tal como está ahora, para que el modelo lo reescriba. */
export interface ArtefactoEnCurso {
  tipo: TipoArtefacto;
  titulo: string;
  lenguaje?: string;
  contenido: string;
}

export interface ContextoTurno {
  tarea: string;
  conversacion: Intervencion[];
  artefacto?: ArtefactoEnCurso;
  /** ids de mensajes humanos que el agente todavía no incorporó */
  pendientes: string[];
  /** lo que la sala decidió votando y el agente debe respetar */
  decisiones: string[];
  /**
   * Cuántos turnos dio el agente en TODA la sesión, contados por el cliente,
   * que tiene la conversación completa.
   *
   * Existe porque `conversacion` viaja recortada a `VENTANA_CONVERSACION`:
   * contar los turnos dentro de la ventana se congela en cuanto el chat
   * humano la desborda — y el guion, que progresa por ese conteo, repetía
   * sus líneas para siempre y el artefacto llegaba a ENCOGERSE.
   */
  turnosDados?: number;
}

export interface Turno {
  /** lo que el agente dice en el chat: breve y humano */
  mensaje: string;
  /** qué hizo para poder decirlo, en una frase */
  actividad?: string;
  /** el artefacto completo reescrito, si este turno lo tocó */
  artefacto?: ArtefactoEnCurso;
  /** ids de instrucciones humanas que este turno incorporó */
  atendio: string[];
  /** el agente considera que la tarea terminó */
  fin: boolean;
}

export interface ModeloTurno {
  readonly nombre: string;
  siguienteTurno(ctx: ContextoTurno): Promise<Turno>;
}

/** Tope duro del artefacto. Más que esto y el chat deja de ser el foco. */
export const MAX_ARTEFACTO = 8000;
/** Cuántas intervenciones ve el modelo. La historia entera no cabe ni hace falta. */
export const VENTANA_CONVERSACION = 24;

/** Un turno que venga torcido no debe tumbar la sesión. */
export function sanearTurno(crudo: unknown): Turno | undefined {
  if (!crudo || typeof crudo !== "object") return undefined;
  const o = crudo as Record<string, unknown>;

  const mensaje = typeof o.mensaje === "string" ? o.mensaje.trim() : "";
  if (!mensaje) return undefined;

  const actividad =
    typeof o.actividad === "string" && o.actividad.trim()
      ? o.actividad.trim().slice(0, 80)
      : undefined;

  const atendio = Array.isArray(o.atendio)
    ? o.atendio.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 10)
    : [];

  return {
    mensaje: mensaje.slice(0, 600),
    actividad,
    artefacto: sanearArtefacto(o.artefacto),
    atendio,
    fin: o.fin === true,
  };
}

function sanearArtefacto(crudo: unknown): ArtefactoEnCurso | undefined {
  if (!crudo || typeof crudo !== "object") return undefined;
  const o = crudo as Record<string, unknown>;

  const contenido = typeof o.contenido === "string" ? o.contenido : "";
  if (!contenido.trim()) return undefined;

  const tipo: TipoArtefacto = o.tipo === "codigo" ? "codigo" : "documento";
  const titulo =
    typeof o.titulo === "string" && o.titulo.trim()
      ? o.titulo.trim().slice(0, 80)
      : tipo === "codigo"
        ? "archivo.txt"
        : "Documento";

  const lenguaje =
    tipo === "codigo" && typeof o.lenguaje === "string" && o.lenguaje.trim()
      ? o.lenguaje.trim().toLowerCase().slice(0, 20)
      : undefined;

  return { tipo, titulo, lenguaje, contenido: contenido.slice(0, MAX_ARTEFACTO) };
}

/** El prompt es el mismo para cualquier proveedor. */
export function construirPromptTurno(ctx: ContextoTurno): string {
  const conversacion =
    ctx.conversacion.length === 0
      ? "(todavía nadie habló)"
      : ctx.conversacion
          .map((i) => (i.deAgente ? `[vos] ${i.texto}` : `[${i.autor} · id:${i.id}] ${i.texto}`))
          .join("\n");

  const pendientes =
    ctx.pendientes.length === 0
      ? "(ninguna)"
      : ctx.pendientes.map((id) => `- id:${id}`).join("\n");

  const decisiones =
    ctx.decisiones.length === 0 ? "(ninguna)" : ctx.decisiones.map((d) => `- ${d}`).join("\n");

  const artefacto = ctx.artefacto
    ? `\nLO QUE YA CONSTRUISTE — ${ctx.artefacto.titulo} (${ctx.artefacto.tipo}):
\`\`\`
${ctx.artefacto.contenido}
\`\`\`
Si lo tocás, devolvelo ENTERO y actualizado, no un fragmento ni un parche.`
    : `\nTodavía no construiste nada.`;

  return `Sos un agente de IA trabajando dentro de un chat que un equipo entero ve en
vivo. Cualquiera puede escribirte para corregirte y vos tenés que hacerles caso.

TAREA: ${ctx.tarea}

CONVERSACIÓN HASTA AHORA:
${conversacion}

INSTRUCCIONES QUE TODAVÍA NO INCORPORASTE:
${pendientes}

LO QUE EL EQUIPO DECIDIÓ VOTANDO (obligatorio):
${decisiones}
${artefacto}

Devolvé UN turno: lo próximo que decís y hacés. Nada de planes largos.

"mensaje": 1 o 2 frases, en primera persona, como le hablarías a un compañero.
Sin jerga ni formato de log. Si alguien te pidió algo, decí explícitamente que
lo estás aplicando y nombralo.
Bien: "Le agrego el manejo de error que pidió ana. Quedó cubierto el timeout."
Mal: "tool_call: edit_file(path=...)"

"actividad": máximo 6 palabras sobre qué hiciste para eso ("Revisando el
esquema de la base"). Opcional.

"atendio": los "id:" de las instrucciones de la lista de pendientes que este
turno SÍ incorporaste. Array vacío si ninguna. No inventes ids.

"artefacto": incluilo SOLO si este turno creó o cambió el entregable.
  - "tipo": "codigo" si la tarea pide construir algo ejecutable, "documento"
    si pide investigar, resumir, redactar o analizar.
  - "titulo": nombre de archivo ("carrito.tsx") o título del documento.
  - "lenguaje": solo para código ("tsx", "python", "sql"…).
  - "contenido": el entregable COMPLETO. Para documento, texto plano con
    saltos de línea; podés usar "## " para subtítulos y "- " para viñetas.
Avanzá de a poco: cada turno agrega o mejora una parte, no lo entregues todo
en el primero.

"fin": true solo cuando el entregable ya está terminado y no queda nada.

Respondé SOLO con JSON:
{"mensaje":"...","actividad":"...","atendio":[],"artefacto":{"tipo":"codigo","titulo":"...","lenguaje":"...","contenido":"..."},"fin":false}`;
}

/** Detecta si dos pedidos se contradicen. Es lo que dispara la votación. */
export function construirPromptConflicto(a: string, b: string): string {
  return `Dos personas del mismo equipo le pidieron cosas distintas al mismo agente:

A: "${a}"
B: "${b}"

¿Se contradicen, de modo que hacer una impide hacer la otra?

Respondé SOLO con JSON:
{"conflicto":true,"motivo":"frase corta que explique el choque"}
o
{"conflicto":false,"motivo":""}`;
}

export interface Conflicto {
  conflicto: boolean;
  motivo: string;
}

export function sanearConflicto(crudo: unknown): Conflicto {
  if (!crudo || typeof crudo !== "object") return { conflicto: false, motivo: "" };
  const o = crudo as Record<string, unknown>;
  const motivo = typeof o.motivo === "string" ? o.motivo.trim().slice(0, 120) : "";
  return { conflicto: o.conflicto === true && motivo.length > 0, motivo };
}

/** Con `format: json` la respuesta debería ser JSON puro, pero a veces trae prosa alrededor. */
export function extraerJson(texto: string): unknown {
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
