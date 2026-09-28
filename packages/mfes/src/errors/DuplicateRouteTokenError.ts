import { MfeError } from './MfeError';

export class DuplicateRouteTokenError extends MfeError {
  constructor(
    public readonly extensionId: string,
    public readonly conflictingExtensionId: string,
    public readonly domainId: string,
    public readonly token: string
  ) {
    super(
      `Extension '${extensionId}' cannot register route token '${token}' in domain '${domainId}': ` +
      `already claimed by extension '${conflictingExtensionId}'`,
      'DUPLICATE_ROUTE_TOKEN_ERROR'
    );
    this.name = 'DuplicateRouteTokenError';
  }
}
