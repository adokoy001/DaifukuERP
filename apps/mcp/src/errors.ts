// Protocol-level methods need the same privacy boundary as tools/call.
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { DaifukuError, newId, safeErrorDiagnostics, toErrorBody, type Logger } from '@daifuku/kernel';

export async function withProtocolErrors<T>(log: Logger, method: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof DaifukuError) throw new McpError(ErrorCode.InvalidRequest, err.message, err.toBody());
    const requestId = newId();
    const { body } = toErrorBody(err);
    log.error('protocol request failed', { method, requestId, ...safeErrorDiagnostics(err) });
    throw new McpError(ErrorCode.InternalError, body.message, { ...body, details: { ...body.details, requestId } });
  }
}
