# Tagmatter

Automatically formats inline #tags into clean YAML frontmatter.

## What it does

Write tags anywhere in your document using the standard #tag syntax, and Tagmatter will automatically format them into your frontmatter. For anyone who prefers using tags throughout their writing, or simply doesn’t want to fuss with YAML, Tagmatter keeps your metadata clean by collecting every inline tag and properly formatting it in frontmatter automatically.

**Example:**

You write:
```
"#Luke, you can destroy the Emperor. He has foreseen this. It is your destiny. Join me, and #together, we can rule the #galaxy as father and son."
```

Tagmatter automatically creates/updates:
```yaml
---
tags:
  - galaxy
  - luke
  - together
---
```

## Features

- **Automatic sync**: Tags are synced to frontmatter when you switch away from the file
- **Smart punctuation handling**: `#tag.` correctly becomes `tag`
- **Lowercase normalization**: Optionally convert tags to lowercase (enabled by default)
- **Automatic cleanup**: Remove tags from frontmatter when you delete them from the document
- **Deduplication**: No duplicate tags in your frontmatter
- **Manual command**: Force sync anytime with the command palette
- **Configurable**: Customize behavior in settings

## Settings

- **Auto-sync tags**: Toggle automatic syncing on file save (default: enabled)
- **Lowercase tags**: Convert all tags to lowercase, e.g., `#Tag` becomes `tag` (default: enabled)

## License

MIT
