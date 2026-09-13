import { isApiError } from '../api/client.ts';

export interface ReadState {
  data: unknown;
  error: unknown;
  isError: boolean;
}
/** Only an already authorized snapshot may survive a temporary transport/server failure. */
export function canRetainData(query: ReadState): boolean {
  return (
    query.data !== undefined &&
    query.data !== null &&
    query.isError &&
    isApiError(query.error) &&
    (query.error.status === 0 || (query.error.status >= 500 && query.error.status <= 599))
  );
}
