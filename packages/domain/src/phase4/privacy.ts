export type DeletionState4='requested'|'held'|'discovering'|'deleting'|'anonymizing'|'tombstoned'|'completed'|'failed';
const order:DeletionState4[]=['requested','held','discovering','deleting','anonymizing','tombstoned','completed'];
export interface PrivacyDeletionJob4{id:string;workspaceId:string;profileId:string;state:DeletionState4;requestedAt:Date;updatedAt:Date;tombstoneHash?:string|null;error?:string|null}
export function deletionBlocksProcessing4(state:DeletionState4){return state!=='completed'&&state!=='failed'}
export function canAdvanceDeletion4(from:DeletionState4,to:DeletionState4){if(to==='failed')return from!=='completed';const i=order.indexOf(from),j=order.indexOf(to);return i>=0&&j===i+1}
