---
name: skill-creator
description: Create or revise a safe project skill when the user asks to author reusable instructions, scripts, or references.
---

# Skill creator

Use the `lobe-skill-authoring` tool for project skill operations.

## Author

1. Choose a lowercase, hyphenated name and write a complete `SKILL.md` with `name` and `description` frontmatter.
2. Keep the entrypoint concise: put shared workflow and hard constraints in `SKILL.md`; put conditional detail in referenced files.
3. Create the skill, then add or update supporting files with paths relative to its directory.
4. Run `validateProjectSkill` after changes and fix every reported error before finishing.

Use `renameProjectSkill` to keep the directory and frontmatter synchronized. Use `packProjectSkill` when the user needs a portable archive. Use `promoteProjectSkill` only when the user asks to copy a validated project skill into their personal library.

Creating, updating, renaming, deleting, and promoting are confirmation-gated operations. Preserve the user's scope and never place files outside the selected skill directory.
