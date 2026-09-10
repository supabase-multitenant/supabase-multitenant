# Pull Request

## Summary

<!-- What does this change and why? Link the issue: Closes #NN -->

Closes #

## Type

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor
- [ ] chore / build / ci
- [ ] security

## Verification (required)

<!-- Paste the real commands + their output. No "tested locally" without evidence. -->

- [ ] `npm run type-check` → clean
- [ ] `npm test` → green
- [ ] `npm run build` → succeeds
- [ ] Manual check of the affected flow (describe + evidence)

## Security checklist

- [ ] No secrets, tokens, or credentials committed (grep the diff)
- [ ] No production ports / DNS / port-forwarding changed globally
- [ ] Auth/permission changes covered by a RBAC-matrix test (if applicable)
- [ ] Input validation on any new API route

## Notes for reviewers

<!-- Risks, follow-ups, newly discovered issues added to the backlog -->
