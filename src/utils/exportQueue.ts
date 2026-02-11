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
    private generation = 0;

    enqueue(task: Task, name?: string) {
        if (this.paused) return;
        const token = this.generation;
        this.queue.push({ task, token, name });
        this.process();
    }

    pause() {
        this.paused = true;
        this.generation += 1;
    }

    resume() {
        this.paused = false;
        this.process();
    }

    clear() {
        this.queue = [];
        this.generation += 1;
    }

    get isPaused() {
        return this.paused;
    }

    get currentToken() {
        return this.generation;
    }

    get pendingCount() {
        return this.queue.length;
    }

    get isBusy() {
        return this.isProcessing;
    }

    // ✅ ADD: wait until all export tasks finish
    async waitForIdle(timeoutMs = 20000, intervalMs = 120) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (!this.isProcessing && this.queue.length === 0) return;
            await new Promise(r => setTimeout(r, intervalMs));
        }
        throw new Error("ExportQueue timeout: export not finished");
    }

    private async process() {
        if (this.isProcessing || this.paused) return;

        this.isProcessing = true;

        while (this.queue.length > 0) {
            if (this.paused) break;

            const item = this.queue.shift();
            if (!item) continue;
            if (item.token !== this.generation) continue;

            try {
                await item.task();
            } catch (e) {
                console.error("[ExportQueue] Task failed", e);
            }
        }

        this.isProcessing = false;
    }
}

export const exportQueue = new ExportQueue();
