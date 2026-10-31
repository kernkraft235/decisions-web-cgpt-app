import { z } from 'zod';

export const criterionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  description: z.string().default(''),
});

export const draftQuestionSchema = z.object({
  id: z.string().min(1),
  savedId: z.string().optional(),
  name: z.string().default(''),
  type: z.enum(['noul', 'choice', 'score']),
  instructions: z.string().default(''),
  trueDescription: z.string().default(''),
  falseDescription: z.string().default(''),
  choices: z.array(criterionSchema).max(255).default([]),
  levels: z.array(criterionSchema).max(10).default([]),
});

export const questionSchema = draftQuestionSchema.extend({
  name: z.string().trim().min(1, 'Name each question.'),
  instructions: z.string().trim().min(1, 'Write the question to ask.'),
}).superRefine((q, context) => {
  const options = q.type === 'choice' ? q.choices : q.type === 'score' ? q.levels : null;
  if (options && options.length < 2) {
    context.addIssue({ code: 'custom', message: `${q.name}: add at least two ${q.type === 'choice' ? 'choices' : 'scale levels'}.` });
  }
  if (options?.some(o => !o.label.trim())) {
    context.addIssue({ code: 'custom', message: `${q.name}: give every option or level a label.` });
  }
  if (q.type === 'choice' && new Set(q.choices.map(o => o.label)).size !== q.choices.length) {
    context.addIssue({ code: 'custom', message: `${q.name}: choice labels must be unique.` });
  }
});

export const draftQuestionListSchema = z.array(draftQuestionSchema).max(200)
  .refine(qs => new Set(qs.map(q => q.id)).size === qs.length, 'Question IDs must be unique.');

export const questionListSchema = z.array(questionSchema).min(1, 'Add a question first.').max(200)
  .refine(qs => new Set(qs.map(q => q.id)).size === qs.length, 'Question IDs must be unique.');

export const evaluationSchema = z.object({
  provider: z.enum(['llama', 'openrouter', 'openai']),
  baseUrl: z.string().optional(),
  model: z.string().trim().min(1, 'Choose a model.'),
  text: z.string().default(''),
  images: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/, 'Use JPEG, PNG, or WebP images.')).max(128).default([]),
  questions: questionListSchema,
}).refine(r => r.text.trim().length || r.images.length, 'Add text or an image to evaluate.');
