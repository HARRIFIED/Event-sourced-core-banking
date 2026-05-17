import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProjectionCoordinationService {
  private readonly logger = new Logger(ProjectionCoordinationService.name);
  private activeSharedOperations = 0;
  private exclusiveOperationInProgress = false;
  private exclusiveOperationRequested = false;
  private exclusiveQueue: Promise<void> = Promise.resolve();
  private waitingResolvers: Array<() => void> = [];

  async runShared<T>(work: () => Promise<T>): Promise<T> {
    await this.waitUntil(() => !this.exclusiveOperationRequested && !this.exclusiveOperationInProgress);
    this.activeSharedOperations += 1;

    try {
      return await work();
    } finally {
      this.activeSharedOperations -= 1;
      this.notifyWaiters();
    }
  }

  async runExclusive<T>(reason: string, work: () => Promise<T>): Promise<T> {
    const previousExclusive = this.exclusiveQueue;
    let releaseExclusiveQueue: () => void = () => undefined;
    this.exclusiveQueue = new Promise<void>((resolve) => {
      releaseExclusiveQueue = resolve;
    });

    await previousExclusive;
    this.exclusiveOperationRequested = true;
    this.logger.log(`Pausing live projections for ${reason}.`);
    this.notifyWaiters();

    try {
      await this.waitUntil(() => this.activeSharedOperations === 0 && !this.exclusiveOperationInProgress);
      this.exclusiveOperationInProgress = true;
      this.logger.log(`Live projections paused. Running exclusive projection task for ${reason}.`);
      return await work();
    } finally {
      this.exclusiveOperationInProgress = false;
      this.exclusiveOperationRequested = false;
      this.logger.log(`Exclusive projection task completed for ${reason}. Resuming live projections.`);
      this.notifyWaiters();
      releaseExclusiveQueue();
    }
  }

  private async waitUntil(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
      await new Promise<void>((resolve) => {
        this.waitingResolvers.push(resolve);
      });
    }
  }

  private notifyWaiters(): void {
    const resolvers = this.waitingResolvers.splice(0, this.waitingResolvers.length);
    for (const resolve of resolvers) {
      resolve();
    }
  }
}
