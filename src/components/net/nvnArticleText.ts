export function splitNvnArticleParagraphs(body: string): readonly string[] {
  return body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
}
