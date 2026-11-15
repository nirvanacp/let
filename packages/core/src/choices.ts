// What an app can be built from. The tools and the guidance read this one tree, so a choice that
// is listed but not implemented is refused with the same message everywhere.

export type Choice = { id: string; label: string; implemented: boolean; children?: Choice[] };

/** The applet's UI. */
export const APPLET_CHOICES: Choice[] = [
  {
    id: "web", label: "Web UI", implemented: true, children: [
      { id: "typescript", label: "TypeScript", implemented: true },
      { id: "javascript", label: "JavaScript", implemented: true },
    ],
  },
  { id: "react-native", label: "React Native", implemented: false },
  {
    id: "native", label: "Native app", implemented: false, children: [
      { id: "java", label: "Java", implemented: false },
      { id: "kotlin", label: "Kotlin", implemented: false },
    ],
  },
];

/** The servelet's language and, for Go, its router. */
export const SERVELET_CHOICES: Choice[] = [
  {
    id: "go", label: "Go", implemented: true, children: [
      { id: "default", label: "Go standard library router", implemented: true },
      { id: "chi", label: "chi", implemented: true },
      { id: "gin", label: "gin", implemented: true },
      { id: "echo", label: "echo", implemented: true },
    ],
  },
  { id: "node", label: "JavaScript on Node.js", implemented: false },
];

/** Where a servelet runs. */
export const RUNTIME_CHOICES: Choice[] = [
  { id: "local", label: "Local, on the phone", implemented: true },
  { id: "cloud", label: "Cloud", implemented: false },
];

/** How a local servelet runs on the phone. */
export const ENGINE_CHOICES: Choice[] = [
  { id: "wasm", label: "WebAssembly inside the host", implemented: true },
  { id: "native", label: "Native process", implemented: false },
];

/** An error whose `code` is `NOT_IMPLEMENTED` or `UNKNOWN_CHOICE`. */
export class ChoiceError extends Error {
  constructor(readonly code: "NOT_IMPLEMENTED" | "UNKNOWN_CHOICE", message: string) {
    super(message);
    this.name = "ChoiceError";
  }
}

function available(level: Choice[]): string {
  return level.filter(choice => choice.implemented).map(choice => `${choice.label} (${choice.id})`).join(", ");
}

/**
 * Walks `path` (ids from the top of `tree`) and throws a `ChoiceError` at the first id that is
 * unknown or not implemented, naming the implemented choices at that level.
 */
export function requireImplemented(tree: Choice[], path: string[]): void {
  let level = tree;
  for (const id of path) {
    const choice = level.find(item => item.id === id);
    if (!choice) throw new ChoiceError("UNKNOWN_CHOICE", `Unknown choice "${id}". Available: ${available(level)}.`);
    if (!choice.implemented) throw new ChoiceError("NOT_IMPLEMENTED", `${choice.label} is not implemented yet. Available: ${available(level)}.`);
    level = choice.children ?? [];
  }
}
