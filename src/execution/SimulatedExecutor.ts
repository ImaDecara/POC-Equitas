import type { ExecutionContext, ExecutionExecutor, ExecutionResult } from './contracts';

/** First-stage provider used until an external tool such as Apache Hop is connected. */
export class SimulatedExecutor implements ExecutionExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    return {
      status: 'SUCCESS',
      message: `Simulated execution completed for ${context.element.Code} and client ${context.client.Code}`,
    };
  }
}
