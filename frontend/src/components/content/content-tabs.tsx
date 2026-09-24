"use client";

export type ContentTab = "templates" | "emails" | "assets";

export function ContentTabs({workspaceId,active}:{workspaceId:string;active:ContentTab}){
  return <nav className="content-tabs" aria-label="Content sections">
    <a href={`/w/${workspaceId}/content/templates`} aria-current={active==="templates"?"page":undefined}>Templates</a>
    <a href={`/w/${workspaceId}/content/emails`} aria-current={active==="emails"?"page":undefined}>Emails</a>
    <a href={`/w/${workspaceId}/content/assets`} aria-current={active==="assets"?"page":undefined}>Assets</a>
  </nav>;
}
