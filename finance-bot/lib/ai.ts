import { ollama } from 'ai-sdk-ollama';

export const model = ollama('qwen2.5:3b', {
	think: false,
	options: {
		num_predict: 300,
	},
});
