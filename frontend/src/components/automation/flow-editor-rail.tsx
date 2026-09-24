'use client';

export function FlowEditorRail({workspaceId,flowId}:{workspaceId:string;flowId:string}){
 return <nav className="flow-editor-rail" aria-label="Flow editor sections">
  <span className="flow-rail-current"><span aria-hidden="true">⌘</span>Builder</span>
  <a href={`/w/${workspaceId}/flows/${flowId}/runs`}><span aria-hidden="true">⌁</span>Activity</a>
 </nav>;
}
