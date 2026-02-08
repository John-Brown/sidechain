---
paths:
  - "apps/web/**/*.svelte"
  - "apps/web/**/*.svelte.ts"
---

# Svelte 5 Runes

This project uses Svelte 5 exclusively. No legacy stores, no `$:`, no `on:directive`.

## Rune Syntax

- `let x = $state(initial)` — reactive primitive
- `const x = $derived(expr)` — NOT `$derived(() => expr)` (no function wrapper)
- `$derived.by(() => { ... return val })` — only for multi-statement derivations
- `$effect(() => { ... })` — side effects; return cleanup function if needed
- `let { prop1, prop2 } = $props()` — destructure props (supports generics)

## Class-based State

State objects use classes with `$state` fields (not stores):
```typescript
export class FooState {
  value = $state(0);
  get computed(): number { return this.value * 2; } // getters work reactively
}
```

## Event Handlers

- `onclick`, `onpointerdown`, `oninput` — camelCase, no `on:` prefix
- `e.currentTarget` for typed event targets
- Keyboard: check `e.code` (layout-independent), guard against `INPUT`/`TEXTAREA`/`contenteditable` targets

## Context Pattern

Svelte 5 context via `setContext`/`getContext` with Symbol keys:
```typescript
const KEY = Symbol('name');
export function setFoo(s: Foo) { setContext(KEY, s); }
export function getFoo(): Foo { return getContext(KEY); }
```
Set in parent component, get in any descendant.

## Common Mistakes

- `$derived(() => expr)` — WRONG. Use `$derived(expr)` or `$derived.by(() => expr)`
- `on:click` — WRONG. Use `onclick`
- `$: x = ...` — WRONG. Use `$derived` or `$effect`
- `import { writable } from 'svelte/store'` — WRONG. Use `$state`
- Mutating `$derived` values — WRONG. Derived is read-only
