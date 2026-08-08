import { describe, expect, it } from "vitest";

import { alguienEscribe, otrosEn, type Presencia } from "./transporte";

function presencia(p: Partial<Presencia> = {}): Presencia {
  return { total: 0, espectadores: [], detallada: true, ...p };
}

describe("otrosEn", () => {
  it("no me cuenta a mí", () => {
    const p = presencia({
      total: 3,
      espectadores: [
        { id: "a", escribiendo: false, soyYo: true },
        { id: "b", escribiendo: false, soyYo: false },
        { id: "c", escribiendo: false, soyYo: false },
      ],
    });
    expect(otrosEn(p)).toBe(2);
  });

  it("con presencia agregada cae al conteo menos yo", () => {
    expect(otrosEn(presencia({ total: 4, detallada: false }))).toBe(3);
  });

  it("nunca es negativo", () => {
    expect(otrosEn(presencia({ total: 0, detallada: false }))).toBe(0);
  });
});

describe("alguienEscribe", () => {
  it("me ignora a mí escribiendo", () => {
    const p = presencia({
      espectadores: [{ id: "a", escribiendo: true, soyYo: true }],
    });
    expect(alguienEscribe(p)).toBe(false);
  });

  it("usa el booleano si el transporte no da vencimiento (Portal)", () => {
    const p = presencia({
      espectadores: [{ id: "b", escribiendo: true, soyYo: false }],
    });
    expect(alguienEscribe(p)).toBe(true);
  });

  it("caduca contra el reloj si hay vencimiento (mock en segundo plano)", () => {
    // El booleano quedó pegado en true porque el timer está throttleado.
    const p = presencia({
      espectadores: [
        { id: "b", escribiendo: true, escribiendoHasta: 1_000, soyYo: false },
      ],
    });
    expect(alguienEscribe(p, 999)).toBe(true);
    expect(alguienEscribe(p, 1_001)).toBe(false);
  });

  it("sala vacía no escribe", () => {
    expect(alguienEscribe(presencia())).toBe(false);
  });
});
