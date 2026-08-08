import { describe, expect, it } from "vitest";

import type { Paso } from "./protocolo";
import {
  Politica,
  UMBRAL_CONFIANZA,
  decidir,
  motivoDeDuda,
  redactarPregunta,
  type Sala,
} from "./iniciativa";

function paso(p: Partial<Paso> = {}): Paso {
  return {
    n: 1,
    texto: "leer el repo",
    riesgo: "bajo",
    confianza: 0.9,
    estado: "ejecutando",
    ...p,
  };
}

const VACIA: Sala = { espectadores: 0, escribiendo: false };
const MIRADA: Sala = { espectadores: 2, escribiendo: false };
const TECLEANDO: Sala = { espectadores: 2, escribiendo: true };

/** ids deterministas para poder afirmar sobre ellos. */
function politica() {
  let n = 0;
  return new Politica({ generarId: () => `id${++n}` });
}

describe("decidir — la regla pura", () => {
  it("espera si alguien está escribiendo, aunque el paso sea trivial", () => {
    expect(decidir(paso(), TECLEANDO)).toBe("ESPERAR");
  });

  it("espera si alguien escribe, incluso con riesgo alto", () => {
    expect(decidir(paso({ riesgo: "alto" }), TECLEANDO)).toBe("ESPERAR");
  });

  it("pregunta si el riesgo es alto y hay espectadores", () => {
    expect(decidir(paso({ riesgo: "alto" }), MIRADA)).toBe("PREGUNTAR");
  });

  it("sigue si el riesgo es alto pero la sala está vacía", () => {
    expect(decidir(paso({ riesgo: "alto" }), VACIA)).toBe("SEGUIR");
  });

  it("pregunta si la confianza es baja y hay espectadores", () => {
    expect(decidir(paso({ confianza: 0.4 }), MIRADA)).toBe("PREGUNTAR");
  });

  it("sigue si la confianza es baja pero la sala está vacía", () => {
    expect(decidir(paso({ confianza: 0.4 }), VACIA)).toBe("SEGUIR");
  });

  it("sigue en el caso normal", () => {
    expect(decidir(paso(), MIRADA)).toBe("SEGUIR");
    expect(decidir(paso(), VACIA)).toBe("SEGUIR");
  });

  it(`el umbral es estricto: ${UMBRAL_CONFIANZA} exacto NO es duda`, () => {
    expect(decidir(paso({ confianza: UMBRAL_CONFIANZA }), MIRADA)).toBe("SEGUIR");
    expect(decidir(paso({ confianza: UMBRAL_CONFIANZA - 0.001 }), MIRADA)).toBe(
      "PREGUNTAR",
    );
  });

  it("escribir gana sobre todo lo demás", () => {
    const critico = paso({ riesgo: "alto", confianza: 0.1 });
    expect(decidir(critico, { espectadores: 5, escribiendo: true })).toBe("ESPERAR");
  });
});

describe("motivoDeDuda", () => {
  it("el riesgo alto pesa más que la confianza", () => {
    expect(motivoDeDuda(paso({ riesgo: "alto", confianza: 0.2 }))).toBe("riesgo-alto");
  });

  it("confianza baja con riesgo bajo", () => {
    expect(motivoDeDuda(paso({ confianza: 0.2 }))).toBe("baja-confianza");
  });

  it("sin duda devuelve undefined", () => {
    expect(motivoDeDuda(paso())).toBeUndefined();
  });
});

describe("Politica — encolar sin testigos", () => {
  it("emite un volante por cada duda con la sala vacía y no pregunta", () => {
    const p = politica();

    const r1 = p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    expect(r1.decision).toBe("SEGUIR");
    expect(r1.volante?.pasos).toEqual([1]);
    expect(r1.pregunta).toBeUndefined();

    const r2 = p.evaluar(paso({ n: 2, confianza: 0.3 }), VACIA);
    expect(r2.decision).toBe("SEGUIR");
    expect(r2.volante?.motivos).toEqual(["baja-confianza"]);

    expect(p.pendientes.map((d) => d.n)).toEqual([1, 2]);
    expect(p.preguntaAbierta).toBeUndefined();
  });

  it("un paso limpio con la sala vacía no encola nada", () => {
    const p = politica();
    const r = p.evaluar(paso({ n: 1 }), VACIA);
    expect(r.decision).toBe("SEGUIR");
    expect(r.volante).toBeUndefined();
    expect(p.pendientes).toHaveLength(0);
  });
});

describe("Politica — agrupación (el anti-ráfaga)", () => {
  it("tres dudas acumuladas a solas salen como UNA sola pregunta", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    p.evaluar(paso({ n: 2, confianza: 0.2 }), VACIA);
    p.evaluar(paso({ n: 3, riesgo: "alto" }), VACIA);

    // entra alguien
    const r = p.revisar(MIRADA);
    expect(r.decision).toBe("PREGUNTAR");
    expect(r.pregunta?.pasos).toEqual([1, 2, 3]);
    expect(r.pregunta?.motivos).toEqual(["riesgo-alto", "baja-confianza"]);
    expect(p.pendientes).toHaveLength(0);
  });

  it("una duda con público arrastra lo pendiente a la misma pregunta", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    p.evaluar(paso({ n: 2, confianza: 0.1 }), VACIA);

    const r = p.evaluar(paso({ n: 3, riesgo: "alto" }), MIRADA);
    expect(r.decision).toBe("PREGUNTAR");
    expect(r.pregunta?.pasos).toEqual([1, 2, 3]);
  });

  it("con una pregunta abierta, las dudas nuevas NO generan más preguntas", () => {
    const p = politica();
    const primera = p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA);
    expect(primera.decision).toBe("PREGUNTAR");

    for (const n of [2, 3, 4]) {
      const r = p.evaluar(paso({ n, riesgo: "alto" }), MIRADA);
      expect(r.decision).toBe("ESPERAR");
      expect(r.pregunta).toBeUndefined();
      expect(r.volante).toBeUndefined();
    }
    expect(p.pendientes.map((d) => d.n)).toEqual([2, 3, 4]);
  });

  it("un paso limpio con pregunta abierta también espera", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA);
    expect(p.evaluar(paso({ n: 2 }), MIRADA).decision).toBe("ESPERAR");
  });

  it("al responder, lo acumulado sale como una sola pregunta nueva", () => {
    const p = politica();
    const primera = p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA);
    p.evaluar(paso({ n: 2, riesgo: "alto" }), MIRADA);
    p.evaluar(paso({ n: 3, confianza: 0.1 }), MIRADA);

    expect(p.responder(primera.pregunta!.id)).toBe(true);
    expect(p.preguntaAbierta).toBeUndefined();

    const r = p.revisar(MIRADA);
    expect(r.decision).toBe("PREGUNTAR");
    expect(r.pregunta?.pasos).toEqual([2, 3]);
  });

  it("responder con un id que no es el abierto no libera nada", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA);
    expect(p.responder("otro")).toBe(false);
    expect(p.preguntaAbierta).toBeDefined();
  });

  it("reevaluar el mismo paso no lo duplica en la cola", () => {
    const p = politica();
    p.evaluar(paso({ n: 7, riesgo: "alto" }), VACIA);
    p.evaluar(paso({ n: 7, riesgo: "alto" }), VACIA);
    expect(p.pendientes.map((d) => d.n)).toEqual([7]);
  });
});

describe("Politica — revisar", () => {
  it("no pregunta si la sala sigue vacía", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    expect(p.revisar(VACIA).decision).toBe("SEGUIR");
    expect(p.pendientes).toHaveLength(1);
  });

  it("no pregunta a alguien que está escribiendo", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    expect(p.revisar(TECLEANDO).decision).toBe("ESPERAR");
    expect(p.pendientes).toHaveLength(1);
  });

  it("sin nada pendiente, revisar deja seguir", () => {
    expect(politica().revisar(MIRADA).decision).toBe("SEGUIR");
  });
});

describe("Politica — reiniciar", () => {
  it("borra cola y pregunta abierta", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA);
    p.evaluar(paso({ n: 2, riesgo: "alto" }), MIRADA);
    p.reiniciar();
    expect(p.pendientes).toHaveLength(0);
    expect(p.preguntaAbierta).toBeUndefined();
    expect(p.evaluar(paso({ n: 3 }), MIRADA).decision).toBe("SEGUIR");
  });
});

describe("Politica — persistencia (la usa la channel extension)", () => {
  it("sobrevive a un ciclo guardar/rehidratar con la cola intacta", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    p.evaluar(paso({ n: 2, confianza: 0.2 }), VACIA);

    // el canal queda inactivo: los campos de instancia se pierden
    const guardado = JSON.parse(JSON.stringify(p.instantanea()));
    const revivida = politica();
    revivida.restaurar(guardado);

    const r = revivida.revisar(MIRADA);
    expect(r.decision).toBe("PREGUNTAR");
    expect(r.pregunta?.pasos).toEqual([1, 2]);
  });

  it("rehidrata una pregunta abierta y sigue frenada", () => {
    const p = politica();
    const abierta = p.evaluar(paso({ n: 1, riesgo: "alto" }), MIRADA).pregunta!;

    const revivida = politica();
    revivida.restaurar(JSON.parse(JSON.stringify(p.instantanea())));

    expect(revivida.preguntaAbierta?.id).toBe(abierta.id);
    expect(revivida.evaluar(paso({ n: 2 }), MIRADA).decision).toBe("ESPERAR");
    expect(revivida.responder(abierta.id)).toBe(true);
  });

  it("restaurar sin estado previo arranca limpia", () => {
    const p = politica();
    p.restaurar(undefined);
    expect(p.pendientes).toHaveLength(0);
    expect(p.preguntaAbierta).toBeUndefined();
  });

  it("la instantánea no comparte referencia con la cola viva", () => {
    const p = politica();
    p.evaluar(paso({ n: 1, riesgo: "alto" }), VACIA);
    const snap = p.instantanea();
    p.evaluar(paso({ n: 2, riesgo: "alto" }), VACIA);
    expect(snap.pendientes).toHaveLength(1);
  });
});

describe("redactarPregunta", () => {
  it("una duda de riesgo se pregunta directo", () => {
    expect(redactarPregunta([{ n: 4, texto: "borrar la tabla", motivo: "riesgo-alto" }]))
      .toBe("El paso 4 es arriesgado: borrar la tabla. ¿Lo hago?");
  });

  it("varias dudas se listan en un solo texto", () => {
    const t = redactarPregunta([
      { n: 1, texto: "a", motivo: "riesgo-alto" },
      { n: 2, texto: "b", motivo: "baja-confianza" },
    ]);
    expect(t).toContain("2 dudas");
    expect(t).toContain("1. a");
    expect(t).toContain("2. b");
  });
});
