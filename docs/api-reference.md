# Decision API reference

Checked against primary sources on 2026-10-14. All examples here are illustrative, not captured model answers. Do not substitute a chat or Responses call for these endpoints.

| Provider | POST endpoint | Evidence | Questions | Yes/no type |
| --- | --- | --- | --- | --- |
| llama.cpp | `{baseUrl}/systemone` | `state` plus `images` data URLs | Object keyed by question ID | `noul` |
| OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `state` string, or array of strings/image parts | Object keyed by question ID | `noul` |
| OpenAI | `https://api.openai.com/v1/decisions` | `input` string, or user messages with content parts | Array, each with `name` | `predicate` |

All have `choice` and `score` types. Results are probabilities, labels, or expected scores, not generated explanations. Questions about shared evidence can be batched. Score indices start at **0**; the returned score is a probability-weighted average, not necessarily an integer. Provider `confidence` is separate from a winning option's probability.

## llama.cpp / System One

Base URL defaults to `https://llama.ghost-morpho.ts.net/v1`; no API key. `GET {baseUrl}/models` returns `{data: [{id, architecture?: {input_modalities, output_modalities}}]}`. Image support is membership of `image` in inputs; native decision support is membership of `decisions` in outputs. Metadata may be missing. This app lists **all** local models and prefers a native decision model initially.

```json
{
  "model": "clef-flash",
  "state": "A photo of an outdoor sign.",
  "images": ["data:image/jpeg;base64,..."],
  "questions": {
    "readable": {
      "type": "noul",
      "instructions": "Is the sign's text readable?",
      "criteria": {"true": "The main words can be read.", "false": "The main words cannot be read."}
    },
    "category": {
      "type": "choice",
      "instructions": "What kind of sign is it?",
      "criteria": {"warning": "Warns about a hazard.", "direction": "Gives directions.", "other": null}
    },
    "quality": {
      "type": "score",
      "instructions": "How clear is the photo?",
      "criteria": ["Poor: heavily blurred", "Fair: some blur", "Good: sharp details"]
    }
  }
}
```

`images` aliases `files`; use inline base64 data URLs. The app uses a string state and a separate images field. Choice criteria map unique string labels to descriptions or null. Yes/no criteria are optional, with `true` and `false` keys. Score criteria contain 2–10 descriptions from lowest to highest.

```json
{
  "model": "clef-flash",
  "answers": {
    "readable": {"type": "noul", "noul": 0.8},
    "category": {"type": "choice", "choice": "warning", "probabilities": {"warning": 0.7, "direction": 0.2, "other": 0.1}, "confidence": 0.4},
    "quality": {"type": "score", "score": 1.6, "legend": {"0": "Poor: heavily blurred", "1": "Fair: some blur", "2": "Good: sharp details"}, "probabilities": {"0": 0.1, "1": 0.2, "2": 0.7}, "confidence": 0.4}
  },
  "usage": {"input_tokens": 123, "output_tokens": 0}
}
```

Invalid requests return 400. Non-decision models, unsupported image inputs, or missing projectors can return 501. Limits such as choice count vary by model. No streaming.

## OpenRouter

Bearer key from `.env` or the browser's Settings. Native question and response shapes above, including `noul.criteria`, are reused. **Image input differs**: do not send a top-level `images` field.

```json
{
  "model": "cloudflare/clef-flash",
  "state": [
    "A photo of an outdoor sign.",
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
  ],
  "questions": {"readable": {"type": "noul", "instructions": "Is the sign's text readable?"}}
}
```

Top-level state items are strings or Chat Completions-style `image_url` objects. Do not use text-part objects or OpenAI `input_image` parts here. Only inline PNG/JPEG/WebP data URLs; remote URLs are not fetched.

Models: `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`. Filter returned `architecture.output_modalities` for `decisions`; `architecture.input_modalities` advertises image support. Avoid static model-name allowlists.

Response `answers` is an object keyed by question IDs. `probabilities`, `confidence`, and `legend` may be omitted; do not synthesize them. Optional `usage.cost` is USD. Clef/Clef Flash/Clef Omni have a 4-image limit; their image accounting can reject large base64 payloads. The client compresses those images to a small combined budget before an OpenRouter call. Mercury Decide allows 16 images; OpenRouter GPT-6 Luna Decisions allows 128. Clef/Clef Flash on Workers AI read roughly the first 2,000 text tokens. Local llama.cpp does not share that hosted limit.

## OpenAI

Only `gpt-6-luna` is currently supported. Bearer key from `.env` or browser Settings. Use `input`, not `state`, and an array of questions (1–200). The app sends names derived from stable question-instance IDs.

```json
{
  "model": "gpt-6-luna",
  "input": [{"role": "user", "content": [
    {"type": "input_text", "text": "A photo of an outdoor sign."},
    {"type": "input_image", "image_url": "data:image/jpeg;base64,..."}
  ]}],
  "questions": [
    {"type": "predicate", "name": "readable", "instructions": "Is the sign's text readable?"},
    {"type": "choice", "name": "category", "instructions": "What kind of sign is it?", "choices": [
      {"value": "warning", "description": "Warns about a hazard."},
      {"value": "direction", "description": "Gives directions."}
    ]},
    {"type": "score", "name": "quality", "instructions": "How clear is the photo?", "levels": [
      {"label": "Poor", "description": "Heavily blurred."},
      {"label": "Fair", "description": "Some blur."},
      {"label": "Good", "description": "Sharp details."}
    ]}
  ]
}
```

OpenAI has no predicate criteria field, so the adapter appends any optional yes/no definitions to instructions. Choices permit 2–255 unique values; the app uses string labels. Score levels separate labels and descriptions.

```json
{
  "model": "gpt-6-luna",
  "answers": [
    {"type": "predicate", "name": "readable", "probability": 0.8},
    {"type": "choice", "name": "category", "choice": "warning", "probabilities": [{"value": "warning", "probability": 0.7}, {"value": "direction", "probability": 0.3}], "confidence": 0.4},
    {"type": "score", "name": "quality", "score": 1.6, "probabilities": [{"value": 0, "label": "Poor", "probability": 0.1}, {"value": 1, "label": "Fair", "probability": 0.2}, {"value": 2, "label": "Good", "probability": 0.7}], "confidence": 0.4}
  ]
}
```

Answers are ordered and retain names. A single answer can instead be `{type: "refusal", name: "..."}`; the rest may succeed. The app handles each answer independently and matches by name before considering unnamed ordered answers. The guide currently requires inline image data URLs; the reference also mentions hosted URLs. This app uses inline data URLs to satisfy both.

## Sources

- [llama.cpp server reference](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1systemone-typesafe-compatible-system-one-api)
- [OpenRouter Decisions reference maintained by OpenRouter](https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-decisions/references/decisions-api.md)
- [OpenRouter multimodal Decisions](https://openrouter.ai/docs/guides/community/multimodal-decisions)
- [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [OpenAI create decision API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
