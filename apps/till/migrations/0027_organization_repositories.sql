-- «Each organization's repository» (2026-11-20): an organization — a
-- community, they are the same thing — has ONE private repository in the
-- house's GitHub organization, made from the organization template. What it
-- makes on numinia.com (its worlds, its calendar, its documents) is written
-- there, and the repository is what it downloads, invites someone to, or
-- receives by transfer.
--
-- The till makes no call to GitHub: numinia.com does, and tells the till
-- what became of it. This table is only the link and its state:
--
--   creating     the repository is being made; nothing may be written to it
--   ready        it exists and numinia.com writes to it
--   error        GitHub refused or failed; `problem` says what, in words,
--                and the organization's panel offers to try again
--   transferred  it is the organization's own now, outside the house:
--                numinia.com no longer writes to it, and that is final
--
-- One row per organization, kept: a link is replaced in place, never
-- deleted (trigger below). `name` is the repository's name alone — the
-- GitHub organization it lives in is numinia.com's configuration, not the
-- till's. No person's data: who asked is in no column.

CREATE TABLE organization_repositories (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts (id),
  name TEXT NOT NULL CHECK (
    length(name) BETWEEN 1 AND 100
    AND length(trim(name, 'abcdefghijklmnopqrstuvwxyz0123456789-')) = 0
    AND substr(name, 1, 1) <> '-'
  ),
  state TEXT NOT NULL CHECK (state IN ('creating', 'ready', 'error', 'transferred')),
  problem TEXT CHECK (
    (state = 'error' AND problem IS NOT NULL AND problem = trim(problem)
      AND length(problem) BETWEEN 1 AND 200)
    OR (state <> 'error' AND problem IS NULL)
  ),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

-- Two organizations never share a repository.
CREATE UNIQUE INDEX organization_repositories_name ON organization_repositories (name);

CREATE TRIGGER organization_repositories_kept_on_delete BEFORE DELETE ON organization_repositories
BEGIN
  SELECT RAISE(ABORT, 'the link to an organization''s repository is kept');
END;

-- A repository that was transferred is the organization's own: its row is final.
CREATE TRIGGER organization_repositories_transferred_is_final
BEFORE UPDATE ON organization_repositories
WHEN OLD.state = 'transferred'
BEGIN
  SELECT RAISE(ABORT, 'a transferred repository is no longer the house''s to change');
END;
