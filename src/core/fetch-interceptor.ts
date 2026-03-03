// Patches globalThis.fetch to inject X-Kyra-Trace into all outgoing HTTP calls
// from within an agent run. Enables cross-service chain propagation.
// Call activate() once after setting a GovernanceContext.

import { getContext } from "../governance-context";

let _originalFetch: typeof fetch | null = null;
let _active = false;

export function activate(): void {
  if (_active) return;
  _active = true;
  _originalFetch = globalThis.fetch;

  globalThis.fetch = function patchedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const ctx = getContext();
    if (ctx) {
      const headers = new Headers(init?.headers);
      const ctxHeaders = ctx.toHeaders();
      Object.entries(ctxHeaders).forEach(([k, v]) => headers.set(k, v));
      init = { ...init, headers };
    }
    return _originalFetch!(input, init);
  };
}

export function deactivate(): void {
  if (!_active || !_originalFetch) return;
  _active = false;
  globalThis.fetch = _originalFetch;
  _originalFetch = null;
}
