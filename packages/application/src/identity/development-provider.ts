import type { AuthenticatedIdentity, IdentityProvider } from "../ports/identity-provider.js";
export class DevelopmentIdentityProvider implements IdentityProvider {
  async authenticate(input:{authorization?:string;devUser?:string}):Promise<AuthenticatedIdentity|null>{
    if (process.env.NODE_ENV === "production") return null;
    if (process.env.EMAIL_PLATFORM_ALLOW_DEV_IDENTITY !== "true") return null;
    const subject=input.devUser?.trim(); if(!subject) return null;
    const email=subject.includes("@")?subject:`${subject}@local.test`;
    return {subject,email,displayName:subject};
  }
}
