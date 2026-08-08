import { describe, expect, it } from "vitest";

import { UMBRAL_CONFIANZA } from "./iniciativa";
import { UMBRAL_NITIDO, gradoDeConfianza } from "./tipografia";

describe("gradoDeConfianza", () => {
  it("un paso seguro sale nítido", () => {
    expect(gradoDeConfianza(0.95)).toBe("nitido");
    expect(gradoDeConfianza(UMBRAL_NITIDO)).toBe("nitido");
  });

  it("la duda leve degrada un escalón", () => {
    expect(gradoDeConfianza(0.7)).toBe("leve");
    expect(gradoDeConfianza(UMBRAL_NITIDO - 0.001)).toBe("leve");
  });

  it("la letra se rompe EXACTAMENTE en el umbral de la política", () => {
    // El punto de todo el mecanismo: por debajo de este número la política
    // preguntaría, y por debajo de este número la letra sale dentada.
    expect(gradoDeConfianza(UMBRAL_CONFIANZA)).toBe("leve");
    expect(gradoDeConfianza(UMBRAL_CONFIANZA - 0.001)).toBe("dentado");
  });

  it("aguanta los extremos", () => {
    expect(gradoDeConfianza(0)).toBe("dentado");
    expect(gradoDeConfianza(1)).toBe("nitido");
  });
});
