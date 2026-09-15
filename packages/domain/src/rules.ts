export type ProofRule =
  | { type: "email_ends_with"; value: string }
  | { type: "first_name_exists" }
  | { type: "and"; children: ProofRule[] }
  | { type: "or"; children: ProofRule[] };

export function validateRule(rule: ProofRule, depth = 0): void {
  if (depth > 4) throw new Error("RULE_TOO_DEEP");
  if (rule.type === "and" || rule.type === "or") {
    if (rule.children.length < 1 || rule.children.length > 10) throw new Error("RULE_CHILD_COUNT");
    for (const child of rule.children) validateRule(child, depth + 1);
  }
  if (rule.type === "email_ends_with" && (!rule.value || rule.value.length > 255)) throw new Error("RULE_VALUE_INVALID");
}

export function evaluateRule(rule: ProofRule, profile: { email: string; firstName?: string }): boolean {
  validateRule(rule);
  switch (rule.type) {
    case "email_ends_with": return profile.email.toLowerCase().endsWith(rule.value.toLowerCase());
    case "first_name_exists": return Boolean(profile.firstName?.trim());
    case "and": return rule.children.every((c) => evaluateRule(c, profile));
    case "or": return rule.children.some((c) => evaluateRule(c, profile));
  }
}

export interface CompiledRulePlan {
  sql: string;
  params: unknown[];
}

/**
 * Phase 0 parameterized compiler proof. It deliberately supports only the
 * allowlisted proof rule language; user values never become SQL text.
 */
export function compileRuleToSql(rule: ProofRule, alias = "p"): CompiledRulePlan {
  validateRule(rule);
  const params: unknown[] = [];
  const compile = (node: ProofRule): string => {
    switch (node.type) {
      case "email_ends_with": {
        params.push(`%${node.value.toLowerCase()}`);
        return `LOWER(${alias}.normalized_email) LIKE $${params.length}`;
      }
      case "first_name_exists":
        return `NULLIF(BTRIM(${alias}.first_name), '') IS NOT NULL`;
      case "and":
        return `(${node.children.map(compile).join(" AND ")})`;
      case "or":
        return `(${node.children.map(compile).join(" OR ")})`;
    }
  };
  return { sql: compile(rule), params };
}
