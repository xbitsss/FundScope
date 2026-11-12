interface InFlightRequest<Value> {
  controller: AbortController;
  promise: Promise<Value>;
  consumers: Set<symbol>;
  settled: boolean;
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The request was cancelled.', 'AbortError');
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  return error;
}

/** Shares identical requests and cancels the transport after its last consumer leaves. */
export class AbortableRequestPool<Key, Value> {
  private readonly requests = new Map<Key, InFlightRequest<Value>>();

  load(key: Key, execute: (signal: AbortSignal) => Promise<Value>, signal?: AbortSignal): Promise<Value> {
    if (signal?.aborted) return Promise.reject(abortError());
    let request = this.requests.get(key);
    if (!request || request.controller.signal.aborted) {
      const controller = new AbortController();
      const created: InFlightRequest<Value> = { controller, consumers: new Set(), settled: false, promise: Promise.resolve(undefined as Value) };
      created.promise = Promise.resolve().then(() => execute(controller.signal)).finally(() => {
        created.settled = true;
        if (this.requests.get(key) === created) this.requests.delete(key);
      });
      this.requests.set(key, created);
      request = created;
    }

    return new Promise<Value>((resolve, reject) => {
      const current = request!;
      const consumer = Symbol('request-consumer');
      let complete = false;
      current.consumers.add(consumer);
      const release = () => {
        if (complete) return;
        complete = true;
        signal?.removeEventListener('abort', onAbort);
        current.consumers.delete(consumer);
        if (!current.settled && current.consumers.size === 0) current.controller.abort();
      };
      const onAbort = () => { release(); reject(abortError()); };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      current.promise.then(value => { if (!complete) { release(); resolve(value); } }, error => { if (!complete) { release(); reject(error); } });
    });
  }

  clear(): void {
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear();
  }

  get size(): number { return this.requests.size; }
}
