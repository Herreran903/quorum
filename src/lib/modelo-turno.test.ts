import { describe, expect, it } from "vitest";

import { MAX_ARTEFACTO, extraerJson, sanearConflicto, sanearTurno } from "./modelo-turno";
import { contenidoDe, limpiarRazonamiento } from "./modelo-abierto";
import { ModeloGuionTurno } from "./modelo-guion-turno";
import { ganadoraDe, presupuestoDeTexto, trocear } from "./agente-chat";
import { TOPE_CONTENIDO_BYTES, type Cuerpo, type Votacion } from "./protocolo";

describe("sanearTurno", () => {
  it("descarta lo que no trae mensaje", () => {
    expect(sanearTurno({})).toBeUndefined();
    expect(sanearTurno({ mensaje: "   " })).toBeUndefined();
    expect(sanearTurno(null)).toBeUndefined();
    expect(sanearTurno("texto suelto")).toBeUndefined();
  });

  it("acepta un turno mínimo", () => {
    expect(sanearTurno({ mensaje: "Voy con esto" })).toEqual({
      mensaje: "Voy con esto",
      actividad: undefined,
      artefacto: undefined,
      atendio: [],
      fin: false,
    });
  });

  it("descarta ids de `atendio` que no sean cadenas", () => {
    const t = sanearTurno({ mensaje: "x", atendio: ["a1", 7, null, "b2", ""] });
    expect(t?.atendio).toEqual(["a1", "b2"]);
  });

  it("tolera que `atendio` no sea un array", () => {
    expect(sanearTurno({ mensaje: "x", atendio: "a1" })?.atendio).toEqual([]);
  });

  it("ignora un artefacto sin contenido", () => {
    expect(sanearTurno({ mensaje: "x", artefacto: { tipo: "codigo" } })?.artefacto).toBeUndefined();
    expect(
      sanearTurno({ mensaje: "x", artefacto: { tipo: "codigo", contenido: "  " } })?.artefacto,
    ).toBeUndefined();
  });

  it("un tipo desconocido de artefacto cae en documento, y el lenguaje solo vale en código", () => {
    const doc = sanearTurno({
      mensaje: "x",
      artefacto: { tipo: "otra-cosa", contenido: "hola", lenguaje: "tsx" },
    });
    expect(doc?.artefacto).toEqual({
      tipo: "documento",
      titulo: "Documento",
      lenguaje: undefined,
      contenido: "hola",
    });
  });

  it("recorta el artefacto al tope", () => {
    const t = sanearTurno({
      mensaje: "x",
      artefacto: { tipo: "codigo", titulo: "a.ts", contenido: "y".repeat(MAX_ARTEFACTO + 500) },
    });
    expect(t?.artefacto?.contenido).toHaveLength(MAX_ARTEFACTO);
  });

  it("solo marca fin cuando viene explícito", () => {
    expect(sanearTurno({ mensaje: "x", fin: true })?.fin).toBe(true);
    expect(sanearTurno({ mensaje: "x", fin: "true" })?.fin).toBe(false);
    expect(sanearTurno({ mensaje: "x" })?.fin).toBe(false);
  });
});

describe("sanearConflicto", () => {
  /**
   * El error caro es el falso positivo: una votación abierta por nada
   * interrumpe a toda la sala. Ante cualquier duda, no hay conflicto.
   */
  it("no hay conflicto sin un motivo que lo explique", () => {
    expect(sanearConflicto({ conflicto: true, motivo: "" }).conflicto).toBe(false);
    expect(sanearConflicto({ conflicto: true }).conflicto).toBe(false);
  });

  it("reconoce un conflicto declarado con motivo", () => {
    expect(sanearConflicto({ conflicto: true, motivo: "uno pide A y el otro B" })).toEqual({
      conflicto: true,
      motivo: "uno pide A y el otro B",
    });
  });

  it("tolera basura", () => {
    expect(sanearConflicto(null).conflicto).toBe(false);
    expect(sanearConflicto("nope").conflicto).toBe(false);
    expect(sanearConflicto({ conflicto: "true", motivo: "x" }).conflicto).toBe(false);
  });
});

describe("extraerJson", () => {
  it("lee JSON puro", () => {
    expect(extraerJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("rescata el objeto cuando viene envuelto en prosa", () => {
    expect(extraerJson('Claro:\n{"a":1}\n¿Algo más?')).toEqual({ a: 1 });
  });

  it("devuelve undefined si no hay objeto", () => {
    expect(extraerJson("sin json")).toBeUndefined();
  });
});

describe("ModeloAbierto — leer al proveedor", () => {
  it("saca el texto de la primera opción", () => {
    expect(contenidoDe({ choices: [{ message: { content: "hola" } }] })).toBe("hola");
  });

  it("rechaza respuestas vacías o malformadas", () => {
    expect(contenidoDe({ choices: [{ message: { content: "   " } }] })).toBeUndefined();
    expect(contenidoDe({ choices: [] })).toBeUndefined();
    expect(contenidoDe(null)).toBeUndefined();
    expect(contenidoDe("basura")).toBeUndefined();
  });

  /**
   * Un razonador que piensa en voz alta con llaves adentro engañaría a
   * `extraerJson`: agarraría el objeto del pensamiento, no el del turno.
   */
  it("bota el razonamiento antes de buscar el JSON", () => {
    const crudo = '<think>quizá {"mensaje":"borrador"}…</think>\n{"mensaje":"final"}';
    expect(extraerJson(limpiarRazonamiento(crudo))).toEqual({ mensaje: "final" });
    expect(limpiarRazonamiento("sin pensamiento")).toBe("sin pensamiento");
  });
});

describe("trocear", () => {
  it("deja intacto lo que ya entra", () => {
    expect(trocear("corto", 100)).toEqual(["corto"]);
  });

  it("parte y se puede rearmar sin perder nada", () => {
    const texto = "abcdefghij".repeat(30);
    const partes = trocear(texto, 40);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.join("")).toBe(texto);
  });

  /**
   * El caso que rompía en silencio: el tope de Portal es de bytes, y cortar
   * por `length` hacía que cualquier texto en español pesara el doble de lo
   * previsto. Portal rechazaba el trozo y el artefacto no aparecía nunca.
   */
  it.each([
    ["ascii", "a".repeat(3000)],
    ["acentos", "ó".repeat(3000)],
    ["emoji", "🚀".repeat(800)],
    ["CJK", "漢".repeat(1500)],
    ["saltos de línea", "const x = 1;\n".repeat(400)],
    ["comillas y barras", 'const s = "a\\\\b";\n'.repeat(300)],
  ])("ningún trozo se pasa del presupuesto: %s", (_nombre, texto) => {
    const cabecera = {
      id: "art",
      version: 12,
      tipo: "codigo",
      titulo: "componentes/carrito-de-compras.tsx",
      lenguaje: "tsx",
    };
    const presupuesto = presupuestoDeTexto(cabecera);
    const partes = trocear(texto, presupuesto);

    // Nada se pierde ni se duplica en el viaje.
    expect(partes.join("")).toBe(texto);

    for (let i = 0; i < partes.length; i++) {
      const sobre: Cuerpo = {
        tipo: "artefacto",
        trozo: { ...cabecera, tipo: "codigo", parte: i, total: partes.length, texto: partes[i] },
      };
      const bytes = new TextEncoder().encode(JSON.stringify(sobre)).length;
      expect(bytes).toBeLessThanOrEqual(TOPE_CONTENIDO_BYTES);
    }
  });

  it("no parte un emoji al medio", () => {
    const partes = trocear("🚀".repeat(200), 40);
    // Un par sustituto roto sobrevive como U+FFFD al normalizar; si algún
    // trozo cortara por la mitad, esto lo delata.
    for (const p of partes) expect(p).toBe([...p].join(""));
    expect(partes.join("")).toBe("🚀".repeat(200));
  });
});

describe("ganadoraDe", () => {
  const votacion: Votacion = {
    id: "v1",
    motivo: "chocan",
    opciones: [
      { id: "a", texto: "opción A" },
      { id: "b", texto: "opción B" },
    ],
    cierraEn: 0,
  };

  it("gana la más votada", () => {
    expect(ganadoraDe(votacion, { a: 1, b: 3 }).id).toBe("b");
  });

  it("con empate gana la que se propuso primero", () => {
    expect(ganadoraDe(votacion, { a: 2, b: 2 }).id).toBe("a");
  });

  it("sin votos gana la primera", () => {
    expect(ganadoraDe(votacion, {}).id).toBe("a");
  });
});

describe("ModeloGuionTurno — la ventana no lo congela", () => {
  const base = {
    tarea: "Armar un plan de lanzamiento",
    pendientes: [] as string[],
    decisiones: [] as string[],
  };

  /** una conversación recortada: la ventana solo conserva 1 turno de agente */
  const recortada = [
    { id: "h1", autor: "ana", texto: "dale", deAgente: false, at: 1 },
    { id: "a1", autor: "agente", texto: "sigo", deAgente: true, at: 2 },
    { id: "h2", autor: "beto", texto: "ok", deAgente: false, at: 3 },
  ];

  it("progresa por el conteo del cliente, no por lo que quepa en la ventana", async () => {
    const m = new ModeloGuionTurno();
    // sin turnosDados se congelaría en la línea 1; con él, cierra la tarea
    const t = await m.siguienteTurno({ ...base, conversacion: recortada, turnosDados: 9 });
    expect(t.fin).toBe(true);
  });

  it("sin el conteo explícito conserva la conducta vieja (cuenta la ventana)", async () => {
    const m = new ModeloGuionTurno();
    const t = await m.siguienteTurno({ ...base, conversacion: recortada });
    expect(t.fin).toBe(false);
  });

  it("el resolver no encoge: conserva pedidos que salieron de la ventana", async () => {
    const m = new ModeloGuionTurno();
    const previo = [
      "// Armar el código del proyecto",
      "// pedido de ana: usar sqlite",
      "",
      "export function resolver(entrada: string) {",
      "  return { entrada };",
      "}",
    ].join("\n");

    const t = await m.siguienteTurno({
      ...base,
      tarea: "Armar el código del proyecto",
      conversacion: recortada,
      turnosDados: 3,
      artefacto: { tipo: "codigo", titulo: "resolver.ts", lenguaje: "ts", contenido: previo },
    });

    // el pedido de ana ya no está en la conversación recortada, pero estaba
    // incorporado al archivo: no puede esfumarse de la versión nueva
    expect(t.artefacto?.contenido).toContain("// pedido de ana: usar sqlite");
    // y el pedido visible en la ventana también entra
    expect(t.artefacto?.contenido).toContain("// pedido de beto: ok");
  });
});
