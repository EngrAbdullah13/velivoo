"use client";

import type { Ref } from "react";

export interface PersonalizationVariable {
  key: string;
  label: string;
  requiresFallback: boolean;
  type?: "text" | "url";
}

export function personalizationToken(variable: PersonalizationVariable): string {
  const fallback = variable.key === "profile.last_name" || variable.key === "profile.email" ? "" : "there";
  return `{{ ${variable.key}${variable.requiresFallback ? ` | default: "${fallback}"` : ""} }}`;
}

export function inboxPersonalizationVariables(variables: PersonalizationVariable[]): PersonalizationVariable[] {
  return variables.filter(variable => variable.type !== "url" && !variable.key.startsWith("system.") && variable.key !== "workspace.business_address");
}

export function PersonalizationPicker({ variables, onInsert, pickerRef, label = "Insert placeholder" }: {
  variables: PersonalizationVariable[];
  onInsert: (variable: PersonalizationVariable) => void;
  pickerRef?: Ref<HTMLDetailsElement>;
  label?: string;
}) {
  const groups = [
    { title: "Recipient", items: variables.filter(variable => variable.key.startsWith("profile.")) },
    { title: "Workspace", items: variables.filter(variable => variable.key.startsWith("workspace.")) },
    { title: "Other", items: variables.filter(variable => !variable.key.startsWith("profile.") && !variable.key.startsWith("workspace.")) },
  ];

  return <details className="variable-insert personalization-picker" ref={pickerRef}>
    <summary>{label}</summary>
    <div className="personalization-picker-list">
      {groups.map(group => group.items.length > 0 && <section key={group.title}>
        <h4>{group.title}</h4>
        {group.items.map(variable => <button type="button" key={variable.key} title={personalizationToken(variable)} onClick={event => {
          onInsert(variable);
          event.currentTarget.closest("details")!.open = false;
        }}>{variable.label}<small>{variable.key}</small></button>)}
      </section>)}
      {variables.length === 0 && <p>No placeholders are available.</p>}
    </div>
  </details>;
}
