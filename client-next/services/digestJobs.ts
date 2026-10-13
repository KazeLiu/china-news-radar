/**
 * Module-level singleton that tracks in-flight digest generation jobs by date.
 * Survives component unmount/remount so switching tabs and returning preserves
 * the running state (button stays "生成中..." instead of resetting to blue).
 */

type Listener = () => void;

const jobs = new Map<string, Promise<void>>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export const digestJobs = {
  isGenerating(date: string): boolean {
    return jobs.has(date);
  },

  /**
   * Start a generation job for the given date. If one is already running for
   * this date, returns the existing promise instead of starting a duplicate.
   */
  start(date: string, runner: () => Promise<void>): Promise<void> {
    const existing = jobs.get(date);
    if (existing) return existing;

    const promise = runner().finally(() => {
      jobs.delete(date);
      notify();
    });
    jobs.set(date, promise);
    notify();
    return promise;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
