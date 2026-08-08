/**
 * La confianza declarada por el modelo, convertida en grado tipográfico.
 *
 * Redaction trae tramas de medio tono cada vez más gruesas. Aquí un paso
 * dudoso no se marca con un color ni con un icono: se lee DENTADO. El dato
 * deforma la letra.
 *
 * El corte inferior es `UMBRAL_CONFIANZA`, la misma constante con la que la
 * política decide preguntar. No es coincidencia — es el punto: la letra se
 * rompe exactamente donde el agente empieza a dudar, así que ver un paso roto
 * y entender por qué se detuvo es el mismo acto.
 */

import { UMBRAL_CONFIANZA } from "./iniciativa";

export type Grado = "nitido" | "leve" | "dentado";

/** Por encima de esto el modelo está cómodo y la letra sale limpia. */
export const UMBRAL_NITIDO = 0.85;

export function gradoDeConfianza(confianza: number): Grado {
  if (confianza >= UMBRAL_NITIDO) return "nitido";
  if (confianza >= UMBRAL_CONFIANZA) return "leve";
  return "dentado";
}

/** La familia que le corresponde a cada grado. */
export const FAMILIA: Record<Grado, string> = {
  nitido: "var(--font-acta)",
  leve: "var(--font-acta-20)",
  dentado: "var(--font-acta-35)",
};

export function familiaDeConfianza(confianza: number): string {
  return FAMILIA[gradoDeConfianza(confianza)];
}
