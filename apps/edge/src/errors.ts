export class EdgeError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'EdgeError';
  }
}
export const errorCode = (error: unknown): string => (error instanceof EdgeError ? error.code : 'agent_error');
