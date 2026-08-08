/**
 * El guion fijo de respaldo del chat.
 *
 * Red de seguridad: sin `ANTHROPIC_API_KEY`, si Claude tarda o si devuelve
 * basura, la sesión sigue viva con esto. Una demo que se congela en vivo no
 * se recupera.
 *
 * No sabe nada de la tarea real, así que no finge haberla resuelto: narra en
 * genérico y va armando un documento con lo que el equipo pide.
 *
 * Lo que sí respeta es la regla que hay que poder demostrar SIEMPRE, con
 * modelo o sin él: si hay un pedido sin atender, el agente lo atiende y no da
 * nada por cerrado. Un respaldo que se declara terminado y deja de responder
 * al chat rompe justamente lo que la sala existe para mostrar.
 */

import type {
  ArtefactoEnCurso,
  ContextoTurno,
  Intervencion,
  ModeloTurno,
  Turno,
} from "./modelo-turno";

const LINEAS = [
  { mensaje: "Arranco por acá. Primero miro con qué contamos.", actividad: "Reuniendo contexto" },
  { mensaje: "Ya tengo una idea de por dónde va. Voy armando un primer borrador.", actividad: "Redactando el borrador" },
  { mensaje: "Sumé una sección más. Decime si va por buen camino.", actividad: "Ampliando el documento" },
  { mensaje: "Repasé lo escrito y ajusté un par de cosas que no cerraban.", actividad: "Revisando el texto" },
  { mensaje: "Con esto lo doy por cerrado. Queda a mano para retocar.", actividad: "Cerrando" },
];

/**
 * Palabras que delatan que la tarea pide construir algo, no redactarlo.
 *
 * Es una heurística tosca y está bien que lo sea: con modelo de verdad esta
 * decisión la toma Claude. Existe para que el panel de código no quede sin
 * ejercitarse cuando no hay API key — que es justamente cuando más se mira.
 */
const SEÑAS_DE_CODIGO =
  /\b(c[oó]digo|componente|funci[oó]n|endpoint|api|script|clase|m[oó]dulo|react|tsx?|python|sql|query|consulta|programa|app)\b/i;

export class ModeloGuionTurno implements ModeloTurno {
  readonly nombre = "guion";

  async siguienteTurno(ctx: ContextoTurno): Promise<Turno> {
    const pedidos = ctx.conversacion.filter((x) => !x.deAgente);
    const pendientes = pedidos.filter((p) => ctx.pendientes.includes(p.id));
    // El conteo del cliente manda: la conversación llega recortada a una
    // ventana, y contar adentro se congela en cuanto el chat la desborda.
    const turnosDados =
      ctx.turnosDados ?? ctx.conversacion.filter((i) => i.deAgente).length;
    const entregable = SEÑAS_DE_CODIGO.test(ctx.tarea)
      ? codigo(ctx, pedidos, turnosDados)
      : {
          tipo: "documento" as const,
          titulo: "Avance",
          contenido: documento(ctx, pedidos, turnosDados),
        };

    // Hay algo sin atender: eso manda sobre el guion.
    if (pendientes.length > 0) {
      const quienes = [...new Set(pendientes.map((p) => p.autor))];
      return {
        mensaje: `Tomo lo que pidió ${quienes.join(" y ")} y lo aplico sobre lo que llevo.`,
        actividad: "Aplicando lo pedido",
        artefacto: entregable,
        atendio: pendientes.map((p) => p.id),
        fin: false,
      };
    }

    const i = Math.min(turnosDados, LINEAS.length - 1);
    const linea = LINEAS[i];

    return {
      mensaje: linea.mensaje,
      actividad: linea.actividad,
      artefacto: entregable,
      atendio: [],
      fin: i === LINEAS.length - 1,
    };
  }
}

/**
 * Un archivo que crece turno a turno, con los pedidos del equipo como
 * comentarios dentro del propio código. No pretende resolver la tarea real —
 * pretende que se vea lo que la sala pidió, dentro del entregable.
 */
function codigo(ctx: ContextoTurno, pedidos: Intervencion[], turno: number): ArtefactoEnCurso {
  /**
   * Los pedidos viajan recortados con la conversación: uno viejo desaparece
   * de la ventana y su comentario se esfumaría del archivo — "mi pedido
   * estaba ahí y ya no está". Igual que el modelo real, el guion evoluciona
   * el artefacto ANTERIOR: rescata los comentarios ya incorporados.
   */
  const previas = (ctx.artefacto?.contenido ?? "")
    .split("\n")
    .filter((l) => l.startsWith("// pedido de "));
  const nuevas = pedidos.map((p) => `// pedido de ${p.autor}: ${p.texto}`);
  const notas = [...new Set([...previas, ...nuevas])];

  const partes = [
    `// ${ctx.tarea}`,
    ...notas,
    ``,
    `export function resolver(entrada: string) {`,
    `  const pasos: string[] = [];`,
  ];

  for (let i = 0; i <= Math.min(turno, LINEAS.length - 1); i++) {
    partes.push(`  pasos.push(${JSON.stringify(LINEAS[i].actividad)});`);
  }

  if (ctx.decisiones.length > 0) {
    partes.push(``, ...ctx.decisiones.map((d) => `  // decidido por votación: ${d}`));
  }

  partes.push(``, `  return { entrada, pasos };`, `}`);
  return { tipo: "codigo", titulo: "resolver.ts", lenguaje: "ts", contenido: partes.join("\n") };
}

/** El documento refleja los pedidos: sin modelo, esa sigue siendo la prueba de que el chat manda. */
function documento(ctx: ContextoTurno, pedidos: Intervencion[], turnosDados: number): string {
  const hechos = LINEAS.slice(0, Math.min(turnosDados + 1, LINEAS.length));

  return [
    `## Tarea`,
    ctx.tarea,
    ``,
    `## Avance`,
    ...hechos.map((l) => `- ${l.mensaje}`),
    ``,
    `## Lo que pidió el equipo`,
    ...(pedidos.length === 0
      ? ["- (nada todavía)"]
      : pedidos.map((p) => `- ${p.autor}: ${p.texto}`)),
    ...(ctx.decisiones.length > 0 ? ["", `## Decidido por votación`, ...ctx.decisiones.map((d) => `- ${d}`)] : []),
  ].join("\n");
}
