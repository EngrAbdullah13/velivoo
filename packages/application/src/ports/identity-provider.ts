export interface AuthenticatedIdentity {
  subject: string;
  email: string;
  displayName?: string;
}

export interface IdentityProvider {
  authenticate(input: { authorization?: string; devUser?: string }): Promise<AuthenticatedIdentity | null>;
}
