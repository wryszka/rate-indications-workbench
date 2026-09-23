# UI design language (Databricks-native POC)

This app's frontend is the **reference implementation** of the candidate Databricks-native
design language — **shadcn/ui + Tailwind + a Databricks light/dark theme** (modelled on the
Ontos Databricks Labs app). See the full, reusable spec:

- **Spec:** `bricksurance-playbook/DESIGN_LANGUAGE_DBX.md`
- **Starters:** `bricksurance-playbook/template/frontend-dbx/`

The theme, shell, and `components/ui/*` here are what other workbenches copy to adopt it.
Theme tokens: `src/app/frontend/src/index.css`. Shell: `src/app/frontend/src/App.tsx`.
