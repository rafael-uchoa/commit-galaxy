## Setup

1. In your profile repo (`username/username`), create `.github/workflows/commit-galaxy.yml`:

   ```yaml
   name: Commit Galaxy
   on:
     schedule:
       - cron: "0 0 * * *"
     workflow_dispatch:
   permissions:
     contents: write
   jobs:
     galaxy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: rafael-uchoa/commit-galaxy@v1
   ```

2. Go to **Actions → Commit Galaxy → Run workflow**.

3. Add this to your `README.md`:

   ```md
   ![Commit Galaxy](./commit-galaxy.svg)
   ```

## Preview

![Commit Galaxy](https://raw.githubusercontent.com/rafael-uchoa/rafael-uchoa/main/commit-galaxy.svg)
