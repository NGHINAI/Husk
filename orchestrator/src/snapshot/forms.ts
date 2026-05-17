/**
 * Extract form definitions from the page via Runtime.evaluate.
 * Implements M14 Task 5: snapshot.forms discovery.
 *
 * For each <form> on the page, returns:
 *   - action, method
 *   - fields (name, type, label, required, placeholder) — skips non-data types
 *   - submit_text — text of the first submit button, or null
 *
 * Label resolution priority:
 *   1. <label for="id"> matching the field's id attribute
 *   2. Closest ancestor <label> element
 *   3. aria-label attribute
 *
 * aria-required="true" is treated the same as the required HTML attribute.
 * Input types hidden/submit/button/image/reset are excluded from fields.
 *
 * Falls back to [] on any CDP error.
 */

export interface FormField {
  name: string;
  type: string;
  label: string | null;
  required: boolean;
  placeholder: string | null;
}

export interface FormSchema {
  /** Stable ID — left null in T5; reserved for future cross-ref work. */
  stable_id: string | null;
  action: string | null;
  method: string;
  fields: FormField[];
  submit_text: string | null;
}

const EXTRACT_EXPR = `(() => {
  try {
    const forms = [];
    for (const f of document.querySelectorAll("form")) {
      const fields = [];
      for (const el of f.querySelectorAll("input, textarea, select")) {
        const tag = el.tagName.toLowerCase();
        const t = tag === "input" ? (el.getAttribute("type") || "text") : tag;
        if (t === "hidden" || t === "submit" || t === "button" || t === "image" || t === "reset") continue;
        const n = el.getAttribute("name") || el.getAttribute("id") || "";
        const label = (() => {
          const id = el.getAttribute("id");
          if (id) {
            const l = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
            if (l) return (l.textContent || "").trim() || null;
          }
          const parent = el.closest("label");
          if (parent) return (parent.textContent || "").trim() || null;
          return el.getAttribute("aria-label") || null;
        })();
        fields.push({
          name: n,
          type: t,
          label,
          required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
          placeholder: el.getAttribute("placeholder") || null,
        });
      }
      const submit = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      const submitText = submit
        ? (submit.tagName === "INPUT" ? submit.getAttribute("value") : (submit.textContent || "").trim()) || null
        : null;
      forms.push({
        stable_id: null,
        action: f.getAttribute("action") || null,
        method: (f.getAttribute("method") || "GET").toUpperCase(),
        fields,
        submit_text: submitText,
      });
    }
    return forms;
  } catch (e) {
    return null;
  }
})()`;

/**
 * Extract form definitions from the page via CDP Runtime.evaluate.
 *
 * @param cdp CDP client with send(method, params) signature.
 * @param _sid Session ID (unused; provided for API consistency with extractMeta).
 * @returns Array of FormSchema objects. Returns [] on any CDP error.
 */
export async function extractForms(
  cdp: { send(method: string, params: unknown): Promise<{ result?: { value?: FormSchema[] | null } }> },
  _sid: string,
): Promise<FormSchema[]> {
  try {
    const r = await cdp.send("Runtime.evaluate", { expression: EXTRACT_EXPR, returnByValue: true });
    return (r.result?.value as FormSchema[]) ?? [];
  } catch {
    return [];
  }
}
