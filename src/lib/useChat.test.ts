import { describe, expect, it } from "vitest";

import {
  VACIO,
  VENTANA_CONDUCCION_MS,
  armarArtefacto,
  derivarConductor,
  derivarInstrucciones,
  pendienteActivo,
  reducir,
  type EstadoChat,
} from "./useChat";
import { presupuestoDeTexto, trocear } from "./agente-chat";
import type { Cuerpo, Sobre, TrozoArtefacto } from "./protocolo";

let n = 0;
function sobre(cuerpo: Cuerpo, emisor = "ana", at = 1000): Sobre {
  return { id: `s${++n}`, emisor, at, cuerpo };
}

function aplicar(sobres: Sobre[], desde: EstadoChat = VACIO): EstadoChat {
  return sobres.reduce(reducir, desde);
}

describe("reducir — tarea", () => {
  it("guarda quién la creó y cuándo: es el conductor inicial", () => {
    const e = aplicar([sobre({ tipo: "tarea", tarea: { texto: "hacer algo" } }, "ana", 500)]);
    expect(e.tarea).toBe("hacer algo");
    expect(e.tareaPor).toBe("ana");
    expect(e.tareaAt).toBe(500);
  });

  it("la primera gana: no se redefine a mitad de sesión", () => {
    const e = aplicar([
      sobre({ tipo: "tarea", tarea: { texto: "la buena" } }, "ana"),
      sobre({ tipo: "tarea", tarea: { texto: "otra cosa" } }, "beto"),
    ]);
    expect(e.tarea).toBe("la buena");
    expect(e.tareaPor).toBe("ana");
  });
});

describe("reducir — mensajes", () => {
  it("descarta un id repetido, aunque llegue de otro emisor", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "ana"),
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "beto"),
    ]);
    expect(e.mensajes).toHaveLength(1);
    expect(e.mensajes[0].emisor).toBe("ana");
  });

  it("adjunta emisor y momento, que no viajan en el cuerpo", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "beto", 7000),
    ]);
    expect(e.mensajes[0]).toMatchObject({ emisor: "beto", at: 7000, texto: "hola" });
  });
});

describe("reducir — votos", () => {
  it("un voto por persona: el último reemplaza al anterior", () => {
    const e = aplicar([
      sobre({ tipo: "voto", voto: { votacionId: "v1", opcionId: "a" } }, "ana"),
      sobre({ tipo: "voto", voto: { votacionId: "v1", opcionId: "b" } }, "ana"),
    ]);
    expect(e.votos).toHaveLength(1);
    expect(e.votos[0].opcionId).toBe("b");
  });

  it("personas distintas suman votos", () => {
    const e = aplicar([
      sobre({ tipo: "voto", voto: { votacionId: "v1", opcionId: "a" } }, "ana"),
      sobre({ tipo: "voto", voto: { votacionId: "v1", opcionId: "a" } }, "beto"),
    ]);
    expect(e.votos).toHaveLength(2);
  });

  it("la misma persona puede votar en votaciones distintas", () => {
    const e = aplicar([
      sobre({ tipo: "voto", voto: { votacionId: "v1", opcionId: "a" } }, "ana"),
      sobre({ tipo: "voto", voto: { votacionId: "v2", opcionId: "a" } }, "ana"),
    ]);
    expect(e.votos).toHaveLength(2);
  });
});

describe("reducir — retiro", () => {
  it("el autor retira su propio pedido pendiente", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "ana"),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "ana"),
    ]);
    expect(e.retiros.has("m1")).toBe(true);
  });

  it("ignora el retiro de un pedido ajeno", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "ana"),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "beto"),
    ]);
    expect(e.retiros.has("m1")).toBe(false);
  });

  it("ignora el retiro de un pedido ya aplicado por el agente", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "ana"),
      sobre(
        { tipo: "mensaje", mensaje: { id: "m2", texto: "listo", deAgente: true, atendio: ["m1"] } },
        "agente",
      ),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "ana"),
    ]);
    expect(e.retiros.has("m1")).toBe(false);
  });

  it("ignora el retiro de un id que no existe", () => {
    const e = aplicar([sobre({ tipo: "retiro", retiro: { instruccionId: "fantasma" } }, "ana")]);
    expect(e.retiros.has("fantasma")).toBe(false);
  });

  it("es idempotente", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "hola" } }, "ana"),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "ana"),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "ana"),
    ]);
    expect(e.retiros.size).toBe(1);
  });
});

describe("pendienteActivo", () => {
  function activoDe(estado: EstadoChat) {
    return pendienteActivo(derivarInstrucciones(estado));
  }

  it("sin pedidos no hay nada activo", () => {
    expect(activoDe(VACIO)).toBeUndefined();
  });

  it("con uno solo, ese es el activo", () => {
    const e = aplicar([sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "en prosa" } }, "ana", 1000)]);
    expect(activoDe(e)?.id).toBe("m1");
  });

  it("con dos, gana el que llegó primero — no importa quién lo mandó", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "en prosa" } }, "ana", 3000),
      sobre({ tipo: "mensaje", mensaje: { id: "m2", texto: "en verso" } }, "beto", 1000),
    ]);
    // m2 llegó primero (at: 1000) aunque se publicó después en el array.
    expect(activoDe(e)?.id).toBe("m2");
  });

  it("un pedido ya aplicado no cuenta: pasa al siguiente en la cola", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "en prosa" } }, "ana", 1000),
      sobre({ tipo: "mensaje", mensaje: { id: "m2", texto: "en verso" } }, "beto", 2000),
      sobre(
        { tipo: "mensaje", mensaje: { id: "m3", texto: "listo", deAgente: true, atendio: ["m1"] } },
        "agente",
        2500,
      ),
    ]);
    expect(activoDe(e)?.id).toBe("m2");
  });

  it("un pedido retirado no cuenta", () => {
    const e = aplicar([
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "en prosa" } }, "ana", 1000),
      sobre({ tipo: "mensaje", mensaje: { id: "m2", texto: "en verso" } }, "beto", 2000),
      sobre({ tipo: "retiro", retiro: { instruccionId: "m1" } }, "ana", 1500),
    ]);
    expect(activoDe(e)?.id).toBe("m2");
  });
});

describe("armarArtefacto", () => {
  function trozo(p: Partial<TrozoArtefacto> = {}): TrozoArtefacto {
    return {
      id: "art",
      version: 1,
      tipo: "codigo",
      titulo: "a.ts",
      parte: 0,
      total: 1,
      texto: "hola",
      ...p,
    };
  }

  it("sin trozos no hay artefacto", () => {
    expect(armarArtefacto(new Map())).toBeUndefined();
  });

  it("no muestra una versión incompleta", () => {
    const trozos = new Map([["art:1", [trozo({ parte: 0, total: 2, texto: "mitad" })]]]);
    expect(armarArtefacto(trozos)).toBeUndefined();
  });

  it("rearma en orden aunque los trozos lleguen al revés", () => {
    const trozos = new Map([
      [
        "art:1",
        [
          trozo({ parte: 2, total: 3, texto: "tres" }),
          trozo({ parte: 0, total: 3, texto: "uno" }),
          trozo({ parte: 1, total: 3, texto: "dos" }),
        ],
      ],
    ]);
    expect(armarArtefacto(trozos)?.contenido).toBe("unodostres");
  });

  it("gana la versión más alta que esté completa", () => {
    const trozos = new Map([
      ["art:1", [trozo({ version: 1, texto: "viejo" })]],
      ["art:2", [trozo({ version: 2, texto: "nuevo" })]],
    ]);
    expect(armarArtefacto(trozos)?.contenido).toBe("nuevo");
  });

  it("una versión nueva a medio llegar no pisa a la anterior completa", () => {
    const trozos = new Map([
      ["art:1", [trozo({ version: 1, texto: "completo" })]],
      ["art:2", [trozo({ version: 2, parte: 0, total: 2, texto: "a medias" })]],
    ]);
    expect(armarArtefacto(trozos)?.contenido).toBe("completo");
  });

  it("sobrevive el viaje completo: trocear y volver a armar", () => {
    const original = "const x = 1;\n".repeat(400);
    const partes = trocear(
      original,
      presupuestoDeTexto({ id: "art", version: 3, tipo: "codigo", titulo: "a.ts" }),
    );
    expect(partes.length).toBeGreaterThan(1);

    const trozos = new Map([
      [
        "art:3",
        partes.map((texto, i) =>
          trozo({ version: 3, parte: i, total: partes.length, texto }),
        ),
      ],
    ]);
    expect(armarArtefacto(trozos)?.contenido).toBe(original);
  });
});

describe("derivarConductor", () => {
  const ahora = 100_000;

  it("nadie conduce una sala vacía", () => {
    expect(derivarConductor(VACIO, ahora)).toBeUndefined();
  });

  it("al arrancar conduce quien creó la tarea", () => {
    const e = aplicar([sobre({ tipo: "tarea", tarea: { texto: "x" } }, "ana", ahora - 1000)]);
    expect(derivarConductor(e, ahora)).toBe("ana");
  });

  it("después manda quien publicó lo último del agente", () => {
    const e = aplicar([
      sobre({ tipo: "tarea", tarea: { texto: "x" } }, "ana", ahora - 5000),
      sobre(
        { tipo: "mensaje", mensaje: { id: "m1", texto: "voy", deAgente: true } },
        "beto",
        ahora - 1000,
      ),
    ]);
    expect(derivarConductor(e, ahora)).toBe("beto");
  });

  it("los mensajes humanos no dan el mando", () => {
    const e = aplicar([
      sobre({ tipo: "tarea", tarea: { texto: "x" } }, "ana", ahora - 5000),
      sobre({ tipo: "mensaje", mensaje: { id: "m1", texto: "che" } }, "cami", ahora - 100),
    ]);
    expect(derivarConductor(e, ahora)).toBe("ana");
  });

  it("un conductor callado demasiado tiempo deja el puesto vacante", () => {
    const e = aplicar([
      sobre(
        { tipo: "mensaje", mensaje: { id: "m1", texto: "voy", deAgente: true } },
        "beto",
        ahora - VENTANA_CONDUCCION_MS - 1,
      ),
    ]);
    expect(derivarConductor(e, ahora)).toBeUndefined();
  });

  it("una tarea vieja tampoco deja a nadie al mando", () => {
    const e = aplicar([
      sobre(
        { tipo: "tarea", tarea: { texto: "x" } },
        "ana",
        ahora - VENTANA_CONDUCCION_MS - 1,
      ),
    ]);
    expect(derivarConductor(e, ahora)).toBeUndefined();
  });

  it("tomar el control cambia el mando: el mensaje del nuevo es el último", () => {
    const e = aplicar([
      sobre(
        { tipo: "mensaje", mensaje: { id: "m1", texto: "voy", deAgente: true } },
        "beto",
        ahora - 2000,
      ),
      sobre(
        { tipo: "mensaje", mensaje: { id: "m2", texto: "tomo el control", deAgente: true } },
        "cami",
        ahora - 100,
      ),
    ]);
    expect(derivarConductor(e, ahora)).toBe("cami");
  });
});
