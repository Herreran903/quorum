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
