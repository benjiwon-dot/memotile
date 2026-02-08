/**
 * src/utils/exportQueue.ts
 *
 * Simple sequential queue for processing exports in the background without blocking UI.
 * + Added pause/resume/clear + generation token to prevent tasks running after screen transition/unmount.
 */

type Task = () => Promise<void>;

class ExportQueue {
    private queue: Array<{ task: Task; token: number; name?: string }> = [];
    private isProcessing = false;
    private currentTaskName: string | null = null;

    private paused = false;
    private generation = 0; // increments on pause/clear to invalidate queued tasks

    enqueue(task: Task, name?: string) {
        if (this.paused) {
            // Enqueue ignored while paused (prevents new heavy exports during checkout/unmount)
            return;
        }
        const token = this.generation;
        this.queue.push({ task, token, name });
        this.process();
    }

    pause() {
        this.paused = true;
        this.generation += 1; // invalidate queued tasks
    }

    resume() {
        this.paused = false;
        this.process();
    }

    clear() {
        this.queue = [];
        this.generation += 1; // invalidate queued tasks
    }

    get isPaused() {
        return this.paused;
    }

    get currentToken() {
        return this.generation;
    }

    private async process() {
        if (this.isProcessing) return;
        if (this.paused) return;

        this.isProcessing = true;

        while (this.queue.length > 0) {
            if (this.paused) break;

            const item = this.queue.shift();
            if (!item) continue;

            // If generation changed since enqueue -> drop silently
            if (item.token !== this.generation) continue;

            const { task, name } = item;
            this.currentTaskName = name ?? null;

            try {
                await task();
            } catch (e) {
                console.error("[ExportQueue] Task failed", e);
            } finally {
                this.currentTaskName = null;
            }
        }

        this.isProcessing = false;
        this.currentTaskName = null;
    }

    get pendingCount() {
        return this.queue.length;
    }

    get isBusy() {
        return this.isProcessing;
    }
}

export const exportQueue = new ExportQueue();
