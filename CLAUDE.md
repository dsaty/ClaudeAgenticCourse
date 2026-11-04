# ClaudeAgenticCourse

A Claude chat bot used to learn agentic programming: a Python (FastAPI) backend in
`backend/` that runs the agent loop and tools, and a Vite UI in `frontend/`.
See `README.md` for how to run it.

## Keep the architecture deck up to date (required)

`documentation/Claude-Chat-Bot-Architecture.pptx` must always describe the current code.
Whenever you change the architecture or design, add or change a tool, or add a
feature, update the deck in the same change, before you finish:

1. Edit `documentation/deck/build_deck.js`. It is the source of the deck; never edit the
   .pptx by hand.
   - **New tool:** add a `toolDetailSlide({...})` spec (subtitle, a label/example per
     parameter, processing steps, output fields, error cases, speaker notes) and add the
     tool to the overview slide's `tools` list.
   - **Changed tool:** update its processing steps, output fields and errors. Parameter
     names and enum values are read from `backend/tools.py` automatically.
   - **Architecture or agent-loop change** (new component, endpoint, event type,
     guardrail, data flow): update slide 1 or 2.
   - **New feature** that doesn't fit an existing slide: add a slide in the right section.
2. Rebuild: `cd documentation/deck && npm install && npm run build`.
   The build fails if a tool in `backend/tools.py` has no slide, a slide names a tool
   that doesn't exist, or a slide's parameters don't match the tool's schema.
3. Check the result: render the slides and look for text overflowing its card.
4. Commit the updated .pptx together with the code change.

A Stop hook (`.claude/hooks/check_deck.py`) blocks finishing a turn when code in
`backend/` or `frontend/` changed after the deck was last built. If the change really
doesn't affect anything the deck describes (e.g. a bug fix), say so and finish.
