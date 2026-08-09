import { describe, expect, it, vi } from "vitest";

import { AgenteChat, type VistaAgente } from "./agente-chat";
import type { Cuerpo } from "./protocolo";
import type { Transporte } from "./transporte";

/** Un transporte de mentira que solo anota lo que se publicó. */
function transporteFalso() {
  const publicados: Cuerpo[] = [];
  const t: Transporte = {
    yo: "yo",
    estado: "listo",
    publicar: async (cuerpo) => {
      publicados.push(cuerpo);
    },
    suscribir: () => () => {},
    presencia: () => () => {},
    conexion: () => () => {},
    escribiendo: () => {},
    desconectar: () => {},
  };
  return { t, publicados };
}

function vista(p: Partial<VistaAgente> = {}): VistaAgente {
  return {
    tarea: "una tarea",
    conversacion: [],
    pendientes: [],
    decisiones: [],
    artefacto: undefined,
    enEspera: [],
    votacionAbierta: undefined,
    conteo: {},
    escribiendo: false,
    debeCeder: false,
    ...p,
  };
}

/** Deja correr el primer tick, que `arrancar()` dispara sin esperar. */
const dejarTickear = () => new Promise((r) => setTimeout(r, 0));

describe("AgenteChat — quién tiene el mando", () => {
  it("cede de inmediato si otro tomó el control, sin publicar nada", async () => {
    const { t, publicados } = transporteFalso();
    const onFin = vi.fn();
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);

    const agente = new AgenteChat(t, () => vista({ debeCeder: true }), { onFin });
    agente.arrancar();
    await dejarTickear();

    expect(agente.corriendo).toBe(false);
    expect(publicados).toHaveLength(0);
    // Ni siquiera llega a pedirle un turno al modelo.
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(onFin).toHaveBeenCalled();

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("se calla mientras alguien escribe, pero sigue al mando", async () => {
    const { t, publicados } = transporteFalso();
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);

    const agente = new AgenteChat(t, () => vista({ escribiendo: true }), {});
    agente.arrancar();
    await dejarTickear();

    expect(publicados).toHaveLength(0);
    expect(fetchEspia).not.toHaveBeenCalled();
    // A diferencia de ceder, esto es una pausa: el puesto sigue siendo suyo.
    expect(agente.corriendo).toBe(true);

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("no avanza mientras hay una votación abierta", async () => {
    const { t, publicados } = transporteFalso();
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);

    const agente = new AgenteChat(
      t,
      () =>
        vista({
          votacionAbierta: {
            id: "v1",
            motivo: "chocan",
            opciones: [{ id: "a", texto: "A" }],
            cierraEn: Date.now() + 10_000,
          },
        }),
      {},
    );
    agente.arrancar();
    await dejarTickear();

    expect(publicados).toHaveLength(0);
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(agente.corriendo).toBe(true);

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("un pedido retirado mientras el modelo piensa no se publica ni se da por hecho", async () => {
    const { t, publicados } = transporteFalso();
    // La foto que ve el agente al arrancar el turno tiene el pedido vivo…
    let enCurso = true;
    const ver = () =>
      vista(
        enCurso
          ? { pendientes: ["h1"], enEspera: [{ id: "h1", emisor: "e1", autor: "ana", texto: "x" }] }
          : { pendientes: [], enEspera: [] },
      );

    vi.stubGlobal("fetch", async () => {
      // …y mientras el modelo piensa, ana lo retira.
      enCurso = false;
      return {
        ok: true,
        json: async () => ({
          turno: { mensaje: "lo apliqué", atendio: ["h1"], fin: false },
          fuente: "gemini",
        }),
      };
    });

    const agente = new AgenteChat(t, ver, {});
    agente.arrancar();
    await dejarTickear();

    // Ni el mensaje ni el artefacto: el trabajo se descarta entero.
    expect(publicados).toHaveLength(0);

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("detener() aborta el turno en vuelo", async () => {
    const { t } = transporteFalso();
    let señal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      señal = init.signal ?? undefined;
      return new Promise(() => {}); // nunca resuelve: se queda en vuelo
    });

    const agente = new AgenteChat(t, () => vista(), {});
    agente.arrancar();
    await dejarTickear();
    expect(señal?.aborted).toBe(false);

    agente.detener();
    expect(señal?.aborted).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("AgenteChat — cuando dos pedidos chocan", () => {
  const dePar = [
    { id: "h1", emisor: "e1", autor: "ana", texto: "que el botón sea verde" },
    { id: "h2", emisor: "e2", autor: "beto", texto: "el botón mejor rojo" },
  ];

  it("consulta el choque y abre la votación con los dos pedidos", async () => {
    const { t, publicados } = transporteFalso();
    const fetchEspia = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conflicto: true, motivo: "piden colores opuestos" }),
    });
    vi.stubGlobal("fetch", fetchEspia);

    const agente = new AgenteChat(
      t,
      () => vista({ pendientes: ["h1"], enEspera: dePar }),
      {},
    );
    agente.arrancar();
    await dejarTickear();

    const votacion = publicados.find((c) => c.tipo === "votacion");
    expect(votacion).toBeDefined();
    expect(votacion?.tipo === "votacion" && votacion.votacion.motivo).toBe("piden colores opuestos");
    // Las dos opciones son los pedidos originales, con su autor.
    expect(votacion?.tipo === "votacion" && votacion.votacion.opciones.map((o) => o.id)).toEqual([
      "h1",
      "h2",
    ]);

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("dos pedidos de la MISMA persona no se votan: no es un desacuerdo del equipo", async () => {
    const { t, publicados } = transporteFalso();
    const fetchEspia = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ turno: undefined, fuente: "guion" }),
    });
    vi.stubGlobal("fetch", fetchEspia);

    const mismoAutor = [
      { id: "h1", emisor: "e1", autor: "ana", texto: "que sea verde" },
      { id: "h2", emisor: "e1", autor: "ana", texto: "no, mejor rojo" },
    ];
    const agente = new AgenteChat(
      t,
      () => vista({ pendientes: ["h1"], enEspera: mismoAutor }),
      {},
    );
    agente.arrancar();
    await dejarTickear();

    expect(publicados.some((c) => c.tipo === "votacion")).toBe(false);
    // Ni siquiera se le preguntó al detector: la única llamada es la del turno.
    const consultas = fetchEspia.mock.calls.filter((c) =>
      String((c[1] as RequestInit).body).includes("conflicto"),
    );
    expect(consultas).toHaveLength(0);

    agente.detener();
    vi.unstubAllGlobals();
  });

  it("si el modelo dice que no chocan, no interrumpe a nadie", async () => {
    const { t, publicados } = transporteFalso();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conflicto: false, motivo: "" }),
      }),
    );

    const agente = new AgenteChat(t, () => vista({ pendientes: ["h1"], enEspera: dePar }), {});
    agente.arrancar();
    await dejarTickear();

    expect(publicados.some((c) => c.tipo === "votacion")).toBe(false);

    agente.detener();
    vi.unstubAllGlobals();
  });
});

describe("AgenteChat — el camino libre", () => {
  it("con el camino libre sí pide un turno", async () => {
    const { t } = transporteFalso();
    const fetchEspia = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ turno: undefined, fuente: "guion" }),
    });
    vi.stubGlobal("fetch", fetchEspia);

    const agente = new AgenteChat(t, () => vista(), {});
    agente.arrancar();
    await dejarTickear();

    expect(fetchEspia).toHaveBeenCalledWith("/api/turno", expect.anything());

    agente.detener();
    vi.unstubAllGlobals();
  });
});
