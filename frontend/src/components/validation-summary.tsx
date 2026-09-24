export interface ValidationItem{key:string;passed:boolean;label:string}
export function ValidationSummary({items}:{items:ValidationItem[]}){return <section aria-labelledby="validation-heading"><h2 id="validation-heading">Readiness checks</h2><ul>{items.map(item=><li key={item.key}><strong>{item.passed?"Passed":"Blocked"}</strong> — {item.label}</li>)}</ul></section>}
