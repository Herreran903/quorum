"use client";

/**
 * El tablero de estación: la palabra que voltea.
 *
 * Cuando cambia, cada letra cicla glifos y se asienta por orden — un
 * split-flap sin renderizar un solo disco. Handjet Variable con ELSH 9
 * (verificado en vivo contra los 17 valores del eje: el único donde los
 * discos individuales se VEN) y el peso atado a la atención de la sala.
 */

import { useEffect, useRef, useState } from "react";

const GLIFOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function EstadoTablero({
  palabra,
  testigos,
}: {
  palabra: string;
  testigos: number;
}) {
  /** la palabra en pleno volteo; null = asentada, se muestra `palabra` */
  const [ciclo, setCiclo] = useState<string | null>(null);
  const anterior = useRef(palabra);

  useEffect(() => {
    if (palabra === anterior.current) return;
    anterior.current = palabra;

    // Reducido: el cambio de estado se conserva, el volteo se quita.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cuadro = 0;
    const timer = setInterval(() => {
      cuadro++;
      let salida = "";
      for (let i = 0; i < palabra.length; i++) {
        // Cada letra se asienta por orden: el volteo recorre la palabra.
        const asienta = 3 + i * 2;
        salida +=
          cuadro >= asienta
            ? palabra[i]
            : GLIFOS[Math.floor(Math.random() * GLIFOS.length)];
      }
      if (cuadro >= 3 + palabra.length * 2) {
        setCiclo(null);
        clearInterval(timer);
      } else {
        setCiclo(salida);
      }
    }, 45);
    return () => clearInterval(timer);
  }, [palabra]);

  /**
   * El peso de la palabra ES la atención de la sala: con nadie mirando los
   * discos apenas se encienden; cada testigo que entra la engorda. Dato
   * hecho forma — y la fuente variable lo transiciona sola.
   */
  const peso = 380 + Math.min(testigos, 5) * 90;

  return (
    <h1
      className="text-estado"
      style={{
        fontFamily: "var(--font-tablero)",
        fontVariationSettings: `"ELSH" 9, "wght" ${peso}`,
        transition: "font-variation-settings 400ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      {ciclo ?? palabra}
    </h1>
  );
}
