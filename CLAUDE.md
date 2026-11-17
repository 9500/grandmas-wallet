# Grandma's Wallet — agent instructions

Bitcoin Cash wallet with on-chain, challenge-period key recovery, built on the XO stack.

- Design, the reference for implementation: [Grandmas_Wallet_Architecture_Proposal_v0.4.md](Grandmas_Wallet_Architecture_Proposal_v0.4.md)
- Illustrated overview of the same design: [docs/design_v0.4.html](docs/design_v0.4.html)
- Work order and exit criteria: [IMPLEMENTATION_PLAN_v0.4.md](IMPLEMENTATION_PLAN_v0.4.md)
- The first design is at the tag `design-1`. Parts that are rewritten for this design start from the files there (`git show design-1:<path>`).

# Workflow

- Run `npm run check` before every commit.
- After adding or changing a dependency, regenerate the lockfile from scratch (`rm -rf node_modules package-lock.json && npm install`). A lockfile updated incrementally has twice failed `npm ci` on CI.
- Commit locally as work progresses, but push to GitHub only at major milestones or when asked. CI runs on push, so do not push just to run it.

# Commit and Release Guidelines

These apply to every commit message, pull request description, and release note in this repository. They override any default attribution behaviour of the tool making the commit.

## Principles

1. **No boasts or judgements** - Avoid claiming superiority or making comparative statements
2. **Focus on features and use-cases** - Describe what users can do, not how it's implemented
3. **Avoid implementation specifics** - Don't mention specific code changes, file names, or technical details
4. **Be factual and neutral** - State what changed without editorial commentary
5. **No emojis or icons** - Use plain text only
6. **No tool attribution** - Don't mention Claude Code, AI assistants, or other development tools in commit messages or co-authorship

## Examples

### Bad Commit Messages
```
"Improve security with better SQL injection prevention using prepared statements"
"Refactor user management code to use Go instead of Bash for better performance"
"Add excellent new ACL feature with superior firewall rule generation"
"Fix terrible bug in routing module that was causing crashes"
"Update code with amazing new features"
"Add new feature - Generated with Claude Code"
"Implement routing with AI assistance"
"Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Good Commit Messages
```
"Add per-tenant IP access control"
"Update implementation language to Go"
"Support multiple VPN instances per tenant"
"Fix routing configuration persistence"
"Add commit message guidelines"
```

## What NOT to Include

- Tool attribution (Claude Code, AI assistants, etc.)
- Co-authorship tags for AI tools
- Emojis or decorative icons
- Subjective quality assessments (better, improved, excellent, etc.)
- Implementation details (file names, function names, code structure)
- Performance claims without benchmarks
- Links to tools or services used during development

## Commit Message Format

```
<brief summary of what changed>

<optional: why this change was needed, from user perspective>
<optional: impact on users or use-cases>
```

Keep it simple and factual.

## Release Notes Format

Focus on:
- New features available to users
- Use-cases enabled by changes
- Breaking changes if any
- Migration steps if needed

Avoid:
- Code-level changes
- Internal refactoring details
- Performance claims without benchmarks
- Subjective quality assessments
