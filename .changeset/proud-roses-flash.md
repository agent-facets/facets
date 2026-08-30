---
"agent-facets": patch
---

Remove empty directories left behind when an install rolls back.

Cleanup previously only reclaimed directories the run could prove it had
created, identified by inode. That test was both too strict and unsound: a
directory that existed before the run was never a candidate no matter how
empty the rollback left it, and inode identity proves nothing on Linux, which
recycles an inode the moment it is freed.

Rollback now asks the only question that matters — is anything left inside? —
and hands the answer to `rmdir`, which is non-recursive and so refuses to
remove a directory holding anything at all, yours or ours, in a single step
with no check-then-delete window. The walk climbs from each restored path and
stops at the tool's configuration directory (`.claude`, `.opencode`), which is
never removed and never climbed past, so cleanup can only reclaim the tree the
install materialized.
