---
name: github-commit
description: "Commit and push code to GitHub repositories using GitHub CLI (gh). Use when Claude needs to: (1) Stage and commit changes to a local git repository, (2) Push commits to GitHub, (3) Save work to a GitHub repo. Assumes the repository is already cloned locally and gh CLI is authenticated."
---

# GitHub Commit

Commit and push code changes to GitHub using the `gh` CLI.

## Prerequisites

- Repository already cloned locally
- GitHub CLI (`gh`) installed and authenticated
- Working directory is inside the git repository (or use `-C <path>`)

## Workflow

### 1. Check status

```bash
git status
```

### 2. Stage changes

```bash
# Stage specific files
git add <file1> <file2>

# Stage all changes
git add -A
```

### 3. Commit

```bash
git commit -m "Your commit message"
```

### 4. Push

```bash
# Push to current branch
git push

# Push and set upstream (first push of a new branch)
git push -u origin <branch-name>
```

## Common Patterns

**Commit all changes with a message:**
```bash
git add -A && git commit -m "Add feature X" && git push
```

**Commit specific files:**
```bash
git add src/main.py tests/test_main.py
git commit -m "Fix bug in main module"
git push
```

**Work from outside the repo directory:**
```bash
git -C /path/to/repo add -A
git -C /path/to/repo commit -m "Update files"
git -C /path/to/repo push
```

## Commit Message Guidelines

Write clear, concise commit messages:
- Start with a verb (Add, Fix, Update, Remove, Refactor)
- Keep the first line under 72 characters
- Be specific about what changed

Examples:
- `Add user authentication endpoint`
- `Fix null pointer in payment processing`
- `Update dependencies to latest versions`
- `Remove deprecated API calls`

## Troubleshooting

**Not a git repository:**
```bash
# Verify you're in a repo
git rev-parse --git-dir
```

**Authentication issues:**
```bash
# Check gh auth status
gh auth status

# Re-authenticate if needed
gh auth login
```

**Push rejected (remote has new commits):**
```bash
git pull --rebase
git push
```