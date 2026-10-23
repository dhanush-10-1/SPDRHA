type Pending<T> = {
  value: T;
};

export class InferenceLifecycle<T, R> {
  private running = false;
  private pending: Pending<T> | null = null;
  private generation = 0;

  submit(
    value: T,
    execute: (value: T, generation: number) => Promise<R>,
  ): Promise<R | null> {
    if (this.running) {
      this.pending = { value };
      return Promise.resolve(null);
    }

    this.running = true;
    const generation = this.generation;
    return this.run(value, generation, execute);
  }

  reset(): void {
    this.generation += 1;
    this.running = false;
    this.pending = null;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private async run(
    value: T,
    generation: number,
    execute: (value: T, generation: number) => Promise<R>,
  ): Promise<R | null> {
    try {
      if (generation !== this.generation) {
        return null;
      }

      return await execute(value, generation);
    } finally {
      if (generation === this.generation) {
        this.running = false;
        const pending = this.pending;
        this.pending = null;

        if (pending !== null) {
          this.running = true;
          void this.run(
            pending.value,
            generation,
            execute,
          ).catch((error) => {
            console.error(
              'Queued AI inference failed:',
              error,
            );
          });
        }
      }
    }
  }
}
