-- nyuz -- enable deterministic_cluster_skip
--
-- Shadow data now supports confident "different" verdicts: 93/93 agreement
-- on "different" in the test corpus. The code only skips the model on
-- "different" verdicts, never on "same" (3/5 agreement — too risky).
--
-- This flip saves one Flash call per confidently different article.

update public.feature_flags
   set enabled = true,
       description = description || ' Enabled 2026-09-05 after shadow data showed 93/93 agreement on "different" verdicts.'
 where key = 'deterministic_cluster_skip';
