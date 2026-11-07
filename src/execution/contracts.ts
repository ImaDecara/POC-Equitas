import type { Client } from '../model/client';
import type { Element } from '../model/element';

/** Request accepted by the generic execution controller. */
export interface ExecutionRequest {
  typeId: string;
  elementId: string;
  clientId?: string;
}

/** Information supplied to any concrete execution provider. */
export interface ExecutionContext {
  executionId: string;
  client: Client;
  element: Element;
  configuration: Record<string, unknown>;
}

export type ExecutionStatus = 'SUCCESS' | 'FAILED';

/** Result returned by a provider without exposing provider-specific details. */
export interface ExecutionResult {
  status: ExecutionStatus;
  message: string;
}

/** Strategy contract: the engine decides the flow, providers perform an operation. */
export interface ExecutionExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
