import { describe, expect, it } from "vitest";

import { alguienEscribe, otrosEn, quienMira, type Presencia } from "./transporte";

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

  it("quien cerró los ojos no cuenta aunque teclee", () => {
    const p = presencia({
      espectadores: [{ id: "b", escribiendo: true, presente: false, soyYo: false }],
    });
    expect(alguienEscribe(p)).toBe(false);
  });
});

describe("Testigo — cerrar los ojos", () => {
  it("quien cierra los ojos sigue conectado pero deja de ser testigo", () => {
    const p = presencia({
      total: 3,
      espectadores: [
        { id: "yo", escribiendo: false, soyYo: true },
        { id: "b", escribiendo: false, presente: false, soyYo: false },
        { id: "c", escribiendo: false, presente: true, soyYo: false },
      ],
    });
    expect(otrosEn(p)).toBe(1);
    expect(p.total).toBe(3);
  });

  it("si todos cierran los ojos, la política ve la sala vacía", () => {
    const p = presencia({
      total: 3,
      espectadores: [
        { id: "yo", escribiendo: false, soyYo: true },
        { id: "b", escribiendo: false, presente: false, soyYo: false },
        { id: "c", escribiendo: false, presente: false, soyYo: false },
      ],
    });
    expect(otrosEn(p)).toBe(0);
  });

  it("`presente` ausente se lee como presente (cliente que no lo reporta)", () => {
    const p = presencia({
      total: 2,
      espectadores: [
        { id: "yo", escribiendo: false, soyYo: true },
        { id: "b", escribiendo: false, soyYo: false },
      ],
    });
    expect(otrosEn(p)).toBe(1);
  });
});

describe("Foco — quién mira cada paso", () => {
  const p = presencia({
    total: 4,
    espectadores: [
      { id: "yo", escribiendo: false, mirandoPaso: 3, soyYo: true },
      { id: "b", escribiendo: false, mirandoPaso: 3, soyYo: false },
      { id: "c", escribiendo: false, mirandoPaso: 5, soyYo: false },
      { id: "d", escribiendo: false, mirandoPaso: 3, presente: false, soyYo: false },
    ],
  });

  it("lista a los otros que miran ese paso", () => {
    expect(quienMira(p, 3).map((e) => e.id)).toEqual(["b"]);
  });

  it("no me incluye a mí aunque lo esté mirando", () => {
    expect(quienMira(p, 3).some((e) => e.soyYo)).toBe(false);
  });

  it("no cuenta a quien tiene los ojos cerrados", () => {
    expect(quienMira(p, 3).some((e) => e.id === "d")).toBe(false);
  });

  it("un paso que nadie mira devuelve vacío", () => {
    expect(quienMira(p, 9)).toHaveLength(0);
  });
});
