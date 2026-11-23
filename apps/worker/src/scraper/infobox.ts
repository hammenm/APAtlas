export interface Template {
  name: string;
  args: string[];
  raw: string;
}

/** Top-level templates found in a piece of wikitext (nested ones stay inside their parent's args). */
export function findTemplates(text: string): Template[] {
  const templates: Template[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === "{{") {
      if (depth === 0) start = i;
      depth++;
      i++;
    } else if (pair === "}}" && depth > 0) {
      depth--;
      i++;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        const [name = "", ...args] = splitTopLevel(raw.slice(2, -2));
        templates.push({ name: name.trim(), args: args.map((arg) => arg.trim()), raw });
      }
    }
  }

  return templates;
}

/** Named parameters of the first "Infobox game" template, keys lowercased. */
export function extractInfobox(wikitext: string): Map<string, string> | null {
  const infobox = findTemplates(wikitext).find(
    (template) => normalizeName(template.name) === "infobox game",
  );
  if (!infobox) return null;

  const params = new Map<string, string>();
  for (const arg of infobox.args) {
    const separator = arg.indexOf("=");
    if (separator === -1) continue;
    params.set(arg.slice(0, separator).trim().toLowerCase(), arg.slice(separator + 1).trim());
  }
  return params;
}

/** Splits on "|" while ignoring pipes inside nested templates and wiki links. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let braces = 0;
  let links = 0;

  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === "{{" || pair === "}}" || pair === "[[" || pair === "]]") {
      if (pair === "{{") braces++;
      else if (pair === "}}") braces--;
      else if (pair === "[[") links++;
      else links--;
      current += pair;
      i++;
      continue;
    }

    const char = text[i]!;
    if (char === "|" && braces === 0 && links === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

function normalizeName(name: string): string {
  return name.replace(/_/g, " ").trim().toLowerCase();
}
