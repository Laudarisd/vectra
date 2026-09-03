// Beginner guide: Handles c on cu rr en cy responsibilities for Vectra.
/** Simple counting semaphore. Bounds how many gated calls run at once without
 * claiming anything about true parallelism in the underlying process. */
export class Semaphore {
  #available;
  #queue = [];

  constructor(permits) {
    this.#available = Math.max(1, permits);
  }

  async acquire() {
    if (this.#available > 0) {
      this.#available--;
      return;
    }
    await new Promise((resolve) => this.#queue.push(resolve));
  }

  release() {
    const next = this.#queue.shift();
    if (next) next();
    else this.#available++;
  }
}
