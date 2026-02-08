/**
 * Snapshot-based undo/redo history using Svelte 5 runes.
 * Snapshots are deep-cloned via structuredClone on push/pop.
 * Push on commit (pointerup, create, delete, split, merge, classify) — never during drag.
 */
export class History<T> {
  #undoStack: T[] = $state([]);
  #redoStack: T[] = $state([]);
  #maxSnapshots: number;

  constructor(maxSnapshots = 50) {
    this.#maxSnapshots = maxSnapshots;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get undoCount(): number {
    return this.#undoStack.length;
  }

  get redoCount(): number {
    return this.#redoStack.length;
  }

  push(snapshot: T): void {
    this.#undoStack.push(structuredClone(snapshot));
    if (this.#undoStack.length > this.#maxSnapshots) {
      this.#undoStack.shift();
    }
    this.#redoStack.length = 0;
  }

  undo(currentState: T): T | undefined {
    const snapshot = this.#undoStack.pop();
    if (snapshot === undefined) return undefined;
    this.#redoStack.push(structuredClone(currentState));
    return structuredClone(snapshot);
  }

  redo(currentState: T): T | undefined {
    const snapshot = this.#redoStack.pop();
    if (snapshot === undefined) return undefined;
    this.#undoStack.push(structuredClone(currentState));
    return structuredClone(snapshot);
  }

  clear(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }
}
