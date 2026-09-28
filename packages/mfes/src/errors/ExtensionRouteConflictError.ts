import { MfeError } from './MfeError';

export class ExtensionRouteConflictError extends MfeError {
  constructor(
    public readonly extensionId: string,
    public readonly baseRoute: string,
    public readonly presentationRoute: string
  ) {
    super(
      `Extension '${extensionId}' declares conflicting routes: base route '${baseRoute}' does ` +
      `not agree with presentation route '${presentationRoute}'`,
      'EXTENSION_ROUTE_CONFLICT_ERROR'
    );
    this.name = 'ExtensionRouteConflictError';
  }
}
