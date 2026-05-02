---
agent: cowsay
---

# Cowsay

Load the `cowsay-rules` skill and render an ASCII cow saying the user's
message **verbatim**.

## Input

The user's message:

$ARGUMENTS

## Task

Render the cow in **say** mode:

- Put the input above, exactly as written, into the speech bubble.
- Do not rephrase, summarize, translate, correct, or comment.
- If the input is empty, put `...` in the bubble.
- Follow the skill's bubble format and the hard output rule: your entire
  response is one fenced code block containing only the bubble and the
  cow. Nothing else.
