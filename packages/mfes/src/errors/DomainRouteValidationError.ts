import { MfeError } from './MfeError';

export class DomainRouteValidationError extends MfeError {
  constructor(
    public readonly domainId: string,
    public readonly route: string
  ) {
    super(
      `Domain '${domainId}' declares an invalid route '${route}': must be a lower-case letter ` +
      `followed by lower-case letters, digits, or '-'`,
      'DOMAIN_ROUTE_VALIDATION_ERROR'
    );
    this.name = 'DomainRouteValidationError';
  }
}
