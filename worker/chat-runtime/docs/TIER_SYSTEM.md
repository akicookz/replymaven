# Knowledge Tier System Documentation

## Overview

The ReplyMaven chatbot uses a hierarchical tier system to prioritize information sources when answering user queries. This ensures that official, hand-written guidance always takes precedence over automatically retrieved content.

## Tier Hierarchy

### Tier 1 Sources (Highest Priority)
1. **Guidelines/SOPs** - Explicit handling rules written by the team
   - Most specific and authoritative source
   - Usually contains workflow-specific instructions
   - Takes precedence over all other sources

2. **Priority FAQs** - Curated FAQ answers from the team
   - Hand-written answers to common questions
   - Second highest priority after guidelines
   - More general than guidelines but still authoritative

### Lower Tier Sources
3. **Knowledge Base** - Retrieved webpage/PDF content
   - Automatically retrieved from documentation
   - Used as fallback when tier-1 sources don't have the answer
   - Can provide supporting context but never overrides tier-1

4. **Company Context** - General business background
   - Broad information about the company
   - Only used for general context, not specific answers
   - Never used for product behavior or troubleshooting

## Conflict Resolution Rules

When sources provide conflicting information:

1. **Tier-1 always wins over lower tiers**
   - Guidelines/FAQs override knowledge base content
   - Exception: Only if tool evidence explicitly proves otherwise

2. **Within Tier-1 conflicts**
   - Guidelines take precedence over FAQs (more specific)
   - More specific rules override general ones
   - If equal specificity, prefer the one directly addressing the question

3. **Partial Information**
   - Tier-1 partial info is never supplemented with lower-tier speculation
   - Complementary info can be combined if no conflicts exist
   - Always indicate confidence level when merging partial matches

## Implementation Notes

### For Developers

- **Internal References**: The system internally tracks these as tier-1 and lower-tier sources
- **User-Facing Language**: Never expose tier structure to users - always say "the documentation" or "my knowledge base"
- **Prompt Building**: The tier hierarchy is enforced in `build-support-system-prompt.ts`
- **Planner Logic**: The planner checks sources in tier order (see `plan-next-action.ts`)

### Key Files

- `prompt/build-support-system-prompt.ts` - Constructs prompts with tier priority
- `planner/plan-next-action.ts` - Implements search strategy respecting tiers
- `executor/run-planner-loop.ts` - Orchestrates the tier-based search process

## Testing Guidelines

When testing tier behavior:

1. **Test precedence**: Ensure tier-1 sources always override lower tiers
2. **Test conflicts**: Verify correct resolution when tier-1 sources disagree
3. **Test hiding**: Confirm users never see internal tier terminology
4. **Test completeness**: Verify multiple search attempts before giving up

## Maintenance

### Adding New Sources

If adding new information sources:
1. Determine appropriate tier based on authoritativeness
2. Update conflict resolution rules if needed
3. Ensure user-facing messages remain generic
4. Add tests for precedence with existing sources

### Modifying Tier Logic

Changes to tier precedence require:
1. Update this documentation
2. Modify `build-support-system-prompt.ts` response rules
3. Update planner prompts in `plan-next-action.ts`
4. Add/update tests to verify new behavior
5. Consider impact on existing production behaviors

## Common Pitfalls

1. **Don't expose tiers to users** - Always use generic terms like "documentation"
2. **Don't skip tier order** - Always check tier-1 before lower tiers
3. **Don't mix tiers carelessly** - Be explicit about confidence when combining sources
4. **Don't assume completeness** - Require multiple search attempts before concluding info is missing