// The `/ui` namespace (src/webui.d.ts).

import type {
  AppMode,
  SdkRpcError,
  WebUiClientToServerEvents,
  WebUiConfig,
  WebUiError,
  WebUiLoginResponse,
  WebUiResponse,
} from '@showtrak/protocol';
import type { Equal, Expect, Extends } from './helpers';

type AckOf<E extends keyof WebUiClientToServerEvents> =
  Parameters<WebUiClientToServerEvents[E]> extends [...unknown[], (response: infer R) => void]
    ? R
    : never;

// rpc answers like /sdk's: the channel authorisation's refusals are the same words.
export type _RpcAck = Expect<Equal<AckOf<'rpc'>, WebUiResponse<unknown>>>;
export type _SharedRefusals = Expect<
  Extends<Extract<SdkRpcError, 'forbidden' | 'edit_mode_required'>, WebUiError>
>;
export type _Mode = Expect<Equal<WebUiConfig['Mode'], AppMode>>;

/** How the browser reads a sign-in: a truthy `ok` narrows to the token. */
export function TokenOf(Response: WebUiLoginResponse): string | null {
  if (Response.ok) return Response.token;
  if (Response.error === 'rate_limited') return String(Response.retryAfterMs);
  return null;
}
