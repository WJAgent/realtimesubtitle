# Issue agent pilot

The manually triggered workflow handles low-risk bilingual phrasebook additions.

1. Add OPENAI_API_KEY as a repository Actions secret.
2. In Settings, enable Actions to create pull requests. Keep GitHub Actions off the bypass list for the main branch update restriction.
3. After this workflow lands on main, run Issue agent pilot from the Actions tab and enter an issue number. Try issue 3 for the pilot.
4. Open the draft PR, approve PR workflows if prompted, and review the patch after required checks pass.

The publication-report artifact contains the dashboard and run record. The preparation job uses read-only GitHub access. The publishing job pushes the exact issue branch and opens a draft PR. Human maintainers handle merging.
