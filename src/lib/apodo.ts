/** Apodo determinista a partir de un id de participante. Mismo id, mismo apodo siempre. */

const APODOS = ["ana", "beto", "cami", "dani", "eli", "fran", "gabo", "hugo"];

export function apodo(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return APODOS[h % APODOS.length];
}
