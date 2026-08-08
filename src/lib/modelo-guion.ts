/**
 * El guion fijo, ahora detrás de la interfaz `Modelo`.
 *
 * Es la red de seguridad del demo: si Ollama no está levantado, si el modelo
 * tarda, o si devuelve basura tres veces seguidas, el agente sigue caminando
 * con estos pasos. Un demo que se congela en vivo no se recupera.
 *
 * También sirve para desarrollar la política sin encender el modelo: es
 * determinista, así que pega siempre los mismos casos.
 */

import type { ContextoPaso, Modelo, PasoPropuesto } from "./modelo";
import type { Riesgo } from "./protocolo";

interface Linea {
  texto: string;
  riesgo: Riesgo;
  confianza: number;
}

/**
 * Guion pensado para que la demo pegue los dos casos interesantes: el paso
 * arriesgado con la sala llena y el mismo con la sala vacía.
 */
const GUION: Linea[] = [
  { texto: "Buscar estudios sobre iniciativa de agentes", riesgo: "bajo", confianza: 0.95 },
  { texto: "Leer el resumen de arXiv 2509.11826", riesgo: "bajo", confianza: 0.91 },
  { texto: "Descartar 4 resultados sin revisión por pares", riesgo: "bajo", confianza: 0.58 },
  { texto: "Decidir si el foro de Cursor cuenta como evidencia", riesgo: "bajo", confianza: 0.41 },
  { texto: "Extraer la cifra de 31,8% de trabajo concurrente", riesgo: "bajo", confianza: 0.89 },
  { texto: "Descartar el estudio de 2019 por obsoleto", riesgo: "alto", confianza: 0.52 },
  { texto: "Citar una cifra que solo aparece en un blog", riesgo: "alto", confianza: 0.44 },
  { texto: "Contrastar las tres fuentes entre sí", riesgo: "bajo", confianza: 0.83 },
  { texto: "Interpretar la contradicción entre dos de ellas", riesgo: "bajo", confianza: 0.47 },
  { texto: "Redactar el informe con las tres fuentes", riesgo: "bajo", confianza: 0.9 },
  { texto: "Publicar el informe en el canal del equipo", riesgo: "alto", confianza: 0.78 },
];

/** Por dónde sigue cuando la sala lo desvía. */
const DESVIO: Linea[] = [
  { texto: "Descartar la línea anterior por indicación de la sala", riesgo: "bajo", confianza: 0.94 },
  { texto: "Buscar solo fuentes con revisión por pares", riesgo: "bajo", confianza: 0.87 },
  { texto: "Releer el estudio de 2019 que había descartado", riesgo: "bajo", confianza: 0.66 },
  { texto: "Decidir si la muestra de ese estudio es comparable", riesgo: "bajo", confianza: 0.39 },
  { texto: "Rehacer el informe sin la cifra del blog", riesgo: "bajo", confianza: 0.85 },
  { texto: "Publicar el informe corregido", riesgo: "alto", confianza: 0.81 },
];

export const TAREA_POR_DEFECTO =
  "Investigar si los agentes colaborativos saturan a los usuarios, y con qué evidencia";

export class ModeloGuion implements Modelo {
  readonly nombre = "guion";

  async planear(ctx: ContextoPaso): Promise<PasoPropuesto[]> {
    const linea = ctx.desviado ? DESVIO : GUION;
    return linea.map((g) => ({
      texto: g.texto,
      riesgo: g.riesgo,
      confianza: g.confianza,
      fin: false,
    }));
  }
}
