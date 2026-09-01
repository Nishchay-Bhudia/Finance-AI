import { createMistral } from '@ai-sdk/mistral';

const mistral = createMistral({
	apiKey: process.env.MISTRAL_API_KEY,
});

// ministral-3b is Mistral's smallest hosted model - cheap on tokens, and
// unlike the local Ollama model, it actually honors toolChoice: 'required'
// and handles tool-call schemas reliably, so the retry loop in server.ts
// should rarely need more than one attempt now.
export const model = mistral('ministral-3b-latest');
