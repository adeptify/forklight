# Candidate reuse runtime fixture

This tiny project exists only for ForkLight dogfood. The Worker should create
`feature.txt`; `verify.mjs` fails its first actual acceptance invocation once,
so Main correction can prove it reuses the retained candidate.
