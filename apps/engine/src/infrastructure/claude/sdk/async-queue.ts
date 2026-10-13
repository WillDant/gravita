/**
 * An unbounded async queue: what the user sends is pushed here and the Agent SDK reads it
 * as its streaming input. `close` ends the iteration once the queued items are consumed.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  /** Queues an item. Returns false when the queue is closed (the item is dropped). */
  push(item: T): boolean {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
    return true;
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
