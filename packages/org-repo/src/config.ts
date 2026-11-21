/**
 * Configuration of numinia.com's GitHub App for the organizations'
 * repositories — fail closed. A missing or malformed variable names itself;
 * there is no fallback. The private key is a Worker secret (PKCS#8 PEM) and
 * is never logged, echoed in an error or written anywhere.
 */

import { z } from 'zod';

const digits = (name: string) => z.string().regex(/^[1-9][0-9]{0,18}$/, `${name} must be a number`);
/** A GitHub owner or repository name: what GitHub itself accepts, nothing that could bend a URL. */
const slug = (name: string) =>
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, `${name} must be a GitHub name`);

const schema = z.object({
  ORG_REPO_APP_ID: digits('ORG_REPO_APP_ID'),
  ORG_REPO_INSTALLATION_ID: digits('ORG_REPO_INSTALLATION_ID'),
  ORG_REPO_OWNER: slug('ORG_REPO_OWNER'),
  ORG_REPO_TEMPLATE: slug('ORG_REPO_TEMPLATE'),
  ORG_REPO_APP_PRIVATE_KEY: z
    .string()
    .regex(
      /-----BEGIN PRIVATE KEY-----[A-Za-z0-9+/=\s]{100,}-----END PRIVATE KEY-----/,
      'ORG_REPO_APP_PRIVATE_KEY must be a PKCS#8 PEM (BEGIN PRIVATE KEY)',
    ),
});

export interface OrgRepoEnv {
  readonly appId: string;
  readonly installationId: string;
  /** The GitHub organization every organization's repository lives in. */
  readonly owner: string;
  /** The template repository each one is made from. */
  readonly template: string;
  readonly privateKey: string;
}

export class OrgRepoConfigError extends Error {
  constructor(issues: readonly string[]) {
    super(
      `Invalid organization repository configuration:\n${issues.map((issue) => `  ${issue}`).join('\n')}`,
    );
    this.name = 'OrgRepoConfigError';
  }
}

export function parseOrgRepoEnv(input: Readonly<Record<string, string | undefined>>): OrgRepoEnv {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Only the variable's name and the rule: never the value, which may be the key.
    throw new OrgRepoConfigError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
    );
  }
  return {
    appId: parsed.data.ORG_REPO_APP_ID,
    installationId: parsed.data.ORG_REPO_INSTALLATION_ID,
    owner: parsed.data.ORG_REPO_OWNER,
    template: parsed.data.ORG_REPO_TEMPLATE,
    privateKey: parsed.data.ORG_REPO_APP_PRIVATE_KEY,
  };
}
