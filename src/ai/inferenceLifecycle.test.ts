import { InferenceLifecycle } from './inferenceLifecycle';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

export async function runInferenceLifecycleTests(): Promise<void> {
  const lifecycle = new InferenceLifecycle<number, number>();
  const deferred = new Deferred<number>();
  let calls = 0;

  const first = lifecycle.submit(1, async (value) => {
    calls += 1;
    return value + (await deferred.promise);
  });

  const queued = lifecycle.submit(2, async (value) => {
    calls += 1;
    return value;
  });

  assert(
    (await queued) === null,
    'A window arriving during inference must not start a concurrent call.',
  );
  lifecycle.submit(3, async (value) => {
    calls += 1;
    return value;
  });
  deferred.resolve(1);
  assert((await first) === 2, 'The first inference result was lost.');
  await Promise.resolve();
  assert(
    calls === 2,
    'Only the newest queued window may run after inference.',
  );

  const resetDeferred = new Deferred<number>();
  let resetCalls = 0;
  const resetLifecycle = new InferenceLifecycle<number, number>();
  const resetResult = resetLifecycle.submit(
    1,
    async () => {
      resetCalls += 1;
      return resetDeferred.promise;
    },
  );
  resetLifecycle.reset();
  resetDeferred.resolve(10);
  assert(
    (await resetResult) === 10,
    'The native call result may complete after reset.',
  );
  assert(
    resetCalls === 1 && !resetLifecycle.isCurrent(0),
    'Reset must invalidate the earlier lifecycle generation.',
  );
}
